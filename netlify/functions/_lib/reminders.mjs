import { sql } from "./db.mjs";
import { notifyClientReminder } from "./notify.mjs";

/* Reminder emails, a few hours before each confirmed booking.
   Times are Tunisia local (UTC+1 all year) like res_date/res_time.
   - confirmed ("accepted"), not arrived yet, with an email, never reminded
   - the table is between 30 min and REMIND_HOURS away
   - and the booking was made MORE than REMIND_HOURS before it: someone who booked
     an hour ago has just had the confirmation, a reminder would be noise.
   Each booking is claimed (reminded_at set) before the email goes out, so two
   runs at the same moment can never send it twice. */
export const REMIND_HOURS = 3;

export async function sendDueReminders() {
  let due = [];
  try {
    due = await sql`
      select * from reservations
       where status = 'accepted' and arrived_at is null and reminded_at is null
         and email is not null and email != ''
         and datetime(res_date || ' ' || substr(res_time,1,5)) >  datetime('now', '+1 hour', '+30 minutes')
         and datetime(res_date || ' ' || substr(res_time,1,5)) <= datetime('now', '+1 hour', ${"+" + REMIND_HOURS + " hours"})
         and datetime(created_at, '+1 hour') < datetime(res_date || ' ' || substr(res_time,1,5), ${"-" + REMIND_HOURS + " hours"})
       order by res_date, res_time limit 25`;
  } catch (e) { console.error("[reminders]", e); return { error: String(e && e.message || e) }; }
  let sent = 0;
  for (const r of due) {
    const claim = await sql`update reservations set reminded_at = datetime('now')
                             where id = ${r.id} and reminded_at is null returning id`;
    if (!claim.length) continue;                        // another run took it
    try { await notifyClientReminder(r); sent++; } catch (e) { console.error("[reminder]", r.id, e); }
  }
  return { due: due.length, sent };
}
