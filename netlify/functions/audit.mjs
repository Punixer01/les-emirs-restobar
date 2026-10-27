import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

/* GET /api/audit?day=YYYY-MM-DD&until=YYYY-MM-DD   (owner only)
   Everything done from the dashboards on one day (Tunisia time, UTC+1),
   newest first, with the names behind the ids (reservations, credit clients,
   tables), plus how many actions each of the 35 days up to `until` had — for
   the day strip. Written by the router (functions/api/[[path]].js). */
const RES_ROUTES = new Set(["reservation-status", "reservation-update", "reservation-restore", "assign"]);
const TABLE_KEYS = ["table_id", "add_table_id", "free_table_id", "remove_table_id", "child_table_id"];

export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);
  if (req.method !== "GET") return json({ error: "method" }, 405);

  const url = new URL(req.url);
  const ymdOk = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  const day = ymdOk(url.searchParams.get("day")) ? url.searchParams.get("day") : today;
  const until = ymdOk(url.searchParams.get("until")) ? url.searchParams.get("until") : today;
  const start = day + " 00:00:00", end = until + " 00:00:00";

  const rows = await sql`
    select id, path, meta, created_at from events
     where type = 'audit'
       and created_at >= datetime(${start}, '-1 hour')
       and created_at <  datetime(${start}, '+1 day', '-1 hour')
     order by id desc limit 1500`;
  const act = await sql`
    select date(created_at, '+1 hour') as d, count(*) as n from events
     where type = 'audit'
       and created_at >= datetime(${end}, '-34 days', '-1 hour')
       and created_at <  datetime(${end}, '+1 day', '-1 hour')
     group by d`;

  const entries = [];
  const resIds = new Set(), acctIds = new Set(), tblIds = new Set();
  const addId = (set, v) => { const n = parseInt(v, 10); if (Number.isFinite(n) && n > 0) set.add(n); };
  for (const r of rows) {
    let m = {};
    try { m = JSON.parse(r.meta) || {}; } catch (e) { m = {}; }
    const b = m.body || {};
    if (RES_ROUTES.has(m.route)) addId(resIds, b.id);
    if (m.route === "send-message") addId(resIds, b.reservationId);
    if (m.route === "debts") addId(acctIds, b.account_id);
    for (const k of TABLE_KEYS) addId(tblIds, b[k]);
    if (m.route === "tables") addId(tblIds, b.id);
    entries.push(Object.assign({ id: r.id, at: r.created_at }, m));
  }

  const lookup = async (ids, text) => {
    if (!ids.size) return [];
    const list = [...ids];
    return sql.query(text.replace("(?)", "(" + list.map(() => "?").join(",") + ")"), list);
  };
  const names = { reservations: {}, accounts: {}, tables: {} };
  for (const x of await lookup(resIds, "select id, name, reference, res_date, res_time, party_size from reservations where id in (?)")) names.reservations[x.id] = x;
  for (const x of await lookup(acctIds, "select id, name from debt_accounts where id in (?)")) names.accounts[x.id] = x.name;
  for (const x of await lookup(tblIds, "select id, code from tables where id in (?)")) names.tables[x.id] = x.code;

  const activity = {};
  for (const r of act) activity[r.d] = r.n;
  return json({ day, until, today, entries, names, activity });
};
