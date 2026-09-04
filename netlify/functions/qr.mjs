import { sql } from "./_lib/db.mjs";
import { verifyPassToken } from "./_lib/auth.mjs";
import { qrPng } from "./_lib/qr.mjs";

/* GET /api/qr?r=<id>&t=<passToken>  -> PNG of the guest's pass code.
   Public on purpose: it is what the <img> in the confirmation email points at,
   and the token already gates it. Nothing about the booking leaks from the
   image itself. */
export default async (req) => {
  const url = new URL(req.url);
  const id = parseInt(url.searchParams.get("r"), 10);
  const token = url.searchParams.get("t") || "";
  if (!id || !verifyPassToken(id, token)) {
    return new Response("Lien invalide", { status: 403 });
  }

  const rows = await sql`select id from reservations where id = ${id}`;
  if (!rows.length) return new Response("Introuvable", { status: 404 });

  const base = (typeof process !== "undefined" && process.env && process.env.PUBLIC_BASE_URL) || "";
  const target = `${base}/pass?r=${id}&t=${token}`;
  const png = qrPng(target, { scale: 8, margin: 4 });

  return new Response(png, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
      "content-length": String(png.length),
    },
  });
};
