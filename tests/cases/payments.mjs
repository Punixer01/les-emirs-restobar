/* online payment: off until keys are set · amounts from the server · paid once · crédit reminder */
import assert from "assert";
const { signId, passToken } = await import("../.tmp/_lib/auth.mjs");
const { SENT } = await import("../.tmp/_lib/notify.mjs");
const { LOG, answerWith } = await import("../.tmp/_lib/db.mjs");
const pay = (await import("../.tmp/pay.mjs")).default;
const book = (await import("../.tmp/reservations.mjs")).default;

const get = async (qs) => { const r = await pay(new Request("https://x/api/pay?" + qs)); return r.headers.get("location") || ""; };
const count = (re) => LOG.filter((l) => re.test(String(l.q).replace(/\s+/g, " "))).length;

/* 1. no merchant keys: links lead to "unavailable", nothing is created */
delete process.env.CLICTOPAY_USER; delete process.env.CLICTOPAY_PASSWORD;
assert.match(await get(`k=deposit&id=5&t=${passToken(5)}`), /s=off/);
assert.equal(count(/insert into payments/), 0);

/* 2. keys set: the deposit amount comes from the booking, not the link */
process.env.CLICTOPAY_USER = "u"; process.env.CLICTOPAY_PASSWORD = "p"; process.env.CLICTOPAY_TEST = "1";
let sentAmount = null;
globalThis.fetch = async (url, o) => {
  const b = new URLSearchParams(o.body);
  if (/register\.do/.test(url)) { sentAmount = b.get("amount"); return { json: async () => ({ orderId: "ORD1", formUrl: "https://test.clictopay.com/form?x" }) }; }
  return { json: async () => ({ ErrorCode: "0", OrderStatus: paidNow ? 2 : 6 }) };
};
let paidNow = false;
answerWith((t) => {
  if (/from reservations where id/.test(t)) return [{ id: 5, reference: "ABC", status: "pending", lang: "fr", deposit_due: 240, deposit_paid: 40 }];
  if (/insert into payments/.test(t)) return [{ id: 9 }];
  return undefined;
});
assert.match(await get(`k=deposit&id=5&t=${passToken(5)}&amount=1`), /clictopay\.com\/form/);
assert.equal(sentAmount, "200000", "240 due − 40 paid = 200 DT, sent in millimes");
assert.match(await get(`k=deposit&id=5&t=forged`), /s=ko/, "a forged pass token is refused");

/* 3. the way back: a forged token changes nothing; a declined card changes nothing */
let pay9 = { id: 9, kind: "deposit", reservation_id: 5, amount: 200, status: "pending", gateway_order: "ORD1" };
answerWith((t) => {
  if (/select \* from payments/.test(t)) return [pay9];
  if (/update payments set status = 'paid'/.test(t)) { if (pay9.status !== "pending") return []; pay9 = { ...pay9, status: "paid" }; return [{ id: 9 }]; }
  return undefined;
});
assert.match(await get(`ret=9&t=nope`), /s=ko/);
assert.match(await get(`ret=9&t=${signId("payret", 9)}`), /s=ko/, "card declined");
assert.equal(count(/update reservations set deposit_paid/), 0);
/* paid: applied once, even if the guest comes back twice */
paidNow = true;
assert.match(await get(`ret=9&t=${signId("payret", 9)}`), /s=ok&k=deposit/);
assert.match(await get(`ret=9&t=${signId("payret", 9)}`), /s=ok&k=deposit/);
assert.equal(count(/update reservations set deposit_paid/), 1, "deposit counted exactly once");

/* 4. a crédit payment lands in the Crédit book as an online payment */
let pay10 = { id: 10, kind: "credit", account_id: 3, amount: 75.5, status: "pending", gateway_order: "ORD2" };
answerWith((t) => {
  if (/select \* from payments/.test(t)) return [pay10];
  if (/update payments set status = 'paid'/.test(t)) return [{ id: 10 }];
  return undefined;
});
assert.match(await get(`ret=10&t=${signId("payret", 10)}`), /s=ok&k=credit/);
const op = LOG.filter((l) => /insert into debt_ops/.test(l.q)).pop();
assert.deepEqual(op.args.slice(0, 2), [3, 75.5]);

/* 5. booking: a group of 12 at 20 DT/person owes 240 DT; a guest with a crédit gets the reminder */
SENT.splice(0);
answerWith((t) => {
  if (/key = 'payments'/.test(t)) return [{ value: JSON.stringify({ deposit_min: 10, deposit_per_person: 20, reminder_fr: "Merci de régler votre crédit." }) }];
  if (/from debt_accounts/.test(t)) return [{ id: 3, name: "X", client_id: 1, phone: "22123456", balance: 75.5 }];
  if (/insert into clients/.test(t)) return [{ id: 1, is_blocked: 0 }];
  if (/insert into reservations/.test(t)) return [{ id: 7, reference: "R7", name: "Test", phone: "22123456", email: "a@b.co", party_size: 12, status: "pending", lang: "fr", res_date: "2026-12-20", res_time: "20:00", seating: "inside" }];
  return undefined;
});
const res = await book(new Request("https://x/api/reservations", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Test", phone: "22123456", email: "a@b.co", date: "2026-12-20", time: "20:00", party: 12, seating: "inside" }) }));
const data = await res.json();
assert.equal(res.status, 200, JSON.stringify(data));
assert.equal(data.deposit.amount, 240);
assert.match(data.deposit.url, /k=deposit&id=7/);
const rem = SENT.find((s) => s.k === "creditReminder");
assert.ok(rem, "crédit reminder sent");
assert.equal(rem.a[1], 75.5);
assert.match(rem.a[3][0].url, /k=credit&a=3&t=/);
answerWith(null);
console.log("OK payments: off without keys · server-side amount · forged links refused · paid once · crédit book entry · group deposit · crédit reminder");
