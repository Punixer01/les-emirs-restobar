import { json, readBody } from "./_lib/util.mjs";
import { codeToRole, issueToken } from "./_lib/auth.mjs";
import { rateLimit, sweepLimits } from "./_lib/ratelimit.mjs";

/* The dashboard is protected by a short code a human types, which is
   brute-forceable in minutes at network speed. Ten tries per 15 minutes per
   address turns that into centuries, and a real user never notices. */
const MAX_TRIES = 10;
const WINDOW = 15 * 60;

// POST /api/auth  { code } -> { token, role }
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const gate = await rateLimit(req, "login", MAX_TRIES, WINDOW);
  if (!gate.ok) {
    return json(
      { error: `Trop de tentatives. Réessayez dans ${Math.ceil(gate.retryAfter / 60)} min.` },
      429,
      { "retry-after": String(gate.retryAfter) }
    );
  }

  const { code } = await readBody(req);
  const role = codeToRole(code);
  if (!role) return json({ error: "Code invalide" }, 401);

  await sweepLimits();
  return json({ token: issueToken(role), role });
};
