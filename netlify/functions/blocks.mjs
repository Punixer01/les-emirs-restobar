import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET  /api/blocks?date=YYYY-MM-DD   (public) — used by the booking form to grey out full slots
// POST /api/blocks   (owner) { date, start, end, seating, reason }  — the "Complet" button
// DELETE /api/blocks (owner) { id }
export default async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    const rows = date
      ? await sql`select * from blocks where block_date = ${date} order by start_time`
      : await sql`select * from blocks where block_date >= current_date order by block_date, start_time`;
    return json({ blocks: rows });
  }

  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (req.method === "POST") {
    const b = await readBody(req);
    if (!b.date || !b.start || !b.end) return json({ error: "date, début et fin requis" }, 400);
    const seating = ["inside", "terrace", "all"].includes(b.seating) ? b.seating : "all";
    const rows = await sql`
      insert into blocks (block_date, start_time, end_time, seating, reason)
      values (${b.date}, ${b.start}, ${b.end}, ${seating}, ${b.reason || "Complet"})
      returning *`;
    return json({ ok: true, block: rows[0] });
  }

  if (req.method === "DELETE") {
    const b = await readBody(req);
    if (!b.id) return json({ error: "id" }, 400);
    await sql`delete from blocks where id = ${b.id}`;
    return json({ ok: true });
  }

  return json({ error: "method" }, 405);
};
