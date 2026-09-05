import { sql } from "./_lib/db.mjs";
import { json, readBody, normPhone } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET /api/blacklist  (owner)
// POST /api/blacklist (owner) { phone, name, reason }
// DELETE /api/blacklist (owner) { phone }
export default async (req) => {
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET") {
    const rows = await sql`select * from blacklist order by created_at desc`;
    return json({ blacklist: rows });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const phone = normPhone(b.phone);
    if (!phone) return json({ error: "téléphone requis" }, 400);
    const rows = await sql`
      insert into blacklist (phone, name, reason, created_by)
      values (${phone}, ${b.name || null}, ${b.reason || "Ajouté par le restaurant"}, ${me.role})
      on conflict (phone) do update
        set reason = excluded.reason, name = coalesce(excluded.name, name)
      returning *`;
    await sql`update clients set is_blocked = 1 where phone = ${phone}`;
    return json({ ok: true, entry: rows[0] });
  }

  if (req.method === "DELETE") {
    const b = await readBody(req);
    const phone = normPhone(b.phone);
    if (!phone) return json({ error: "téléphone requis" }, 400);
    await sql`delete from blacklist where phone = ${phone}`;
    await sql`update clients set is_blocked = 0 where phone = ${phone}`;
    return json({ ok: true });
  }

  return json({ error: "method" }, 405);
};
