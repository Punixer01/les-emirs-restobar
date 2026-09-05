import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { sendMail } from "./_lib/notify.mjs";

/* The owner's inbox, as delivered by the email Worker.
   GET  /api/emails                    -> latest 200 + unread count
   GET  /api/emails?id=12              -> one message, full body
   POST /api/emails {action:"read", id}      mark one read (omit id = all)
   POST /api/emails {action:"delete", id}    remove one                     */
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const id = parseInt(url.searchParams.get("id"), 10);

    if (id) {
      const rows = await sql`select * from emails where id = ${id}`;
      if (!rows.length) return json({ error: "introuvable" }, 404);
      await sql`update emails set is_read = 1 where id = ${id}`;
      return json({ email: rows[0] });
    }

    /* the list never carries full bodies — a mailbox page should stay light */
    const rows = await sql`
      select id, from_addr, from_name, to_addr, subject, snippet, is_read, size, direction, created_at
      from emails order by created_at desc limit 200`;
    const unread = rows.filter((m) => !m.is_read && m.direction !== "out").length;
    return json({ emails: rows, unread });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    if (b.action === "read") {
      if (b.id) await sql`update emails set is_read = 1 where id = ${b.id}`;
      else await sql`update emails set is_read = 1 where is_read = 0`;
      return json({ ok: true });
    }
    if (b.action === "delete" && b.id) {
      await sql`delete from emails where id = ${b.id}`;
      return json({ ok: true });
    }

    /* Compose / reply — send from the restaurant's own address so the guest
       sees "contact@lesemirs.tn", and a reply comes back to this same inbox. */
    if (b.action === "send") {
      const to = String(b.to || "").trim();
      const subject = String(b.subject || "").trim() || "(sans objet)";
      const text = String(b.body || "").trim();
      if (!/.+@.+\..+/.test(to)) return json({ error: "Adresse du destinataire invalide." }, 400);
      if (!text) return json({ error: "Le message est vide." }, 400);

      const from = process.env.MAIL_OUTBOUND || "Les Émirs <contact@lesemirs.tn>";
      const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17150f;white-space:pre-wrap">${
        text.replace(/[<>]/g, (c) => (c === "<" ? "&lt;" : "&gt;"))
      }</div>`;

      /* attachments: any file type. Sanitise to { filename, content(base64) } and
         cap the total so the message doesn't bounce at the mail server. */
      let attachments = [];
      if (Array.isArray(b.attachments)) {
        let total = 0;
        for (const a of b.attachments) {
          const filename = String((a && a.filename) || "fichier").slice(0, 200);
          const content = String((a && a.content) || "");
          if (!content) continue;
          total += Math.floor(content.length * 0.75);   // base64 → raw bytes
          attachments.push({ filename, content });
        }
        if (total > 20 * 1024 * 1024) return json({ error: "Pièces jointes trop lourdes (max ~18 Mo au total)." }, 413);
      }

      const res = await sendMail(from, to, subject, html, attachments);
      if (res && res.error) return json({ error: "Envoi impossible : " + res.error }, 502);
      if (res && res.skipped) return json({ error: "L'envoi d'emails n'est pas configuré." }, 400);

      /* keep a copy in the thread, marked as sent (attachment names noted) */
      const names = attachments.map((a) => a.filename).join(", ");
      const logBody = text + (names ? `\n\n[Pièces jointes : ${names}]` : "");
      try {
        await sql`insert into emails (from_addr, to_addr, subject, body, snippet, direction, is_read, size)
                  values (${String(from)}, ${to}, ${subject}, ${logBody}, ${logBody.replace(/\s+/g, " ").slice(0, 180)}, 'out', 1, ${logBody.length})`;
      } catch (e) { console.error("[email out log]", e); }

      return json({ ok: true, id: res && res.data && res.data.id });
    }

    return json({ error: "action" }, 400);
  }

  return json({ error: "method" }, 405);
};
