/* réservations manquées: a second "complet" try updates the same line; staff read, suivi cannot close */
import assert from "assert";
const { issueToken } = await import("../.tmp/_lib/auth.mjs");
const { LOG, answerWith } = await import("../.tmp/_lib/db.mjs");
const mod = await import("../.tmp/missed.mjs");
const v = { name: "Amira Ben", phone: "22123456", email: null, date: "2026-11-20", time: "20:00", party: 2, seating: "terrace" };
answerWith((t) => (/select id from missed/.test(t) ? [{ id: 9 }] : undefined));
await mod.recordMissed(v);
assert.ok(LOG.some((l) => /update missed set/.test(l.q) && /tries = tries \+ 1/.test(l.q) && l.args.includes(9)), "same guest + day = one line");
answerWith(null);
const call = async (role, method, body, qs) => (await mod.default(new Request("https://x/api/missed" + (qs || ""), { method,
  headers: { "content-type": "application/json", authorization: "Bearer " + issueToken(role) },
  body: method === "GET" ? undefined : JSON.stringify(body) }))).status;
assert.equal(await call("reception", "GET"), 200);
assert.equal(await call("owner", "GET", null, "?count=1"), 200);
assert.equal(await call("gerant", "POST", { action: "close", id: 9 }), 200);
assert.equal(await call("watcher", "POST", { action: "close", id: 9 }), 403, "suivi stays read-only");
assert.equal((await mod.default(new Request("https://x/api/missed"))).status, 401, "never public");
console.log("OK missed: kept on a full slot · one line per guest/day · staff list · suivi read-only");
