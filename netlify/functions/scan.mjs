import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, verifyPassToken } from "./_lib/auth.mjs";

/* POST /api/scan  (staff)
     { r, t }                  -> look up the pass, no side effects
     { r, t, confirm:true }    -> also mark the guest arrived and record lateness

   The two-step shape matters: the scanner reads continuously, so a bare scan
   must never mutate anything. The receptionist sees the table, the party size
   and the time, and only then confirms.

   Accepts either the raw token pair or the full URL from the QR. */

const GRACE_MIN = 15;

function mins(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : 0;
}
function nowMinutesInTunis() {
  const d = new Date(Date.now() + 60 * 60 * 1000);   // Tunisia is UTC+1 year-round
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
function todayInTunis() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** The scanner may hand us a whole URL; pull r and t out of whatever we get. */
function parseTarget(body) {
  let r = body.r, t = body.t;
  if (body.raw) {
    try {
      const u = new URL(String(body.raw));
      r = u.searchParams.get("r") || r;
      t = u.searchParams.get("t") || t;
    } catch (e) {
      const m = String(body.raw).match(/[?&]r=(\d+)[^&]*&t=([A-Za-z0-9_-]+)/);
      if (m) { r = m[1]; t = m[2]; }
    }
  }
  return { id: parseInt(r, 10), token: String(t || "") };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const body = await readBody(req);

  /* Reference fallback: a flat battery or a cracked screen must not stop the
     door. Staff are already authenticated, so looking one up by reference is
     no weaker than reading the list. */
  let id, token;
  if (body.reference) {
    const ref = String(body.reference).trim().toUpperCase();
    const found = await sql`select id from reservations where upper(reference) = ${ref}`;
    if (!found.length) return json({ error: `Aucune réservation pour « ${ref} ».` }, 404);
    id = found[0].id;
  } else {
    ({ id, token } = parseTarget(body));
    if (!id || !verifyPassToken(id, token)) return json({ error: "QR code non valide." }, 403);
  }

  const rows = await sql`
    select r.*, t.code as table_code, t.zone as table_zone, t.seats as table_seats,
           c.bookings_completed, c.no_shows, c.on_time, c.late_count
    from reservations r
    left join tables t on t.id = r.table_id
    left join clients c on c.id = r.client_id
    where r.id = ${id}`;
  if (!rows.length) return json({ error: "Réservation introuvable." }, 404);
  const r = rows[0];

  const late = Math.max(0, nowMinutesInTunis() - mins(r.res_time));
  const today = todayInTunis();
  const info = {
    id: r.id,
    reference: r.reference,
    name: r.name,
    time: r.res_time,
    date: r.res_date,
    party_size: r.party_size,
    seating: r.seating,
    table_code: r.table_code,
    table_zone: r.table_zone,
    status: r.status,
    is_today: r.res_date === today,
    late_minutes: r.res_date === today ? late : null,
    on_time: r.res_date === today ? late <= GRACE_MIN : null,
    loyal: (r.bookings_completed || 0) >= 5,
    history: { on_time: r.on_time || 0, late: r.late_count || 0, no_shows: r.no_shows || 0 },
    already_arrived: !!r.arrived_at,
  };

  if (!body.confirm) return json({ ok: true, reservation: info });

  // guard rails before it mutates anything
  if (r.status === "cancelled" || r.status === "declined")
    return json({ error: "Cette réservation a été annulée.", reservation: info }, 409);
  if (!info.is_today)
    return json({ error: `Réservation prévue le ${r.res_date}, pas aujourd'hui.`, reservation: info }, 409);
  if (r.arrived_at)
    return json({ ok: true, already: true, reservation: info });

  const updated = await sql`
    update reservations
       set status = 'arrived', arrived_at = datetime('now'), late_minutes = ${late},
           updated_at = datetime('now')
     where id = ${id} returning *`;

  if (r.client_id) {
    if (late <= GRACE_MIN) await sql`update clients set on_time = on_time + 1 where id = ${r.client_id}`;
    else await sql`update clients set late_count = late_count + 1 where id = ${r.client_id}`;
  }

  /* Who scanned — the owner or reception — so the history can tell them apart. */
  const by = me.role === "owner" ? "owner" : "reception";
  try {
    await sql`insert into events (type, path, meta) values (
      'scan', ${"scan:" + id},
      ${JSON.stringify({ reservation_id: id, by, guest: r.name, reference: r.reference,
        late_minutes: late, on_time: late <= GRACE_MIN })}
    )`;
  } catch (e) { console.error("[scan event]", e); }

  info.status = "arrived";
  info.already_arrived = true;
  return json({ ok: true, scanned: true, by, reservation: info, late_minutes: late, on_time: late <= GRACE_MIN });
};
