import { json } from "./_lib/util.mjs";
import { sweepExpired } from "./_lib/sweep.mjs";
import { sendDueReminders } from "./_lib/reminders.mjs";

/* POST /api/cron — called every 10 minutes by the "les-emirs-cron" Cloudflare
   worker (see cron/), so reminder emails and the expiry sweep run even when no
   dashboard is open. Only the worker knows CRON_KEY. */
export default async (req) => {
  const key = process.env.CRON_KEY;
  if (!key || req.headers.get("x-cron-key") !== key) return json({ error: "unauthorized" }, 401);
  const reminders = await sendDueReminders();
  const sweep = await sweepExpired(true);
  return json({ ok: true, reminders, sweep });
};
