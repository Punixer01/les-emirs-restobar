/* refusing / cancelling: the staff choose auto / custom / none */
import assert from "assert";
const { issueToken } = await import("../.tmp/_lib/auth.mjs");
const { SENT } = await import("../.tmp/_lib/notify.mjs");
const { LOG, answerWith } = await import("../.tmp/_lib/db.mjs");
const rs = (await import("../.tmp/reservation-status.mjs")).default;
const call = async (body) => {
  const r = await rs(new Request("https://x/api/reservation-status", { method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + issueToken("owner") }, body: JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};
const kinds = () => SENT.splice(0).map((s) => s.k).filter((k) => k !== "push");
const updates = () => LOG.filter((l) => /update reservations set status/.test(l.q)).length;

let r = await call({ id: 1, status: "declined" });
assert.equal(r.status, 200); assert.deepEqual(kinds(), ["decision"], "default = the usual message");
r = await call({ id: 1, status: "cancelled", notify: "none" });
assert.equal(r.status, 200); assert.deepEqual(kinds(), [], "none = nothing sent");
const before = updates();
r = await call({ id: 1, status: "declined", notify: "custom", subject: "Objet", text: "" });
assert.equal(r.status, 400, "custom needs a message"); assert.equal(updates(), before, "nothing changed on a bad request");
r = await call({ id: 1, status: "cancelled", notify: "custom", subject: "Objet", text: "Bonjour" });
assert.equal(r.status, 400, "no email on file -> refused before any change"); assert.equal(updates(), before);
answerWith((t) => /select email from reservations/.test(t) ? [{ email: "a@b.co" }] : undefined);
r = await call({ id: 1, status: "cancelled", notify: "custom", subject: "Objet", text: "Bonjour" });
assert.equal(r.status, 200); assert.deepEqual(kinds(), ["custom"], "custom email sent");
answerWith(null);
r = await call({ id: 1, status: "accepted", notify: "none" });
assert.equal(r.status, 200); assert.deepEqual(kinds(), ["decision"], "accepting always confirms");
console.log("OK refuse/cancel notify: auto default · none · custom validated before change · accept unaffected");
