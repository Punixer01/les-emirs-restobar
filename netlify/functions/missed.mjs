import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, STAFF, isWatcher } from "./_lib/auth.mjs";
import { notifyOwnerMissed } from "./_lib/notify.mjs";

/* Réservations manquées — every online request the site turned away as
   "complet". The guest's details are kept even if they closed the popup
   without choosing anything, so the restaurant can call them back.

   recordMissed(value)                      called by reservations.mjs on a 409
   GET  /api/missed            (staff)      the unfinished ones, newest first
   GET  /api/missed?count=1    (staff)      how many are still to call
   POST /api/missed {action:'close', id}    (staff) handled / given up            */

/* one line per guest and day: a second "complet" try updates it. Each try
   alerts again (the guest is still waiting for a table) — except the very same
   request repeated within 10 minutes, which is one guest tapping twice. */
export async function recordMissed(v) {
  if (!v.phone) return;
  const open = await sql`select id, res_time, seating, party_size, created_at from missed
    where phone = ${v.phone} and res_date = ${v.date} and status = 'open' limit 1`;
  if (open.length) {
    const o = open[0];
    const same = String(o.res_time).slice(0, 5) === String(v.time).slice(0, 5) && o.seating === v.seating && +o.party_size === +v.party;
    const recent = Date.now() - Date.parse(String(o.created_at).replace(" ", "T") + "Z") < 10 * 60 * 1000;
    await sql`update missed set name = ${v.name}, email = ${v.email || null}, res_time = ${v.time},
      party_size = ${v.party}, seating = ${v.seating}, tries = tries + 1, created_at = datetime('now')
      where id = ${o.id}`;
    if (!(same && recent)) await notifyOwnerMissed(sql, v);
    return;
  }
  await sql`insert into missed (name, phone, email, res_date, res_time, party_size, seating)
    values (${v.name}, ${v.phone}, ${v.email || null}, ${v.date}, ${v.time}, ${v.party}, ${v.seating})`;
  /* a new guest turned away: the owner and every staff dashboard are alerted */
  await notifyOwnerMissed(sql, v);
}

/* booked anyway (another place or hour, same day) or put on the waiting list */
const OUTCOME = `
  (select r.reference from reservations r where r.phone = m.phone and r.res_date = m.res_date
     and r.status not in ('refused','cancelled') limit 1) as booked_ref,
  (select 1 from waitlist w where w.phone = m.phone and w.res_date = m.res_date limit 1) as on_waitlist`;

export default async (req) => {
  const me = auth(req, STAFF);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET") {
    if (new URL(req.url).searchParams.get("count") === "1") {
      const r = await sql.query(`select count(*) as n, max(created_at) as last from (select m.status, m.res_date, m.created_at, ${OUTCOME} from missed m)
        where status = 'open' and booked_ref is null and on_waitlist is null and res_date >= date('now','+1 hour')`);
      return json({ n: (r[0] && r[0].n) || 0, last: (r[0] && r[0].last) || "" });
    }
    /* only the unfinished ones: a guest who then booked (another place or hour)
       or joined the waiting list is not a missed reservation */
    const rows = await sql.query(`select * from (select m.*, ${OUTCOME} from missed m)
      where booked_ref is null and on_waitlist is null order by created_at desc, id desc limit 300`);
    return json({ missed: rows });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (isWatcher(me)) return json({ error: "Compte en lecture seule." }, 403);
  const b = await readBody(req);
  const id = parseInt(b.id, 10);
  if (b.action !== "close" || !id) return json({ error: "bad request" }, 400);
  await sql`update missed set status = 'closed', closed_at = datetime('now') where id = ${id}`;
  return json({ ok: true });
};
