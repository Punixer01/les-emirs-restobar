import { sql } from "./_lib/db.mjs";
import { dueIndex } from "./_lib/dues.mjs";
import { json } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

/* Historique — the client book with every outcome attached, so the owner can
   trace who comes, who cancels, who is refused and who never shows up.

   GET /api/clients-history?q=        -> every client + their counts per outcome
   GET /api/clients-history?id=<n>    -> one client's full booking timeline      */
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("id"), 10) || null;

  /* one client's timeline */
  if (id) {
    const who = await sql`select * from clients where id = ${id}`;
    if (!who.length) return json({ error: "Client introuvable." }, 404);
    const rows = await sql`
      select r.id, r.reference, r.res_date, r.res_time, r.party_size, r.seating,
             r.status, r.source, r.note, r.arrived_at, r.late_minutes,
             r.mod_summary, r.created_at, t.code as table_code
        from reservations r
        left join tables t on t.id = r.table_id
       where r.client_id = ${id}
       order by r.res_date desc, r.res_time desc
       limit 200`;
    return json({ client: who[0], reservations: rows });
  }

  const q = (url.searchParams.get("q") || "").trim();
  const like = "%" + q + "%";

  /* Counts are computed per client from the reservations themselves, so they
     always agree with the lists (never a stale counter on the client row). */
  const base = `
    select c.id, c.name, c.phone, c.email, c.is_blocked, c.last_visit,
           count(r.id)                                                               as total,
           sum(case when r.status in ('arrived','seated')
                     or (r.status = 'expired' and r.arrived_at is not null) then 1 else 0 end) as venus,
           sum(case when r.status = 'accepted'
                     and r.res_date >= date('now','-3 hours') then 1 else 0 end)     as a_venir,
           sum(case when r.status = 'pending' then 1 else 0 end)                     as en_attente,
           sum(case when r.status = 'declined' then 1 else 0 end)                    as refusees,
           sum(case when r.status = 'cancelled' then 1 else 0 end)                   as annulees,
           sum(case when r.status = 'no_show' then 1 else 0 end)                     as no_shows,
           sum(case when r.status = 'expired' and r.arrived_at is null then 1 else 0 end) as expirees,
           max(r.res_date)                                                           as last_date
      from clients c
      left join reservations r on r.client_id = c.id`;
  const tail = `
     group by c.id
     order by coalesce(max(r.res_date), '') desc, c.id desc
     limit 300`;

  const clients = q
    ? await sql.query(`${base} where c.name like ? or c.phone like ? ${tail}`, [like, like])
    : await sql.query(`${base} ${tail}`);

  /* headline totals across the whole book */
  const tot = await sql`
    select count(*) as clients,
           coalesce(sum(case when status in ('arrived','seated')
                              or (status = 'expired' and arrived_at is not null) then 1 else 0 end),0) as venus,
           coalesce(sum(case when status = 'declined'  then 1 else 0 end),0)           as refusees,
           coalesce(sum(case when status = 'no_show'   then 1 else 0 end),0)           as no_shows,
           coalesce(sum(case when status = 'cancelled' then 1 else 0 end),0)           as annulees
      from reservations
     where client_id is not null      -- the same bookings the client list below is built from (no walk-ins)`;
  const nClients = await sql`select count(*) as n from clients`;
  const totals = tot[0] || {};
  totals.clients = nClients.length ? nClients[0].n : 0;

  const dueOf = await dueIndex();
  for (const c of clients) { const d = dueOf(c.id, c.phone); c.due = d ? d.due : 0; }
  return json({ clients, totals });
};
