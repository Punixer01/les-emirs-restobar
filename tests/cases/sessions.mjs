/* a code change (or "Déconnecter tous les appareils") cancels older logins */
import assert from "assert";
const auth = await import("../.tmp/_lib/auth.mjs");
const { answerWith } = await import("../.tmp/_lib/db.mjs");
let stored = null;                                       // the settings row 'session_gen'
answerWith((t, a) => {
  if (/select value from settings where key = 'session_gen'/.test(t)) return stored ? [{ value: stored }] : [];
  if (/insert into settings \(key, value\) values \('session_gen'/.test(t)) { stored = a[0]; return []; }
  if (/insert into settings/.test(t)) return [];           // the code itself
});
const recOld = auth.verifyToken(auth.issueToken("reception"));
const ownerOld = auth.verifyToken(auth.issueToken("owner"));
assert.ok(await auth.sessionStillValid(recOld), "valid before any change");

/* the owner changes the reception code */
const cred = (await import("../.tmp/credentials.mjs")).default;
const r = await cred(new Request("https://x/api/credentials", { method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + auth.issueToken("owner") },
  body: JSON.stringify({ reception_code: "nouveau-123" }) }));
assert.equal(r.status, 200);
assert.equal(await auth.sessionStillValid(recOld), false, "old reception login cancelled");
assert.ok(await auth.sessionStillValid(ownerOld), "the owner stays logged in");
const g = await auth.sessionGens();
assert.ok(await auth.sessionStillValid(auth.verifyToken(auth.issueToken("reception", undefined, g.reception))), "a fresh reception login works");

/* log everyone out: the owner gets a fresh token back */
const r2 = await cred(new Request("https://x/api/credentials", { method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer " + auth.issueToken("owner") },
  body: JSON.stringify({ action: "logout_all" }) }));
const d2 = await r2.json();
assert.equal(await auth.sessionStillValid(ownerOld), false, "every old login cancelled");
assert.ok(await auth.sessionStillValid(auth.verifyToken(d2.token)), "the owner's new token works");
answerWith(null);
console.log("OK sessions: code change cancels that role's logins · logout_all cancels all, owner kept in");
