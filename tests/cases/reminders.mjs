/* reminder emails: each due booking once; a booking already claimed is skipped */
import assert from "assert";
const { answerWith, LOG } = await import("../.tmp/_lib/db.mjs");
const { SENT } = await import("../.tmp/_lib/notify.mjs");
const { sendDueReminders } = await import("../.tmp/_lib/reminders.mjs");
const cron = (await import("../.tmp/cron.mjs")).default;

const due = [{ id: 11, email: "a@b.co", name: "A" }, { id: 12, email: "c@d.co", name: "C" }];
answerWith((t, a) => {
  if (/select \* from reservations/.test(t) && /reminded_at is null/.test(t)) return due;
  if (/update reservations set reminded_at/.test(t)) return a.includes(12) ? [] : [{ id: a[0] }];   // 12 claimed elsewhere
});
SENT.splice(0);
const out = await sendDueReminders();
assert.deepEqual(out, { due: 2, sent: 1 });
assert.deepEqual(SENT.filter((s) => s.k === "reminder").map((s) => s.a[0].id), [11], "only the booking this run claimed");
const q = LOG.filter((l) => /select \* from reservations/.test(l.q)).pop().q.replace(/\s+/g, " ");
assert.ok(/status = 'accepted'/.test(q) && /arrived_at is null/.test(q) && /email is not null/.test(q), "confirmed, not arrived, with an email");
answerWith(null);

/* the cron route needs the key */
process.env.CRON_KEY = "k-123";
assert.equal((await cron(new Request("https://x/api/cron", { method: "POST" }))).status, 401);
assert.equal((await cron(new Request("https://x/api/cron", { method: "POST", headers: { "x-cron-key": "nope" } }))).status, 401);
assert.equal((await cron(new Request("https://x/api/cron", { method: "POST", headers: { "x-cron-key": "k-123" } }))).status, 200);
console.log("OK reminders: once per booking, claimed before sending · cron route needs its key");
