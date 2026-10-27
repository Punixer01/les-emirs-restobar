import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { shell, sendEmail, sendSms, sendWhatsAppTemplate, pushTest, logOutbound } from "./_lib/notify.mjs";

/* Delivery self-test for the owner.
   GET  /api/test-notify       -> which channels are actually configured
   GET  /api/test-notify?wa=1  -> + WhatsApp number health (Meta) and the last
                                  sends with their delivery status
   POST /api/test-notify { channel:'email'|'sms'|'whatsapp'|'push', to, template? }
                               -> send one real message

   Keys are never returned, only whether they are present, so the owner can see
   at a glance what is switched on without exposing anything. */

/* sample values for each WhatsApp template, in the exact order it expects */
const WHEN = "samedi 20 septembre 20h30";
const WA_SAMPLES = {
  reservation_recue:        { params: ["Client Test", WHEN, "4", "TEST01"] },
  reservation_confirmee_qr: { params: ["Client Test", WHEN, "4", "TEST01"], qr: true },
  reservation_confirmee:    { params: ["Client Test", WHEN, "4", "TEST01"] },
  reservation_refusee:      { params: ["Client Test", "20/09/2026 à 20:30"] },
  reservation_annulee:      { params: ["Client Test", WHEN] },
  message_restaurant:       { params: ["Client Test", "Ceci est un message de test de l'équipe des Émirs."] },
};

export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const env = (typeof process !== "undefined" && process.env) || {};
  const base = env.PUBLIC_BASE_URL || "https://lesemirs.com";
  const config = {
    email: {
      ready: !!env.RESEND_API_KEY,
      from: env.MAIL_FROM || "Les Émirs <onboarding@resend.dev> (par défaut)",
      inbox: env.RESTAURANT_EMAIL || null,
    },
    sms: { ready: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM), from: env.TWILIO_FROM || null },
    whatsapp: { ready: !!(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID), webhookSigned: !!env.WHATSAPP_APP_SECRET },
    push: { ready: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) },
  };

  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("wa") !== "1") return json({ config });

    /* is the token still accepted, and how does Meta rate the number? */
    let number = null, numberError = null;
    if (config.whatsapp.ready) {
      try {
        const api = env.WHATSAPP_API_VERSION || "v21.0";
        /* status (PENDING/CONNECTED…) and platform_type (CLOUD_API once
           registered) say whether the number can actually send */
        const r = await fetch(`https://graph.facebook.com/${api}/${env.WHATSAPP_PHONE_ID}?fields=display_phone_number,verified_name,quality_rating,name_status,status,platform_type,code_verification_status,messaging_limit_tier`,
          { headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` } });
        const j = await r.json().catch(() => ({}));
        if (r.ok) number = j;
        else numberError = j.error ? `${j.error.code} ${j.error.message}` : `HTTP ${r.status}`;
      } catch (e) { numberError = String(e); }
    }

    /* last sends + the latest delivery status Meta reported for each
       (created_at range keeps these on the index, not a full events scan) */
    const sent = await sql`select meta, created_at from events
                           where created_at >= datetime('now','-30 days') and type = 'wa'
                           order by id desc limit 30`;
    const st = await sql`select meta from events
                         where created_at >= datetime('now','-30 days') and type = 'wa_status'
                         order by id asc`;
    const last = {};
    for (const r of st) { try { const m = JSON.parse(r.meta); if (m.id) last[m.id] = m; } catch (e) {} }
    const log = sent.map((r) => {
      let m = {}; try { m = JSON.parse(r.meta); } catch (e) {}
      const s = m.id && last[m.id];
      return {
        at: r.created_at, template: m.template || null, to: m.to || null, ref: m.ref || null,
        status: s ? s.status : (m.ok ? "sent" : "failed"),
        error: (s && s.error) || m.error || null,
      };
    });
    return json({ config, number, numberError, log });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const channel = String(b.channel || "email");

    /* Phone alerts fail silently by nature: the browser never tells the
       restaurant, so this reports exactly what each device answered. */
    if (channel === "push") {
      const out = await pushTest(sql, {
        title: "Test — Les Émirs",
        body: "Si vous voyez ceci, les notifications fonctionnent.",
        url: "/admin",
      });
      return json(out);
    }

    /* Finish registering the number on the Cloud API — the usual cause of a
       "Pending" number. The PIN is the 6-digit two-step verification code the
       owner chooses (or already set); it is passed to Meta, never stored. */
    if (channel === "wa_register") {
      if (!config.whatsapp.ready) return json({ error: "WhatsApp (Meta) n'est pas configuré : WHATSAPP_TOKEN et WHATSAPP_PHONE_ID manquants." }, 400);
      const pin = String(b.pin || "").trim();
      if (!/^\d{6}$/.test(pin)) return json({ error: "Le code PIN doit contenir exactement 6 chiffres." }, 400);
      try {
        const api = env.WHATSAPP_API_VERSION || "v21.0";
        const r = await fetch(`https://graph.facebook.com/${api}/${env.WHATSAPP_PHONE_ID}/register`, {
          method: "POST",
          headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", pin }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.success) {
          const e = j.error || {};
          return json({ error: `Meta a refusé l'enregistrement (${e.code || r.status}) : ${(e.error_data && e.error_data.details) || e.message || "erreur inconnue"}` }, 502);
        }
        return json({ ok: true, registered: true });
      } catch (e) { return json({ error: String(e) }, 502); }
    }

    const to = String(b.to || "").trim();
    if (!to) return json({ error: "Indiquez un destinataire." }, 400);

    const stamp = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Tunis" });

    if (channel === "email") {
      if (!config.email.ready) return json({ error: "Resend n'est pas encore configuré (clé RESEND_API_KEY manquante)." }, 400);
      const html = shell(`<b>Test de configuration</b><br><br>Si vous lisez ce message, l'envoi d'emails fonctionne.<br><br>
               Envoyé le ${stamp}.<br><span style="color:#8b8271;font-size:12px">Message de test — aucune action requise.</span>`);
      const res = await sendEmail(to, "Test d'envoi — Les Émirs", html);
      if (res && res.error) return json({ error: String(res.error) }, 502);
      await logOutbound(to, "Test d'envoi — Les Émirs", html);   // kept in the mail history too
      return json({ ok: true, channel, to, sent_at: stamp });
    }

    if (channel === "sms") {
      if (!config.sms.ready) return json({ error: "Twilio n'est pas encore configuré pour les SMS." }, 400);
      const res = await sendSms(to, `Les Emirs - test d'envoi (${stamp}). Si vous recevez ce message, tout fonctionne.`);
      if (res && (res.error || res.error_message)) return json({ error: String(res.error || res.error_message) }, 502);
      return json({ ok: true, channel, to, sent_at: stamp, sid: res && res.sid });
    }

    /* WhatsApp: a business-initiated message must be an approved template, so
       the test sends a real template with sample values and returns Meta's
       exact answer (template missing, wrong number of variables, not approved…) */
    if (channel === "whatsapp") {
      if (!config.whatsapp.ready) return json({ error: "WhatsApp (Meta) n'est pas configuré : WHATSAPP_TOKEN et WHATSAPP_PHONE_ID manquants." }, 400);
      const name = WA_SAMPLES[b.template] ? b.template : "reservation_recue";
      const s = WA_SAMPLES[name];
      const res = await sendWhatsAppTemplate(to, name, s.params, null,
        s.qr ? { image: `${base}/api/qr?test=1`, button: "r=0&t=test", ref: "TEST" } : { ref: "TEST" });
      if (res.skipped) return json({ error: "Numéro invalide." }, 400);
      if (!res.ok) {
        const e = (res.body && res.body.error) || {};
        const why = (e.error_data && e.error_data.details) || e.message || res.error || "erreur inconnue";
        return json({ error: `Meta a refusé le modèle « ${name} » (${e.code || res.status || "?"}) : ${why}`, template: name }, 502);
      }
      return json({ ok: true, channel, to, template: name, sent_at: stamp });
    }

    return json({ error: "Canal inconnu." }, 400);
  }

  return json({ error: "method" }, 405);
};
