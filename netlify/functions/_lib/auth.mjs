import crypto from "node:crypto";
import { sql } from "./db.mjs";

// Env is read at call time (works on Cloudflare, where env is populated per-request).
// Fail CLOSED: a missing/weak AUTH_SECRET would make every token (login, edit,
// pass) forgeable, so we refuse to sign or verify anything rather than fall back
// to a known default. AUTH_SECRET is a required Pages secret in production.
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || String(s).length < 16) throw new Error("AUTH_SECRET is not configured");
  return s;
}

function b64url(input) { return Buffer.from(input).toString("base64url"); }

/* Staff stay signed in on their own devices — a 12 h token forced a code
   re-entry every day. 90 days behaves like "logged in once"; rotate the
   access codes if a device is lost. */
export function issueToken(role, hours = 24 * 90, gen = 0) {
  const payload = { role, exp: Date.now() + hours * 3600 * 1000, g: gen || 0 };
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export function verifyToken(token, roles) {
  if (!token || typeof token !== "string") return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expect = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
  if (!payload || payload.exp < Date.now()) return null;
  if (roles && !roles.includes(payload.role)) return null;
  return payload;
}

/* Compare in constant time: a plain === leaks how many leading characters
   were right, one byte at a time. */
function sameSecret(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch { return false; }
}

/* Access codes can be changed from the dashboard (owner only): the new code is
   stored HASHED in settings and takes precedence over the deploy-time secret.
   Until the owner changes a code, the env secret still works. */
export function hashCode(code) {
  return crypto.createHmac("sha256", secret()).update("code:" + String(code)).digest("base64url");
}
function sameHash(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && (function(){ try { return crypto.timingSafeEqual(x, y); } catch { return false; } })();
}
/* Four staff roles:
     owner     — everything
     gerant    — the reception dashboard + Crédits, but never a deletion and
                 never the "solde initial"
     reception — the service dashboard
     watcher   — read-only: sees the service live, changes nothing          */
export const STAFF = ["owner", "reception", "gerant", "watcher"];
export const WRITERS = ["owner", "reception", "gerant"];          // everyone but the watcher
export const isWatcher = (me) => !!me && me.role === "watcher";
/* the three Crédits actions the owner keeps for himself */
export const OWNER_ONLY_DEBT_ACTIONS = ["delete_op", "delete_account", "set_opening", "edit_op", "edit_account", "set_photo"];

const CODE_KEYS = [
  ["owner_code", "OWNER_CODE", "owner"],
  ["reception_code", "RECEPTION_CODE", "reception"],
  ["gerant_code", "GERANT_CODE", "gerant"],
  ["watcher_code", "WATCHER_CODE", "watcher"],
];

/* Sessions can be cancelled. Every login carries its role's "generation";
   changing a role's code (or "Déconnecter tous les appareils") moves that
   generation forward, and every older login of that role stops working at once
   — a lost phone or a departed employee is locked out without waiting 90 days.
   Read from settings, cached 30 s per server instance. */
let GEN = null, GEN_AT = 0;
export async function sessionGens() {
  if (GEN && Date.now() - GEN_AT < 30000) return GEN;
  let g = {};
  try {
    const rows = await sql`select value from settings where key = 'session_gen'`;
    if (rows.length) g = JSON.parse(rows[0].value || "{}") || {};
  } catch (e) { if (GEN) return GEN; }           // DB hiccup: keep the last known values
  GEN = g; GEN_AT = Date.now();
  return g;
}
export async function sessionStillValid(payload) {
  if (!payload) return false;
  const g = await sessionGens();
  return (payload.g || 0) === (g[payload.role] || 0);
}
export async function bumpSessions(roles) {
  const g = { ...(await sessionGens()) };
  for (const r of roles) g[r] = (g[r] || 0) + 1;
  await sql`insert into settings (key, value) values ('session_gen', ${JSON.stringify(g)})
            on conflict (key) do update set value = excluded.value`;
  GEN = g; GEN_AT = Date.now();
  return g;
}

export async function codeToRole(code) {
  const c = String(code || "");
  if (!c) return null;
  let stored = {};
  try {
    const rows = await sql`select key, value from settings
                            where key in ('owner_code','reception_code','gerant_code','watcher_code')`;
    rows.forEach((r) => { stored[r.key] = r.value; });
  } catch (e) { /* settings unavailable — fall back to env */ }
  const h = hashCode(c);
  // each role: the DB hash if the owner set one, else the deploy-time secret
  for (const [key, env, role] of CODE_KEYS) {
    if (stored[key] ? sameHash(h, stored[key]) : sameSecret(c, process.env[env])) return role;
  }
  return null;
}

export function editToken(id) {
  return crypto.createHmac("sha256", secret()).update("edit:" + id).digest("base64url").slice(0, 24);
}
export function verifyEditToken(id, token) {
  if (!token) return false;
  const expect = editToken(id);
  const a = Buffer.from(String(token)), b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Pass token — printed into the QR on the guest's booking pass.
   Deliberately separate from editToken: scanning a pass at the door must never
   grant the ability to change the booking. */
export function passToken(id) {
  return crypto.createHmac("sha256", secret()).update("pass:" + id).digest("base64url").slice(0, 22);
}
export function verifyPassToken(id, token) {
  if (!token) return false;
  const a = Buffer.from(String(token)), b = Buffer.from(passToken(id));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function auth(req, roles) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  return verifyToken(token, roles);
}
