import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { auth } from "./_lib/auth.mjs";

// GET /api/clients?q=  (owner) — client book, sorted by loyalty
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const q = url.searchParams.get("q");
  const pol = await sql`select value from settings where key = 'policy'`;
  let _pv = {}; try { _pv = pol.length ? JSON.parse(pol[0].value || "{}") : {}; } catch (e) {}
  const threshold = _pv.loyal_threshold ?? 5;

  const rows = q
    ? await sql`select * from clients
                where name like ${"%" + q + "%"} or phone like ${"%" + q + "%"}
                order by bookings_completed desc, bookings_total desc limit 300`
    : await sql`select * from clients order by bookings_completed desc, bookings_total desc limit 300`;

  const clients = rows.map((c) => ({ ...c, loyal: c.bookings_completed >= threshold }));
  return json({ clients, loyal_threshold: threshold });
};
