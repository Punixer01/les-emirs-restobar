import { json, readBody } from "./_lib/util.mjs";
import { codeToRole, issueToken } from "./_lib/auth.mjs";

// POST /api/auth  { code } -> { token, role }
export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const { code } = await readBody(req);
  const role = codeToRole(code);
  if (!role) return json({ error: "Code invalide" }, 401);
  return json({ token: issueToken(role), role });
};
