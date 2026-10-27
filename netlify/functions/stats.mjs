import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { auth, STAFF, isWatcher } from "./_lib/auth.mjs";
import { sweepExpired } from "./_lib/sweep.mjs";

// GET /api/stats (owner) — dashboard analytics (SQLite / D1 dialect)
export default async (req) => {
  const me = auth(req, STAFF);
  if (!me) return json({ error: "unauthorized" }, 401);
  /* a watcher account is read-only: it may look at the service, never change it */
  if (isWatcher(me) && req.method !== "GET") return json({ error: "Compte en lecture seule." }, 403);

  await sweepExpired();

  /* Today's service, which is what the owner actually watches during a rush:
     who still needs a table, who has walked in, who has not. */
  const today = await sql`
    select
      /* A walk-in (Sans réservation) is counted ONLY in its own box: every other
         box excludes source='walkin'. */
      sum(case when status='pending' and coalesce(source,'') != 'walkin' then 1 else 0 end) as pending,
      sum(case when (status in ('accepted','arrived','seated','expired','no_show') or (status='pending' and modified=1)) and coalesce(source,'') != 'walkin' then 1 else 0 end) as accepted,
      coalesce(sum(case when status in ('accepted','arrived','seated','expired') and coalesce(source,'') != 'walkin' then party_size else 0 end),0) as covers,
      sum(case when status in ('accepted','arrived','seated','expired') and coalesce(source,'') != 'walkin' and table_id is null then 1 else 0 end) as no_table,
      sum(case when status in ('accepted','arrived','seated','expired') and coalesce(source,'') != 'walkin' and table_id is not null then 1 else 0 end) as with_table,
      sum(case when arrived_at is not null and coalesce(source,'') != 'walkin' then 1 else 0 end) as arrived,
      sum(case when arrived_at is null and status in ('accepted','expired') and coalesce(source,'') != 'walkin' then 1 else 0 end) as not_arrived,
      sum(case when status='no_show' and coalesce(source,'') != 'walkin' then 1 else 0 end) as no_shows,
      sum(case when waiting=1 and coalesce(source,'') != 'walkin' then 1 else 0 end) as waiting,
      sum(case when status='cancelled' and coalesce(source,'') != 'walkin' then 1 else 0 end) as cancelled,
      sum(case when status='declined' and coalesce(source,'') != 'walkin' then 1 else 0 end) as declined,
      sum(case when status='expired' and coalesce(source,'') != 'walkin' then 1 else 0 end) as expired,
      /* walk-ins still at a table — once their table is freed they leave the count */
      sum(case when source='walkin' and table_id is not null and status in ('accepted','arrived','seated') then 1 else 0 end) as walkins,
      sum(case when modified=1 and status='pending' and coalesce(source,'') != 'walkin' then 1 else 0 end) as modified,
      sum(case when coalesce(source,'') != 'walkin' then 1 else 0 end)         as total
    from reservations where res_date = date('now','-3 hours')`;

  /* En attente is the forward-looking queue (today + upcoming), so its KPI/badge
     matches the list, which no longer shows requests whose date has passed. */
  const pendAhead = await sql`select count(*) as n from reservations where status = 'pending' and res_date >= date('now','-3 hours') and coalesce(source,'') != 'walkin'`;
  if (today[0]) today[0].pending = pendAhead.length ? pendAhead[0].n : 0;

  /* The Annulées box glows on any NEW cancellation — including a client who
     cancels a future booking — so the alert tracks all cancellations, not just
     today's. The box still DISPLAYS today's count; this feeds the pulse only. */
  const cancAll = await sql`select count(*) as n from reservations where status = 'cancelled' and coalesce(source,'') != 'walkin'`;
  if (today[0]) today[0].cancelled_all = cancAll.length ? cancAll[0].n : 0;

  /* Everything below scans whole tables. The dashboard refreshes every 20 s on
     every open device, so these only run when the Analytics tab asks for them
     (?full=1) — running them on each refresh burned the D1 daily read quota
     (5M rows) and took the whole dashboard down on 2026-09-13. */
  /* owner only: the latest Crédit operation entered by the gérant — the Crédit
     tab glows when this moves past what the owner last saw */
  let gerantOp = null;
  if (me.role === "owner") {
    const g = await sql`select max(id) as id from debt_ops where created_by = 'gérance'`;
    gerantOp = g.length ? g[0].id : null;
  }

  if (new URL(req.url).searchParams.get("full") !== "1") return json({ today: today[0], gerant_op: gerantOp });

  const byStatus = await sql`select status, count(*) as n from reservations group by status`;
  const seating  = await sql`select seating, count(*) as n from reservations group by seating`;
  const perDay   = await sql`
    select res_date as day, count(*) as n
    from reservations where res_date >= date('now','-13 days')
    group by res_date order by res_date`;
  const perHour  = await sql`
    select cast(substr(res_time,1,2) as integer) as hour, count(*) as n
    from reservations group by hour order by hour`;
  const visitors = await sql`
    select
      sum(case when type='pageview' then 1 else 0 end)                              as pageviews,
      count(distinct case when type='pageview' then json_extract(meta,'$.sid') end) as visitors
    from events where created_at >= datetime('now','-30 days')`;
  const clients  = await sql`select count(*) as n from clients`;
  const topClients = await sql`
    select name, phone, bookings_completed, bookings_total, no_shows
    from clients order by bookings_completed desc, bookings_total desc limit 8`;
  const totals = await sql`
    select
      count(*)                                                                             as total,
      sum(case when status='pending' then 1 else 0 end)                                    as pending,
      sum(case when status='accepted' then 1 else 0 end)                                   as accepted,
      sum(case when status in ('arrived','seated') then 1 else 0 end)                      as honored,
      sum(case when status='no_show' then 1 else 0 end)                                    as no_shows,
      coalesce(sum(case when status in ('accepted','arrived','seated') then party_size else 0 end),0) as covers
    from reservations`;

  return json({
    totals: totals[0],
    today: today[0],
    byStatus, seating, perDay, perHour,
    visitors: visitors[0],
    clients: clients[0].n,
    topClients,
  });
};
