import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { notifyClientDecision } from "./_lib/notify.mjs";

const ALLOWED = ["pending", "accepted", "declined", "arrived", "seated", "no_show", "cancelled"];

// POST /api/reservation-status  { id, status }
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const { id, status } = await readBody(req);
  if (!id || !ALLOWED.includes(status)) return json({ error: "bad request" }, 400);

  const rows = await sql`update reservations set status = ${status}, updated_at = now() where id = ${id} returning *`;
  if (!rows.length) return json({ error: "not found" }, 404);
  const r = rows[0];

  // client stats + policy side-effects
  if ((status === "seated" || status === "arrived") && r.client_id) {
    await sql`update clients set bookings_completed = bookings_completed + 1, last_visit = now() where id = ${r.client_id}`;
  }

  if (status === "no_show") {
    if (r.client_id) await sql`update clients set no_shows = no_shows + 1 where id = ${r.client_id}`;
    const pol = await sql`select value from settings where key = 'policy'`;
    const auto = pol.length ? pol[0].value?.noshow_blacklist !== false : true;
    if (auto) {
      await sql`insert into blacklist (phone, name, reason, created_by)
                values (${r.phone}, ${r.name}, 'No-show / réservation non honorée', ${me.role})
                on conflict (phone) do nothing`;
      if (r.client_id) await sql`update clients set is_blocked = true where id = ${r.client_id}`;
    }
  }

  if (status === "accepted" || status === "declined") {
    try { await notifyClientDecision(r); } catch (e) { console.error("[notify decision]", e); }
  }

  return json({ ok: true, reservation: r });
};
