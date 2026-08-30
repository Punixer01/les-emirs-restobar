import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET  /api/push            -> { publicKey }  (for the owner app to subscribe)
// POST /api/push  (owner)   { subscription }  -> saves the device for push alerts
export default async (req) => {
  if (req.method === "GET") {
    return json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  }
  if (req.method === "POST") {
    const me = auth(req, ["owner"]);
    if (!me) return json({ error: "unauthorized" }, 401);
    const b = await readBody(req);
    const sub = b.subscription;
    if (!sub || !sub.endpoint) return json({ error: "subscription" }, 400);
    await sql`
      insert into push_subscriptions (role, endpoint, sub)
      values ('owner', ${sub.endpoint}, ${JSON.stringify(sub)}::jsonb)
      on conflict (endpoint) do nothing`;
    return json({ ok: true });
  }
  return json({ error: "method" }, 405);
};
