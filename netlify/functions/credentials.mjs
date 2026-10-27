import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, hashCode, bumpSessions, issueToken } from "./_lib/auth.mjs";

/* Change the access codes — OWNER ONLY. Codes are stored hashed in settings and
   override the deploy-time secrets (see codeToRole). The owner can set either or
   both; the current owner token keeps working (it is signed with AUTH_SECRET,
   not the code), so changing a code never logs the owner out.
   POST /api/credentials { owner_code?, reception_code? } */
export default async (req) => {
  const me = auth(req, ["owner"]);
  if (!me) return json({ error: "unauthorized" }, 401);

  /* which codes exist — never their values — so the owner sees at a glance
     whether a staff code was really saved */
  if (req.method === "GET") {
    const rows = await sql`select key from settings where key in ('owner_code','reception_code','gerant_code','watcher_code')`;
    const has = new Set(rows.map((r) => r.key));
    const env = process.env;
    return json({ codes: {
      owner: has.has("owner_code") || !!env.OWNER_CODE,
      reception: has.has("reception_code") || !!env.RECEPTION_CODE,
      gerant: has.has("gerant_code") || !!env.GERANT_CODE,
      watcher: has.has("watcher_code") || !!env.WATCHER_CODE,
    } });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const b = await readBody(req);

  /* "Déconnecter tous les appareils": every staff phone must log in again;
     the owner's own device gets a fresh login so he stays in */
  if (b.action === "logout_all") {
    const g = await bumpSessions(["owner", "reception", "gerant", "watcher"]);
    return json({ ok: true, token: issueToken("owner", undefined, g.owner), audit: { logout_all: true } });
  }

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
    await set("gerant_code", b.gerant_code);
    await set("watcher_code", b.watcher_code);
  } catch (e) {
    return json({ error: String(e.message || e) }, 400);
  }
  if (!updates.length) return json({ error: "Aucun code fourni." }, 400);
  /* a new code closes every session opened with the old one */
  const roles = updates.map((k) => k.replace("_code", ""));
  const g = await bumpSessions(roles);
  return json({ ok: true, updated: updates, token: roles.includes("owner") ? issueToken("owner", undefined, g.owner) : undefined });
};
