import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

/* Undo for the reversible desk actions (#7).
   POST /api/reservation-restore { id, type, snapshot }

   `type` says which action is being undone so the right side-effects are
   reversed (client punctuality counters, arrival timestamps). `snapshot` holds
   the fields as they were BEFORE the action, captured client-side from the
   list the dashboard already had. No new rows are ever created — the same
   reservation is set back to its previous state.

   Deliberately NOT offered for no-show / declined / cancelled: those carry
   blacklisting and client-stat consequences that a snapshot cannot safely
   reverse, so those keep a confirmation dialog instead of a fake undo. */
const UNDOABLE = new Set(["arrived", "seated", "accept", "assign", "free", "wait", "add_table", "remove_table"]);

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const b = await readBody(req);
  const id = parseInt(b.id, 10);
  const type = String(b.type || "");
  const snap = b.snapshot || {};
  if (!id || !UNDOABLE.has(type)) return json({ error: "bad request" }, 400);

  const found = await sql`select * from reservations where id = ${id}`;
  if (!found.length) return json({ error: "not found" }, 404);
  const cur = found[0];

  // reverse the client punctuality / completion counters this action had bumped
  if (type === "arrived" && cur.client_id && cur.arrived_at) {
    if ((cur.late_minutes || 0) <= 15) await sql`update clients set on_time = max(0, on_time - 1) where id = ${cur.client_id}`;
    else await sql`update clients set late_count = max(0, late_count - 1) where id = ${cur.client_id}`;
  }
  if (type === "seated" && cur.client_id) {
    await sql`update clients set bookings_completed = max(0, bookings_completed - 1) where id = ${cur.client_id}`;
  }

  if (type === "add_table" || type === "remove_table") {
    /* table joins live on the tables table — snapshot carries the child id and
       what its merged_into was before, so we put it back exactly. */
    const childId = parseInt(snap.child_table_id, 10);
    if (childId) {
      const back = snap.child_merged_into == null ? null : parseInt(snap.child_merged_into, 10);
      await sql`update tables set merged_into = ${back} where id = ${childId}`;
    }
    const rows = await sql`update reservations set table_id = ${snap.table_id == null ? null : parseInt(snap.table_id, 10)},
      updated_at = datetime('now') where id = ${id} returning *`;
    return json({ ok: true, reservation: rows[0] });
  }

  // restore the reservation's own state from the snapshot
  const status = snap.status || cur.status;
  const table_id = snap.table_id === undefined ? cur.table_id : (snap.table_id == null ? null : parseInt(snap.table_id, 10));
  const waiting = snap.waiting ? 1 : 0;
  const arrived_at = snap.arrived_at || null;
  const seated_at = snap.seated_at || null;
  const late_minutes = snap.late_minutes == null ? null : parseInt(snap.late_minutes, 10);

  const rows = await sql`
    update reservations
       set status = ${status}, table_id = ${table_id}, waiting = ${waiting},
           arrived_at = ${arrived_at}, seated_at = ${seated_at}, late_minutes = ${late_minutes},
           updated_at = datetime('now')
     where id = ${id} returning *`;

  try {
    await sql`insert into events (type, path, meta) values (
      'reservation', ${"reservation:" + id},
      ${JSON.stringify({ reservation_id: id, kind: "undo", by: me.role, undone: type, guest: cur.name })}
    )`;
  } catch (e) { /* history is best-effort */ }

  return json({ ok: true, reservation: rows[0] });
};
