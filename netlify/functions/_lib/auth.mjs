import crypto from "node:crypto";

// Env vars take precedence; baked fallbacks keep the app working before env is set.
const SECRET = process.env.AUTH_SECRET || "dev-insecure-change-me";
const OWNER = process.env.OWNER_CODE || "";
const RECEPTION = process.env.RECEPTION_CODE || "";

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function issueToken(role, hours = 12) {
  const payload = { role, exp: Date.now() + hours * 3600 * 1000 };
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export function verifyToken(token, roles) {
  if (!token || typeof token !== "string") return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(p).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
  if (!payload || payload.exp < Date.now()) return null;
  if (roles && !roles.includes(payload.role)) return null;
  return payload;
}

export function codeToRole(code) {
  const c = String(code || "");
  if (c && c === OWNER) return "owner";
  if (c && c === RECEPTION) return "reception";
  return null;
}

// Stateless token for the client's "modify my reservation" link (no login).
export function editToken(id) {
  return crypto.createHmac("sha256", SECRET).update("edit:" + id).digest("base64url").slice(0, 24);
}
export function verifyEditToken(id, token) {
  if (!token) return false;
  const expect = editToken(id);
  const a = Buffer.from(String(token)), b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Returns the auth payload if the request bears a valid token for one of `roles`, else null.
export function auth(req, roles) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  return verifyToken(token, roles);
}
