import { sql } from "./_lib/db.mjs";
import { json, readBody, validateBooking, makeRef } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { notifyClientReceived, notifyOwnerNew } from "./_lib/notify.mjs";

// GET  /api/reservations           (staff) — list, filters: ?status= &date= &scope=today|upcoming
// POST /api/reservations           (public) — create a booking
export default async (req) => {
  if (req.method === "GET") return list(req);
  if (req.method === "POST") return create(req);
  return json({ error: "method" }, 405);
};

async function list(req) {
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const date = url.searchParams.get("date");
  const scope = url.searchParams.get("scope");

  let rows;
  if (scope === "today") {
    rows = await sql`select * from reservations where res_date = date('now') order by res_time asc`;
  } else if (scope === "upcoming") {
    rows = await sql`select * from reservations
                     where res_date >= date('now') and status = 'accepted'
                     order by res_date asc, res_time asc`;
  } else if (status && date) {
    rows = await sql`select * from reservations where status = ${status} and res_date = ${date} order by res_time asc`;
  } else if (status) {
    rows = await sql`select * from reservations where status = ${status} order by res_date desc, res_time asc limit 300`;
  } else if (date) {
    rows = await sql`select * from reservations where res_date = ${date} order by res_time asc`;
  } else {
    rows = await sql`select * from reservations order by created_at desc limit 300`;
  }
  return json({ reservations: rows });
}

async function create(req) {
  const body = await readBody(req);
  const { errors, value } = validateBooking(body);
  if (errors.length) return json({ error: "Champs incomplets : " + errors.join(", ") }, 400);

  // 1) blacklist
  const bl = await sql`select 1 from blacklist where phone = ${value.phone} limit 1`;
  if (bl.length)
    return json({ error: "Réservation en ligne indisponible pour ce numéro. Merci de nous contacter par téléphone.", code: "blacklisted" }, 403);

  // 2) "complet" window
  const blocked = await sql`
    select 1 from blocks
    where block_date = ${value.date}
      and (seating = 'all' or seating = ${value.seating})
      and start_time <= ${value.time} and end_time > ${value.time}
    limit 1`;
  if (blocked.length)
    return json({ error: "Ce créneau est complet. Merci de choisir un autre horaire.", code: "full" }, 409);

  // 3) upsert client
  const clientRows = await sql`
    insert into clients (phone, name, email, bookings_total)
    values (${value.phone}, ${value.name}, ${value.email}, 1)
    on conflict (phone) do update
      set bookings_total = bookings_total + 1,
          name  = excluded.name,
          email = coalesce(excluded.email, email)
    returning id, is_blocked`;
  const clientId = clientRows[0].id;

  // 4) insert reservation
  const reference = makeRef();
  const rows = await sql`
    insert into reservations
      (reference, client_id, name, phone, email, res_date, res_time, party_size, seating, service, note)
    values
      (${reference}, ${clientId}, ${value.name}, ${value.phone}, ${value.email},
       ${value.date}, ${value.time}, ${value.party}, ${value.seating}, ${value.service}, ${value.note})
    returning *`;
  const r = rows[0];

  // 5) notify (never let a channel error fail the booking)
  try { await notifyClientReceived(r); } catch (e) { console.error("[notify client]", e); }
  try { await notifyOwnerNew(sql, r); } catch (e) { console.error("[notify owner]", e); }

  return json({ ok: true, reference, reservation: r });
}
