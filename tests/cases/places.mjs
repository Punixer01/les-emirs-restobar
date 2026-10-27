/* winter mode: three places (salle, terrasse plein air, terrasse verrière) */
import assert from "assert";
const { validateBooking, zoneOf, seatFr } = await import("../.tmp/_lib/util.mjs");
const { answerWith, LOG } = await import("../.tmp/_lib/db.mjs");

assert.equal(zoneOf("verriere"), "verriere");
assert.equal(zoneOf("terrace"), "terrace");
assert.equal(zoneOf("garden"), "inside", "unknown place falls back to the salle");
assert.equal(seatFr("verriere"), "Terrasse verrière");
assert.equal(seatFr("terrace"), "Terrasse au plein air");
const ok = validateBooking({ name: "Amira", phone: "22123456", email: "a@b.co", date: "2026-11-20", time: "20:00", party: 2, seating: "verriere" });
assert.equal(ok.errors.length, 0); assert.equal(ok.value.seating, "verriere");

/* a full open-air terrace offers the verrière first, when it is free */
const reservations = (await import("../.tmp/reservations.mjs")).default;
answerWith((t, a) => {
  if (/from blocks/.test(t)) return a.includes("terrace") || a.includes("inside") ? [{ x: 1 }] : [];
});
const r = await reservations(new Request("https://x/api/reservations", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Amira", phone: "22123456", email: "a@b.co", date: "2026-11-20", time: "20:00", party: 2, seating: "terrace" }) }));
const d = await r.json();
assert.equal(r.status, 409); assert.equal(d.code, "full");
assert.equal(d.other, "verriere"); assert.equal(d.otherFree, true);
assert.deepEqual(d.rooms, { terrace: "full", verriere: "free", inside: "full" });
answerWith(null);
console.log("OK places: verrière accepted, labels, full terrace -> verrière offered first");
