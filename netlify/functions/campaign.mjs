import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";
import { sendMarketingEmail, sleep } from "./_lib/notify.mjs";

// GET  /api/campaign  (owner) -> audience counts for the composer
// POST /api/campaign  (owner) { subject, body, segment: 'loyal'|'all' } -> send emails
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const pol = await sql`select value from settings where key = 'policy'`;
  const threshold = pol.length ? (pol[0].value?.loyal_threshold ?? 5) : 5;

  if (req.method === "GET") {
    const loyal = await sql`select count(*)::int as n from clients where email is not null and bookings_completed >= ${threshold}`;
    const all = await sql`select count(*)::int as n from clients where email is not null`;
    return json({ loyal: loyal[0].n, all: all[0].n, threshold });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    const subject = String(b.subject || "").trim();
    const body = String(b.body || "").trim();
    if (!subject || !body) return json({ error: "Sujet et message requis." }, 400);
    const segment = b.segment === "all" ? "all" : "loyal";

    const recipients =
      segment === "all"
        ? await sql`select name, email from clients where email is not null`
        : await sql`select name, email from clients where email is not null and bookings_completed >= ${threshold}`;

    if (!recipients.length) return json({ ok: true, sent: 0, total: 0, note: "Aucun destinataire avec email." });

    let sent = 0;
    const cap = Math.min(recipients.length, 300);
    for (let i = 0; i < cap; i++) {
      const c = recipients[i];
      const r = await sendMarketingEmail(c.email, c.name, subject, body);
      if (r && !r.skipped && !r.error) sent++;
      await sleep(130); // stay under provider rate limits
    }
    return json({ ok: true, sent, total: cap });
  }

  return json({ error: "method" }, 405);
};
