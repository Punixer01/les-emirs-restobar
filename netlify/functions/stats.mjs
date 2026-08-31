import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET /api/stats (owner) — dashboard analytics (SQLite / D1 dialect)
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const totals = await sql`
    select
      count(*)                                                                             as total,
      sum(case when status='pending' then 1 else 0 end)                                    as pending,
      sum(case when status='accepted' then 1 else 0 end)                                   as accepted,
      sum(case when status in ('arrived','seated') then 1 else 0 end)                      as honored,
      sum(case when status='no_show' then 1 else 0 end)                                    as no_shows,
      coalesce(sum(case when status in ('accepted','arrived','seated') then party_size else 0 end),0) as covers
    from reservations`;

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

  return json({
    totals: totals[0],
    byStatus, seating, perDay, perHour,
    visitors: visitors[0],
    clients: clients[0].n,
    topClients,
  });
};
