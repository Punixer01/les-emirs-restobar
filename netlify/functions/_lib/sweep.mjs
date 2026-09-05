import { sql } from "./db.mjs";

/* Cloudflare Pages has no cron, so the sweep runs lazily whenever staff load
   the dashboard. Any booking still sitting on "accepted" once its day has gone
   by was never honoured — it becomes "expired", which is deliberately kept
   distinct from a no-show the owner marked by hand.

   Auto-expired guests are counted in the client's no_show tally but are NEVER
   auto-blacklisted: nobody should lose access because the owner was too busy
   to tap a button. */
const LATE_NO_SHOW_MIN = 30;   // grace before a missing guest counts as a no-show

function tunisMinutes() {
  const d = new Date(Date.now() + 60 * 60 * 1000);   // Tunisia is UTC+1 year-round
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

let lastRun = 0;

export async function sweepExpired(force) {
  const now = Date.now();
  if (!force && now - lastRun < 60_000) return { skipped: true };
  lastRun = now;
  try {
    /* 1) Same day, more than 30 minutes past the booked time and still not
       arrived -> EXPIRED (never an automatic no-show: the owner marks no-shows
       by hand). The guest stays visible in "Pas encore arrivé" and also appears
       in "Expirées". The table is deliberately LEFT ASSIGNED so the owner can
       still seat a late arrival or release it himself. */
    const nowMin = tunisMinutes();
    const lateCut = nowMin - LATE_NO_SHOW_MIN;
    let noShows = [];
    if (lateCut > 0) {
      noShows = await sql`
        select id, client_id from reservations
        where status = 'accepted' and res_date = date('now') and arrived_at is null
          and (cast(substr(res_time,1,2) as integer) * 60
             + cast(substr(res_time,4,2) as integer)) < ${lateCut}`;
      if (noShows.length) {
        await sql`
          update reservations set status = 'expired', updated_at = datetime('now')
          where status = 'accepted' and res_date = date('now') and arrived_at is null
            and (cast(substr(res_time,1,2) as integer) * 60
               + cast(substr(res_time,4,2) as integer)) < ${lateCut}`;
        /* No client no-show tally here: a late guest is only a confirmed no-show
           once the owner marks it by hand. Auto-expiry never penalises anyone. */
      }
    }

    /* 2) The day has gone by and it was never honoured -> expired. No tally
       change: penalising a client is a manual no-show decision by the owner. */
    const stale = await sql`
      select id from reservations
      where status in ('accepted','arrived') and res_date < date('now')`;
    if (stale.length) {
      await sql`update reservations
                set status = 'expired', table_id = null, waiting = 0, updated_at = datetime('now')
                where status in ('accepted','arrived') and res_date < date('now')`;
    }
    return { expired: stale.length, no_shows: noShows.length };
  } catch (e) {
    console.error("[sweep]", e);
    return { error: String(e && e.message || e) };
  }
}
