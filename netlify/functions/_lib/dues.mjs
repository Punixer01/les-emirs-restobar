import { sql } from "./db.mjs";

/* What a guest still owes on the Crédit book.

   A crédit account is tied to a guest either by its client link or by phone
   number: accounts are often opened before the guest ever booked online, so
   the link can be missing while the number is the same. Numbers are compared
   on their last 8 digits, so "+216 22 123 456" and "22123456" match.

   ONE query for a whole list (not one per reservation): the dashboard polls
   every few seconds, and per-row sub-queries are what once exhausted the
   database's daily read quota. */
const tail8 = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-8) : null;
};

export async function dueIndex() {
  let rows = [];
  try {
    rows = await sql`
      select a.id, a.name, a.client_id, a.phone,
             coalesce(sum(case o.kind when 'payment' then -o.amount else o.amount end), 0) as balance,
             max(o.created_at) as last_op
        from debt_accounts a
        left join debt_ops o on o.account_id = a.id
       group by a.id`;
  } catch (e) {
    console.error("[dues]", e);
    return () => null;                       // never break a list over the crédit book
  }
  const owing = rows.filter((a) => Number(a.balance) > 0.0005)
                    .map((a) => ({ ...a, tail: tail8(a.phone) }));
  return function lookup(clientId, phone) {
    if (!owing.length) return null;
    const t = tail8(phone);
    const hit = owing.filter((a) => (clientId && a.client_id === clientId) || (t && a.tail === t));
    if (!hit.length) return null;
    const due = Math.round(hit.reduce((s, a) => s + Number(a.balance), 0) * 1000) / 1000;
    return { due, accounts: hit.map((a) => ({ id: a.id, name: a.name, balance: Number(a.balance), last_op: a.last_op })) };
  };
}
