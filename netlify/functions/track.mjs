import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";

// POST /api/track  { type, path, meta } — public interaction analytics (never blocks UX)
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const b = await readBody(req);
  const type = String(b.type || "event").slice(0, 40);
  const path = b.path ? String(b.path).slice(0, 200) : null;
  const meta = b.meta && typeof b.meta === "object" ? b.meta : {};
  try {
    await sql`insert into events (type, path, meta) values (${type}, ${path}, ${JSON.stringify(meta)}::jsonb)`;
  } catch (e) {
    /* analytics must never break the site */
  }
  return json({ ok: true });
};
