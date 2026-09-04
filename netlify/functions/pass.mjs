import { sql } from "./_lib/db.mjs";
import { json } from "./_lib/util.mjs";
import { verifyPassToken } from "./_lib/auth.mjs";

/* GET /api/pass?r=&t=  -> what the guest sees on their own pass.
   Token-gated, and deliberately narrow: name, when, party, seating, table,
   status. No phone, no email, no notes — a pass can be shown to anyone. */
export default async (req) => {
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("r"), 10);
  const token = url.searchParams.get("t") || "";
  if (!id || !verifyPassToken(id, token)) return json({ error: "Lien invalide." }, 403);

  const rows = await sql`
    select r.id, r.reference, r.name, r.res_date, r.res_time, r.party_size,
           r.seating, r.status, r.arrived_at, t.code as table_code
    from reservations r
    left join tables t on t.id = r.table_id
    where r.id = ${id}`;
  if (!rows.length) return json({ error: "Réservation introuvable." }, 404);

  return json({ reservation: rows[0] });
};
