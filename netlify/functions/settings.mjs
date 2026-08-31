import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET  /api/settings           (public) -> { settings } (capacity, hours, policy)
// POST /api/settings  (owner)  { key, value } -> upsert
export default async (req) => {
  if (req.method === "GET") {
    const rows = await sql`select key, value from settings`;
    const out = {};
    rows.forEach((r) => { try { out[r.key] = JSON.parse(r.value); } catch (e) { out[r.key] = r.value; } });
    return json({ settings: out });
  }
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);
  if (req.method === "POST") {
    const b = await readBody(req);
    if (!b.key) return json({ error: "key" }, 400);
    await sql`
      insert into settings (key, value) values (${b.key}, ${JSON.stringify(b.value)})
      on conflict (key) do update set value = excluded.value`;
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};
