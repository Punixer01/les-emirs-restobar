/* Les Émirs — server test harness.
   Copies the REAL route files and the real auth/util/dues/xlsx/qr next to
   stand-ins for the database, notifications, rate limit, sweep and web push,
   then runs every tests/cases/*.mjs against them.
     node tests/run.mjs
   Nothing here is deployed (deploy.sh publishes public/ and functions/ only). */
import fs from "fs";
import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "..", "netlify", "functions");
const TMP = path.join(HERE, ".tmp");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, "_lib"), { recursive: true });
for (const f of fs.readdirSync(SRC)) if (f.endsWith(".mjs")) fs.copyFileSync(path.join(SRC, f), path.join(TMP, f));
for (const f of ["auth.mjs", "util.mjs", "dues.mjs", "xlsx.mjs", "qr.mjs", "reminders.mjs"])
  fs.copyFileSync(path.join(SRC, "_lib", f), path.join(TMP, "_lib", f));

/* the database: every query is logged; a test decides the answers */
fs.writeFileSync(path.join(TMP, "_lib", "db.mjs"), `
export const LOG = [];
let handler = null;
export function answerWith(fn) { handler = fn; }
function answer(q, args) {
  const t = String(q).replace(/\\s+/g, " ").trim().toLowerCase();
  if (handler) { const r = handler(t, args || []); if (r !== undefined) return r; }
  if (/returning/.test(t)) return [{ id: 1, reference: "TEST01", name: "Test", status: "pending", res_date: "2026-11-20", res_time: "20:00", party_size: 2, seating: "inside" }];
  if (/count\\(\\*\\)/.test(t) || /coalesce\\(sum/.test(t)) return [{ n: 0, total: 0, outstanding: 0, debtors: 0, balance: 0 }];
  return [];
}
export const sql = (strings, ...values) => { const q = strings.join("?"); LOG.push({ q, args: values }); return Promise.resolve(answer(q, values)); };
sql.query = (q, args = []) => { LOG.push({ q, args }); return Promise.resolve(answer(q, args)); };
`);

/* notifications: recorded, never sent */
fs.writeFileSync(path.join(TMP, "_lib", "notify.mjs"), `
export const SENT = [];
const rec = (k) => async (...a) => { SENT.push({ k, a }); return { ok: true }; };
export const pushOwners = rec("push");
export const sendEmail = rec("email"), sendMail = rec("mail"), logOutbound = async () => {};
export const sendSms = rec("sms"), sendWhatsApp = rec("wa"), sendWhatsAppTemplate = rec("watpl");
export const pushTest = rec("pushtest"), telegram = rec("telegram");
export const notifyClientReceived = rec("received"), notifyClientDecision = rec("decision");
export const notifyClientCancelled = rec("cancelled"), notifyClientCustom = rec("custom");
export const notifyClientReminder = rec("reminder");
export const notifyOwnerNew = rec("ownerNew"), notifyOwnerChange = rec("ownerChange"), notifyOwnerCancel = rec("ownerCancel");
export const notifyOwnerMessage = rec("ownerMsg"), sendClientMessage = rec("clientMsg"), sendMarketingEmail = rec("marketing");
export const shell = (s) => String(s);
export const replyHtml = (n, q, t) => String(t);
export const sleep = async () => {};
`);
fs.writeFileSync(path.join(TMP, "_lib", "ratelimit.mjs"), `export async function rateLimit() { return { ok: true }; }`);
fs.writeFileSync(path.join(TMP, "_lib", "sweep.mjs"), `export async function sweepExpired() { return {}; } export async function resetPlanForNewShift() { return {}; }`);
fs.writeFileSync(path.join(TMP, "_lib", "webpush.mjs"), `export async function sendPush() { return { ok: true }; }`);

process.env.AUTH_SECRET = "test-secret-at-least-16-chars-long";
const cases = fs.readdirSync(path.join(HERE, "cases")).filter((f) => f.endsWith(".mjs")).sort();
let failed = 0;
for (const c of cases) {
  try { await import(pathToFileURL(path.join(HERE, "cases", c)).href); }
  catch (e) { failed++; console.error("FAIL " + c + "\n  " + (e && e.stack || e)); }
}
console.log(failed ? `${failed} test file(s) FAILED` : `ALL ${cases.length} TEST FILES OK`);
process.exit(failed ? 1 : 0);
