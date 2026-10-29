import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, STAFF, isWatcher } from "./_lib/auth.mjs";

/* Réservations manquées — every online request the site turned away as
   "complet". The guest's details are kept even if they closed the popup
   without choosing anything, so the restaurant can call them back.

   recordMissed(value)                      called by reservations.mjs on a 409
   GET  /api/missed            (staff)      the list, newest first, with what became of it
   GET  /api/missed?count=1    (staff)      how many are still to call
   POST /api/missed {action:'close', id}    (staff) handled / given up            */

/* one line per guest and day: a second "complet" try updates it */
export async function recordMissed(v) {
  if (!v.phone) return;
  const open = await sql`select id from missed where phone = ${v.phone} and res_date = ${v.date} and status = 'open' limit 1`;
  if (open.length) {
    await sql`update missed set name = ${v.name}, email = ${v.email || null}, res_time = ${v.time},
      party_size = ${v.party}, seating = ${v.seating}, tries = tries + 1, created_at = datetime('now')
      where id = ${open[0].id}`;
    return;
  }
  await sql`insert into missed (name, phone, email, res_date, res_time, party_size, seating)
    values (${v.name}, ${v.phone}, ${v.email || null}, ${v.date}, ${v.time}, ${v.party}, ${v.seating})`;
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
      const r = await sql.query(`select count(*) as n from (select m.status, m.res_date, ${OUTCOME} from missed m)
        where status = 'open' and booked_ref is null and on_waitlist is null and res_date >= date('now','+1 hour')`);
      return json({ n: (r[0] && r[0].n) || 0 });
    }
    const rows = await sql.query(`select m.*, ${OUTCOME} from missed m order by m.created_at desc, m.id desc limit 300`);
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
