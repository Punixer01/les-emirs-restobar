import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

/* GET /api/history            -> what happened to the tables lately
   GET /api/history?table=<id> -> just that table
   GET /api/history?res=<id>   -> just that booking

   Reads the `events` rows written by /api/assign, and joins the table code back
   on so the owner sees "T4" rather than an id. */
export default async (req) => {
  const me = auth(req, ["owner", "reception"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const table = parseInt(url.searchParams.get("table"), 10) || null;
  const res = parseInt(url.searchParams.get("res"), 10) || null;
  const limit = Math.min(200, parseInt(url.searchParams.get("limit"), 10) || 60);

  /* Scan log — who checked each guest in, the owner or reception. */
  if (url.searchParams.get("scans")) {
    const srows = await sql.query(
      `select meta, created_at from events where type = 'scan'
       order by created_at desc limit ?`, [limit]);
    const scans = [];
    for (const e of srows) {
      let m = {};
      try { m = typeof e.meta === "string" ? JSON.parse(e.meta) : (e.meta || {}); } catch (x) { continue; }
      scans.push({
        at: e.created_at,
        by: m.by || "reception",
        guest: m.guest || null,
        reference: m.reference || null,
        late_minutes: m.late_minutes || 0,
        on_time: m.on_time !== false,
      });
    }
    return json({ scans });
  }

  const rows = await sql.query(
    `select id, meta, created_at from events
     where type = 'table' order by created_at desc limit ?`, [limit * 3]);

  const codes = await sql`select id, code from tables`;
  const byId = {};
  for (const t of codes) byId[t.id] = t.code;

  const out = [];
  for (const e of rows) {
    let m = {};
    try { m = typeof e.meta === "string" ? JSON.parse(e.meta) : (e.meta || {}); } catch (x) { continue; }
    if (table && m.table_id !== table) continue;
    if (res && m.reservation_id !== res) continue;
    out.push({
      id: e.id,
      at: e.created_at,
      kind: m.kind,                       // assign | free
      by: m.by,                           // owner | reception
      guest: m.guest || null,
      reason: m.reason || null,
      table_id: m.table_id || null,
      table_code: m.table_id ? (byId[m.table_id] || "—") : "—",
      reservation_id: m.reservation_id || null,
    });
    if (out.length >= limit) break;
  }

  return json({ history: out });
};
