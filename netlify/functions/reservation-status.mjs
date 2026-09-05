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

  const body = await readBody(req);
  const { id, status } = body;

  /* Rétablir — undo a no-show: the guest goes back to "accepted" (so it shows in
     Acceptées and, if today, in Pas encore arrivé), the manual no-show tally is
     reversed and the automatic no-show blacklisting is lifted. No email. */
  if (body.restore) {
    if (!id) return json({ error: "bad request" }, 400);
    const found = await sql`select * from reservations where id = ${id}`;
    if (!found.length) return json({ error: "not found" }, 404);
    const r = found[0];
    const upd = await sql`
      update reservations
         set status = 'accepted', arrived_at = null, seated_at = null,
             late_minutes = null, waiting = 0, updated_at = datetime('now')
       where id = ${id} returning *`;
    if (r.client_id) await sql`update clients set no_shows = max(0, no_shows - 1) where id = ${r.client_id}`;
    await sql`delete from blacklist where phone = ${r.phone} and reason = 'No-show / réservation non honorée'`;
    const left = await sql`select count(*) as n from blacklist where phone = ${r.phone}`;
    if (r.client_id && (!left.length || left[0].n === 0)) {
      await sql`update clients set is_blocked = false where id = ${r.client_id}`;
    }
    return json({ ok: true, reservation: upd[0] });
  }

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
    /* free the table the moment the guest is a confirmed no-show, so it can be
       given to someone else without a second tap */
    if (r.table_id) { await sql`update reservations set table_id = null, waiting = 0 where id = ${id}`; r.table_id = null; r.waiting = 0; }
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
