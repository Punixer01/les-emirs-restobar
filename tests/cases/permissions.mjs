/* who may do what — the rules that protect money, content and the guest book */
import assert from "assert";
const { issueToken } = await import("../.tmp/_lib/auth.mjs");
const route = async (name) => (await import("../.tmp/" + name + ".mjs")).default;
const call = async (name, role, method, body, qs) => {
  const h = { "content-type": "application/json" };
  if (role) h.authorization = "Bearer " + issueToken(role);
  const r = await (await route(name))(new Request("https://x/api/" + name + (qs || ""), { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(body || {}) }));
  return r.status;
};
const refused = (s) => s === 401 || s === 403;

/* crédit: owner-only actions */
for (const action of ["delete_op", "delete_account", "set_opening", "edit_op", "edit_account", "set_photo"]) {
  for (const role of ["gerant", "watcher", "reception"])
    assert.ok(refused(await call("debts", role, "POST", { action, id: 1, account_id: 1 })), `${role} must not ${action}`);
}
/* the suivi account reads, never writes */
assert.ok(!refused(await call("debts", "watcher", "GET")), "watcher reads crédit");
assert.ok(refused(await call("debts", "watcher", "POST", { action: "add_payment", account_id: 1, amount: 5, method: "cash" })), "watcher cannot cash in");
assert.ok(refused(await call("reservation-status", "watcher", "POST", { id: 1, status: "declined" })), "watcher cannot refuse");
assert.ok(refused(await call("waitlist", "watcher", "POST", { action: "close", id: 1 })), "watcher cannot close waitlist");
/* site content (menu, prices, winter mode) is the direction's */
for (const role of ["gerant", "watcher", "reception"])
  assert.ok(refused(await call("content", role, "POST", { content: {} })), `${role} must not edit the site`);
assert.ok(!refused(await call("content", "owner", "POST", { content: { winter: true } })), "owner edits the site");
/* no token, no staff data */
assert.ok(refused(await call("waitlist", null, "GET")), "waitlist is staff-only");
assert.ok(refused(await call("debts", null, "GET")), "crédit is staff-only");
console.log("OK permissions: crédit owner-only actions · suivi read-only · site content owner-only · anonymous refused");
