import { sql } from "./_lib/db.mjs";
import { json, readBody, normPhone, fmtTime, fmtDate, zoneOf, seatFr } from "./_lib/util.mjs";
import { auth, STAFF, isWatcher } from "./_lib/auth.mjs";
import { rateLimit } from "./_lib/ratelimit.mjs";
import { pushOwners } from "./_lib/notify.mjs";

/* Liste d'attente — when a slot is "complet" the guest is no longer simply turned
   away: they can ask to be called if a table frees up. A refusal becomes a lead.

   POST /api/waitlist            (public)  { name, phone, email, date, time, party, seating }
   GET  /api/waitlist?date=      (staff)   the people waiting
   POST /api/waitlist {action:'close', id} (staff) — served or given up          */
export default async (req) => {
  const me = auth(req, STAFF);            // every staff role may read the list

  if (req.method === "GET") {
    if (!me) return json({ error: "unauthorized" }, 401);
    const url = new URL(req.url);
    const date = url.searchParams.get("date");
    /* the whole list, newest first: who asked, when, and what became of it */
    if (url.searchParams.get("all") === "1") {
      const all = await sql`select * from waitlist order by created_at desc, id desc limit 300`;
      return json({ waitlist: all });
    }
    const rows = date
      ? await sql`select * from waitlist where res_date = ${date} and status = 'waiting' order by created_at`
      : await sql`select * from waitlist where status = 'waiting' and res_date >= date('now','-3 hours')
                  order by res_date, created_at`;
    return json({ waitlist: rows });
  }

  if (req.method !== "POST") return json({ error: "method" }, 405);
  const b = await readBody(req);

  /* staff actions */
  if (b.action) {
    if (!me) return json({ error: "unauthorized" }, 401);
    if (isWatcher(me)) return json({ error: "Compte en lecture seule." }, 403);
    const id = parseInt(b.id, 10);
    if (!id) return json({ error: "bad request" }, 400);
    if (b.action === "close") {
      await sql`update waitlist set status = 'closed', closed_at = datetime('now') where id = ${id}`;
      return json({ ok: true });
    }
    /* turned into a real booking from the dashboard */
    if (b.action === "booked") {
      await sql`update waitlist set status = 'booked', closed_at = datetime('now') where id = ${id}`;
      return json({ ok: true });
    }
    return json({ error: "action inconnue" }, 400);
  }

  /* public sign-up — the same ceiling as the booking form */
  const gate = await rateLimit(req, "waitlist", 6, 60 * 60);
  if (!gate.ok) return json({ error: "Trop de demandes. Merci de nous appeler au +216 73 348 700." }, 429);

  const name = String(b.name || "").trim();
  if (name.length < 2) return json({ error: "Merci d'indiquer votre nom." }, 400);
  const phone = b.phone ? normPhone(b.phone).slice(0, 40) : "";
  const email = b.email && /.+@.+\..+/.test(b.email) ? String(b.email).trim().slice(0, 160) : null;
  /* we must be able to reach them — that is the whole point of the list */
  if (!phone && !email) return json({ error: "Laissez un téléphone ou un email pour être prévenu." }, 400);
  if (!b.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return json({ error: "Date invalide." }, 400);
  const time = b.time ? fmtTime(b.time) : null;
  const party = Math.min(30, Math.max(1, parseInt(b.party, 10) || 2));
  const seating = zoneOf(b.seating);

  const rows = await sql`
    insert into waitlist (name, phone, email, res_date, res_time, party_size, seating)
    values (${name}, ${phone || null}, ${email}, ${b.date}, ${time}, ${party}, ${seating})
    returning *`;
  const w = rows[0];

  /* tell the staff straight away — a freed table can be offered immediately */
  try {
    await pushOwners(sql, {
      title: "Liste d'attente · nouvelle demande",
      body: `${name} · ${fmtDate(b.date)}${time ? " " + time : ""} · ${party}p · ${seatFr(seating)}`,
      url: "/admin",
    });
  } catch (e) { console.error("[waitlist push]", e); }

  return json({ ok: true, waitlist: w });
};
