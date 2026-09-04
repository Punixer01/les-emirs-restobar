import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { shell, sendEmail, sendSms, sendWhatsApp, pushTest } from "./_lib/notify.mjs";

/* Delivery self-test for the owner.
   GET  /api/test-notify  -> which channels are actually configured
   POST /api/test-notify { channel:'email'|'sms'|'whatsapp', to } -> send one real message

   Keys are never returned, only whether they are present, so the owner can see
   at a glance what is switched on without exposing anything. */
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const env = (typeof process !== "undefined" && process.env) || {};
  const config = {
    email: {
      ready: !!env.RESEND_API_KEY,
      from: env.MAIL_FROM || "Les Émirs <onboarding@resend.dev> (par défaut)",
      inbox: env.RESTAURANT_EMAIL || null,
    },
    sms: { ready: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM), from: env.TWILIO_FROM || null },
    whatsapp: { ready: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM), from: env.TWILIO_WHATSAPP_FROM || null },
    push: { ready: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) },
  };

  if (req.method === "GET") return json({ config });

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

    const to = String(b.to || "").trim();
    if (!to) return json({ error: "Indiquez un destinataire." }, 400);

    const stamp = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Tunis" });

    if (channel === "email") {
      if (!config.email.ready) return json({ error: "Resend n'est pas encore configuré (clé RESEND_API_KEY manquante)." }, 400);
      const res = await sendEmail(to, "Test d'envoi — Les Émirs",
        shell(`<b>Test de configuration</b><br><br>Si vous lisez ce message, l'envoi d'emails fonctionne.<br><br>
               Envoyé le ${stamp}.<br><span style="color:#8b8271;font-size:12px">Message de test — aucune action requise.</span>`));
      if (res && res.error) return json({ error: String(res.error) }, 502);
      return json({ ok: true, channel, to, sent_at: stamp });
    }

    if (channel === "sms" || channel === "whatsapp") {
      if (!config[channel].ready) return json({ error: `Twilio n'est pas encore configuré pour ${channel}.` }, 400);
      const body = `Les Emirs - test d'envoi (${stamp}). Si vous recevez ce message, tout fonctionne.`;
      const res = channel === "sms" ? await sendSms(to, body) : await sendWhatsApp(to, body);
      if (res && (res.error || res.error_message)) return json({ error: String(res.error || res.error_message) }, 502);
      return json({ ok: true, channel, to, sent_at: stamp, sid: res && res.sid });
    }

    return json({ error: "Canal inconnu." }, 400);
  }

  return json({ error: "method" }, 405);
};
