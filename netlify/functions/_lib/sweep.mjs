import { sql } from "./db.mjs";
import { sendDueReminders } from "./reminders.mjs";

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

/* End of shift: the room goes back to its normal configuration for the next
   service. Tables joined together for a big group during the night are split
   again; tables the owner marked BLOCKED or hors service stay exactly as they
   are, and nobody's saved positions are touched — that layout IS the plan.
   Runs once per business day (the 4am boundary), lazily, like the sweep. */
export async function resetPlanForNewShift() {
  try {
    const day = (await sql`select date('now','-3 hours') as d`)[0].d;
    const row = await sql`select value from settings where key = 'plan_reset_day'`;
    if (row.length && row[0].value === day) return { skipped: true };

    const joined = await sql`select count(*) as n from tables where merged_into is not null`;
    await sql`update tables set merged_into = null where merged_into is not null`;
    await sql`insert into settings (key, value) values ('plan_reset_day', ${day})
              on conflict (key) do update set value = excluded.value`;
    const n = joined.length ? joined[0].n : 0;
    if (n) console.log("[shift reset] split", n, "joined tables for", day);

    /* Data retention: a photographed ticket carries the guest's signature. Once
       the debt has been settled for 6 months it is no longer proof of anything,
       so the image is dropped — the ledger line (who, how much, when) is kept.
       Unpaid debts keep their photo for as long as they are owed. */
    const purged = await sql`
      update debts set photo = null, photo_thumb = null
       where photo is not null
         and settled_at is not null
         and settled_at < datetime('now','-6 months')
       returning id`;
    if (purged.length) console.log("[retention] cleared", purged.length, "settled ticket photos");

    return { split: n, day, photos_purged: purged.length };
  } catch (e) {
    console.error("[shift reset]", e);
    return { error: String((e && e.message) || e) };
  }
}

let lastRun = 0;

export async function sweepExpired(force) {
  const now = Date.now();
  if (!force && now - lastRun < 60_000) return { skipped: true };
  lastRun = now;
  /* a new business day also means a fresh room */
  await resetPlanForNewShift();
  /* reminder emails ride along: any dashboard poll (or the cron) sends what is due */
  try { await sendDueReminders(); } catch (e) { console.error("[sweep reminders]", e); }
  try {
    /* 1) Same day, more than 30 minutes past the booked time and still not
       arrived -> EXPIRED (never an automatic no-show: the owner marks no-shows
       by hand). A booking made AFTER its slot (the last slot stays open until
       midnight) counts its 30 minutes from when it was made. The guest stays
       visible in "Pas encore arrivé" and also appears
       in "Expirées". The table is deliberately LEFT ASSIGNED so the owner can
       still seat a late arrival or release it himself. */
    const nowMin = tunisMinutes();
    const lateCut = nowMin - LATE_NO_SHOW_MIN;
    let noShows = [];
    if (lateCut > 0) {
      noShows = await sql`
        select id, client_id from reservations
        where status = 'accepted' and res_date = date('now','-3 hours') and arrived_at is null
          and max(cast(substr(res_time,1,2) as integer) * 60 + cast(substr(res_time,4,2) as integer),
                  case when date(created_at,'+1 hour') = res_date
                       then cast(strftime('%H', created_at, '+1 hour') as integer) * 60
                          + cast(strftime('%M', created_at) as integer) else 0 end) < ${lateCut}`;
      if (noShows.length) {
        await sql`
          update reservations set status = 'expired', updated_at = datetime('now')
          where status = 'accepted' and res_date = date('now','-3 hours') and arrived_at is null
            and max(cast(substr(res_time,1,2) as integer) * 60 + cast(substr(res_time,4,2) as integer),
                  case when date(created_at,'+1 hour') = res_date
                       then cast(strftime('%H', created_at, '+1 hour') as integer) * 60
                          + cast(strftime('%M', created_at) as integer) else 0 end) < ${lateCut}`;
        /* No client no-show tally here: a late guest is only a confirmed no-show
           once the owner marks it by hand. Auto-expiry never penalises anyone. */
      }
    }

    /* 2) The day has gone by and it was never honoured -> expired. No tally
       change: penalising a client is a manual no-show decision by the owner.
       A guest who ARRIVED came: he stays "arrived" forever (that is his visit
       history) — only his table is handed back for the next service. */
    const stale = await sql`
      select id from reservations
      where status = 'accepted' and arrived_at is null and res_date < date('now','-3 hours')`;
    if (stale.length) {
      await sql`update reservations
                set status = 'expired', table_id = null, waiting = 0, updated_at = datetime('now')
                where status = 'accepted' and arrived_at is null and res_date < date('now','-3 hours')`;
    }
    /* 3) A request nobody answered and whose day has gone by would sit in
       "En attente" forever: it moves to "Expirées", where it can still be seen. */
    await sql`update reservations set status = 'expired', updated_at = datetime('now')
              where status = 'pending' and res_date < date('now','-3 hours')`;
    await sql`update reservations set table_id = null, waiting = 0
              where status = 'arrived' and table_id is not null and res_date < date('now','-3 hours')`;
    return { expired: stale.length, no_shows: noShows.length };
  } catch (e) {
    console.error("[sweep]", e);
    return { error: String(e && e.message || e) };
  }
}
