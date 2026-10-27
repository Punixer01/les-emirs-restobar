import { sql } from "./_lib/db.mjs";
import { json, readBody, fmtTime, zoneOf, seatFr } from "./_lib/util.mjs";
import { auth, WRITERS } from "./_lib/auth.mjs";

// POST /api/reservation-update  (owner/reception)
// Staff edit of a booking — date, time, covers, place, name, note. Unlike the
// client edit it does NOT send the booking back to review (staff is authoritative).
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, WRITERS);
  if (!me) return json({ error: "unauthorized" }, 401);

  const b = await readBody(req);
  const id = parseInt(b.id, 10);
  if (!id) return json({ error: "bad request" }, 400);
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return json({ error: "Date invalide." }, 400);
  if (!b.time || !/^\d{2}:\d{2}/.test(b.time)) return json({ error: "Heure invalide." }, 400);
  const party = parseInt(b.party, 10);
  if (!party || party < 1 || party > 40) return json({ error: "Nombre de couverts invalide." }, 400);
  const seating = zoneOf(b.seating);
  const name = String(b.name || "").trim();
  const note = b.note != null && String(b.note).trim() ? String(b.note).slice(0, 500) : null;

  const found = await sql`select * from reservations where id = ${id} limit 1`;
  if (!found.length) return json({ error: "Réservation introuvable." }, 404);
  const before = found[0];

  /* Flag the modification so the owner sees a badge on the card, same as a
     client edit. Summary lists what actually changed. */
  const roomFr = (s) => seatFr(s).toLowerCase();
  const bits = [];
  if (b.date !== before.res_date) bits.push(`date ${before.res_date}→${b.date}`);
  if (fmtTime(b.time) !== fmtTime(before.res_time)) bits.push(`heure ${fmtTime(before.res_time)}→${fmtTime(b.time)}`);
  if (party !== before.party_size) bits.push(`couverts ${before.party_size}→${party}`);
  if (seating !== before.seating) bits.push(`salle ${roomFr(before.seating)}→${roomFr(seating)}`);
  const who = me.role === "owner" ? "la direction" : "la réception";
  const summary = `Modifié par ${who} · ` + bits.join(" · ");
  const changed = bits.length > 0;

  const rows = await sql`
    update reservations
       set name       = coalesce(nullif(${name}, ''), name),
           res_date   = ${b.date},
           res_time   = ${fmtTime(b.time)},
           party_size = ${party},
           seating    = ${seating},
           note       = ${note},
           modified   = ${changed ? 1 : before.modified},
           mod_summary = ${changed ? summary : before.mod_summary},
           updated_at = datetime('now')
     where id = ${id} returning *`;
  const r = rows[0];

  try {
    await sql`insert into events (type, path, meta) values (
      'reservation', ${"reservation:" + id},
      ${JSON.stringify({
        reservation_id: id, kind: "staff_edit", by: me.role, guest: r.name, reference: r.reference,
        from: { date: before.res_date, time: fmtTime(before.res_time), party: before.party_size, seating: before.seating },
        to: { date: r.res_date, time: fmtTime(r.res_time), party: r.party_size, seating: r.seating },
      })})`;
  } catch (e) { /* history is best-effort */ }

  return json({ ok: true, reservation: r });
};
