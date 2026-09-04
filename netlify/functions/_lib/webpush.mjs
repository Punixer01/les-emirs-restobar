/**
 * Web Push for the Cloudflare runtime.
 *
 * The `web-push` npm package cannot run here: it sends over Node's
 * https.request, which Workers do not implement, so every notification failed
 * silently. This does the same job with Web Crypto and fetch.
 *
 *   VAPID    — RFC 8292 (an ES256 JWT identifying the sender)
 *   Payload  — RFC 8291 (ECDH → HKDF → AES-128-GCM, "aes128gcm")
 */

const enc = new TextEncoder();

/* ---------- base64url ---------- */
function b64uToBytes(s) {
  const p = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = p + "=".repeat((4 - (p.length % 4)) % 4);
  const raw = atob(pad);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64u(bytes) {
  let s = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrays) {
  let n = 0;
  for (const a of arrays) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrays) { out.set(a, o); o += a.length; }
  return out;
}

/* ---------- HKDF (RFC 5869) ---------- */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8
  );
  return new Uint8Array(bits);
}

/* ---------- VAPID: an ES256 JWT proving who is sending ---------- */
async function vapidHeader(endpoint, publicKey, privateKey, subject) {
  const aud = new URL(endpoint).origin;
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject || "mailto:admin@example.com",
  };
  const signingInput =
    bytesToB64u(enc.encode(JSON.stringify(header))) + "." +
    bytesToB64u(enc.encode(JSON.stringify(payload)));

  /* the raw VAPID pair, rebuilt as a JWK so Web Crypto will take it */
  const pub = b64uToBytes(publicKey);           // 65 bytes: 0x04 || x || y
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: bytesToB64u(b64uToBytes(privateKey)),
    ext: true,
  };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput)
  );
  const jwt = signingInput + "." + bytesToB64u(new Uint8Array(sig));
  return { Authorization: `vapid t=${jwt}, k=${publicKey}` };
}

/* ---------- payload encryption (RFC 8291) ---------- */
async function encryptPayload(plaintext, uaPublicB64, authSecretB64) {
  const uaPublic = b64uToBytes(uaPublicB64);      // 65 bytes
  const authSecret = b64uToBytes(authSecretB64);  // 16 bytes
  const salt = crypto.getRandomValues(new Uint8Array(16));

  /* an ephemeral key pair for this one message */
  const asPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
  );
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asPair.publicKey));

  const uaKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPair.privateKey, 256)
  );

  /* PRK_key = HKDF(auth_secret, shared, "WebPush: info" || ua || as) */
  const keyInfo = concat(enc.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const cek = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(enc.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  /* 0x02 marks the last record, per the aes128gcm scheme */
  const padded = concat(enc.encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, padded)
  );

  /* header: salt | record size | key length | ephemeral public key */
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/**
 * @param {{endpoint:string, keys:{p256dh:string, auth:string}}} sub
 * @param {string} payload  JSON string the service worker will receive
 * @returns {Promise<{ok:boolean, status:number, body?:string}>}
 */
export async function sendPush(sub, payload, { publicKey, privateKey, subject, ttl = 3600 } = {}) {
  const body = await encryptPayload(payload, sub.keys.p256dh, sub.keys.auth);
  const auth = await vapidHeader(sub.endpoint, publicKey, privateKey, subject);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      ...auth,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
    },
    body,
  });

  if (res.ok) return { ok: true, status: res.status };
  let text = "";
  try { text = (await res.text()).slice(0, 200); } catch (e) { /* nothing useful */ }
  return { ok: false, status: res.status, body: text };
}
