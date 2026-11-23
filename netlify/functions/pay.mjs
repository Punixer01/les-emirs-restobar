import { sql } from "./_lib/db.mjs";
import { verifyPassToken, signId, verifySigned } from "./_lib/auth.mjs";
import { pushOwners } from "./_lib/notify.mjs";
import * as ctp from "./_lib/clictopay.mjs";

/* Online payment by ClicToPay — three GET links, no page script needed:
     /api/pay?k=deposit&id=<res>&t=<pass token>   group deposit (amount set at booking)
     /api/pay?k=credit&a=<account>&t=<signed>      the whole balance of a Crédit account
     /api/pay?ret=<payment>&t=<signed>             where the gateway sends the guest back
   Amounts are always computed here, never taken from the link. A payment
   counts only once the gateway confirms it, and only once. */

const site = () => process.env.PUBLIC_BASE_URL || "https://lesemirs.com";
const go = (s, k) => new Response(null, { status: 302, headers: { location: `${site()}/paiement?s=${s}${k ? "&k=" + k : ""}` } });
const money = (n) => Math.round(Number(n || 0) * 1000) / 1000;

async function start(kind, amount, ref, lang, description) {
  const rows = await sql`insert into payments (kind, reservation_id, account_id, amount)
    values (${kind}, ${kind === "deposit" ? ref : null}, ${kind === "credit" ? ref : null}, ${amount}) returning id`;
  const pid = rows[0].id;
  try {
    const o = await ctp.register({
      orderNumber: `LE${pid}T${Date.now().toString(36)}`, amount, description, language: lang,
      returnUrl: `${site()}/api/pay?ret=${pid}&t=${signId("payret", pid)}`,
    });
    await sql`update payments set gateway_order = ${o.orderId} where id = ${pid}`;
    return new Response(null, { status: 302, headers: { location: o.formUrl } });
  } catch (e) {
    console.error("[pay register]", e);
    await sql`update payments set status = 'failed' where id = ${pid}`;
    return go("ko", kind);
  }
}

export default async (req) => {
  if (req.method !== "GET") return new Response("method", { status: 405 });
  const q = new URL(req.url).searchParams;

  /* ---- back from the gateway ---- */
  if (q.get("ret")) {
    const pid = parseInt(q.get("ret"), 10);
    if (!verifySigned("payret", pid, q.get("t"))) return go("ko");
    const p = (await sql`select * from payments where id = ${pid}`)[0];
    if (!p) return go("ko");
    if (p.status === "paid") return go("ok", p.kind);
    if (p.status !== "pending" || !p.gateway_order) return go("ko", p.kind);
    let paid = false;
    try { paid = await ctp.isPaid(p.gateway_order); } catch (e) { console.error("[pay status]", e); }
    if (!paid) return go("ko", p.kind);              // stays pending: a late confirmation can still land
    /* the conditional update is the "only once": a second return finds it paid */
    const won = await sql`update payments set status = 'paid', paid_at = datetime('now')
      where id = ${pid} and status = 'pending' returning id`;
    if (won.length) {
      const amt = money(p.amount);
      if (p.kind === "deposit") {
        await sql`update reservations set deposit_paid = coalesce(deposit_paid, 0) + ${amt} where id = ${p.reservation_id}`;
      } else {
        await sql`insert into debt_ops (account_id, kind, amount, method, note, created_by)
          values (${p.account_id}, 'payment', ${amt}, 'clictopay', 'Paiement en ligne', null)`;
      }
      try {
        await pushOwners(sql, {
          title: p.kind === "deposit" ? `💳 Acompte payé en ligne · ${amt.toFixed(3)} DT` : `💳 Crédit réglé en ligne · ${amt.toFixed(3)} DT`,
          body: p.kind === "deposit" ? `Réservation n°${p.reservation_id}` : `Compte crédit n°${p.account_id}`,
          url: "/admin",
        });
      } catch (e) { console.error("[pay push]", e); }
    }
    return go("ok", p.kind);
  }

  if (!ctp.enabled()) return go("off");

  /* ---- group deposit ---- */
  if (q.get("k") === "deposit") {
    const id = parseInt(q.get("id"), 10);
    if (!verifyPassToken(id, q.get("t"))) return go("ko", "deposit");
    const r = (await sql`select id, reference, status, lang, deposit_due, deposit_paid from reservations where id = ${id}`)[0];
    if (!r || ["declined", "cancelled", "expired", "no_show"].includes(r.status)) return go("closed", "deposit");
    const due = money(Number(r.deposit_due || 0) - Number(r.deposit_paid || 0));
    if (due <= 0) return go("done", "deposit");
    return start("deposit", due, id, r.lang === "en" ? "en" : "fr", `Acompte réservation ${r.reference}`);
  }

  /* ---- a Crédit account's balance ---- */
  if (q.get("k") === "credit") {
    const a = parseInt(q.get("a"), 10);
    if (!verifySigned("credit", a, q.get("t"))) return go("ko", "credit");
    const b = await sql`select coalesce(sum(case kind when 'payment' then -amount else amount end), 0) as balance
      from debt_ops where account_id = ${a}`;
    const due = money(b[0] && b[0].balance);
    if (due <= 0) return go("done", "credit");
    return start("credit", due, a, "fr", `Règlement crédit n°${a}`);
  }

  return go("ko");
};
