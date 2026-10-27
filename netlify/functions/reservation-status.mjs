import { sql } from "./_lib/db.mjs";
import { json, readBody, fmtDate, fmtTime } from "./_lib/util.mjs";
import { auth, WRITERS } from "./_lib/auth.mjs";
import { notifyClientDecision, notifyClientCancelled, notifyClientCustom, pushOwners } from "./_lib/notify.mjs";

const ALLOWED = ["pending", "accepted", "declined", "arrived", "seated", "no_show", "cancelled", "expired"];

// POST /api/reservation-status  { id, status }
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, WRITERS);
  if (!me) return json({ error: "unauthorized" }, 401);

  const body = await readBody(req);
  const { id, status } = body;

  /* Rétablir — undo a no-show: the guest goes back to "accepted" (so it shows in
     Acceptées and, if today, in Pas encore arrivé), the manual no-show tally is
     reversed and the automatic no-show blacklisting is lifted. No email. */
  if (body.restore) {
    if (!id) return json({ error: "bad request" }, 400);
    const found = await sql`select * from reservations where id = ${id}`;
    if (!found.length) return json({ error: "not found" }, 404);
    const r = found[0];
    const upd = await sql`
      update reservations
         set status = 'accepted', arrived_at = null, seated_at = null,
             late_minutes = null, waiting = 0, modified = 0, mod_summary = null,
             updated_at = datetime('now')
       where id = ${id} returning *`;
    /* only reverse no-show consequences when it actually WAS a no-show — a
       cancelled booking never touched these counters. */
    /* putting an arrived guest back to "accepted" takes the visit back off his record */
    if (r.client_id && r.arrived_at) {
      await sql`update clients set on_time = max(0, on_time - 1),
                bookings_completed = max(0, bookings_completed - 1) where id = ${r.client_id}`;
    }
    if (r.status === "no_show") {
      if (r.client_id) await sql`update clients set no_shows = max(0, no_shows - 1) where id = ${r.client_id}`;
      await sql`delete from blacklist where phone = ${r.phone} and reason = 'No-show / réservation non honorée'`;
      const left = await sql`select count(*) as n from blacklist where phone = ${r.phone}`;
      if (r.client_id && (!left.length || left[0].n === 0)) {
        await sql`update clients set is_blocked = false where id = ${r.client_id}`;
      }
    }
    return json({ ok: true, reservation: upd[0] });
  }

  if (!id || !ALLOWED.includes(status)) return json({ error: "bad request" }, 400);

  /* refusing or cancelling: the staff choose what the guest receives —
     "auto" the usual message, "custom" their own email, "none" nothing.
     Checked before anything changes, so a bad request changes nothing. */
  const mode = ["auto", "custom", "none"].includes(body.notify) ? body.notify : "auto";
  const subject = String(body.subject || "").trim().slice(0, 150);
  const text = String(body.text || "").trim().slice(0, 4000);
  if ((status === "declined" || status === "cancelled") && mode === "custom") {
    if (!subject || !text) return json({ error: "Objet et message requis." }, 400);
    const em = await sql`select email from reservations where id = ${id}`;
    if (!em.length || !em[0].email) return json({ error: "Ce client n'a pas laissé d'email." }, 400);
  }
  const tell = async (auto) => {
    if (mode === "none") return;
    if (mode === "custom") return notifyClientCustom(r, subject, text);
    return auto();
  };

  /* Keep the modification on the record when accepting: the owner must still
     see what the client changed in the Acceptées list. The "à revoir" state is
     driven by status='pending', so accepting alone drops it from review. */
  const before = await sql`select status, arrived_at from reservations where id = ${id}`;
  const rows = await sql`update reservations set status = ${status}, updated_at = datetime('now') where id = ${id} returning *`;
  if (!rows.length) return json({ error: "not found" }, 404);
  const r = rows[0];
  const alreadyCame = before.length && (before[0].arrived_at || before[0].status === "arrived" || before[0].status === "seated");

  // client stats + policy side-effects — a visit counts once
  if ((status === "seated" || status === "arrived") && r.client_id && !alreadyCame) {
    await sql`update clients set bookings_completed = bookings_completed + 1, last_visit = datetime('now') where id = ${r.client_id}`;
  }

  if (status === "no_show") {
    /* free the table the moment the guest is a confirmed no-show, so it can be
       given to someone else without a second tap */
    if (r.table_id) { await sql`update reservations set table_id = null, waiting = 0 where id = ${id}`; r.table_id = null; r.waiting = 0; }
    /* The no-show is recorded on the client's record (and shows as a red tag on
       their card), but it NEVER blacklists anyone: blocking a guest is the
       owner's decision alone, taken by hand from the Clients or Blacklist tab. */
    if (r.client_id) await sql`update clients set no_shows = no_shows + 1 where id = ${r.client_id}`;
  }

  if (status === "cancelled") {
    /* a cancelled booking frees its table straight away, and we stamp who did
       it so the rest of the team sees it on the card */
    const who = me.role === "owner" ? "la direction" : "la réception";
    await sql`update reservations set table_id = null, waiting = 0, mod_summary = ${"Annulé par " + who} where id = ${id}`;
    r.table_id = null; r.waiting = 0; r.mod_summary = "Annulé par " + who;
    /* tell the guest the restaurant cancelled it (not them) */
    try { await tell(() => notifyClientCancelled(r)); } catch (e) { console.error("[notify client cancel]", e); }
    /* and ping every staff device so the rest of the team knows */
    try {
      await pushOwners(sql, {
        title: "Réservation annulée · " + who,
        body: `${r.name} · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size}p`,
        url: "/admin",
      });
    } catch (e) { console.error("[notify staff cancel]", e); }
  }

  if (status === "accepted") {
    try { await notifyClientDecision(r); } catch (e) { console.error("[notify decision]", e); }
  }
  if (status === "declined") {
    try { await tell(() => notifyClientDecision(r)); } catch (e) { console.error("[notify decision]", e); }
  }

  return json({ ok: true, reservation: r });
};
