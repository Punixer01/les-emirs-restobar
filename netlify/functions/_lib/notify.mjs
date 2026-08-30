import { Resend } from "resend";
import webpush from "web-push";
import { fmtDate, fmtTime, seatFr } from "./util.mjs";
import { editToken } from "./auth.mjs";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.MAIL_FROM || "Les Émirs <onboarding@resend.dev>";
const RESTAURANT_EMAIL = process.env.RESTAURANT_EMAIL || null;
const BASE = process.env.PUBLIC_BASE_URL || "https://lesemirsrestobar.netlify.app";

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
if (VAPID_PUBLIC && VAPID_PRIVATE) {
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@les-emirs.tn", VAPID_PUBLIC, VAPID_PRIVATE);
  } catch (e) { console.warn("[push] vapid setup failed", e.message); }
}

/* ---------- low-level channels ---------- */

export async function sendEmail(to, subject, html) {
  if (!resend || !to) return { skipped: true };
  try { return await resend.emails.send({ from: FROM, to, subject, html }); }
  catch (e) { console.error("[email]", e); return { error: String(e) }; }
}

export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
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
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const tok = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM; // e.g. "whatsapp:+14155238886"
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

// Reach a client on every available channel (email + SMS + WhatsApp). Each self-skips if unconfigured.
async function reachClient(r, subject, html, smsText) {
  const jobs = [];
  if (r.email) jobs.push(sendEmail(r.email, subject, html));
  if (r.phone) { jobs.push(sendSms(r.phone, smsText)); jobs.push(sendWhatsApp(r.phone, smsText)); }
  await Promise.allSettled(jobs);
}
function editLink(r) {
  return r && r.id ? `${BASE}/modifier?r=${r.id}&t=${editToken(r.id)}` : "";
}

export async function telegram(text) {
  const t = process.env.TELEGRAM_BOT_TOKEN, c = process.env.TELEGRAM_CHAT_ID;
  if (!t || !c) return { skipped: true };
  try {
    await fetch(`https://api.telegram.org/bot${t}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: c, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("[tg]", e); }
}

export async function pushOwners(sql, payload) {
  if (!VAPID_PUBLIC) return;
  try {
    const subs = await sql`select id, sub from push_subscriptions where role = 'owner'`;
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification(s.sub, JSON.stringify(payload)); }
      catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410)
          await sql`delete from push_subscriptions where id = ${s.id}`;
      }
    }));
  } catch (e) { console.error("[push]", e); }
}

/* ---------- email template ---------- */

export function shell(inner) {
  return `<!doctype html><html><body style="margin:0;background:#f3efe6;padding:28px 0;font-family:Helvetica,Arial,sans-serif;color:#17150f">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e2dccf;border-radius:8px;overflow:hidden">
      <tr><td style="height:4px;background:#1f473f"></td></tr>
      <tr><td style="padding:26px 30px">
        <div style="font-family:Georgia,serif;font-size:22px;color:#17150f">Les <b>Émirs</b></div>
        <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8b8271;margin-top:2px">Port El Kantaoui · Sousse</div>
        <div style="height:1px;background:#e2dccf;margin:18px 0"></div>
        <div style="font-size:15px;line-height:1.7;color:#3b352b">${inner}</div>
      </td></tr>
      <tr><td style="padding:14px 30px;border-top:1px solid #e2dccf;font-size:11px;color:#8b8271">Restaurant Les Émirs — Port El Kantaoui, Sousse, Tunisie</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/* ---------- flows ---------- */

export async function notifyClientReceived(r) {
  const when = `${fmtDate(r.res_date)} à ${fmtTime(r.res_time)}`;
  const link = editLink(r);
  const html = shell(
    `Bonjour ${r.name},<br><br>Nous avons bien reçu votre demande de réservation :<br><br>
     <b>${when}</b> · ${r.party_size} couverts · ${seatFr(r.seating)}<br>
     Référence : <b>${r.reference}</b><br><br>
     Nous vous confirmons très rapidement. À très bientôt.` +
    (link ? `<br><br>Besoin de changer l’heure ou le nombre de couverts ?<br><a href="${link}">Modifier ma réservation</a> <span style="color:#8b8271">(jusqu’à 3 h avant).</span>` : "")
  );
  const sms = `Les Emirs: demande recue (${r.reference}) ${when}. Nous confirmons bientot.` + (link ? ` Modifier: ${link}` : "");
  await reachClient(r, "Votre demande de réservation — Les Émirs", html, sms);
}

export async function notifyClientDecision(r) {
  const when = `${fmtDate(r.res_date)} à ${fmtTime(r.res_time)}`;
  if (r.status === "accepted") {
    const link = editLink(r);
    const html = shell(
      `Bonjour ${r.name},<br><br>Votre table est <b style="color:#1f473f">confirmée</b> :<br><br>
       <b>${when}</b> · ${r.party_size} couverts · ${seatFr(r.seating)}<br>
       Référence : <b>${r.reference}</b><br><br>Au plaisir de vous accueillir au bord du port.` +
      (link ? `<br><br><a href="${link}">Modifier l’heure ou le nombre de couverts</a> <span style="color:#8b8271">(jusqu’à 3 h avant).</span>` : "")
    );
    const sms = `Les Emirs: reservation CONFIRMEE ${when} (${r.party_size}p). Ref ${r.reference}.` + (link ? ` Modifier: ${link}` : "");
    await reachClient(r, "Réservation confirmée — Les Émirs", html, sms);
    return;
  }
  if (r.status === "declined") {
    const html = shell(
      `Bonjour ${r.name},<br><br>Nous sommes navrés : nous ne pouvons pas honorer votre demande du <b>${when}</b>.<br><br>
       N'hésitez pas à nous rappeler pour trouver un autre créneau. Merci de votre compréhension.`
    );
    const sms = `Les Emirs: desole, la reservation du ${when} n'est pas disponible. Rappelez-nous svp.`;
    await reachClient(r, "À propos de votre réservation — Les Émirs", html, sms);
    return;
  }
}

export async function notifyOwnerNew(sql, r) {
  const line = `${r.name} (${r.phone}) · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size} couverts · ${seatFr(r.seating)} · Réf ${r.reference}`;
  if (RESTAURANT_EMAIL) {
    await sendEmail(
      RESTAURANT_EMAIL,
      `🔔 Nouvelle réservation — ${r.name}`,
      shell(`<b>Nouvelle demande de réservation</b><br><br>${line}<br><br>
        <a href="${BASE}/admin" style="display:inline-block;background:#1f473f;color:#fff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:13px">Ouvrir le tableau de bord</a>`)
    );
  }
  await telegram(`🔔 <b>Nouvelle réservation</b>\n${line}`);
  await pushOwners(sql, {
    title: "Nouvelle réservation",
    body: `${r.name} · ${fmtDate(r.res_date)} ${fmtTime(r.res_time)} · ${r.party_size}p · ${seatFr(r.seating)}`,
    url: "/admin",
  });
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Owner/reception -> a client (email preferred, SMS fallback)
export async function sendClientMessage({ email, phone, name, text }) {
  const html = shell(`Bonjour ${name || ""},<br><br>${String(text).replace(/\n/g, "<br>")}<br><br>— L'équipe des Émirs`);
  if (email) return sendEmail(email, "Un message de Les Émirs", html);
  if (phone) return sendSms(phone, "Les Emirs: " + text);
  return { skipped: true };
}

// Marketing email to a loyal client
export async function sendMarketingEmail(email, name, subject, body) {
  const html = shell(
    `${name ? "Bonjour " + name + ",<br><br>" : ""}${String(body).replace(/\n/g, "<br>")}<br><br>
     <span style="color:#8b8271;font-size:12px">Les Émirs · Port El Kantaoui, Sousse — vous recevez ce message en tant que client fidèle.</span>`
  );
  return sendEmail(email, subject, html);
}

// New inbound message from the public site -> alert the owner
export async function notifyOwnerMessage(sql, m) {
  const line = `${m.name || "Client"} (${m.phone || m.email || ""}) : ${String(m.body).slice(0, 140)}`;
  if (RESTAURANT_EMAIL)
    await sendEmail(RESTAURANT_EMAIL, `✉️ Nouveau message — ${m.name || "site"}`,
      shell(`<b>Nouveau message depuis le site</b><br><br>${line}<br><br><a href="${BASE}/admin">Ouvrir le tableau de bord</a>`));
  await pushOwners(sql, { title: "Nouveau message", body: line.slice(0, 90), url: "/admin" });
}
