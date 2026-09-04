import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { notifyClientDecision } from "./_lib/notify.mjs";

const ALLOWED = ["pending", "accepted", "declined", "arrived", "seated", "no_show", "cancelled", "expired"];

// POST /api/reservation-status  { id, status }
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const { id, status } = await readBody(req);
  if (!id || !ALLOWED.includes(status)) return json({ error: "bad request" }, 400);

  /* Accepting (or re-accepting a client-modified booking) clears the review
     flag so it leaves the "à revoir" state. */
  const clearMod = (status === "accepted") ? 1 : 0;
  const rows = clearMod
    ? await sql`update reservations set status = ${status}, modified = 0, mod_summary = null, updated_at = datetime('now') where id = ${id} returning *`
    : await sql`update reservations set status = ${status}, updated_at = datetime('now') where id = ${id} returning *`;
  if (!rows.length) return json({ error: "not found" }, 404);
  const r = rows[0];

  // client stats + policy side-effects
  if ((status === "seated" || status === "arrived") && r.client_id) {
    await sql`update clients set bookings_completed = bookings_completed + 1, last_visit = datetime('now') where id = ${r.client_id}`;
  }

  if (status === "no_show") {
    if (r.client_id) await sql`update clients set no_shows = no_shows + 1 where id = ${r.client_id}`;
    const pol = await sql`select value from settings where key = 'policy'`;
    let _pv = {}; try { _pv = pol.length ? JSON.parse(pol[0].value || "{}") : {}; } catch (e) {}
    const auto = _pv.noshow_blacklist !== false;
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
