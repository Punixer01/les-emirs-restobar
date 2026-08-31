import { sql } from "./_lib/db.mjs";
import { json, readBody, fmtTime } from "./_lib/util.mjs";
import { verifyEditToken } from "./_lib/auth.mjs";

// Public, token-protected self-service edit of a reservation (time & party size only).
// GET  /api/reservation-edit?r=<id>&t=<token>
// POST /api/reservation-edit { r, t, time, party }
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
  const party = parseInt(body.party, 10);
  if (!/^\d{2}:\d{2}$/.test(time)) return json({ error: "Heure invalide." }, 400);
  if (!party || party < 1 || party > 30) return json({ error: "Nombre de couverts invalide." }, 400);

  const upd = await sql`
    update reservations set res_time = ${time}, party_size = ${party}, updated_at = datetime('now')
    where id = ${id} returning *`;
  return json({ ok: true, reservation: publicView(upd[0]) });
};
