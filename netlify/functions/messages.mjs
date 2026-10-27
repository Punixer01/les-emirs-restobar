import { sql } from "./_lib/db.mjs";
import { json, readBody, normPhone } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { rateLimit } from "./_lib/ratelimit.mjs";
import { notifyOwnerMessage } from "./_lib/notify.mjs";

// GET  /api/messages                (staff) — inbox (client -> restaurant) + unread count
// GET  /api/messages?threads=1      (staff) — one conversation per website contact
// GET  /api/messages?contact=<key>  (staff) — that contact's whole history, oldest first:
//        what they wrote on the site, their WhatsApp answers, the team's replies and
//        (owner only) every email sent to / received from their address
// POST /api/messages                (public) — a visitor sends a message from the site
// POST /api/messages {action:"read", id}  (staff) — mark read

const tail8 = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-8) : null; };
const WA = /^WhatsApp : /;

/* One contact = every message sharing an email, or the last 8 digits of a phone
   (numbers are stored with or without +216 / spaces). A row carrying both joins
   the two, so a site message left with a phone and a reply sent to the email
   end up in the same conversation. */
function groupContacts(rows) {
  const byEmail = new Map(), byPhone = new Map(), groups = [];
  const absorb = (into, from) => {
    if (into === from) return into;
    for (const r of from.rows) into.rows.push(r);
    for (const e of from.emails) { into.emails.add(e); byEmail.set(e, into); }
    for (const p of from.phones) { into.phones.add(p); byPhone.set(p, into); }
    from.merged = true;
    return into;
  };
  for (const m of rows) {
    const em = String(m.email || "").trim().toLowerCase() || null;
    const ph = tail8(m.phone);
    /* no email and no phone: nobody to match it with, but it must still be
       readable (and markable read) — it becomes its own conversation */
    if (!em && !ph) { groups.push({ emails: new Set(), phones: new Set(), rows: [m], solo: m.id }); continue; }
    const ge = em ? byEmail.get(em) : null, gp = ph ? byPhone.get(ph) : null;
    let g = ge && gp ? absorb(ge, gp) : (ge || gp);
    if (!g) { g = { emails: new Set(), phones: new Set(), rows: [] }; groups.push(g); }
    g.rows.push(m);
    if (em) { g.emails.add(em); byEmail.set(em, g); }
    if (ph) { g.phones.add(ph); byPhone.set(ph, g); }
  }
  return groups.filter((g) => !g.merged);
}
const keyOf = (g) => (g.solo ? "msg:" + g.solo : g.emails.size ? [...g.emails].sort()[0] : "tel:" + [...g.phones].sort()[0]);
const byTime = (a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id);

function summarize(g) {
  const rows = g.rows.slice().sort(byTime);
  const inbound = rows.filter((m) => m.direction === "inbound");
  const named = inbound.filter((m) => m.name).slice(-1)[0] || rows.filter((m) => m.name).slice(-1)[0];
  const withPhone = rows.filter((m) => m.phone).slice(-1)[0];
  const last = rows[rows.length - 1];
  return {
    key: keyOf(g),
    name: named ? named.name : null,
    email: g.emails.size ? [...g.emails].sort()[0] : null,
    phone: withPhone ? withPhone.phone : null,
    site: inbound.filter((m) => !WA.test(m.body || "")).length,
    whatsapp: inbound.filter((m) => WA.test(m.body || "")).length,
    replies: rows.filter((m) => m.direction === "outbound").length,
    unread: inbound.filter((m) => !m.is_read).length,
    last: last.created_at,
    last_text: String(last.body || "").replace(WA, ""),
    last_direction: last.direction,
  };
}
const inList = (arr) => arr.map(() => "?").join(",");

export default async (req) => {
  if (req.method === "GET") {
    const me = auth(req, ["owner", "reception", "gerant"]);   // no Messages for a watcher
    if (!me) return json({ error: "unauthorized" }, 401);
    const url = new URL(req.url);
    const owner = me.role === "owner";                // emails are the owner's only

    const wantThreads = url.searchParams.get("threads") === "1";
    const contact = (url.searchParams.get("contact") || "").trim().toLowerCase();

    if (!wantThreads && !contact) {
      const rows = await sql`select * from messages where direction = 'inbound' order by created_at desc limit 200`;
      const unread = rows.filter((m) => !m.is_read).length;
      return json({ messages: rows, unread });
    }

    const all = await sql`
      select id, direction, client_id, reservation_id, name, phone, email, body, is_read, created_at
        from messages order by created_at asc, id asc limit 5000`;
    const groups = groupContacts(all);

    /* ---- the list of contacts ---- */
    if (wantThreads) {
      const threads = groups.map(summarize);
      if (owner) {
        const peers = [...new Set(groups.flatMap((g) => [...g.emails]))];
        if (peers.length) {
          const counts = await sql.query(
            `select peer, direction, count(*) as n, max(created_at) as last from emails
              where direction in ('in','out') and peer in (${inList(peers)}) group by peer, direction`, peers);
          const lasts = await sql.query(
            `select peer, subject, direction, created_at from emails
              where id in (select max(id) from emails where direction in ('in','out') and peer in (${inList(peers)}) group by peer)`, peers);
          for (const g of groups) {
            const t = threads.find((x) => x.key === keyOf(g));
            t.email_in = 0; t.email_out = 0;
            for (const c of counts) {
              if (!g.emails.has(c.peer)) continue;
              if (c.direction === "in") t.email_in += c.n; else t.email_out += c.n;
            }
            for (const l of lasts) {
              if (!g.emails.has(l.peer) || !(l.created_at > t.last)) continue;
              t.last = l.created_at; t.last_text = "Email : " + (l.subject || "(sans objet)");
              t.last_direction = l.direction === "out" ? "outbound" : "inbound";
            }
          }
        }
      }
      threads.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0));
      const unread = all.filter((m) => m.direction === "inbound" && !m.is_read).length;
      return json({ threads, unread });
    }

    /* ---- one contact's whole history ---- */
    const g = groups.find((x) => keyOf(x) === contact)
      || groups.find((x) => x.emails.has(contact) || (contact.startsWith("tel:") && x.phones.has(contact.slice(4))));
    if (!g) return json({ error: "Contact introuvable." }, 404);

    const items = g.rows.map((m) => ({
      id: m.id, at: m.created_at,
      kind: m.direction === "outbound" ? "reply" : (WA.test(m.body || "") ? "whatsapp" : "site"),
      body: String(m.body || "").replace(WA, ""),
    }));
    const emails = [...g.emails];
    if (owner && emails.length) {
      const mails = await sql.query(
        `select id, subject, body, direction, created_at, (html is not null and html != '') as has_html
           from emails where direction in ('in','out') and peer in (${inList(emails)})
          order by created_at asc limit 1000`, emails);
      for (const e of mails) {
        items.push({ id: e.id, at: e.created_at, kind: e.direction === "out" ? "email_out" : "email_in",
                     subject: e.subject || "(sans objet)", body: e.body || "", has_html: e.has_html ? 1 : 0 });
      }
      await sql.query(`update emails set is_read = 1 where direction = 'in' and is_read = 0 and peer in (${inList(emails)})`, emails);
    }
    items.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const unreadIds = g.rows.filter((m) => m.direction === "inbound" && !m.is_read).map((m) => m.id);
    if (unreadIds.length) await sql.query(`update messages set is_read = 1 where id in (${inList(unreadIds)})`, unreadIds);

    const summary = summarize(g);
    summary.unread = 0;
    return json({ contact: summary, items });
  }

  if (req.method === "POST") {
    const b = await readBody(req);

    // owner action: mark read
    if (b.action === "read") {
      const me = auth(req, ["owner", "reception", "gerant"]);   // no Messages for a watcher
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
