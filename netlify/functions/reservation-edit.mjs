import { sql } from "./_lib/db.mjs";
import { json, readBody, fmtTime } from "./_lib/util.mjs";
import { verifyEditToken } from "./_lib/auth.mjs";
import { notifyOwnerChange } from "./_lib/notify.mjs";

// Public, token-protected self-service edit of a reservation — hour, room and
// number of covers. ANY change sends the booking back to "En attente" for the
// owner to re-validate (#4), and the owner is notified with what changed (#3).
// GET  /api/reservation-edit?r=<id>&t=<token>
// POST /api/reservation-edit { r, t, time, seating, party }
const CUTOFF_MS = 3 * 3600 * 1000; // 3 hours

function resDateTime(r) {
  const d = typeof r.res_date === "string" ? r.res_date.slice(0, 10) : new Date(r.res_date).toISOString().slice(0, 10);
  let t = String(r.res_time);
  if (/^\d{2}:\d{2}$/.test(t)) t += ":00";
  // Tunisia is UTC+1 (no DST)
  return new Date(`${d}T${t}+01:00`);
}
function editability(r) {
  if (!["pending", "accepted"].includes(r.status))
    return { editable: false, reason: "Cette réservation ne peut plus être modifiée en ligne." };
  const dt = resDateTime(r);
  if (!isNaN(dt) && dt.getTime() - Date.now() < CUTOFF_MS)
    return { editable: false, reason: "Les modifications ferment 3 h avant l’heure prévue. Merci de nous appeler." };
  return { editable: true, reason: "" };
}
function publicView(r) {
  return {
    reference: r.reference, name: r.name, date: (typeof r.res_date === "string" ? r.res_date.slice(0,10) : new Date(r.res_date).toISOString().slice(0,10)),
    time: fmtTime(r.res_time), party: r.party_size, seating: r.seating, status: r.status,
  };
}

export default async (req) => {
  const url = new URL(req.url);
  const method = req.method;
  let id, token, body = {};
  if (method === "GET") { id = url.searchParams.get("r"); token = url.searchParams.get("t"); }
  else if (method === "POST") { body = await readBody(req); id = body.r; token = body.t; }
  else return json({ error: "method" }, 405);

  id = parseInt(id, 10);
  if (!id || !verifyEditToken(id, token)) return json({ error: "Lien invalide." }, 403);

  const rows = await sql`select * from reservations where id = ${id} limit 1`;
  if (!rows.length) return json({ error: "Réservation introuvable." }, 404);
  const r = rows[0];
  const ed = editability(r);

  if (method === "GET") return json({ reservation: publicView(r), editable: ed.editable, reason: ed.reason });

  // POST — apply change
  if (!ed.editable) return json({ error: ed.reason }, 409);
  const time = fmtTime(body.time);
  if (!/^\d{2}:\d{2}$/.test(time)) return json({ error: "Heure invalide." }, 400);
  const hm = parseInt(time.slice(0, 2), 10) * 60 + parseInt(time.slice(3, 5), 10);
  /* the same window the booking form offers: midday to 21h30 */
  if (!(hm >= 12 * 60 && hm <= 21 * 60 + 30))
    return json({ error: "Merci de choisir une heure entre 12h00 et 21h30." }, 400);
  const seating = body.seating === "terrace" ? "terrace" : "inside";
  // covers: optional; default to the current count if not sent
  let party = parseInt(body.party, 10);
  if (!Number.isFinite(party)) party = r.party_size;
  if (party < 1 || party > 30) return json({ error: "Nombre de couverts invalide (1 à 30)." }, 400);

  const movedRoom = seating !== r.seating;
  const coversChanged = Number(party) !== Number(r.party_size);

  /* Table allocation is reconsidered when anything that affects it changes:
     a room change invalidates the chosen table, and so does a cover count the
     current table can no longer hold. In either case release it so the owner
     re-seats during review. Otherwise the existing table is kept. */
  let releaseTable = movedRoom;
  if (!releaseTable && coversChanged && r.table_id) {
    const tbl = await sql`select seats from tables where id = ${r.table_id}`;
    if (tbl.length && party > tbl[0].seats) releaseTable = true;
  }

  const changed = time !== fmtTime(r.res_time) || seating !== r.seating || coversChanged;
  if (!changed) return json({ ok: true, reservation: publicView(r), unchanged: true });

  /* #4 — ANY client change sends the booking back to review. Even a previously
     accepted booking becomes pending again so the owner re-validates it. */
  const summaryBits = [];
  if (time !== fmtTime(r.res_time)) summaryBits.push(`heure ${fmtTime(r.res_time)}→${time}`);
  if (seating !== r.seating) summaryBits.push(`salle ${r.seating === "terrace" ? "terrasse" : "intérieur"}→${seating === "terrace" ? "terrasse" : "intérieur"}`);
  if (coversChanged) summaryBits.push(`couverts ${r.party_size}→${party}`);
  const summary = summaryBits.join(" · ");

  const upd = await sql`
    update reservations
       set res_time   = ${time},
           seating    = ${seating},
           party_size = ${party},
           table_id   = ${releaseTable ? null : r.table_id},
           waiting    = 0,
           status     = 'pending',
           modified   = 1,
           mod_summary = ${summary},
           updated_at = datetime('now')
     where id = ${id} returning *`;
  const now = upd[0];

  // history, so the change is visible in the dashboard long after the alert
  try {
    await sql`insert into events (type, path, meta) values (
      'reservation', ${"reservation:" + id},
      ${JSON.stringify({
        reservation_id: id, kind: "client_edit", by: "client", guest: r.name,
        reference: r.reference, summary,
        from: { time: fmtTime(r.res_time), seating: r.seating, party: r.party_size, status: r.status, table_id: r.table_id },
        to: { time: fmtTime(now.res_time), seating: now.seating, party: now.party_size, status: "pending" },
        table_released: releaseTable && !!r.table_id,
      })})`;
  } catch (e) { console.error("[edit event]", e); }
  try { await notifyOwnerChange(sql, now, r); } catch (e) { console.error("[notify change]", e); }

  return json({ ok: true, reservation: publicView(now), review: true });
};
