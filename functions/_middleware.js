// Cloudflare Pages: expose the platform env to the shared handlers.
// - string vars → process.env (auth secret, codes, Resend/Twilio keys, PUBLIC_BASE_URL…)
// - full env (incl. the D1 "DB" binding) → globalThis.__ENV for the DB adapter
export async function onRequest(context) {
  try {
    globalThis.__ENV = context.env;
    globalThis.process = globalThis.process || {};
    const strings = {};
    for (const k in context.env) {
      const v = context.env[k];
      if (typeof v === "string") strings[k] = v;
    }
    globalThis.process.env = Object.assign({}, globalThis.process.env || {}, strings);
  } catch (e) {}
  return context.next();
}
