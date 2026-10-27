/* the waiting list: staff read it all, a booking made from it marks it "booked" */
import assert from "assert";
const { issueToken } = await import("../.tmp/_lib/auth.mjs");
const { LOG } = await import("../.tmp/_lib/db.mjs");
const wl = (await import("../.tmp/waitlist.mjs")).default;
const call = async (role, method, body, qs) => {
  const r = await wl(new Request("https://x/api/waitlist" + (qs || ""), { method,
    headers: { "content-type": "application/json", authorization: "Bearer " + issueToken(role) },
    body: method === "GET" ? undefined : JSON.stringify(body) }));
  return r.status;
};
assert.equal(await call("reception", "GET", null, "?all=1"), 200);
assert.ok(LOG.some((l) => /from waitlist order by created_at desc/.test(l.q)), "history = every entry, newest first");
assert.equal(await call("gerant", "POST", { action: "booked", id: 3 }), 200);
assert.ok(LOG.some((l) => /set status = 'booked'/.test(l.q) && l.args.includes(3)));
assert.equal(await call("watcher", "POST", { action: "booked", id: 3 }), 403, "suivi stays read-only");
console.log("OK waitlist: history for every staff role · booked from the list · suivi read-only");
