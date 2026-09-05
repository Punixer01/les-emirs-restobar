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
    await sql`insert into emails (from_addr, to_addr, subject, body, snippet, direction, is_read, size)
      values (${mailFrom()}, ${String(to)}, ${String(subject || "")}, ${text}, ${text.slice(0, 180)}, 'out', 1, ${text.length})`;
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

async function reachClient(r, subject, html, smsText) {
  const jobs = [];
  if (r.email) { jobs.push(sendEmail(r.email, subject, html)); jobs.push(logOutbound(r.email, subject, html)); }
  if (r.phone) { jobs.push(sendSms(r.phone, smsText)); jobs.push(sendWhatsApp(r.phone, smsText)); }
  await Promise.allSettled(jobs);
}
function editLink(r) { return r && r.id ? `${base()}/modifier?r=${r.id}&t=${editToken(r.id)}` : ""; }
function cancelLink(r) { return r && r.id ? `${base()}/modifier?r=${r.id}&t=${editToken(r.id)}&annuler=1` : ""; }
function passLink(r) { return r && r.id ? `${base()}/pass?r=${r.id}&t=${passToken(r.id)}` : ""; }

/* The QR block for the guest's email. Points at /api/qr rather than embedding
   SVG, because most mail clients strip inline SVG but render <img> fine. */
function passBlock(r) {
  if (!r || !r.id) return "";
  const t = passToken(r.id);
  const img = `${base()}/api/qr?r=${r.id}&t=${t}`;
  return `<div style="margin:24px 0;padding:22px;background:#fff;border:1px solid #e2dccf;border-radius:8px;text-align:center">
      <img src="${img}" width="220" height="220" alt="Code de réservation ${r.reference}"
           style="display:block;margin:0 auto;width:220px;height:220px;image-rendering:pixelated" />
      <div style="font-size:13px;color:#3b352b;margin-top:14px">Présentez ce code à l'accueil.</div>
      <div style="font-family:Georgia,serif;font-size:17px;color:#17150f;margin-top:16px;letter-spacing:.04em">${r.reference}</div>
      <div style="font-size:12px;color:#8b8271;margin-top:4px">à présenter à l'arrivée</div>
      <a href="${passLink(r)}" style="display:inline-block;margin-top:16px;font-size:12px;color:#1f473f">Ouvrir ma réservation</a>
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

export async function pushOwners(sql, payload) {
  const cfg = vapid();
  if (!cfg) { console.error("[push] VAPID keys missing"); return; }
  try {
    const subs = await sql`select id, sub from push_subscriptions where role = 'owner'`;
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
  try { subs = await sql`select id, role, endpoint, sub from push_subscriptions where role = 'owner'`; }
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
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8b8271;margin-top:8px">Port El Kantaoui · Sousse</div>
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
function seatPhrase(s) { return s === "terrace" ? "terrasse" : "salle intérieure"; }
function seatPhraseCap(s) { const p = seatPhrase(s); return p.charAt(0).toUpperCase() + p.slice(1); }
function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
/* the guest's special-occasion note, echoed back in the emails as a soft banner */
function occBlock(r) {
  if (!r || !r.note) return "";
  return `<div style="margin:16px 0;padding:12px 14px;background:#faf5e6;border:1px solid #ecdfbf;border-radius:8px;font-size:13.5px;color:#8a6d1f">✎ ${esc(r.note)}</div>`;
}

export async function notifyClientReceived(r) {
  const when = `${frDateLong(r.res_date)} ${frHour(r.res_time)}`;
  const html = shell(
    `<div style="font-family:Georgia,serif;font-size:19px;color:#17150f;margin-bottom:18px">Demande de réservation reçue</div>
     Merci ${r.name},<br>
     Référence : <b>${r.reference}</b><br><br>
     <b>${when}</b><br>
     ${r.party_size} couverts · ${seatPhrase(r.seating)}<br>` +
     occBlock(r) +
     `<br>Merci, nous avons reçu votre demande de réservation. La réservation n’est
     considérée valide que seulement après la confirmation de notre équipe envoyée
     par email.<br><br>
     Nous vous enverrons une réponse à votre demande dans les plus brefs délais.`
  );
  const sms = `Les Emirs: demande de reservation recue (${r.reference}) — ${when}, ${r.party_size} couverts.` + (r.note ? ` Occasion: ${r.note}.` : "") + ` Valide seulement apres confirmation de notre equipe par email.`;
  await reachClient(r, "Demande de réservation reçue — Les Émirs", html, sms);
}

export async function notifyClientDecision(r) {
  const when = `${fmtDate(r.res_date)} à ${fmtTime(r.res_time)}`;
  if (r.status === "accepted") {
    const link = editLink(r);
    const cancel = cancelLink(r);
    const btn = (href, label, primary) =>
      `<a href="${href}" style="display:inline-block;margin:6px 6px 0 0;padding:12px 18px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none;` +
      (primary ? `background:#1f473f;color:#fff` : `background:#fff;color:#1f473f;border:1px solid #cdbfa3`) + `">${label}</a>`;
    const html = shell(
      `Bonjour Mr ${r.name},<br><br>` +
      `<div style="font-family:Georgia,serif;font-size:21px;color:#1f473f;margin:2px 0 18px">Votre réservation est confirmée</div>` +
      `<b>${frDateLong(r.res_date)} · ${frHour(r.res_time)}</b> · ${r.party_size} personne${r.party_size > 1 ? "s" : ""}<br>` +
      `${seatPhraseCap(r.seating)}<br>` +
      `Référence : <b>${r.reference}</b>` +
      occBlock(r) +
      passBlock(r) +
      `<div style="margin-top:4px">Au plaisir de vous accueillir.</div>` +
      (link || cancel
        ? `<div style="height:1px;background:#e2dccf;margin:22px 0"></div>` +
          `Vous avez toujours la possibilité de modifier ou d'annuler votre réservation.<br>` +
          `<div style="margin-top:10px">` +
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
    await reachClient(r, "Réservation confirmée — Les Émirs", html, sms);
    return;
  }
  if (r.status === "declined") {
    const html = shell(
      `Bonjour ${r.name},<br><br>` +
      `Nous sommes navrés : nous ne pouvons pas honorer votre demande pour le <b>${when}</b> par manque de places disponibles.<br><br>` +
      `N'hésitez pas à réserver de nouveau en essayant un autre créneau. Merci de votre compréhension.`
    );
    const sms = `Les Emirs: desole, nous ne pouvons pas honorer votre demande pour le ${when} par manque de places disponibles. N'hesitez pas a reserver un autre creneau.`;
    await reachClient(r, "À propos de votre réservation — Les Émirs", html, sms);
    return;
  }
}

export async function notifyOwnerNew(sql, r) {
  const line = `${r.name} (${r.phone}) · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size} couverts · ${seatFr(r.seating)} · Réf ${r.reference}`;
  /* a note is the reason the guest bothered to write one — never bury it */
  const noteHtml = r.note ? `<div style="margin-top:16px;padding:13px 15px;background:#fbf7ec;border-left:3px solid #a98c4b">
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8b8271;margin-bottom:5px">Demande particulière</div>
      <div style="font-size:15px;color:#17150f">${String(r.note).replace(/[<>]/g, "")}</div></div>` : "";
  const re = restaurantEmail();
  if (re) {
    await sendEmail(re, `🔔 Nouvelle réservation — ${r.name}`,
      shell(`<b>Nouvelle demande de réservation</b><br><br>${line}${noteHtml}<br><br>
        <a href="${base()}/admin" style="display:inline-block;background:#1f473f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:13px">Ouvrir le tableau de bord</a>`));
  }
  await telegram(`🔔 <b>Nouvelle réservation</b>\n${line}` + (r.note ? `\n✎ ${r.note}` : ""));
  await pushOwners(sql, {
    title: "Nouvelle réservation",
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
  const head = `Réservation ${r.reference} · ${r.name} (${r.phone}) · ${fmtDate(r.res_date)}`;
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
  const head = `${r.name} (${r.phone}) · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size} couverts · Réf ${r.reference}`;
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

export async function sendClientMessage({ email, phone, name, text }) {
  const html = shell(`Bonjour ${name || ""},<br><br>${String(text).replace(/\n/g, "<br>")}<br><br>— L'équipe des Émirs`);
  if (email) { const res = await sendEmail(email, "Un message de Les Émirs", html); await logOutbound(email, "Un message de Les Émirs", html); return res; }
  if (phone) return sendSms(phone, "Les Emirs: " + text);
  return { skipped: true };
}

export async function sendMarketingEmail(email, name, subject, body) {
  const html = shell(`${name ? "Bonjour " + name + ",<br><br>" : ""}${String(body).replace(/\n/g, "<br>")}<br><br>
     <span style="color:#8b8271;font-size:12px">Les Émirs · Port El Kantaoui, Sousse — vous recevez ce message en tant que client fidèle.</span>`);
  return sendEmail(email, subject, html);
}

export async function notifyOwnerMessage(sql, m) {
  const line = `${m.name || "Client"} (${m.phone || m.email || ""}) : ${String(m.body).slice(0, 140)}`;
  const re = restaurantEmail();
  if (re) await sendEmail(re, `✉️ Nouveau message — ${m.name || "site"}`,
    shell(`<b>Nouveau message depuis le site</b><br><br>${line}<br><br><a href="${base()}/admin">Ouvrir le tableau de bord</a>`));
  await pushOwners(sql, { title: "Nouveau message", body: line.slice(0, 90), url: "/admin" });
}
