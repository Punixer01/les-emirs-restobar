import { sql } from "./_lib/db.mjs";
import { json, readBody, validateBooking, makeRef } from "./_lib/util.mjs";
import { auth, passToken } from "./_lib/auth.mjs";
import { sweepExpired } from "./_lib/sweep.mjs";
import { notifyClientReceived, notifyOwnerNew } from "./_lib/notify.mjs";
import { rateLimit } from "./_lib/ratelimit.mjs";

// GET  /api/reservations   (staff) — ?status= &date= &scope=today|upcoming|waiting
// POST /api/reservations   (public) — create a booking
//                          (staff)  — add one directly from the dashboard
export default async (req) => {
  if (req.method === "GET") return list(req);
  if (req.method === "POST") return create(req);
  return json({ error: "method" }, 405);
};

/* every list carries the table and the guest's punctuality record, so the
   dashboard never has to fan out a query per row */
const SELECT = `
  select r.*,
         t.code  as table_code,
         t.zone  as table_zone,
         t.seats as table_seats,
         (select group_concat(tk.code) from tables tk where tk.merged_into = t.id) as merged_codes,
         c.bookings_completed, c.bookings_total, c.no_shows,
         c.on_time, c.late_count, c.is_blocked
  from reservations r
  left join tables  t on t.id = r.table_id
  left join clients c on c.id = r.client_id`;

async function list(req) {
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  // normally throttled; forced when he is actually looking at the expired list
  await sweepExpired(status === "expired");
  const date = url.searchParams.get("date");
  const scope = url.searchParams.get("scope");

  let rows;
  if (scope === "today") {
    rows = await sql.query(`${SELECT} where r.res_date = date('now') order by r.res_time asc`);
  } else if (scope === "accepted") {
    /* the accepted family keeps arrived/seated guests visible here too, so a
       booking stays in "Acceptées" after the client walks in (#2).
       Honours the date picker: a chosen day shows that day, no date shows every
       upcoming day so the owner can page through with Aujourd'hui / Demain. */
    /* walk-ins live in their own "Sans réservation" section and must not appear
       here; owner-added reservations (source 'owner') stay in Acceptées. */
    if (date) {
      rows = await sql.query(`${SELECT} where r.res_date = ?
                              and r.status in ('accepted','arrived','seated')
                              and coalesce(r.source,'') != 'walkin' order by r.res_time asc`, [date]);
    } else {
      rows = await sql.query(`${SELECT} where r.res_date >= date('now')
                              and r.status in ('accepted','arrived','seated')
                              and coalesce(r.source,'') != 'walkin' order by r.res_date asc, r.res_time asc`);
    }
  } else if (scope === "upcoming") {
    rows = await sql.query(`${SELECT} where r.res_date >= date('now') and r.status in ('accepted','arrived','seated')
                            order by r.res_date asc, r.res_time asc`);
  } else if (scope === "no_table") {
    rows = await sql.query(`${SELECT} where r.res_date >= date('now') and r.status in ('accepted','arrived','seated')
                            and r.table_id is null order by r.res_date, r.res_time`);
  } else if (scope === "with_table") {
    rows = await sql.query(`${SELECT} where r.res_date >= date('now') and r.status in ('accepted','arrived','seated')
                            and r.table_id is not null order by r.res_date, r.res_time`);
  } else if (scope === "arrived") {
    /* arrival is tracked by arrived_at, independent of the acceptance status,
       so an arrived booking shows here AND stays in Acceptées (#2) */
    rows = await sql.query(`${SELECT} where r.res_date = date('now')
                            and r.arrived_at is not null order by r.res_time`);
  } else if (scope === "not_arrived") {
    /* Everyone expected today who has not walked in — the still-waited-for
       (accepted) AND the ones the 30-minute rule auto-expired, so a late guest
       stays visible here while also appearing in Expirées. Manual no-shows are
       a deliberate absence and live only in the No-shows list. */
    rows = await sql.query(`${SELECT} where r.res_date = date('now')
                            and r.arrived_at is null
                            and r.status in ('accepted','expired')
                            order by r.res_time`);
  } else if (scope === "walkins") {
    rows = await sql.query(`${SELECT} where r.source = 'walkin' and r.res_date = date('now')
                            order by r.created_at desc`);
  } else if (scope === "waiting") {
    rows = await sql.query(`${SELECT} where r.waiting = 1 and r.res_date = date('now')
                            order by r.res_time asc`);
  } else if (status === "pending") {
    /* the En attente queue is forward-looking: today and the days ahead, never
       requests whose date has already passed. */
    rows = await sql.query(`${SELECT} where r.status = 'pending' and r.res_date >= date('now')
                            order by r.res_date asc, r.res_time asc limit 300`);
  } else if (status && date) {
    rows = await sql.query(`${SELECT} where r.status = ? and r.res_date = ? order by r.res_time asc`, [status, date]);
  } else if (status) {
    /* pending is a queue the owner works through, so it reads soonest-first;
       the closed lists (declined/no_show/…) read most-recent-first */
    const ord = status === "pending" ? "r.res_date asc, r.res_time asc" : "r.res_date desc, r.res_time asc";
    rows = await sql.query(`${SELECT} where r.status = ? order by ${ord} limit 300`, [status]);
  } else if (date) {
    rows = await sql.query(`${SELECT} where r.res_date = ? order by r.res_time asc`, [date]);
  } else {
    rows = await sql.query(`${SELECT} order by r.created_at desc limit 300`);
  }
  return json({ reservations: rows });
}

async function create(req) {
  const body = await readBody(req);
  const me = auth(req, ["owner", "reception"]);
  const staff = !!me;

  /* Anyone can post here. Without a ceiling one script can fill the book,
     spam the owner and burn the email quota. Staff are not limited. */
  if (!staff) {
    const gate = await rateLimit(req, "book", 6, 60 * 60);
    if (!gate.ok)
      return json({ error: "Trop de demandes envoyées. Merci de nous appeler au +216 73 348 700." }, 429);
  }

  /* A walk-in usually gives no name and no number — they are just a table of
     four at the door. Fill the gaps so the record is still valid and countable,
     with a placeholder phone unique per booking (clients.phone is UNIQUE). */
  if (staff && body.walkin === true) {
    if (!body.name || !String(body.name).trim()) body.name = "Client sans réservation";
    if (!body.phone || String(body.phone).replace(/[^0-9]/g, "").length < 6)
      body.phone = "+000" + Date.now();      // survives normPhone, unique per walk-in
    const now = new Date(Date.now() + 60 * 60 * 1000);            // Tunisia = UTC+1
    if (!body.date) body.date = now.toISOString().slice(0, 10);
    if (!body.time) body.time = now.toISOString().slice(11, 16);
  }

  /* Reception takes bookings over the phone, where there is often no email;
     only the public form is required to supply one. */
  if (staff) body.staff = true;
  const { errors, value } = validateBooking(body);
  if (errors.length) return json({ error: "Champs incomplets : " + errors.join(", ") }, 400);

  // Staff bookings (the owner adding a friend) bypass the public guards —
  // he is standing there deciding, and he already knows the room is free.
  if (!staff) {
    const bl = await sql`select 1 from blacklist where phone = ${value.phone} limit 1`;
    if (bl.length)
      return json({ error: "Réservation en ligne indisponible pour ce numéro. Merci de nous contacter par téléphone.", code: "blacklisted" }, 403);

    const blocked = await sql`
      select 1 from blocks
      where block_date = ${value.date}
        and (seating = 'all' or seating = ${value.seating})
        and start_time <= ${value.time} and end_time > ${value.time}
      limit 1`;
    if (blocked.length)
      return json({ error: "Ce créneau est complet. Merci de choisir un autre horaire.", code: "full" }, 409);
  }

  const clientRows = await sql`
    insert into clients (phone, name, email, bookings_total)
    values (${value.phone}, ${value.name}, ${value.email}, 1)
    on conflict (phone) do update
      set bookings_total = bookings_total + 1,
          name  = excluded.name,
          email = coalesce(excluded.email, email)
    returning id, is_blocked`;
  const clientId = clientRows[0].id;

  const reference = makeRef();
  /* A walk-in has no booking to confirm — they are already standing in the
     room, so the record starts as seated at today's date. */
  const walkin = staff && body.walkin === true;
  const status = walkin ? "seated" : (staff ? "accepted" : "pending");
  const source = walkin ? "walkin" : (staff ? (me.role === "owner" ? "owner" : "phone") : "web");

  const rows = await sql`
    insert into reservations
      (reference, client_id, name, phone, email, res_date, res_time, party_size,
       seating, service, note, status, source)
    values
      (${reference}, ${clientId}, ${value.name}, ${value.phone}, ${value.email},
       ${value.date}, ${value.time}, ${value.party}, ${value.seating}, ${value.service},
       ${value.note}, ${status}, ${source})
    returning *`;
  const r = rows[0];

  if (walkin) {
    try { await sql`update reservations set seated_at = datetime('now'), arrived_at = datetime('now'),
                    late_minutes = 0 where id = ${r.id}`; } catch (e) { console.error("[walkin]", e); }
  }

  // optional table at creation time, when the owner already knows where they sit
  if (staff && body.table_id) {
    try { await sql`update reservations set table_id = ${parseInt(body.table_id, 10)} where id = ${r.id}`; r.table_id = parseInt(body.table_id, 10); }
    catch (e) { console.error("[assign at create]", e); }
  }

  // notifications: guests always hear back; staff bookings only if asked
  if (!staff) {
    try { await notifyClientReceived(r); } catch (e) { console.error("[notify client]", e); }
    try { await notifyOwnerNew(sql, r); } catch (e) { console.error("[notify owner]", e); }
  } else if (body.notify) {
    try { await notifyClientReceived(r); } catch (e) { console.error("[notify client]", e); }
  }

  // the guest gets their pass immediately — no waiting on email
  const pt = passToken(r.id);
  return json({
    ok: true, reference, reservation: r,
    pass: { id: r.id, token: pt, url: `/pass?r=${r.id}&t=${pt}` },
  });
}
