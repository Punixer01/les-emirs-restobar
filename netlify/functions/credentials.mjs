import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, hashCode } from "./_lib/auth.mjs";

/* Change the access codes — OWNER ONLY. Codes are stored hashed in settings and
   override the deploy-time secrets (see codeToRole). The owner can set either or
   both; the current owner token keeps working (it is signed with AUTH_SECRET,
   not the code), so changing a code never logs the owner out.
   POST /api/credentials { owner_code?, reception_code? } */
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  const b = await readBody(req);
  const updates = [];
  const set = async (key, code) => {
    const v = String(code || "").trim();
    if (!v) return;
    if (v.length < 6) throw new Error("Le code doit faire au moins 6 caractères.");
    await sql`insert into settings (key, value) values (${key}, ${hashCode(v)})
              on conflict (key) do update set value = excluded.value`;
    updates.push(key);
  };
  try {
    await set("owner_code", b.owner_code);
    await set("reception_code", b.reception_code);
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
  if (!updates.length) return json({ error: "Aucun code fourni." }, 400);
  return json({ ok: true, updated: updates });
};
