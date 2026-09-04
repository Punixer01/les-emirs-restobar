#!/usr/bin/env node
/**
 * OVH domain helper — Les Émirs.
 *
 * Only three things are ever needed here: read the zone exactly as OVH holds
 * it (so nothing is lost in the move), read the current nameservers, and set
 * new ones. Everything is read-only unless `set-ns` is passed explicitly.
 *
 * Credentials come from the environment, never from a file in the repo:
 *   OVH_APP_KEY, OVH_APP_SECRET, OVH_CONSUMER_KEY
 *   OVH_ENDPOINT (default https://eu.api.ovh.com/1.0)
 *
 * Usage:
 *   node scripts/ovh.mjs check                      # credentials + what they can reach
 *   node scripts/ovh.mjs zone lesemirs.com          # authoritative zone export
 *   node scripts/ovh.mjs ns lesemirs.com            # current nameservers
 *   node scripts/ovh.mjs backup                     # export both zones to backup/
 *   node scripts/ovh.mjs set-ns lesemirs.com a.ns.cloudflare.com b.ns.cloudflare.com
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ENDPOINT = process.env.OVH_ENDPOINT || "https://eu.api.ovh.com/1.0";
const AK = process.env.OVH_APP_KEY;
const AS = process.env.OVH_APP_SECRET;
const CK = process.env.OVH_CONSUMER_KEY;

if (!AK || !AS || !CK) {
  console.error(`Missing credentials. Set them for this shell only:

  export OVH_APP_KEY=...
  export OVH_APP_SECRET=...
  export OVH_CONSUMER_KEY=...
`);
  process.exit(1);
}

/* OVH signs every call: $1$ + sha1(AS+CK+METHOD+URL+BODY+TIMESTAMP). The
   timestamp must match theirs, so take it from their own clock endpoint. */
let drift = null;
async function ovhTime() {
  if (drift === null) {
    const r = await fetch(ENDPOINT + "/auth/time");
    drift = parseInt(await r.text(), 10) - Math.floor(Date.now() / 1000);
  }
  return Math.floor(Date.now() / 1000) + drift;
}

async function call(method, urlPath, body) {
  const url = ENDPOINT + urlPath;
  const payload = body === undefined ? "" : JSON.stringify(body);
  const ts = await ovhTime();
  const sig = "$1$" + crypto.createHash("sha1")
    .update([AS, CK, method, url, payload, ts].join("+")).digest("hex");

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Ovh-Application": AK,
      "X-Ovh-Consumer": CK,
      "X-Ovh-Timestamp": String(ts),
      "X-Ovh-Signature": sig,
    },
    body: payload || undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

const zoneExport = (z) => call("GET", `/domain/zone/${z}/export`);
const nameServers = async (d) => {
  const ids = await call("GET", `/domain/${d}/nameServer`);
  return Promise.all(ids.map((id) => call("GET", `/domain/${d}/nameServer/${id}`)));
};

/* A zone is worthless as a backup unless the mail records are in it — check
   before writing the file, and shout if they are missing. */
function checkMail(zone, text) {
  const mx = (text.match(/\sMX\s/gi) || []).length;
  const spf = /v=spf1/i.test(text);
  console.log(`  ${mx} MX record(s), SPF ${spf ? "present" : "MISSING"}`);
  if (mx < 1 || !spf) console.log(`  !! ${zone}: mail records look wrong — do NOT change nameservers yet`);
  return mx >= 1 && spf;
}

/* Two endpoints exist for this, and which one a domain answers on depends on
   its TLD and how old the service is. Try the bulk update, fall back to
   replacing the entries one by one. */
async function setNameServers(domain, hosts) {
  try {
    return await call("POST", `/domain/${domain}/nameServers/update`, {
      nameServers: hosts.map((host) => ({ host })),
    });
  } catch (e) {
    if (!/404|Got an invalid|not found/i.test(e.message)) throw e;
    console.log("  bulk endpoint unavailable, replacing entries individually…");
    const current = await call("GET", `/domain/${domain}/nameServer`);
    for (const host of hosts) await call("POST", `/domain/${domain}/nameServer`, { host });
    for (const id of current) await call("DELETE", `/domain/${domain}/nameServer/${id}`);
    return { method: "individual", added: hosts.length, removed: current.length };
  }
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "check") {
    /* /me is not requested in the token rights on purpose — the account's
       personal details are none of our business. Report it if it is there. */
    try {
      const me = await call("GET", "/me");
      console.log(`account: ${me.nichandle}`);
    } catch { console.log("account: (not in token scope — fine)"); }
    /* Listing every domain needs a right on `/domain` itself, which a token
       scoped to `/domain/*` does not carry. Not worth asking for — probe the
       two domains we actually care about instead. */
    let domains = null;
    try { domains = await call("GET", "/domain"); console.log(`domains in the account: ${domains.join(", ")}`); }
    catch { console.log("domain list: (not in token scope — probing directly)"); }

    for (const d of ["lesemirs.com", "lesemirs.tn"]) {
      if (domains && !domains.includes(d)) { console.log(`  ${d}: NOT in this account`); continue; }
      const ns = (await nameServers(d)).map((n) => n.host);
      const t = await zoneExport(d);
      console.log(`  ${d}: nameservers ${ns.join(", ")}`);
      process.stdout.write("   ");
      checkMail(d, t);
    }

  } else if (cmd === "zone") {
    const t = await zoneExport(args[0]);
    console.log(t);
    checkMail(args[0], t);

  } else if (cmd === "ns") {
    console.log(JSON.stringify(await nameServers(args[0]), null, 2));

  } else if (cmd === "backup") {
    const dir = path.join(process.cwd(), "backup");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    for (const z of ["lesemirs.com", "lesemirs.tn"]) {
      const t = await zoneExport(z);
      const f = path.join(dir, `dns-${z}-${stamp}.txt`);
      console.log(`${z}:`);
      checkMail(z, t);
      fs.writeFileSync(f, t);
      console.log(`  saved → ${path.relative(process.cwd(), f)}`);
      console.log(`  nameservers: ${(await nameServers(z)).map((n) => n.host).join(", ")}`);
    }

  } else if (cmd === "set-ns") {
    const [domain, ...hosts] = args;
    if (!domain || hosts.length < 2) throw new Error("usage: set-ns <domain> <ns1> <ns2> [...]");

    /* Never flip nameservers on a zone whose mail records we have not seen. */
    const t = await zoneExport(domain);
    console.log(`Current zone for ${domain}:`);
    if (!checkMail(domain, t)) throw new Error("aborting: mail records not confirmed in the current zone");
    const before = (await nameServers(domain)).map((n) => n.host);
    console.log(`  nameservers now: ${before.join(", ")}`);
    console.log(`  nameservers new: ${hosts.join(", ")}`);

    const task = await setNameServers(domain, hosts);
    console.log("update task:", JSON.stringify(task));
    console.log("Propagation takes 30 min to 24 h. Verify with:  nslookup -type=NS " + domain);

  } else {
    console.log("commands: check | zone <domain> | ns <domain> | backup | set-ns <domain> <ns1> <ns2>");
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exit(1);
}
