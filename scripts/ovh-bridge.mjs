#!/usr/bin/env node
/**
 * Bridge the OLD OVH-hosted zone to the new host.
 *
 * Why this exists: a .com delegation is cached by resolvers for up to 48 h.
 * Until that expires, some networks still ask OVH's nameservers — and OVH is
 * still serving the pre-migration zone, which points at the old web server.
 * Those visitors silently get the OLD website, with a valid certificate and
 * no error to hint at it.
 *
 * So we repoint the A / AAAA records inside OVH's own zone at the new host.
 * Stale resolvers then land on the new site instead of the old one.
 *
 * It touches A and AAAA on the apex and www, and NOTHING else — MX, SPF and
 * every other record are left exactly as they are, because those are the
 * client's live email.
 *
 *   node scripts/ovh-bridge.mjs lesemirs.com            # show what it would do
 *   node scripts/ovh-bridge.mjs lesemirs.com --apply
 */
import crypto from "node:crypto";

const ENDPOINT = process.env.OVH_ENDPOINT || "https://eu.api.ovh.com/1.0";
const AK = process.env.OVH_APP_KEY, AS = process.env.OVH_APP_SECRET, CK = process.env.OVH_CONSUMER_KEY;
if (!AK || !AS || !CK) { console.error("Missing OVH_APP_KEY / OVH_APP_SECRET / OVH_CONSUMER_KEY"); process.exit(1); }

const ZONE = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!ZONE) { console.error("usage: ovh-bridge.mjs <zone> [--apply]"); process.exit(1); }

/* the new host's addresses — anycast, they answer for any zone by Host header */
const TARGET = {
  A: ["188.114.96.6", "188.114.97.6"],
  AAAA: ["2a06:98c1:3120::6", "2a06:98c1:3121::6"],
};
const NAMES = ["", "www"];          // apex and www only
const TOUCHABLE = new Set(["A", "AAAA"]);

let drift = null;
async function ts() {
  if (drift === null) {
    const r = await fetch(ENDPOINT + "/auth/time");
    drift = parseInt(await r.text(), 10) - Math.floor(Date.now() / 1000);
  }
  return Math.floor(Date.now() / 1000) + drift;
}
async function call(method, path, body) {
  const url = ENDPOINT + path;
  const payload = body === undefined ? "" : JSON.stringify(body);
  const t = await ts();
  const sig = "$1$" + crypto.createHash("sha1").update([AS, CK, method, url, payload, t].join("+")).digest("hex");
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Ovh-Application": AK, "X-Ovh-Consumer": CK,
               "X-Ovh-Timestamp": String(t), "X-Ovh-Signature": sig },
    body: payload || undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${txt}`);
  try { return JSON.parse(txt); } catch { return txt; }
}

const ids = await call("GET", `/domain/zone/${ZONE}/record`);
const records = [];
for (const id of ids) records.push(await call("GET", `/domain/zone/${ZONE}/record/${id}`));

console.log(`Zone ${ZONE} — ${records.length} records\n`);
const protectedRecords = records.filter((r) => !TOUCHABLE.has(r.fieldType));
console.log("Left untouched (mail and everything else):");
for (const r of protectedRecords)
  console.log(`   ${r.fieldType.padEnd(6)} ${(r.subDomain || "@").padEnd(24)} ${r.target}`);

const victims = records.filter((r) => TOUCHABLE.has(r.fieldType) && NAMES.includes(r.subDomain || ""));
console.log("\nTo repoint at the new host:");
for (const r of victims)
  console.log(`   ${r.fieldType.padEnd(6)} ${(r.subDomain || "@").padEnd(24)} ${r.target}`);

if (!APPLY) { console.log("\n(dry run — pass --apply to make the change)"); process.exit(0); }

/* Replace rather than edit in place: one A record has to become two. */
for (const r of victims) await call("DELETE", `/domain/zone/${ZONE}/record/${r.id}`);
console.log(`\ndeleted ${victims.length} stale address records`);

let added = 0;
for (const sub of NAMES) {
  for (const type of ["A", "AAAA"]) {
    for (const target of TARGET[type]) {
      await call("POST", `/domain/zone/${ZONE}/record`, { fieldType: type, subDomain: sub, target, ttl: 300 });
      added++;
    }
  }
}
console.log(`added ${added} records pointing at the new host (ttl 300)`);

await call("POST", `/domain/zone/${ZONE}/refresh`, {});
console.log("zone refreshed");

/* prove the mail records survived */
const after = [];
for (const id of await call("GET", `/domain/zone/${ZONE}/record`)) after.push(await call("GET", `/domain/zone/${ZONE}/record/${id}`));
const mx = after.filter((r) => r.fieldType === "MX");
const spf = after.filter((r) => r.fieldType === "TXT" && /v=spf1/i.test(r.target));
console.log(`\nafter: ${mx.length} MX record(s), ${spf.length} SPF record(s) — mail intact: ${mx.length >= 3 && spf.length >= 1}`);
