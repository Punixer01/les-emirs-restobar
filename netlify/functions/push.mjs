import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, STAFF, isWatcher } from "./_lib/auth.mjs";
import { pushTest } from "./_lib/notify.mjs";

// GET  /api/push            -> { publicKey }  (for the owner app to subscribe)
// POST /api/push  (owner)   { subscription }  -> saves the device for push alerts
export default async (req) => {
  if (req.method === "GET") {
    /* owner-only: fire a real alert on every registered device and say, device
       by device, what happened — the only way to tell "no alert" from "no
       subscription" from "the browser refused it" */
    if (new URL(req.url).searchParams.get("test") === "1") {
      const me = auth(req, ["owner"]);
      if (!me) return json({ error: "unauthorized" }, 401);
      const report = await pushTest(sql, { title: "Les Émirs — test", body: "Les alertes fonctionnent sur cet appareil.", url: "/admin" });
      return json(report);
    }
    return json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  }
  if (req.method === "POST") {
    /* Reception phones must get the alerts too (a client cancellation frees a
       table the front desk manages), so both staff roles can register a device. */
    const me = auth(req, STAFF);
    if (!me) return json({ error: "unauthorized" }, 401);
    /* a watcher account is read-only — it does not register devices either */
    if (isWatcher(me)) return json({ error: "Compte en lecture seule." }, 403);
    const role = me.role === "owner" ? "owner" : "reception";   // gérant rings with the front desk
    const b = await readBody(req);
    const sub = b.subscription;
    if (!sub || !sub.endpoint) return json({ error: "subscription" }, 400);
    await sql`
      insert into push_subscriptions (role, endpoint, sub)
      values (${role}, ${sub.endpoint}, ${JSON.stringify(sub)})
      on conflict (endpoint) do update set role = excluded.role, sub = excluded.sub`;
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};
