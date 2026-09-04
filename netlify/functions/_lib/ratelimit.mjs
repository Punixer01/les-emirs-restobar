import crypto from "node:crypto";
import { sql } from "./db.mjs";

/* Rate limiting for the endpoints anyone on the internet can call.
   Counters live in D1 so they survive isolate recycling — an in-memory
   counter on Cloudflare resets constantly and gives an attacker a fresh
   budget with every cold start. */

export function clientIp(req) {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

/* The IP is hashed: this table is not a log of who visited the site. */
function bucket(scope, ip) {
  return scope + ":" + crypto.createHash("sha256").update(String(ip)).digest("base64url").slice(0, 16);
}

/**
 * @returns {Promise<{ok:boolean, remaining:number, retryAfter:number}>}
 */
export async function rateLimit(req, scope, max, windowSec) {
  const key = bucket(scope, clientIp(req));
  const now = Math.floor(Date.now() / 1000);
  try {
    const rows = await sql`select count, reset_at from rate_limits where key = ${key}`;
    const row = rows[0];

    if (!row || Number(row.reset_at) <= now) {
      await sql`insert into rate_limits (key, count, reset_at) values (${key}, 1, ${now + windowSec})
                on conflict (key) do update set count = 1, reset_at = ${now + windowSec}`;
      return { ok: true, remaining: max - 1, retryAfter: 0 };
    }

    if (Number(row.count) >= max) {
      return { ok: false, remaining: 0, retryAfter: Number(row.reset_at) - now };
    }

    await sql`update rate_limits set count = count + 1 where key = ${key}`;
    return { ok: true, remaining: max - Number(row.count) - 1, retryAfter: 0 };
  } catch (e) {
    /* A limiter that breaks must not take the site down with it. */
    console.error("[ratelimit]", e);
    return { ok: true, remaining: max, retryAfter: 0 };
  }
}

/* Occasionally drop expired rows so the table cannot grow without bound. */
export async function sweepLimits() {
  if (Math.random() > 0.02) return;
  try { await sql`delete from rate_limits where reset_at < ${Math.floor(Date.now() / 1000)}`; }
  catch (e) { /* never fatal */ }
}
