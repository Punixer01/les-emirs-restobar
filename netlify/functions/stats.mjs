import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET /api/stats  (owner) — dashboard analytics
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const totals = await sql`
    select
      count(*)::int                                                     as total,
      count(*) filter (where status='pending')::int                    as pending,
      count(*) filter (where status='accepted')::int                   as accepted,
      count(*) filter (where status in ('arrived','seated'))::int      as honored,
      count(*) filter (where status='no_show')::int                    as no_shows,
      coalesce(sum(party_size) filter (where status in ('accepted','arrived','seated')),0)::int as covers
    from reservations`;

  const byStatus = await sql`select status, count(*)::int as n from reservations group by status`;
  const seating  = await sql`select seating, count(*)::int as n from reservations group by seating`;
  const perDay   = await sql`
    select to_char(res_date,'YYYY-MM-DD') as day, count(*)::int as n
    from reservations where res_date >= current_date - interval '13 days'
    group by day order by day`;
  const perHour  = await sql`
    select extract(hour from res_time)::int as hour, count(*)::int as n
    from reservations group by hour order by hour`;
  const visitors = await sql`
    select
      count(*) filter (where type='pageview')::int                       as pageviews,
      count(distinct meta->>'sid') filter (where type='pageview')::int    as visitors
    from events where created_at >= current_date - interval '30 days'`;
  const clients  = await sql`select count(*)::int as n from clients`;
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
