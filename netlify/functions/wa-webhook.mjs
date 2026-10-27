import { sql } from "./_lib/db.mjs";
import { pushOwners } from "./_lib/notify.mjs";

// WhatsApp Cloud API webhook.
// GET  = Meta's verification handshake (echo hub.challenge when the token matches).
// POST = events: delivery statuses of what we sent (sent / delivered / read /
//        failed) and messages guests send back. Both are stored so the owner
//        sees in Envois whether a message really arrived, and replies land in
//        the Messages inbox.

/* Meta signs every POST: X-Hub-Signature-256 = HMAC-SHA256(app secret, raw
   body). Without WHATSAPP_APP_SECRET nothing is ingested (ack only) — an
   unsigned endpoint would let anyone inject fake replies into the inbox. */
async function validSignature(req, raw) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const sig = req.headers.get("x-hub-signature-256") || "";
  if (!secret || !sig.startsWith("sha256=")) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const got = sig.slice(7);
  if (got.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);   // constant time
  return diff === 0;
}

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (url.searchParams.get("hub.mode") === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });

  const raw = await req.text();
  // always 200: Meta retries anything else for days
  if (!(await validSignature(req, raw))) return new Response("ok", { status: 200 });
  let body;
  try { body = JSON.parse(raw); } catch (e) { return new Response("ok", { status: 200 }); }

  try {
    for (const entry of body.entry || []) {
      for (const ch of entry.changes || []) {
        const v = ch.value || {};

        for (const s of v.statuses || []) {
          const err = s.errors && s.errors[0];
          await sql`insert into events (type, path, meta) values ('wa_status', ${"wa:" + s.id},
            ${JSON.stringify({ id: s.id, status: s.status, error: err ? `${err.code} ${err.title || err.message || ""}`.trim() : null })})`;
        }

        const names = {};
        for (const c of v.contacts || []) names[c.wa_id] = c.profile && c.profile.name;
        for (const m of v.messages || []) {
          // Meta redelivers on timeouts — store each message once
          const seen = await sql`select 1 from events where type = 'wa_in' and path = ${"wa:" + m.id} limit 1`;
          if (seen.length) continue;
          await sql`insert into events (type, path, meta) values ('wa_in', ${"wa:" + m.id}, ${JSON.stringify({ from_tail: String(m.from).slice(-4) })})`;

          const text = m.type === "text" ? (m.text && m.text.body)
                     : m.type === "button" ? (m.button && m.button.text)
                     : `[${m.type} reçu sur WhatsApp]`;
          if (!text) continue;
          const digits = String(m.from || "").replace(/\D/g, "");
          const phone = "+" + digits;
          // client phones are stored with or without +216 / spaces: match on the last 8 digits
          const tail = digits.slice(-8);
          const c = tail.length === 8
            ? await sql`select id, name from clients where replace(replace(phone,' ',''),'+','') like ${"%" + tail} limit 1`
            : [];
          const name = names[m.from] || (c.length ? c[0].name : null);
          await sql`insert into messages (direction, client_id, name, phone, body)
                    values ('inbound', ${c.length ? c[0].id : null}, ${name}, ${phone}, ${"WhatsApp : " + String(text).slice(0, 2000)})`;
          try { await pushOwners(sql, { title: "WhatsApp · " + (name || phone), body: String(text).slice(0, 90), url: "/admin" }); } catch (e) {}
        }
      }
    }
  } catch (e) { console.error("[wa-webhook]", e); }
  return new Response("ok", { status: 200 });
};
