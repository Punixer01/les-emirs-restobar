import PostalMime from "postal-mime";

/**
 * Les Émirs — inbound mail.
 *
 * Cloudflare Email Routing hands every message for the domain to this Worker,
 * which parses it and writes it into the same D1 database the dashboard reads.
 * The restaurant's own OVH mailbox is never involved.
 */

const MAX_BODY = 60_000;   // a mail body that long is already unreadable
const SNIPPET = 180;

function clean(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Strip tags when a sender gives us HTML only — the dashboard renders the
   body as text, and unparsed markup there would be both ugly and unsafe. */
function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, " ");
}

export default {
  async email(message, env, ctx) {
    let parsed = {};
    let size = 0;
    try {
      const raw = new Response(message.raw);
      const buf = await raw.arrayBuffer();
      size = buf.byteLength;
      parsed = await PostalMime.parse(buf);
    } catch (e) {
      console.error("[mail parse]", e);
    }

    const fromAddr = (parsed.from && parsed.from.address) || message.from || "inconnu";
    const fromName = (parsed.from && parsed.from.name) || null;
    const subject = clean(parsed.subject).slice(0, 300) || "(sans objet)";
    const body = clean(parsed.text || htmlToText(parsed.html)).slice(0, MAX_BODY);
    const snippet = body.replace(/\s+/g, " ").slice(0, SNIPPET);

    try {
      await env.DB.prepare(
        `insert into emails (from_addr, from_name, to_addr, subject, body, snippet, size)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
      ).bind(fromAddr, fromName, message.to || null, subject, body, snippet, size).run();
    } catch (e) {
      /* If storing fails the mail must not vanish silently: bounce it so the
         sender knows it never arrived, rather than accepting and losing it. */
      console.error("[mail store]", e);
      message.setReject("Mailbox temporarily unavailable");
      return;
    }
  },
};
