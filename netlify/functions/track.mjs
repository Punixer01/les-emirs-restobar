import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { rateLimit } from "./_lib/ratelimit.mjs";

// POST /api/track  { type, path, meta } — public interaction analytics (never blocks UX)
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  /* This writes a row per call, so it is a free lever on the database.
     Generous for a real visitor, closed to a flood. */
  const gate = await rateLimit(req, "track", 120, 60 * 60);
  if (!gate.ok) return json({ ok: true, skipped: true });

  const b = await readBody(req);
  const type = String(b.type || "event").slice(0, 40);
  const path = b.path ? String(b.path).slice(0, 200) : null;
  const meta = b.meta && typeof b.meta === "object" ? b.meta : {};
  try {
    await sql`insert into events (type, path, meta) values (${type}, ${path}, ${JSON.stringify(meta)})`;
  } catch (e) {
    /* analytics must never break the site */
  }
  return json({ ok: true });
};
