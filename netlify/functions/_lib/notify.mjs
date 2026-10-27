import { Resend } from "resend";
import { sql } from "./db.mjs";
import { sendPush } from "./webpush.mjs";
import { fmtDate, fmtTime, seatFr } from "./util.mjs";
import { editToken, passToken } from "./auth.mjs";

/* env read lazily (works on Cloudflare, where env is populated per-request) */
function getResend() { return process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null; }
function mailFrom() { return process.env.MAIL_FROM || "Les Émirs <contact@lesemirs.com>"; }
function restaurantEmail() { return process.env.RESTAURANT_EMAIL || null; }
function base() { return process.env.PUBLIC_BASE_URL || "https://lesemirs.com"; }

function vapid() {
  const publicKey = process.env.VAPID_PUBLIC_KEY, privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || "mailto:contact@lesemirs.tn" };
}
function parseSub(row) {
  return typeof row.sub === "string" ? JSON.parse(row.sub) : row.sub;
}

/* ---------- low-level channels ---------- */

/* Replies must reach the restaurant's real mailbox, never the sending
   subdomain — a guest hitting "reply" is answering the restaurant. */
function replyTo() { return process.env.REPLY_TO || process.env.RESTAURANT_EMAIL || null; }

export async function sendEmail(to, subject, html) {
  const resend = getResend();
  if (!resend || !to) return { skipped: true };
  const payload = { from: mailFrom(), to, subject, html };
  const rt = replyTo();
  if (rt) payload.reply_to = rt;
  try { return await resend.emails.send(payload); }
  catch (e) { console.error("[email]", e); return { error: String(e) }; }
}

/* Send with an explicit From — used by the dashboard's compose/reply so the
   owner writes as the restaurant. Reply-To is the same address, so any answer
   lands back in his inbox. */
export async function sendMail(from, to, subject, html, attachments) {
  const resend = getResend();
  if (!resend || !to) return { skipped: true };
  /* Replies must reach the dashboard inbox (contact@lesemirs.tn), never the
     from-address — which may be a .com that has no mailbox behind it. */
  const rt = replyTo() || (String(from).match(/<([^>]+)>/) || [])[1] || from;
  const payload = { from, to, subject, html, reply_to: rt };
  if (Array.isArray(attachments) && attachments.length) payload.attachments = attachments;
  try { return await resend.emails.send(payload); }
  catch (e) { console.error("[email send]", e); return { error: String((e && e.message) || e).slice(0, 200) }; }
}

/* Keep a copy of every guest-facing email in the same `emails` table the inbox
   reads, marked direction 'out', so the dashboard's Emails tab is a full record
   of what the restaurant sent AND received. HTML is flattened to text for the
   stored body/snippet. Best-effort: a logging failure never blocks the send. */
export async function logOutbound(to, subject, html) {
  if (!to) return;
  try {
    const text = String(html || "")
      .replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
      .replace(/\s+/g, " ").trim();
    /* the original HTML is kept too, so the owner can re-open the mail exactly
       as the guest received it (QR code, buttons) — capped to keep rows light */
    const original = String(html || "");
    await sql`insert into emails (from_addr, to_addr, subject, body, snippet, direction, is_read, size, html)
      values (${mailFrom()}, ${String(to)}, ${String(subject || "")}, ${text}, ${text.slice(0, 180)}, 'out', 1, ${text.length},
              ${original && original.length <= 400000 ? original : null})`;
  } catch (e) { console.error("[email out log]", e); }
}

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !tok || !from || !to) return { skipped: true };
  try {
    const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
    });
    return await r.json();
  } catch (e) { console.error("[sms]", e); return { error: String(e) }; }
}

export async function sendWhatsApp(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_WHATSAPP_FROM;
  if (!sid || !tok || !from || !to) return { skipped: true };
  try {
    const auth = Buffer.from(`${sid}:${tok}`).toString("base64");
    const toW = String(to).startsWith("whatsapp:") ? to : "whatsapp:" + to;
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: toW, From: from, Body: body }),
    });
    return await r.json();
  } catch (e) { console.error("[whatsapp]", e); return { error: String(e) }; }
}

/* ---- WhatsApp via Meta Cloud API ----
   Business-initiated messages (we message a guest who hasn't written to us)
   MUST use a Meta-approved template, so each event maps to a template name +
   ordered body parameters. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID (Cloudflare
   secrets); optional WHATSAPP_LANG (default fr) and WHATSAPP_API_VERSION. */
function whatsappCfg() {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId) return null;
  return { token, phoneId, api: process.env.WHATSAPP_API_VERSION || "v21.0", lang: process.env.WHATSAPP_LANG || "fr" };
}
/* Meta wants the number in international digits, no "+". A bare 8-digit local
   Tunisian number gets +216. */
function waNumber(to) {
  let d = String(to || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 8) d = "216" + d;
  return d;
}
/* opts: { image, button, ref }
   image  = public PNG link for a template created with an IMAGE header (the QR)
   button = dynamic suffix for a template's URL button ({{1}} at the end of the URL)
   ref    = booking reference, only for the Envois journal
   Every send is journaled (events type 'wa') so the owner sees what left and
   what Meta refused; delivery statuses arrive later through wa-webhook. */
export async function sendWhatsAppTemplate(to, templateName, bodyParams, langCode, opts) {
  const cfg = whatsappCfg();
  const num = waNumber(to);
  if (!cfg || !num || !templateName) return { skipped: true };
  opts = opts || {};
  const components = [];
  if (opts.image) components.push({ type: "header", parameters: [{ type: "image", image: { link: opts.image } }] });
  if (bodyParams && bodyParams.length) {
    components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: String(t == null ? "" : t).slice(0, 1000) })) });
  }
  if (opts.button) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(opts.button) }] });
  const payload = {
    messaging_product: "whatsapp",
    to: num,
    type: "template",
    template: { name: templateName, language: { code: langCode || cfg.lang }, components },
  };
  let out;
  try {
    const r = await fetch(`https://graph.facebook.com/${cfg.api}/${cfg.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.error("[whatsapp]", r.status, JSON.stringify(j).slice(0, 300));
    out = { ok: r.ok, status: r.status, body: j };
  } catch (e) { console.error("[whatsapp]", e); out = { ok: false, error: String(e) }; }
  await logWa(templateName, num, out, opts.ref);
  return out;
}
/* journal line: template, last 4 digits only, Meta's message id or its error */
async function logWa(template, num, out, ref) {
  try {
    const b = out.body || {};
    const e = b.error;
    const meta = {
      template, to: "…" + String(num).slice(-4), ok: !!out.ok, ref: ref || null,
      id: (b.messages && b.messages[0] && b.messages[0].id) || null,
      code: e ? e.code || null : null,
      error: e ? `${e.code || ""} ${(e.error_data && e.error_data.details) || e.message || ""}`.trim() : (out.error || null),
    };
    await sql`insert into events (type, path, meta) values ('wa', ${"wa:" + template}, ${JSON.stringify(meta)})`;
  } catch (err) { console.error("[wa journal]", err); }
}
/* Meta codes meaning "this template can't be used as sent": missing or not
   approved in that language (132001), wrong variables (132000), wrong
   header/button format (132012) — worth retrying with the simpler fallback */
const WA_TEMPLATE_MISMATCH = [132000, 132001, 132012];
async function sendWa(phone, wa, ref) {
  const res = await sendWhatsAppTemplate(phone, wa.name, wa.params, wa.lang, Object.assign({ ref }, wa.opts));
  const code = res && res.body && res.body.error && res.body.error.code;
  if (wa.fallback && res && !res.ok && WA_TEMPLATE_MISMATCH.includes(code)) {
    return sendWhatsAppTemplate(phone, wa.fallback.name, wa.fallback.params, wa.fallback.lang, { ref });
  }
  return res;
}

async function reachClient(r, subject, html, smsText, wa) {
  const jobs = [];
  if (r.email) { jobs.push(sendEmail(r.email, subject, html)); jobs.push(logOutbound(r.email, subject, html)); }
  if (r.phone) {
    jobs.push(sendSms(r.phone, smsText));
    if (wa && wa.name) jobs.push(sendWa(r.phone, wa, r.reference));
  }
  await Promise.allSettled(jobs);
}
function langSuffix(r) { return isEn(r) ? "&lang=en" : ""; }
function editLink(r) { return r && r.id ? `${base()}/modifier?r=${r.id}&t=${editToken(r.id)}${langSuffix(r)}` : ""; }
function cancelLink(r) { return r && r.id ? `${base()}/modifier?r=${r.id}&t=${editToken(r.id)}&annuler=1${langSuffix(r)}` : ""; }
function passLink(r) { return r && r.id ? `${base()}/pass?r=${r.id}&t=${passToken(r.id)}${langSuffix(r)}` : ""; }

/* The QR block for the guest's email. Points at /api/qr rather than embedding
   SVG, because most mail clients strip inline SVG but render <img> fine. */
function passBlock(r) {
  if (!r || !r.id) return "";
  const t = passToken(r.id);
  const img = `${base()}/api/qr?r=${r.id}&t=${t}`;
  return `<div style="margin:24px 0;padding:22px;background:#fff;border:1px solid #e2dccf;border-radius:8px;text-align:center">
      <img src="${img}" width="220" height="220" alt="${isEn(r) ? "Booking code" : "Code de réservation"} ${r.reference}"
           style="display:block;margin:0 auto;width:220px;height:220px;image-rendering:pixelated" />
      <div style="font-size:13px;color:#3b352b;margin-top:14px">${isEn(r) ? "Show this code at the door." : "Présentez ce code à l'accueil."}</div>
      <div style="font-family:Georgia,serif;font-size:17px;color:#17150f;margin-top:16px;letter-spacing:.04em">${r.reference}</div>
      <div style="font-size:12px;color:#8b8271;margin-top:4px">${isEn(r) ? "to show on arrival" : "à présenter à l'arrivée"}</div>
      <a href="${passLink(r)}" style="display:inline-block;margin-top:18px;padding:11px 22px;background:#1f473f;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600;letter-spacing:.02em">${isEn(r) ? "Open my booking" : "Ouvrir ma réservation"}</a>
    </div>`;
}

export async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return { skipped: true };
  try {
    await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: c, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("[tg]", e); }
}

export async function pushOwners(sql, payload, opts) {
  const cfg = vapid();
  if (!cfg) { console.error("[push] VAPID keys missing"); return; }
  try {
    /* every registered staff device (direction AND réception) is alerted —
       unless opts.role narrows it, e.g. { role: "owner" } for the direction only */
    const subs = opts && opts.role
      ? await sql`select id, sub from push_subscriptions where role = ${opts.role}`
      : await sql`select id, sub from push_subscriptions`;
    await Promise.all(subs.map(async (s) => {
      try {
        const res = await sendPush(parseSub(s), JSON.stringify(payload), cfg);
        /* 404/410 mean the browser threw the subscription away — so should we,
           otherwise dead devices are retried forever */
        if (!res.ok) {
          console.error("[push] refused", res.status, res.body || "");
          if (res.status === 404 || res.status === 410)
            await sql`delete from push_subscriptions where id = ${s.id}`;
        }
      } catch (e) { console.error("[push] send failed", String(e && e.message).slice(0, 200)); }
    }));
  } catch (e) { console.error("[push]", e); }
}

/* Same path as a real alert, but it reports what happened for every device
   instead of swallowing it. */
export async function pushTest(sql, payload) {
  const env = process.env;
  const cfg = vapid();
  const report = {
    vapid: { public: !!env.VAPID_PUBLIC_KEY, private: !!env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || null },
    configured: !!cfg,
    devices: [],
  };
  let subs = [];
  try { subs = await sql`select id, role, endpoint, sub from push_subscriptions`; }
  catch (e) { report.error = "db: " + String(e.message).slice(0, 160); return report; }

  report.count = subs.length;
  if (!report.configured) return report;

  for (const s of subs) {
    const host = String(s.endpoint || "").split("/")[2] || "?";
    try {
      const res = await sendPush(parseSub(s), JSON.stringify(payload), cfg);
      report.devices.push({ id: s.id, host, ok: res.ok, status: res.status, error: res.body || null });
    } catch (e) {
      report.devices.push({ id: s.id, host, ok: false, status: null, error: String((e && e.message) || e).slice(0, 220) });
    }
  }
  return report;
}

/* ---------- email template ---------- */
export function shell(inner) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#f3efe6;padding:28px 0;font-family:Helvetica,Arial,sans-serif;color:#17150f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2dccf;border-radius:8px;overflow:hidden">
      <tr><td style="height:4px;background:#1f473f"></td></tr>
      <tr><td style="padding:26px 30px">
        <img src="${base()}/assets/logo-ink.png" alt="Les Émirs" width="196" height="44"
             style="display:block;width:196px;height:auto;max-width:60%" />
        <div style="height:1px;background:#e2dccf;margin:18px 0"></div>
        <div style="font-size:15px;line-height:1.7;color:#3b352b">${inner}</div>
      </td></tr>
      <tr><td style="padding:14px 30px;border-top:1px solid #e2dccf;font-size:11px;color:#8b8271">Restaurant Les Émirs — Port El Kantaoui, Sousse, Tunisie</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/* ---------- flows ---------- */

/* A request is not a table. Nothing that belongs to a confirmed booking — the
   QR pass, the link to change it — goes out at this stage: both are sent the
   moment the restaurant accepts. */
/* Capitalise each word of the French date ("vendredi 4 septembre" →
   "Vendredi 4 Septembre") and write the hour as 20h00, exactly the format the
   restaurant asked to send its guests. */
function frDateLong(d) {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  const s = dt.toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long" });
  return s.replace(/([a-zà-ÿ])([a-zà-ÿ']*)/gi, (m, a, b) => a.toUpperCase() + b);   // "Vendredi 04 Septembre"
}
function frHour(t) { return fmtTime(t).replace(":", "h"); }
function seatPhrase(s) { return { terrace: "terrasse en plein air", verriere: "terrasse verrière" }[s] || "salle intérieure"; }
/* The guest picked a language on the site; it travels with the booking so every
   message they get back — email, SMS, the pass — speaks it too. */
const isEn = (r) => !!r && String(r.lang || "").toLowerCase() === "en";
function enDateLong(d) {
  const dt = typeof d === "string" ? new Date(d + "T00:00:00") : new Date(d);
  return dt.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function seatEn(s) { return { terrace: "open-air terrace", verriere: "glass-covered terrace" }[s] || "indoor room"; }
function seatEnCap(s) { const e = seatEn(s); return e.charAt(0).toUpperCase() + e.slice(1); }
function seatPhraseCap(s) { const p = seatPhrase(s); return p.charAt(0).toUpperCase() + p.slice(1); }
function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
/* the guest's special-occasion note, echoed back in the emails as a soft banner */
function occBlock(r) {
  if (!r || !r.note) return "";
  return `<div style="margin:16px 0;padding:12px 14px;background:#faf5e6;border:1px solid #ecdfbf;border-radius:8px;font-size:13.5px;color:#8a6d1f">✎ ${esc(r.note)}</div>`;
}

export async function notifyClientReceived(r) {
  if (isEn(r)) {
    const whenEn = `${enDateLong(r.res_date)}, ${fmtTime(r.res_time)}`;
    const htmlEn = shell(
      `<div style="font-family:Georgia,serif;font-size:19px;color:#17150f;margin-bottom:18px">Booking request received</div>
       Dear ${esc(r.name)},<br>
       Reference: <b>${r.reference}</b><br><br>
       <b>${whenEn}</b><br>
       ${r.party_size} guest${r.party_size > 1 ? "s" : ""} · ${seatEn(r.seating)}<br>` +
       occBlock(r) +
       `<br>Thank you, we have received your booking request. <b style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:17px;color:#17150f">A booking is only valid once our team has confirmed it by email.</b><br><br>We will reply to your request as soon as possible.`
    );
    const smsEn = `Les Emirs: booking request received (${r.reference}) - ${whenEn}, ${r.party_size} guests.` +
      (r.note ? ` Occasion: ${r.note}.` : "") + ` Valid only once our team confirms by email.`;
    await reachClient(r, "Booking request received — Les Émirs", htmlEn, smsEn,
      { name: "reservation_recue", params: [r.name, whenEn, String(r.party_size), r.reference] });
    return;
  }
  const when = `${frDateLong(r.res_date)} ${frHour(r.res_time)}`;
  const html = shell(
    `<div style="font-family:Georgia,serif;font-size:19px;color:#17150f;margin-bottom:18px">Demande de réservation reçue</div>
     Merci Mr/Mme ${esc(r.name)},<br>
     Référence : <b>${r.reference}</b><br><br>
     <b>${when}</b><br>
     ${r.party_size} couverts · ${seatPhrase(r.seating)}<br>` +
     occBlock(r) +
     `<br>Merci, nous avons reçu votre demande de réservation. <b style="font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:17px;color:#17150f">La réservation n’est considérée valide que seulement après la confirmation de notre équipe envoyée par email.</b><br><br>Nous vous enverrons une réponse à votre demande dans les plus brefs délais.`
  );
  const sms = `Les Emirs: demande de reservation recue (${r.reference}) — ${when}, ${r.party_size} couverts.` + (r.note ? ` Occasion: ${r.note}.` : "") + ` Valide seulement apres confirmation de notre equipe par email.`;
  await reachClient(r, "Demande de réservation reçue — Les Émirs", html, sms,
    { name: "reservation_recue", params: [r.name, when, String(r.party_size), r.reference] });
}

/* Same two decisions, written for a guest who booked in English. */
async function decisionEn(r) {
  const when = `${enDateLong(r.res_date)}, ${fmtTime(r.res_time)}`;
  if (r.status === "accepted") {
    const link = editLink(r), cancel = cancelLink(r);
    const btn = (href, label, primary) =>
      `<a href="${href}" style="display:inline-block;margin:6px 6px 0 0;padding:12px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;` +
      (primary ? `background:#1f473f;color:#fff` : `background:#fff;color:#1f473f;border:1px solid #cdbfa3`) + `">${label}</a>`;
    const html = shell(
      `Dear ${esc(r.name)},<br><br>` +
      `<div style="font-family:Georgia,serif;font-size:21px;color:#1f473f;margin:2px 0 18px">Your booking is confirmed</div>` +
      `<b>${when}</b> · ${r.party_size} guest${r.party_size > 1 ? "s" : ""}<br>` +
      `${seatEnCap(r.seating)}<br>` +
      `Reference: <b>${r.reference}</b>` +
      occBlock(r) +
      passBlock(r) +
      `<div style="margin-top:4px">We look forward to welcoming you.</div>` +
      (link || cancel
        ? `<div style="height:1px;background:#e2dccf;margin:22px 0"></div><div>` +
          (link ? btn(link, "Change my booking", true) : "") +
          (cancel ? btn(cancel, "Cancel my booking", false) : "") + `</div>`
        : "") +
      `<div style="margin-top:22px;padding:14px 16px;background:#fdf6e6;border:1px solid #ecdfbf;border-radius:8px;font-size:12.5px;color:#7a5f16;line-height:1.6">` +
      `We hold your table for <b>30 minutes at most</b>. After that we may release it to other guests.</div>`
    );
    const sms = `Les Emirs: booking CONFIRMED ${when} (${r.party_size}p). Ref ${r.reference}. Code: ${passLink(r)}` +
      (link ? ` Change: ${link}` : "") + (cancel ? ` Cancel: ${cancel}` : "") + ` Table held 30 min max.`;
    const waParams = [r.name, when, String(r.party_size), r.reference];
    const pt = passToken(r.id);
    await reachClient(r, "Booking confirmed — Les Émirs", html, sms, {
      name: "reservation_confirmee_qr", params: waParams,
      opts: { image: `${base()}/api/qr?r=${r.id}&t=${pt}`, button: `r=${r.id}&t=${pt}` },
      fallback: { name: "reservation_confirmee", params: waParams },
    });
    return;
  }
  if (r.status === "declined") {
    const html = shell(
      `Dear ${esc(r.name)},<br><br>` +
      `We are sorry: we cannot accommodate your request for <b>${when}</b> — no tables are available at that time.<br><br>` +
      `Please do try another time slot. Thank you for your understanding.`
    );
    const sms = `Les Emirs: sorry, we cannot accommodate your request for ${when} - no tables available. Please try another time.`;
    await reachClient(r, "About your booking — Les Émirs", html, sms,
      { name: "reservation_refusee", params: [r.name, when] });
  }
}

export async function notifyClientDecision(r) {
  if (isEn(r)) { await decisionEn(r); return; }
  const when = `${fmtDate(r.res_date)} à ${fmtTime(r.res_time)}`;
  if (r.status === "accepted") {
    const link = editLink(r);
    const cancel = cancelLink(r);
    const btn = (href, label, primary) =>
      `<a href="${href}" style="display:inline-block;margin:6px 6px 0 0;padding:12px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;` +
      (primary ? `background:#1f473f;color:#fff` : `background:#fff;color:#1f473f;border:1px solid #cdbfa3`) + `">${label}</a>`;
    const html = shell(
      `Bonjour Mr/Mme ${esc(r.name)},<br><br>` +
      `<div style="font-family:Georgia,serif;font-size:21px;color:#1f473f;margin:2px 0 18px">Votre réservation est confirmée</div>` +
      `<b>${frDateLong(r.res_date)} · ${frHour(r.res_time)}</b> · ${r.party_size} personne${r.party_size > 1 ? "s" : ""}<br>` +
      `${seatPhraseCap(r.seating)}<br>` +
      `Référence : <b>${r.reference}</b>` +
      occBlock(r) +
      passBlock(r) +
      `<div style="margin-top:4px">Au plaisir de vous accueillir.</div>` +
      (link || cancel
        ? `<div style="height:1px;background:#e2dccf;margin:22px 0"></div>` +
          `<div>` +
          (link ? btn(link, "Modifier la réservation", true) : "") +
          (cancel ? btn(cancel, "Annuler la réservation", false) : "") +
          `</div>`
        : "") +
      `<div style="margin-top:22px;padding:14px 16px;background:#fdf6e6;border:1px solid #ecdfbf;border-radius:8px;font-size:12.5px;color:#7a5f16;line-height:1.6">` +
      `La durée de retard tolérée est de <b>30 minutes maximum</b>. Une fois ce délai expiré, nous nous réservons le droit de libérer la table et d'y installer d'autres clients.` +
      `</div>`
    );
    const sms = `Les Emirs: reservation CONFIRMEE ${frDateLong(r.res_date)} ${frHour(r.res_time)} (${r.party_size}p). Ref ${r.reference}. Code: ${passLink(r)}`
      + (link ? ` Modifier: ${link}` : "") + (cancel ? ` Annuler: ${cancel}` : "")
      + ` Retard tolere 30 min max.`;
    /* WhatsApp carries the QR itself (image header) and a button to the pass;
       until "reservation_confirmee_qr" is approved by Meta, the plain
       "reservation_confirmee" text template goes out instead */
    const waParams = [r.name, `${frDateLong(r.res_date)} ${frHour(r.res_time)}`, String(r.party_size), r.reference];
    const pt = passToken(r.id);
    await reachClient(r, "Réservation confirmée — Les Émirs", html, sms, {
      name: "reservation_confirmee_qr", params: waParams,
      opts: { image: `${base()}/api/qr?r=${r.id}&t=${pt}`, button: `r=${r.id}&t=${pt}` },
      fallback: { name: "reservation_confirmee", params: waParams },
    });
    return;
  }
  if (r.status === "declined") {
    const html = shell(
      `Bonjour Mr/Mme ${esc(r.name)},<br><br>` +
      `Nous sommes navrés : nous ne pouvons pas honorer votre demande pour le <b>${when}</b> par manque de places disponibles.<br><br>` +
      `N'hésitez pas à réserver de nouveau en essayant un autre créneau. Merci de votre compréhension.`
    );
    const sms = `Les Emirs: desole, nous ne pouvons pas honorer votre demande pour le ${when} par manque de places disponibles. N'hesitez pas a reserver un autre creneau.`;
    await reachClient(r, "À propos de votre réservation — Les Émirs", html, sms,
      { name: "reservation_refusee", params: [r.name, when] });
    return;
  }
}

/* A few hours before a confirmed booking: the time, the place, the QR to show
   at the door, and the links to change or cancel — so a guest who cannot come
   frees the table instead of not turning up. Email only. */
export async function notifyClientReminder(r) {
  if (!r.email) return { skipped: true };
  const link = editLink(r), cancel = cancelLink(r);
  const btn = (href, label, primary) =>
    `<a href="${href}" style="display:inline-block;margin:6px 6px 0 0;padding:12px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;` +
    (primary ? `background:#1f473f;color:#fff` : `background:#fff;color:#1f473f;border:1px solid #cdbfa3`) + `">${label}</a>`;
  if (isEn(r)) {
    const html = shell(
      `Dear ${esc(r.name)},<br><br>` +
      `<div style="font-family:Georgia,serif;font-size:21px;color:#1f473f;margin:2px 0 18px">See you shortly</div>` +
      `A reminder of your table today: <b>${enDateLong(r.res_date)} · ${fmtTime(r.res_time)}</b> · ` +
      `${r.party_size} guest${r.party_size > 1 ? "s" : ""}<br>${seatEnCap(r.seating)}<br>Reference: <b>${r.reference}</b>` +
      passBlock(r) +
      (link || cancel ? `<div>If your plans have changed, please let us know:</div><div>` +
        (link ? btn(link, "Change my booking", true) : "") + (cancel ? btn(cancel, "Cancel my booking", false) : "") + `</div>` : "") +
      `<div style="margin-top:22px;font-size:12.5px;color:#7a5f16">Tables are held for 30 minutes after the booked time.</div>`
    );
    const subject = "Reminder: your table at Les Émirs today";
    await Promise.allSettled([sendEmail(r.email, subject, html), logOutbound(r.email, subject, html)]);
    return { ok: true };
  }
  const html = shell(
    `Bonjour Mr/Mme ${esc(r.name)},<br><br>` +
    `<div style="font-family:Georgia,serif;font-size:21px;color:#1f473f;margin:2px 0 18px">À tout à l'heure</div>` +
    `Petit rappel de votre réservation : <b>${frDateLong(r.res_date)} · ${frHour(r.res_time)}</b> · ` +
    `${r.party_size} personne${r.party_size > 1 ? "s" : ""}<br>${seatPhraseCap(r.seating)}<br>Référence : <b>${r.reference}</b>` +
    passBlock(r) +
    (link || cancel ? `<div>Un changement de programme ? Prévenez-nous en un clic :</div><div>` +
      (link ? btn(link, "Modifier la réservation", true) : "") + (cancel ? btn(cancel, "Annuler la réservation", false) : "") + `</div>` : "") +
    `<div style="margin-top:22px;padding:14px 16px;background:#fdf6e6;border:1px solid #ecdfbf;border-radius:8px;font-size:12.5px;color:#7a5f16;line-height:1.6">` +
    `La durée de retard tolérée est de <b>30 minutes maximum</b>. Au-delà, nous nous réservons le droit de libérer la table.</div>`
  );
  const subject = "Rappel : votre table aux Émirs aujourd'hui";
  await Promise.allSettled([sendEmail(r.email, subject, html), logOutbound(r.email, subject, html)]);
  return { ok: true };
}

/* The direction wrote its own message when refusing or cancelling: sent by
   email exactly as typed (escaped, line breaks kept), and kept in the Emails tab. */
export async function notifyClientCustom(r, subject, text) {
  if (!r.email) return { skipped: true };
  const html = shell(esc(text).replace(/\r?\n/g, "<br>"));
  await Promise.allSettled([sendEmail(r.email, subject, html), logOutbound(r.email, subject, html)]);
  return { ok: true };
}

/* The restaurant cancelled a confirmed booking — the guest must be told it was
   cancelled by the restaurant (not by them). */
export async function notifyClientCancelled(r) {
  if (isEn(r)) {
    const whenEn = `${enDateLong(r.res_date)}, ${fmtTime(r.res_time)}`;
    const htmlEn = shell(
      `Dear ${esc(r.name)},<br><br>` +
      `We are sorry to tell you that your booking for <b>${whenEn}</b> ` +
      `(reference <b>${esc(r.reference)}</b>) has been <b>cancelled by the restaurant</b>.<br><br>` +
      `Please accept our apologies. For any question, or to book another time, do get in touch.`
    );
    const smsEn = `Les Emirs: your booking for ${whenEn} (${r.reference}) has been CANCELLED by the restaurant. We apologise - contact us for another time.`;
    await reachClient(r, "Booking cancelled — Les Émirs", htmlEn, smsEn,
      { name: "reservation_annulee", params: [r.name, whenEn] });
    return;
  }
  const when = `${frDateLong(r.res_date)} ${frHour(r.res_time)}`;
  const html = shell(
    `Bonjour Mr/Mme ${esc(r.name)},<br><br>` +
    `Nous sommes au regret de vous informer que votre réservation du <b>${when}</b> ` +
    `(référence <b>${esc(r.reference)}</b>) a été <b>annulée par le restaurant</b>.<br><br>` +
    `Nous vous prions de nous en excuser. Pour toute question ou pour réserver un autre créneau, n'hésitez pas à nous contacter.`
  );
  const sms = `Les Emirs: votre reservation du ${when} (${r.reference}) a ete ANNULEE par le restaurant. Nous nous en excusons — contactez-nous pour un autre creneau.`;
  await reachClient(r, "Réservation annulée — Les Émirs", html, sms,
    { name: "reservation_annulee", params: [r.name, when] });
}

export async function notifyOwnerNew(sql, r, debt) {
  /* name / phone / note are guest-supplied — escape before they reach an HTML
     email or a Telegram (HTML) message, or a crafted name injects markup. */
  const line = `${esc(r.name)} (${esc(r.phone)}) · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size} couverts · ${seatFr(r.seating)} · Réf ${esc(r.reference)}`;
  /* a note is the reason the guest bothered to write one — never bury it */
  const noteHtml = r.note ? `<div style="margin-top:16px;padding:13px 15px;background:#fbf7ec;border-left:3px solid #a98c4b">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8b8271;margin-bottom:5px">Demande particulière</div>
      <div style="font-size:15px;color:#17150f">${esc(r.note)}</div></div>` : "";
  /* a guest who still owes on the Crédit book: said first, with the amount */
  const owes = debt && debt.due > 0.0005 ? `${debt.due.toFixed(3)} DT` : "";
  const debtHtml = owes ? `<div style="margin-top:16px;padding:13px 15px;background:#fdf1ea;border-left:3px solid #a4552f">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#a4552f;margin-bottom:5px">Crédit impayé</div>
      <div style="font-size:15px;color:#17150f">Ce client doit encore <b>${owes}</b>.</div></div>` : "";
  const re = restaurantEmail();
  if (re) {
    await sendEmail(re, `${owes ? "⚠ Crédit impayé · " : "🔔 "}Nouvelle réservation — ${r.name}`,
      shell(`<b>Nouvelle demande de réservation</b><br><br>${line}${debtHtml}${noteHtml}<br><br>
        <a href="${base()}/admin" style="display:inline-block;background:#1f473f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:13px">Ouvrir le tableau de bord</a>`));
  }
  await telegram(`🔔 <b>Nouvelle réservation</b>\n${line}` + (owes ? `\n⚠ <b>Crédit impayé : ${owes}</b>` : "")
                 + (r.note ? `\n✎ ${esc(r.note)}` : ""));
  await pushOwners(sql, {
    title: owes ? `⚠ Crédit impayé ${owes} · nouvelle réservation` : "Nouvelle réservation",
    body: `${r.name} · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size}p · ${seatFr(r.seating)}`
          + (r.note ? ` · ✎ ${r.note}` : ""),
    url: "/admin",
  });
}

/* A guest moving their own booking must never be a silent change: the table
   was chosen for a given hour and room, and reception has to see the new one. */
export async function notifyOwnerChange(sql, r, before) {
  const bits = [];
  if (before.res_time !== r.res_time) bits.push(`heure ${fmtTime(before.res_time)} → <b>${fmtTime(r.res_time)}</b>`);
  if (before.seating !== r.seating) bits.push(`place ${seatFr(before.seating)} → <b>${seatFr(r.seating)}</b>`);
  if (Number(before.party_size) !== Number(r.party_size)) bits.push(`couverts ${before.party_size} → <b>${r.party_size}</b>`);
  if (!bits.length) return;
  const head = `Réservation ${esc(r.reference)} · ${esc(r.name)} (${esc(r.phone)}) · ${fmtDate(r.res_date)}`;
  const re = restaurantEmail();
  if (re) {
    await sendEmail(re, `⚠ Réservation ${r.reference} modifiée par le client — à revoir`,
      shell(`<b>La réservation ${r.reference} a été modifiée par le client et demande une nouvelle validation.</b><br><br>` +
        `${head}<br><br><b>Modifications</b><br>${bits.join("<br>")}<br><br>` +
        `<span style="color:#8b8271">Modifiée le ${new Date(Date.now() + 3600000).toLocaleString("fr-FR", { timeZone: "Africa/Tunis" })}.</span>` +
        (before.table_id && !r.table_id ? `<br><br><span style="color:#a4552f">La table a été libérée — à replacer.</span>` : "") +
        `<br><br>Elle est repassée en <b>« En attente »</b> : validez-la ou refusez-la depuis le tableau de bord.<br><br>` +
        `<a href="${base()}/admin" style="display:inline-block;background:#1f473f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:13px">Revoir la réservation</a>`));
  }
  const plain = bits.map((b) => b.replace(/<\/?b>/g, "")).join(" · ");
  await telegram(`⚠ <b>Réservation ${r.reference} modifiée — à revoir</b>\n${head}\n${plain}`);
  await pushOwners(sql, {
    title: `Réservation ${r.reference} modifiée — à revoir`,
    body: `${r.name} · ${plain}`,
    url: "/admin",
  });
}

/* The guest cancelled online — the owner must know so the table (if any) can
   be given to someone else. */
export async function notifyOwnerCancel(sql, r, before) {
  const head = `${esc(r.name)} (${esc(r.phone)}) · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size} couverts · Réf ${esc(r.reference)}`;
  const re = restaurantEmail();
  if (re) {
    await sendEmail(re, `❌ Réservation ${r.reference} annulée par le client`,
      shell(`<b>La réservation ${r.reference} a été annulée par le client.</b><br><br>${head}<br><br>` +
        (before && before.table_id ? `<span style="color:#a4552f">La table a été libérée.</span><br><br>` : "") +
        `<a href="${base()}/admin" style="display:inline-block;background:#1f473f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:13px">Ouvrir le tableau de bord</a>`));
  }
  await telegram(`❌ <b>Réservation ${r.reference} annulée par le client</b>\n${head}`);
  await pushOwners(sql, {
    title: `Réservation ${r.reference} annulée`,
    body: `${r.name} · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size}p`,
    url: "/admin",
  });
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* A message typed by the team: email when there is one, AND WhatsApp when there
   is a phone (template "message_restaurant": {{1}} name, {{2}} the text — a
   business-initiated WhatsApp can't be free text). SMS only if Twilio is set. */
/* The house format for answering a guest: their request quoted, then the
   answer, in the branded layout. Without a request to quote it is a plain
   message. Used by Messages "Répondre" and Emails "Répondre". */
export function replyHtml(name, quote, text) {
  const para = (s) => esc(String(s || "")).replace(/\n/g, "<br>");
  const hello = `Bonjour Mr/Mme ${esc(name || "")}${name ? "," : ""}<br><br>`;
  if (!quote) return shell(`${hello}${para(text)}<br><br>— L'équipe des Émirs`);
  return shell(
    hello +
    `Nous avons enregistré la demande suivante de votre part :` +
    `<div style="margin:12px 0 18px;padding:12px 16px;background:#f7f2e8;border-left:3px solid #b08d3e;border-radius:6px;color:#3b352b;font-style:italic">"${para(String(quote).slice(0, 2000))}"</div>` +
    `Voici la réponse à votre demande :<br><br>${para(text)}<br><br>— L'équipe des Émirs`
  );
}

export async function sendClientMessage({ email, phone, name, text, quote }) {
  const html = replyHtml(name, quote, text);
  if (!email && !phone) return { skipped: true };
  let res = { skipped: true };
  if (email) { res = await sendEmail(email, "Un message de Les Émirs", html); await logOutbound(email, "Un message de Les Émirs", html); }
  if (phone) {
    // WhatsApp template variables can't contain line breaks
    const wa = await sendWhatsAppTemplate(phone, "message_restaurant", [name || "cher client", String(text).replace(/\s*\n\s*/g, " · ")]);
    if (!email) res = wa;
    if (!whatsappCfg()) { const sms = await sendSms(phone, "Les Emirs: " + text); if (!email) res = sms; }
  }
  return res;
}

export async function sendMarketingEmail(email, name, subject, body) {
  const html = shell(`${name ? "Bonjour Mr/Mme " + esc(name) + ",<br><br>" : ""}${esc(String(body)).replace(/\n/g, "<br>")}<br><br>
     <span style="color:#8b8271;font-size:12px">Les Émirs · Port El Kantaoui, Sousse — vous recevez ce message en tant que client fidèle.</span>`);
  const res = await sendEmail(email, subject, html);
  /* campaigns go into the mail history like every other sent email */
  if (res && !res.skipped && !res.error) await logOutbound(email, subject, html);
  return res;
}

export async function notifyOwnerMessage(sql, m) {
  /* contact-form fields are attacker-controlled — escape before HTML/Telegram */
  const line = `${esc(m.name || "Client")} (${esc(m.phone || m.email || "")}) : ${esc(String(m.body).slice(0, 140))}`;
  const re = restaurantEmail();
  if (re) await sendEmail(re, `✉️ Nouveau message — ${m.name || "site"}`,
    shell(`<b>Nouveau message depuis le site</b><br><br>${line}<br><br><a href="${base()}/admin">Ouvrir le tableau de bord</a>`));
  await pushOwners(sql, { title: "Nouveau message", body: line.slice(0, 90), url: "/admin" });
}
