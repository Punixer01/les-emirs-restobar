import { sql } from "./_lib/db.mjs";
import { json, readBody, normPhone } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { rateLimit } from "./_lib/ratelimit.mjs";
import { notifyOwnerMessage } from "./_lib/notify.mjs";

// GET  /api/messages          (owner) — inbox (client -> restaurant)
// POST /api/messages          (public) — a visitor sends a message from the site
// POST /api/messages {action:"read", id}  (owner) — mark read
export default async (req) => {
  if (req.method === "GET") {
    const me = auth(req, ["owner"]);
    if (!me) return json({ error: "unauthorized" }, 401);
    const rows = await sql`select * from messages where direction = 'inbound' order by created_at desc limit 200`;
    const unread = rows.filter((m) => !m.is_read).length;
    return json({ messages: rows, unread });
  }

  if (req.method === "POST") {
    const b = await readBody(req);

    // owner action: mark read
    if (b.action === "read") {
      const me = auth(req, ["owner"]);
      if (!me) return json({ error: "unauthorized" }, 401);
      if (b.id) await sql`update messages set is_read = 1 where id = ${b.id}`;
      else await sql`update messages set is_read = 1 where direction = 'inbound' and is_read = 0`;
      return json({ ok: true });
    }

    // public inbound message
    const gate = await rateLimit(req, "msg", 5, 60 * 60);
    if (!gate.ok) return json({ error: "Trop de messages envoyés. Merci de nous appeler." }, 429);

    const body = String(b.body || b.message || "").trim();
    if (body.length < 2) return json({ error: "Message vide." }, 400);
    if (body.length > 2000) return json({ error: "Message trop long." }, 400);
    const name = b.name ? String(b.name).slice(0, 120) : null;
    const phone = b.phone ? normPhone(b.phone) : null;
    const email = b.email && /.+@.+\..+/.test(b.email) ? String(b.email).slice(0, 160) : null;

    let clientId = null;
    if (phone) {
      const c = await sql`select id from clients where phone = ${phone} limit 1`;
      if (c.length) clientId = c[0].id;
    }
    const rows = await sql`
      insert into messages (direction, client_id, name, phone, email, body)
      values ('inbound', ${clientId}, ${name}, ${phone}, ${email}, ${body})
      returning *`;
    try { await notifyOwnerMessage(sql, rows[0]); } catch (e) { console.error("[msg notify]", e); }
    return json({ ok: true });
  }

  return json({ error: "method" }, 405);
};
