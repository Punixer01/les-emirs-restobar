import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { sendMail, replyHtml } from "./_lib/notify.mjs";

/* The owner's mailbox — everything sent AND received, kept for good.
   `peer` is a generated column (the other party's address, lower-cased), so
   every mail files itself into its conversation, whoever inserted it.

   GET  /api/emails                         -> latest 200 (+ ?before=<id> for older, ?q= to search all history)
   GET  /api/emails?unread=1                -> unread count (badge)
   GET  /api/emails?id=12                   -> one message, full body + original HTML
   GET  /api/emails?threads=1[&q=]          -> conversations, most recent first
   GET  /api/emails?peer=<address>          -> one conversation, oldest first, full bodies
   POST /api/emails {action:"read", id}          mark one read (omit id = all)
   POST /api/emails {action:"delete", id}        remove one
   POST /api/emails {action:"star", id, important}
   POST /api/emails {action:"draft_save", ...}
   POST /api/emails {action:"send", to, subject, body, attachments}
   POST /api/emails {action:"import_sent", after?}  pull recent sends from Resend  */

const OWN = /@lesemirs\.(com|tn)$/i;               // the restaurant's own addresses
const PAGE = 200;

const toText = (html) => String(html || "")
  .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
  .replace(/[ \t]{2,}/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
const addrOf = (s) => { const m = String(s || "").match(/<([^>]+)>/); return (m ? m[1] : String(s || "")).trim().toLowerCase(); };
const sqliteTs = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 19).replace("T", " ") : null; };

export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET") {
    const url = new URL(req.url);
    const id = parseInt(url.searchParams.get("id"), 10);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
    const like = "%" + q + "%";
    const SEARCH = `(coalesce(peer,'') like ? or lower(coalesce(subject,'')) like ? or lower(coalesce(from_name,'')) like ?
                     or lower(coalesce(from_addr,'')) like ? or lower(coalesce(to_addr,'')) like ? or lower(coalesce(body,'')) like ?)`;
    const SEARCH_ARGS = [like, like, like, like, like, like];

    if (id) {
      const rows = await sql`select * from emails where id = ${id}`;
      if (!rows.length) return json({ error: "introuvable" }, 404);
      await sql`update emails set is_read = 1 where id = ${id}`;
      return json({ email: rows[0] });
    }

    /* badge refresh: just the count, not 200 rows every 20 s */
    if (url.searchParams.get("unread") === "1") {
      const n = await sql`select count(*) as n from emails
                          where is_read = 0 and coalesce(direction,'') not in ('out','draft')`;
      return json({ unread: n.length ? n[0].n : 0 });
    }

    /* conversations: one line per correspondent, with the last message */
    if (url.searchParams.get("threads") === "1") {
      const threads = await sql.query(
        `select peer, count(*) as n,
                sum(case when direction = 'in' then 1 else 0 end)                  as recu,
                sum(case when direction = 'out' then 1 else 0 end)                 as envoye,
                sum(case when direction = 'in' and is_read = 0 then 1 else 0 end)  as unread,
                max(created_at) as last, max(id) as last_id
           from emails
          where direction != 'draft' and coalesce(peer,'') != ''
                ${q ? "and " + SEARCH : ""}
          group by peer order by last desc limit 300`, q ? SEARCH_ARGS : []);
      const ids = threads.map((t) => t.last_id);
      const lastById = {};
      if (ids.length) {
        const lasts = await sql.query(
          `select id, subject, snippet, from_name, direction from emails where id in (${ids.map(() => "?").join(",")})`, ids);
        for (const m of lasts) lastById[m.id] = m;
      }
      /* a display name: the latest name the correspondent signed with */
      const names = {};
      if (threads.length) {
        const nm = await sql.query(
          `select peer, from_name from emails
            where direction = 'in' and from_name is not null and from_name != '' and peer in (${threads.map(() => "?").join(",")})
            order by id asc`, threads.map((t) => t.peer));
        for (const r of nm) names[r.peer] = r.from_name;
      }
      return json({
        threads: threads.map((t) => ({
          ...t, name: names[t.peer] || null, own: OWN.test(t.peer),
          last_subject: (lastById[t.last_id] || {}).subject || null,
          last_snippet: (lastById[t.last_id] || {}).snippet || null,
          last_direction: (lastById[t.last_id] || {}).direction || null,
        })),
      });
    }

    /* one conversation, oldest first, every body — readable again end to end */
    const peer = (url.searchParams.get("peer") || "").trim().toLowerCase();
    if (peer) {
      const rows = await sql`
        select id, from_addr, from_name, to_addr, subject, body, direction, is_read, important, created_at,
               (html is not null and html != '') as has_html
          from emails where peer = ${peer} and direction != 'draft'
         order by created_at asc, id asc limit 1000`;
      await sql`update emails set is_read = 1 where peer = ${peer} and direction = 'in' and is_read = 0`;
      return json({ peer, emails: rows });
    }

    /* the folder list: newest 200, older pages on demand, or a search across all */
    const before = parseInt(url.searchParams.get("before"), 10) || 0;
    const where = [], args = [];
    if (before) { where.push("id < ?"); args.push(before); }
    if (q) { where.push(SEARCH); args.push(...SEARCH_ARGS); }
    const rows = await sql.query(
      `select id, from_addr, from_name, to_addr, subject, snippet, is_read, size, direction, important, created_at, peer,
              (html is not null and html != '') as has_html
         from emails ${where.length ? "where " + where.join(" and ") : ""}
        order by id desc limit ${PAGE + 1}`, args);
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    /* drafts and sent copies never count as "unread" (only meaningful on the first page) */
    const unread = page.filter((m) => !m.is_read && m.direction !== "out" && m.direction !== "draft").length;
    return json({ emails: page, unread, more });
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

    /* Star / unstar an email — shared across every staff device */
    if (b.action === "star" && b.id) {
      await sql`update emails set important = ${b.important ? 1 : 0} where id = ${b.id}`;
      return json({ ok: true });
    }

    /* Drafts live in the same table as direction 'draft', so they sync across
       devices like the rest of the mailbox. Save creates or updates one. */
    if (b.action === "draft_save") {
      const to = String(b.to || "").trim();
      const subject = String(b.subject || "").trim();
      const body = String(b.body || "");
      const snippet = body.replace(/\s+/g, " ").slice(0, 180);
      const from = process.env.MAIL_OUTBOUND || "Les Émirs <contact@lesemirs.tn>";
      if (b.id) {
        await sql`update emails set to_addr = ${to}, subject = ${subject}, body = ${body}, snippet = ${snippet}, size = ${body.length}, created_at = datetime('now') where id = ${b.id} and direction = 'draft'`;
        return json({ ok: true, id: b.id });
      }
      const ins = await sql`
        insert into emails (from_addr, to_addr, subject, body, snippet, direction, is_read, size, created_at)
        values (${String(from)}, ${to}, ${subject}, ${body}, ${snippet}, 'draft', 1, ${body.length}, datetime('now'))
        returning id`;
      return json({ ok: true, id: ins.length ? ins[0].id : null });
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
      /* "Répondre" to a guest's email: the house format — their request quoted
         (read from the database, cut before their own quoted history), then the
         answer, in the branded layout. A brand-new email stays plain. */
      let html;
      const replyId = parseInt(b.reply_to_id, 10);
      const orig = replyId ? await sql`select body, from_name from emails where id = ${replyId} and direction = 'in' limit 1` : [];
      if (orig.length) {
        const quote = String(orig[0].body || "")
          .split(/\n\s*(?:>|-{2,}\s*Original|Le .{0,120}a écrit\s*:|On .{0,120}wrote\s*:)/i)[0]
          .trim().slice(0, 2000);
        html = replyHtml(orig[0].from_name || "", quote || null, text);
      } else {
        html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17150f;white-space:pre-wrap">${
          text.replace(/[<>&]/g, (c) => (c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&amp;"))
        }</div>`;
      }

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

      /* keep a copy in the conversation, marked as sent (attachment names noted) */
      const names = attachments.map((a) => a.filename).join(", ");
      const logBody = text + (names ? `\n\n[Pièces jointes : ${names}]` : "");
      const providerId = (res && res.data && res.data.id) || null;
      try {
        await sql`insert into emails (from_addr, to_addr, subject, body, snippet, direction, is_read, size, html, provider_id)
                  values (${String(from)}, ${to}, ${subject}, ${logBody}, ${logBody.replace(/\s+/g, " ").slice(0, 180)}, 'out', 1, ${logBody.length}, ${html}, ${providerId})`;
      } catch (e) { console.error("[email out log]", e); }

      return json({ ok: true, id: providerId });
    }

    /* Pull what Resend actually sent into the history — mails sent before
       every send was stored (campaigns, tests…) come back into their
       conversations. One page of 40 per call: 1 list + ≤40 retrieves stays
       under the Workers limit of 50 subrequests; the dashboard loops with
       `after` while has_more. Never duplicates: a mail already stored (same
       Resend id, or same recipient + subject within 10 min) is only linked. */
    if (b.action === "import_sent") {
      const key = process.env.RESEND_API_KEY;
      if (!key) return json({ error: "L'envoi d'emails n'est pas configuré." }, 400);
      const own = (process.env.RESTAURANT_EMAIL || "").toLowerCase();
      const qs = new URLSearchParams({ limit: "40" });
      if (b.after) qs.set("after", String(b.after).slice(0, 100));
      const H = { Authorization: `Bearer ${key}` };
      const lr = await fetch(`https://api.resend.com/emails?${qs}`, { headers: H });
      const list = await lr.json().catch(() => ({}));
      if (!lr.ok) return json({ error: `Resend a refusé la liste (${lr.status}) : ${list.message || list.name || "erreur"}` }, 502);

      let imported = 0, linked = 0, skipped = 0;
      const data = Array.isArray(list.data) ? list.data : [];
      for (const e of data) {
        const to = (Array.isArray(e.to) ? e.to : [e.to]).filter(Boolean).map(String);
        const first = addrOf(to[0]);
        // the site's own alerts to the restaurant already sit in the inbox as received mail
        if (!first || OWN.test(first) || (own && first === own)) { skipped++; continue; }
        const exists = await sql`select id from emails where provider_id = ${e.id} limit 1`;
        if (exists.length) { skipped++; continue; }
        const ts = sqliteTs(e.created_at);
        if (!ts) { skipped++; continue; }
        const twin = await sql`
          select id from emails
           where direction = 'out' and provider_id is null and peer = ${first}
             and coalesce(subject,'') = ${String(e.subject || "")}
             and abs(julianday(created_at) - julianday(${ts})) < (10.0 / 1440)
           limit 1`;
        if (twin.length) { await sql`update emails set provider_id = ${e.id} where id = ${twin[0].id}`; linked++; continue; }

        const gr = await fetch(`https://api.resend.com/emails/${encodeURIComponent(e.id)}`, { headers: H });
        const full = await gr.json().catch(() => ({}));
        if (!gr.ok) { skipped++; continue; }
        const html = String(full.html || "");
        const body = (full.text ? String(full.text) : toText(html)).slice(0, 60000) || "(message sans texte)";
        await sql`insert into emails (from_addr, to_addr, subject, body, snippet, direction, is_read, size, html, provider_id, created_at)
                  values (${String(full.from || e.from || "")}, ${to.join(", ")}, ${String(e.subject || "")}, ${body},
                          ${body.replace(/\s+/g, " ").slice(0, 180)}, 'out', 1, ${body.length},
                          ${html && html.length <= 400000 ? html : null}, ${e.id}, ${ts})`;
        imported++;
      }
      const lastId = data.length ? data[data.length - 1].id : null;
      return json({ ok: true, imported, linked, skipped, has_more: !!list.has_more && !!lastId, after: lastId });
    }

    return json({ error: "action" }, 400);
  }

  return json({ error: "method" }, 405);
};
