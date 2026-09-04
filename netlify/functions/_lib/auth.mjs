import crypto from "node:crypto";

// Env is read at call time (works on Cloudflare, where env is populated per-request).
function secret() { return process.env.AUTH_SECRET || "dev-insecure-change-me"; }

function b64url(input) { return Buffer.from(input).toString("base64url"); }

/* Staff stay signed in on their own devices — a 12 h token forced a code
   re-entry every day. 90 days behaves like "logged in once"; rotate the
   access codes if a device is lost. */
export function issueToken(role, hours = 24 * 90) {
  const payload = { role, exp: Date.now() + hours * 3600 * 1000 };
  const p = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  return `${p}.${sig}`;
}

export function verifyToken(token, roles) {
  if (!token || typeof token !== "string") return null;
  const [p, sig] = token.split(".");
  if (!p || !sig) return null;
  const expect = crypto.createHmac("sha256", secret()).update(p).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; }
  if (!payload || payload.exp < Date.now()) return null;
  if (roles && !roles.includes(payload.role)) return null;
  return payload;
}

/* Compare in constant time: a plain === leaks how many leading characters
   were right, one byte at a time. */
function sameSecret(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(x, y); } catch { return false; }
}

export function codeToRole(code) {
  const c = String(code || "");
  if (sameSecret(c, process.env.OWNER_CODE)) return "owner";
  if (sameSecret(c, process.env.RECEPTION_CODE)) return "reception";
  return null;
}

export function editToken(id) {
  return crypto.createHmac("sha256", secret()).update("edit:" + id).digest("base64url").slice(0, 24);
}
export function verifyEditToken(id, token) {
  if (!token) return false;
  const expect = editToken(id);
  const a = Buffer.from(String(token)), b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Pass token — printed into the QR on the guest's booking pass.
   Deliberately separate from editToken: scanning a pass at the door must never
   grant the ability to change the booking. */
export function passToken(id) {
  return crypto.createHmac("sha256", secret()).update("pass:" + id).digest("base64url").slice(0, 22);
}
export function verifyPassToken(id, token) {
  if (!token) return false;
  const a = Buffer.from(String(token)), b = Buffer.from(passToken(id));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function auth(req, roles) {
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  return verifyToken(token, roles);
}
