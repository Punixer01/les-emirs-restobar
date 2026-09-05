import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

/* Seating desk.
   POST /api/assign { id, table_id }        -> put a booking on a table (null frees it)
   POST /api/assign { id, action:"arrived" }-> guest is here; records how late they were
   POST /api/assign { id, action:"seated" }
   POST /api/assign { id, action:"wait" }   -> late, no table free: park them on the wait list

   Lateness is measured once, at arrival, against the booked time. The owner
   never has to judge it after the fact — it is already on the record. */

const GRACE_MIN = 15; // inside this, a guest counts as on time

function mins(t) {
  const m = String(t || "").match(/^(\d{1,2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : 0;
}
function nowMinutesInTunis() {
  // Tunisia is UTC+1 all year
  const d = new Date(Date.now() + 60 * 60 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}


/* Table history — the owner asked to be able to see what happened to a table
   after a no-show or a late arrival. Stored in the existing events table. */
async function logTableEvent(tableId, resId, kind, byRole, reason, guest) {
  try {
    await sql`insert into events (type, path, meta) values (
      'table', ${"table:" + (tableId || "-")},
      ${JSON.stringify({ table_id: tableId || null, reservation_id: resId, kind, by: byRole, reason: reason || null, guest: guest || null })}
    )`;
  } catch (e) { console.error("[table event]", e); }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const b = await readBody(req);
  const id = parseInt(b.id, 10);
  if (!id) return json({ error: "bad request" }, 400);

  const found = await sql`select * from reservations where id = ${id}`;
  if (!found.length) return json({ error: "not found" }, 404);
  const r = found[0];

  /* --- assign / free a table --- */
  if (b.table_id !== undefined) {
    const tid = b.table_id === null || b.table_id === "" ? null : parseInt(b.table_id, 10);

    if (tid) {
      const t = await sql`select * from tables where id = ${tid}`;
      if (!t.length) return json({ error: "Table introuvable." }, 404);

      // is it taken in the same 2h window on the same day?
      const clash = await sql`
        select id, name, res_time from reservations
        where table_id = ${tid} and res_date = ${r.res_date} and id != ${id}
          and status in ('accepted','arrived','seated')`;
      const ref = mins(r.res_time);
      const hit = clash.find((c) => Math.abs(mins(c.res_time) - ref) < 120);
      if (hit) {
        return json({ error: `Table déjà prise par ${hit.name} à ${hit.res_time}.` }, 409);
      }
      if (t[0].active === 0) return json({ error: "Cette table est hors service." }, 400);
    }

    const rows = await sql`update reservations set table_id = ${tid}, waiting = 0,
      updated_at = datetime('now') where id = ${id} returning *`;
    await logTableEvent(tid || r.table_id, id, tid ? "assign" : "free", me.role, null, r.name);
    return json({ ok: true, reservation: rows[0] });
  }

  /* --- arrival, seating, wait list --- */
  const action = String(b.action || "");

  if (action === "arrived") {
    const late = Math.max(0, nowMinutesInTunis() - mins(r.res_time));
    const onTime = late <= GRACE_MIN;
    const rows = await sql`update reservations
      set status = 'arrived', arrived_at = datetime('now'), late_minutes = ${late},
          updated_at = datetime('now')
      where id = ${id} returning *`;
    if (r.client_id) {
      if (onTime) await sql`update clients set on_time = on_time + 1 where id = ${r.client_id}`;
      else await sql`update clients set late_count = late_count + 1 where id = ${r.client_id}`;
    }
    return json({ ok: true, reservation: rows[0], late_minutes: late, on_time: onTime });
  }

  /* Cancel a mis-tapped arrival at ANY time (not just the 7 s undo window):
     the guest goes back to "accepted / non arrivé", the client's punctuality
     counter is reversed, and the correction is counted on the booking so the
     owner can see it was toggled by mistake. */
  if (action === "unarrive") {
    if (!r.arrived_at) return json({ ok: true, reservation: r, unchanged: true });
    if (r.client_id) {
      if ((r.late_minutes || 0) <= GRACE_MIN) await sql`update clients set on_time = max(0, on_time - 1) where id = ${r.client_id}`;
      else await sql`update clients set late_count = max(0, late_count - 1) where id = ${r.client_id}`;
    }
    const rows = await sql`update reservations
      set status = 'accepted', arrived_at = null, seated_at = null, late_minutes = null,
          arrival_undos = coalesce(arrival_undos, 0) + 1, updated_at = datetime('now')
      where id = ${id} returning *`;
    try {
      await sql`insert into events (type, path, meta) values (
        'reservation', ${"reservation:" + id},
        ${JSON.stringify({ reservation_id: id, kind: "unarrive", by: me.role, guest: r.name })}
      )`;
    } catch (e) { /* history best-effort */ }
    return json({ ok: true, reservation: rows[0], corrections: rows[0].arrival_undos });
  }

  if (action === "seated") {
    const rows = await sql`update reservations
      set status = 'seated', seated_at = datetime('now'), waiting = 0, updated_at = datetime('now')
      where id = ${id} returning *`;
    if (r.client_id) {
      await sql`update clients set bookings_completed = bookings_completed + 1,
                last_visit = datetime('now') where id = ${r.client_id}`;
    }
    return json({ ok: true, reservation: rows[0] });
  }

  /* Free a table by hand: the guest never showed, or turned up so late the
     table was given away. Always leaves a trace. */
  if (action === "free") {
    const freed = r.table_id;
    const rows = await sql`update reservations set table_id = null, updated_at = datetime('now')
                           where id = ${id} returning *`;
    await logTableEvent(freed, id, "free", me.role, b.reason || null, r.name);
    return json({ ok: true, reservation: rows[0], freed_table: freed });
  }

  if (action === "wait") {
    const late = Math.max(0, nowMinutesInTunis() - mins(r.res_time));
    const rows = await sql`update reservations
      set waiting = 1, table_id = null, late_minutes = ${late}, updated_at = datetime('now')
      where id = ${id} returning *`;
    return json({ ok: true, reservation: rows[0] });
  }

  /* --- add a second (or third…) table to a booking (#8) ---
     Reuses the table-merge model: the extra table becomes a child of the
     booking's primary table, so the primary number never changes and the
     combined seats roll up. With no primary yet, it just becomes the primary. */
  if (action === "add_table") {
    const tid = parseInt(b.add_table_id, 10);
    if (!tid) return json({ error: "bad request" }, 400);
    const t = await sql`select * from tables where id = ${tid}`;
    if (!t.length) return json({ error: "Table introuvable." }, 404);
    if (t[0].active === 0) return json({ error: "Cette table est hors service." }, 400);

    // taken by someone else in the same 2h window?
    const clash = await sql`
      select name, res_time from reservations
      where table_id = ${tid} and res_date = ${r.res_date} and id != ${id}
        and status in ('accepted','arrived','seated')`;
    const ref = mins(r.res_time);
    const hit = clash.find((c) => Math.abs(mins(c.res_time) - ref) < 120);
    if (hit) return json({ error: `Table déjà prise par ${hit.name} à ${hit.res_time}.` }, 409);

    if (!r.table_id) {
      // no primary yet — this simply becomes the primary table
      const rows = await sql`update reservations set table_id = ${tid}, waiting = 0,
        updated_at = datetime('now') where id = ${id} returning *`;
      await logTableEvent(tid, id, "assign", me.role, null, r.name);
      return json({ ok: true, reservation: rows[0] });
    }
    if (tid === r.table_id) return json({ error: "Cette table est déjà la table principale." }, 409);
    if (t[0].merged_into) return json({ error: "Cette table est déjà rattachée à une autre." }, 409);
    // don't nest joins: a table that already has children can't become a child
    const ownKids = await sql`select id from tables where merged_into = ${tid}`;
    if (ownKids.length) return json({ error: "Séparez d'abord les tables déjà jointes." }, 409);

    await sql`update tables set merged_into = ${r.table_id} where id = ${tid}`;
    await sql`update reservations set table_id = ${r.table_id} where table_id = ${tid} and res_date = ${r.res_date}`;
    await logTableEvent(r.table_id, id, "add_table", me.role, "+" + t[0].code, r.name);
    const seats = await sql`select coalesce(sum(seats),0) as n from tables where id = ${r.table_id} or merged_into = ${r.table_id}`;
    const rows = await sql`select * from reservations where id = ${id}`;
    return json({ ok: true, reservation: rows[0], added: t[0].code, merged_seats: seats[0].n });
  }

  /* Free ONE specific table of a booking that may hold several (#8): the owner
     releases each table on its own as guests leave.
     - a secondary (child) table  -> detached, becomes free; booking keeps the rest
     - the primary, with children -> a child is promoted to primary, the old
       primary is freed; the booking stays seated on the remaining tables
     - the primary, no children   -> booking goes to "Acceptées sans table" */
  if (action === "free_table") {
    const tid = parseInt(b.free_table_id, 10);
    if (!tid) return json({ error: "bad request" }, 400);
    const t = await sql`select * from tables where id = ${tid}`;
    if (!t.length) return json({ error: "Table introuvable." }, 404);
    const reason = String(b.reason || "").slice(0, 120) || "—";

    if (tid === r.table_id) {
      const kids = await sql`select * from tables where merged_into = ${r.table_id} order by id`;
      if (kids.length) {
        const np = kids[0].id;                                   // promote first child to primary
        await sql`update tables set merged_into = null where id = ${np}`;
        await sql`update tables set merged_into = ${np} where merged_into = ${r.table_id}`;
        await sql`update reservations set table_id = ${np} where id = ${id}`;
      } else {
        await sql`update reservations set table_id = null, waiting = 0 where id = ${id}`;
      }
      await logTableEvent(r.table_id, id, "free", me.role, reason, r.name);
    } else if (t[0].merged_into === r.table_id) {
      await sql`update tables set merged_into = null where id = ${tid}`;         // detach child
      await logTableEvent(r.table_id, id, "free", me.role, "-" + t[0].code, r.name);
    } else {
      return json({ error: "Cette table n'appartient pas à cette réservation." }, 409);
    }
    const rows = await sql`select * from reservations where id = ${id}`;
    return json({ ok: true, reservation: rows[0], freed: t[0].code });
  }

  /* Detach a secondary table again (#8). Primary is untouched. */
  if (action === "remove_table") {
    const tid = parseInt(b.remove_table_id, 10);
    if (!tid) return json({ error: "bad request" }, 400);
    const t = await sql`select * from tables where id = ${tid}`;
    if (!t.length) return json({ error: "Table introuvable." }, 404);
    if (t[0].merged_into !== r.table_id) return json({ error: "Cette table n'est pas rattachée à cette réservation." }, 409);
    await sql`update tables set merged_into = null where id = ${tid}`;
    await logTableEvent(r.table_id, id, "remove_table", me.role, "-" + t[0].code, r.name);
    const rows = await sql`select * from reservations where id = ${id}`;
    return json({ ok: true, reservation: rows[0], removed: t[0].code });
  }

  return json({ error: "bad request" }, 400);
};
