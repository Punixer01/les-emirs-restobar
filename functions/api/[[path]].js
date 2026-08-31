// Cloudflare Pages Functions router for /api/*. Reuses the Netlify handlers
// (Web-standard Request/Response), dispatching by the first path segment.
import auth from "../../netlify/functions/auth.mjs";
import reservations from "../../netlify/functions/reservations.mjs";
import reservationStatus from "../../netlify/functions/reservation-status.mjs";
import reservationEdit from "../../netlify/functions/reservation-edit.mjs";
import blocks from "../../netlify/functions/blocks.mjs";
import blacklist from "../../netlify/functions/blacklist.mjs";
import clients from "../../netlify/functions/clients.mjs";
import stats from "../../netlify/functions/stats.mjs";
import track from "../../netlify/functions/track.mjs";
import push from "../../netlify/functions/push.mjs";
import settings from "../../netlify/functions/settings.mjs";
import content from "../../netlify/functions/content.mjs";
import messages from "../../netlify/functions/messages.mjs";
import sendMessage from "../../netlify/functions/send-message.mjs";
import campaign from "../../netlify/functions/campaign.mjs";
import setup from "../../netlify/functions/setup.mjs";

const routes = {
  auth,
  reservations,
  "reservation-status": reservationStatus,
  "reservation-edit": reservationEdit,
  blocks,
  blacklist,
  clients,
  stats,
  track,
  push,
  settings,
  content,
  messages,
  "send-message": sendMessage,
  campaign,
  setup,
};

function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

export const onRequest = async (context) => {
  const seg = (context.params.path && context.params.path[0]) || "";
  const handler = routes[seg];
  if (!handler) return json({ error: "not found" }, 404);
  try {
    return await handler(context.request);
  } catch (e) {
    console.error("[api:" + seg + "]", e);
    return json({ error: "server error", detail: String(e && e.message || e) }, 500);
  }
};
