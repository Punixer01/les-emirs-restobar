// Cloudflare Pages Functions router for /api/*. Reuses the Netlify handlers
// (Web-standard Request/Response), dispatching by the first path segment.
import auth from "../../netlify/functions/auth.mjs";
import reservations from "../../netlify/functions/reservations.mjs";
import reservationStatus from "../../netlify/functions/reservation-status.mjs";
import reservationEdit from "../../netlify/functions/reservation-edit.mjs";
import reservationUpdate from "../../netlify/functions/reservation-update.mjs";
import reservationRestore from "../../netlify/functions/reservation-restore.mjs";
import blocks from "../../netlify/functions/blocks.mjs";
import credentials from "../../netlify/functions/credentials.mjs";
import blacklist from "../../netlify/functions/blacklist.mjs";
import clients from "../../netlify/functions/clients.mjs";
import stats from "../../netlify/functions/stats.mjs";
import track from "../../netlify/functions/track.mjs";
import push from "../../netlify/functions/push.mjs";
import settings from "../../netlify/functions/settings.mjs";
import content from "../../netlify/functions/content.mjs";
import messages from "../../netlify/functions/messages.mjs";
import emails from "../../netlify/functions/emails.mjs";
import sendMessage from "../../netlify/functions/send-message.mjs";
import campaign from "../../netlify/functions/campaign.mjs";
import setup from "../../netlify/functions/setup.mjs";
import tables from "../../netlify/functions/tables.mjs";
import assign from "../../netlify/functions/assign.mjs";
import testNotify from "../../netlify/functions/test-notify.mjs";
import qr from "../../netlify/functions/qr.mjs";
import pass from "../../netlify/functions/pass.mjs";
import scan from "../../netlify/functions/scan.mjs";
import history from "../../netlify/functions/history.mjs";
import waWebhook from "../../netlify/functions/wa-webhook.mjs";
import debts from "../../netlify/functions/debts.mjs";
import clientsHistory from "../../netlify/functions/clients-history.mjs";
import waitlist from "../../netlify/functions/waitlist.mjs";
import audit from "../../netlify/functions/audit.mjs";
import cron from "../../netlify/functions/cron.mjs";
import { verifyToken, sessionStillValid } from "../../netlify/functions/_lib/auth.mjs";
import { sql } from "../../netlify/functions/_lib/db.mjs";

const routes = {
  "wa-webhook": waWebhook,
  auth,
  reservations,
  "reservation-status": reservationStatus,
  "reservation-edit": reservationEdit,
  "reservation-update": reservationUpdate,
  "reservation-restore": reservationRestore,
  blocks,
  credentials,
  blacklist,
  clients,
  stats,
  track,
  push,
  settings,
  content,
  messages,
  emails,
  "send-message": sendMessage,
  campaign,
  setup,
  tables,
  assign,
  "test-notify": testNotify,
  qr,
  pass,
  scan,
  history,
  debts,
  "clients-history": clientsHistory,
  waitlist,
  audit,
  cron,
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

/* ---- activity tracker ----------------------------------------------------
   Every change made from a dashboard — plus every export and every login
   attempt — is written to events (type 'audit'): who (role), where (route),
   what (action + a scrubbed copy of the request) and, when the handler adds
   one to its JSON reply, a readable summary (`audit`: names, before/after).
   Public website traffic is not dashboard activity and is not recorded.
   Access codes, PINs, photos, files and push subscriptions are never kept. */
const UNTRACKED = new Set(["track", "wa-webhook", "qr", "pass", "setup", "audit", "cron"]);
const HIDE = /_code$|^pin$|password|token|photo|attachment|subscription/i;

function scrub(v, depth) {
  if (v == null) return v;
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + "…" : v;
  if (typeof v !== "object") return v;
  if (depth > 3) return "…";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = HIDE.test(k) ? "[masqué]" : scrub(x, depth + 1);
  return out;
}

async function record(seg, req, bodyText, res) {
  try {
    const url = new URL(req.url);
    const h = req.headers.get("authorization") || "";
    let who = null;
    try { who = verifyToken(h.startsWith("Bearer ") ? h.slice(7) : null); } catch (e) { who = null; }
    let data = null;
    if ((res.headers.get("content-type") || "").includes("json")) {
      try { data = await res.clone().json(); } catch (e) { data = null; }
    }
    let role = who ? who.role : null;
    if (seg === "auth") role = res.status === 200 && data && data.role ? data.role : null;
    if (!role && seg !== "auth") return;                       // the public website, not a dashboard

    let body = null;
    try { body = bodyText ? JSON.parse(bodyText) : null; } catch (e) { body = null; }
    const query = {};
    for (const [k, v] of url.searchParams) { if (!HIDE.test(k) && Object.keys(query).length < 12) query[k] = String(v).slice(0, 100); }
    const meta = {
      role: role || null,
      route: seg,
      method: req.method,
      status: res.status,
      action: (body && typeof body.action === "string") ? body.action : null,
      query,
      body: seg === "auth" ? null : scrub(body, 0),               // never keep what was typed at login
      audit: data && data.audit ? scrub(data.audit, 0) : null,
    };
    await sql`insert into events (type, path, meta) values ('audit', ${seg}, ${JSON.stringify(meta).slice(0, 8000)})`;
  } catch (e) { console.error("[audit]", e); }
}

export const onRequest = async (context) => {
  const seg = (context.params.path && context.params.path[0]) || "";
  const handler = routes[seg];
  if (!handler) return json({ error: "not found" }, 404);
  const req = context.request;
  /* a login cancelled by a code change or "Déconnecter tous les appareils" */
  if (seg !== "auth") {
    const h = req.headers.get("authorization") || "";
    if (h.startsWith("Bearer ")) {
      let p = null;
      try { p = verifyToken(h.slice(7)); } catch (e) { p = null; }
      if (p && !(await sessionStillValid(p))) return json({ error: "unauthorized" }, 401);
    }
  }
  let url;
  try { url = new URL(req.url); } catch (e) { url = null; }
  const tracked = !UNTRACKED.has(seg) && (req.method !== "GET" || (url && url.searchParams.get("export") === "1"));
  let bodyText = null;
  if (tracked && req.method !== "GET") {
    try { bodyText = await req.clone().text(); } catch (e) { bodyText = null; }
    if (bodyText && bodyText.length > 200000) bodyText = null;      // photos / files: the handler's summary is enough
  }
  try {
    const res = await handler(req);
    /* successful changes are recorded; for logins, refusals are recorded too */
    if (tracked && (res.status < 400 || seg === "auth")) {
      const p = record(seg, req, bodyText, res);
      if (context.waitUntil) context.waitUntil(p); else await p;
    }
    return res;
  } catch (e) {
    /* Log the real error server-side only; never return internals to the client
       (SQL text, stack messages, config hints are all useful to an attacker). */
    console.error("[api:" + seg + "]", e);
    return json({ error: "server error" }, 500);
  }
};
