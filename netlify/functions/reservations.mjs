import { sql } from "./_lib/db.mjs";
import { recordMissed } from "./missed.mjs";
import { dueIndex } from "./_lib/dues.mjs";
import { json, readBody, validateBooking, makeRef, fmtDate, fmtTime, seatFr } from "./_lib/util.mjs";
import { auth, passToken, STAFF, WRITERS, isWatcher } from "./_lib/auth.mjs";
import { sweepExpired } from "./_lib/sweep.mjs";
import { notifyClientReceived, notifyClientDecision, notifyOwnerNew, pushOwners } from "./_lib/notify.mjs";
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
         (select group_concat(tk.id || '~' || tk.code) from tables tk where tk.merged_into = t.id) as merged_pairs,
         c.bookings_completed, c.bookings_total, c.no_shows,
         c.on_time, c.late_count, c.is_blocked
  from reservations r
  left join tables  t on t.id = r.table_id
  left join clients c on c.id = r.client_id`;

async function list(req) {
  const me = auth(req, STAFF);                 // every staff role may read the service
  if (!me) return json({ error: "unauthorized" }, 401);
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  // normally throttled; forced when he is actually looking at the expired list
  await sweepExpired(status === "expired");
  const date = url.searchParams.get("date");
  const scope = url.searchParams.get("scope");

  /* every service list sticks to the picked day (Aujourd'hui / Demain); with no
     date it falls back to the current business day (4am rollover). */
  const dayEq = date ? "r.res_date = ?" : "r.res_date = date('now','-3 hours')";
  const P = date ? [date] : [];

  let rows;
  if (scope === "today") {
    rows = await sql.query(`${SELECT} where r.res_date = date('now','-3 hours') order by r.res_time asc`);
  } else if (scope === "accepted") {
    /* the accepted family keeps arrived/seated guests visible here too, so a
       booking stays in "Acceptées" after the client walks in (#2).
       Honours the date picker: a chosen day shows that day, no date shows every
       upcoming day so the owner can page through with Aujourd'hui / Demain. */
    /* walk-ins live in their own "Sans réservation" section and must not appear
       here; owner-added reservations (source 'owner') stay in Acceptées. */
    /* ACCEPTED IS PERSISTENT: once accepted a booking stays here through arrival,
       expiry AND no-show. The family accepted/arrived/seated/expired/no_show all
       mean "was accepted" — only cancelled/declined leave. A no-show also keeps
       showing in its own No-shows box, exactly like expired shows in Expirées. */
    /* a booking the client just modified flips to 'pending' for re-validation and
       shows in En attente — but keep it visible here too (with its "modifiée"
       flag) so the owner still sees it in Acceptées. */
    const ACC = `( r.status in ('accepted','arrived','seated','expired','no_show') or (r.status='pending' and r.modified=1) )`;
    if (date) {
      rows = await sql.query(`${SELECT} where r.res_date = ? and ${ACC}
                              and coalesce(r.source,'') != 'walkin' order by r.res_time asc`, [date]);
    } else {
      rows = await sql.query(`${SELECT} where r.res_date >= date('now','-3 hours') and ${ACC}
                              and coalesce(r.source,'') != 'walkin' order by r.res_date asc, r.res_time asc`);
    }
  } else if (scope === "upcoming") {
    rows = await sql.query(`${SELECT} where r.res_date >= date('now','-3 hours') and r.status in ('accepted','arrived','seated','expired')
                            order by r.res_date asc, r.res_time asc`);
  } else if (scope === "no_table") {
    rows = await sql.query(`${SELECT} where ${dayEq} and r.status in ('accepted','arrived','seated','expired')
                            and r.table_id is null and coalesce(r.source,'') != 'walkin' order by r.res_time`, P);
  } else if (scope === "with_table") {
    rows = await sql.query(`${SELECT} where ${dayEq} and r.status in ('accepted','arrived','seated','expired')
                            and r.table_id is not null and coalesce(r.source,'') != 'walkin' order by r.res_time`, P);
  } else if (scope === "arrived") {
    /* arrival is tracked by arrived_at. Walk-ins (Sans réservation) are NOT
       shown here — that list is only guests explicitly marked Arrivé (#1). */
    rows = await sql.query(`${SELECT} where ${dayEq}
                            and r.arrived_at is not null and coalesce(r.source,'') != 'walkin' order by r.res_time`, P);
  } else if (scope === "not_arrived") {
    /* Everyone expected on the picked day who has not walked in — the still-
       waited-for (accepted) AND the ones the 30-minute rule auto-expired, so a
       late guest stays visible here while also appearing in Expirées. */
    rows = await sql.query(`${SELECT} where ${dayEq}
                            and r.arrived_at is null
                            and r.status in ('accepted','expired')
                            and coalesce(r.source,'') != 'walkin'
                            order by r.res_time`, P);
  } else if (scope === "walkins") {
    /* same rule as the KPI: only walk-ins still sitting at a table */
    rows = await sql.query(`${SELECT} where r.source = 'walkin' and ${dayEq}
                            and r.table_id is not null and r.status in ('accepted','arrived','seated')
                            order by r.created_at desc`, P);
  } else if (scope === "waiting") {
    /* "En attente d'une table" (under the plan): everyone who still needs a table
       for the shown day — the explicitly waiting (waiting=1) AND every accepted
       booking with no table yet (the "Sans table" list) — so the owner can seat
       them straight from here. Walk-ins have their own flow and are excluded.
       Defaults to today; honours the plan's date picker when one is sent. */
    const day = date || null;
    if (day) {
      rows = await sql.query(`${SELECT} where r.res_date = ? and coalesce(r.source,'') != 'walkin'
                              and ( r.waiting = 1 or (r.status in ('accepted','arrived','seated','expired') and r.table_id is null) )
                              order by r.res_time asc`, [day]);
    } else {
      rows = await sql.query(`${SELECT} where r.res_date = date('now','-3 hours') and coalesce(r.source,'') != 'walkin'
                              and ( r.waiting = 1 or (r.status in ('accepted','arrived','seated','expired') and r.table_id is null) )
                              order by r.res_time asc`);
    }
  } else if (status === "pending") {
    /* the En attente queue is forward-looking: today and the days ahead, never
       requests whose date has already passed. */
    rows = await sql.query(`${SELECT} where r.status = 'pending' and r.res_date >= date('now','-3 hours')
                            and coalesce(r.source,'') != 'walkin'
                            order by r.res_date asc, r.res_time asc limit 300`);
  } else if (status && date) {
    /* the KPI status lists (Refusées, Annulées, Expirées, No-shows) never show
       walk-ins — those only appear under Sans réservation */
    rows = await sql.query(`${SELECT} where r.status = ? and r.res_date = ? and coalesce(r.source,'') != 'walkin'
                            order by r.res_time asc`, [status, date]);
  } else if (status) {
    /* pending is a queue the owner works through, so it reads soonest-first;
       the closed lists (declined/no_show/…) read most-recent-first */
    const ord = status === "pending" ? "r.res_date asc, r.res_time asc" : "r.res_date desc, r.res_time asc";
    rows = await sql.query(`${SELECT} where r.status = ? and coalesce(r.source,'') != 'walkin' order by ${ord} limit 300`, [status]);
  } else if (date) {
    rows = await sql.query(`${SELECT} where r.res_date = ? order by r.res_time asc`, [date]);
  } else {
    rows = await sql.query(`${SELECT} order by r.created_at desc limit 300`);
  }
  /* what each guest still owes on the Crédit book — shown on the card so the
     staff know before they sit down (one lookup for the whole list) */
  const dueOf = await dueIndex();
  for (const r of rows) {
    const d = dueOf(r.client_id, r.phone);
    r.client_due = d ? d.due : 0;
    r.client_debt = d ? d.accounts : null;
  }
  return json({ reservations: rows });
}

async function create(req) {
  const body = await readBody(req);
  /* a watcher may read the service but never create a booking — refuse the
     token outright instead of letting it through as a public request */
  const viewer = auth(req, STAFF);
  if (isWatcher(viewer)) return json({ error: "Compte en lecture seule." }, 403);
  const me = auth(req, WRITERS);
  const staff = !!me;

  /* Anyone can post here. Without a ceiling one script can fill the book,
     spam the owner and burn the email quota. Staff are not limited. */
  if (!staff) {
    const gate = await rateLimit(req, "book", 6, 60 * 60);
    if (!gate.ok)
      return json({ error: "Trop de demandes envoyées. Merci de nous appeler au +216 73 348 700." }, 429);
  }

  /* A walk-in usually gives no name — just a table at the door. Fill name/date/
     time so the record is valid, but NEVER invent a phone number: an empty phone
     stays empty (no placeholder). */
  if (staff && body.walkin === true) {
    if (!body.name || !String(body.name).trim()) body.name = "Client sans réservation";
    const now = new Date(Date.now() + 60 * 60 * 1000);            // Tunisia = UTC+1
    if (!body.date) body.date = now.toISOString().slice(0, 10);
    if (!body.time) body.time = now.toISOString().slice(11, 16);
  }

  /* Reception takes bookings over the phone, where there is often no email;
     staff bookings may also carry no phone at all — it stays empty. */
  if (staff) body.staff = true;
  const { errors, value } = validateBooking(body);
  if (errors.length) return json({ error: "Champs incomplets : " + errors.join(", ") }, 400);

  // Staff bookings (the owner adding a friend) bypass the public guards —
  // he is standing there deciding, and he already knows the room is free.
  if (!staff) {
    const bl = await sql`select 1 from blacklist where phone = ${value.phone} limit 1`;
    if (bl.length)
      return json({ error: "Réservation en ligne indisponible pour ce numéro. Merci de nous contacter par téléphone.", code: "blacklisted" }, 403);

    /* "Complet" (the owner's Complet section = a block) is a hard stop for online
       requests: if the chosen slot falls inside a declared-full window for that
       room (or 'all'), the client is told it's full instead of the request going
       through. Staff bookings are never blocked. */
    const covers = (seat) => sql`
      select 1 from blocks
       where block_date = ${value.date}
         and (seating = 'all' or seating = ${seat})
         and start_time <= ${value.time} and end_time >= ${value.time}
       limit 1`;
    const blk = await covers(value.seating);
    if (blk.length) {
      /* room-aware: tell the guest whether the OTHER room still has tables, so the
         popup can offer to switch instead of just refusing. */
      /* three places in winter: offer the first one still free, the other
         terrace first (closest to what the guest asked for) */
      const fr = (s) => seatFr(s).toLowerCase();
      const order = { terrace: ["verriere", "inside"], verriere: ["terrace", "inside"], inside: ["verriere", "terrace"] }[value.seating];
      const rooms = { [value.seating]: "full" };
      for (const z of order) rooms[z] = (await covers(z)).length ? "full" : "free";
      const free = order.filter((z) => rooms[z] === "free");
      const other = free[0] || order[0];
      const otherFree = free.length > 0;
      /* the guest may close the popup without choosing: keep their details */
      try { await recordMissed(value); } catch (e) { console.error("[missed]", e); }
      return json({
        error: "Ce créneau est complet.", code: "full",
        requested: value.seating, requestedFr: fr(value.seating),
        other, otherFr: fr(other), otherFree, rooms,
        date: value.date, time: fmtTime(value.time),
      }, 409);
    }
  }

  /* No phone → no client record (client rows are keyed by unique phone). The
     reservation is still saved, just without a linked client / contact. */
  let clientId = null;
  if (value.phone) {
    const clientRows = await sql`
      insert into clients (phone, name, email, bookings_total)
      values (${value.phone}, ${value.name}, ${value.email}, 1)
      on conflict (phone) do update
        set bookings_total = bookings_total + 1,
            name  = excluded.name,
            email = coalesce(excluded.email, email)
      returning id, is_blocked`;
    clientId = clientRows[0].id;
  }

  const reference = makeRef();
  /* A walk-in has no booking to confirm — they are already standing in the
     room, so the record starts as seated at today's date. */
  const walkin = staff && body.walkin === true;
  const status = walkin ? "seated" : (staff ? "accepted" : "pending");
  /* who added it, so every dashboard shows "ajoutée par la réception / la gérance / la direction" */
  const source = walkin ? "walkin" : (staff ? ({ owner: "owner", gerant: "gerant" }[me.role] || "reception") : "web");

  /* the language the guest used on the site: every message we send back — the
     confirmation, the pass, the cancellation — follows it */
  const lang = String(body.lang || "").toLowerCase() === "en" ? "en" : "fr";

  const rows = await sql`
    insert into reservations
      (reference, client_id, name, phone, email, res_date, res_time, party_size,
       seating, service, note, status, source, lang)
    values
      (${reference}, ${clientId}, ${value.name}, ${value.phone}, ${value.email},
       ${value.date}, ${value.time}, ${value.party}, ${value.seating}, ${value.service},
       ${value.note}, ${status}, ${source}, ${lang})
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
    let debt = null;
    try { debt = (await dueIndex())(clientId, r.phone); } catch (e) { /* never block a booking */ }
    try { await notifyOwnerNew(sql, r, debt); } catch (e) { console.error("[notify owner]", e); }
  } else {
    /* a staff-added booking pings every staff device (direction + réception) so
       the whole team sees it appear, and still emails the guest if asked. */
    const who = me.role === "owner" ? "la direction" : "la réception";
    /* walk-ins are seated by the staff standing in the room — notifying the
       team about what they just did themselves is only noise, and a busy
       service adds them by the dozen. */
    try {
      let debt = null;
      try { debt = (await dueIndex())(clientId, value.phone); } catch (e) { /* never block a booking */ }
      if (!walkin) await pushOwners(sql, {
        title: (debt ? "⚠ Crédit impayé · " : "") + "Réservation ajoutée · " + who,
        body: `${value.name} · ${fmtDate(value.date)} ${fmtTime(value.time)} · ${value.party} couv. · ${seatFr(value.seating)}`
              + (debt ? ` · doit ${debt.due.toFixed(3)} DT` : ""),
        url: "/admin",
      });
    } catch (e) { console.error("[notify staff add]", e); }
    /* a staff booking is already accepted → the guest gets the CONFIRMED email
       with the QR pass straight away, not a "request received" mail. */
    if (body.notify) { try { await notifyClientDecision(r); } catch (e) { console.error("[notify client]", e); } }
  }

  // the guest gets their pass immediately — no waiting on email
  const pt = passToken(r.id);
  return json({
    ok: true, reference, reservation: r,
    pass: { id: r.id, token: pt, url: `/pass?r=${r.id}&t=${pt}` },
  });
}
