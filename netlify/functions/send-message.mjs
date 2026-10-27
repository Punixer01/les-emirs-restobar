import { sql } from "./_lib/db.mjs";
import { json, readBody, normPhone } from "./_lib/util.mjs";
import { auth, WRITERS } from "./_lib/auth.mjs";
import { sendClientMessage } from "./_lib/notify.mjs";

// POST /api/send-message  (owner/reception)
// Body: { text, reservationId? , clientId?, phone?, email?, name? }
// Sends the message to the client (email preferred, SMS fallback) and logs it.
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, WRITERS);
  if (!me) return json({ error: "unauthorized" }, 401);

  const b = await readBody(req);
  const text = String(b.text || b.body || "").trim();
  if (!text) return json({ error: "Message vide." }, 400);

  let email = b.email || null;
  let phone = b.phone ? normPhone(b.phone) : null;
  let name = b.name || null;
  let clientId = b.clientId || null;
  let reservationId = b.reservationId || null;

  if (reservationId) {
    const r = await sql`select * from reservations where id = ${reservationId} limit 1`;
    if (r.length) {
      email = email || r[0].email;
      phone = phone || r[0].phone;
      name = name || r[0].name;
      clientId = clientId || r[0].client_id;
    }
  } else if (clientId) {
    const c = await sql`select * from clients where id = ${clientId} limit 1`;
    if (c.length) { email = email || c[0].email; phone = phone || c[0].phone; name = name || c[0].name; }
  }

  if (!email && !phone) return json({ error: "Aucun contact (email/téléphone) pour ce client." }, 400);

  /* answering a website message: quote the guest's own words above the reply
     (read from the database, never from the browser) */
  let quote = null;
  const replyId = parseInt(b.replyToId, 10);
  if (replyId) {
    const q = await sql`select body from messages where id = ${replyId} and direction = 'inbound' limit 1`;
    if (q.length) quote = String(q[0].body || "").replace(/^WhatsApp : /, "").trim() || null;
  }

  const res = await sendClientMessage({ email, phone, name, text, quote });
  const sent = !(res && res.skipped);
  await sql`
    insert into messages (direction, client_id, reservation_id, name, phone, email, body, is_read)
    values ('outbound', ${clientId}, ${reservationId}, ${name}, ${phone}, ${email}, ${text}, true)`;

  return json({ ok: true, sent, channel: [email && "email", phone && "WhatsApp"].filter(Boolean).join(" + ") || "none" });
};
