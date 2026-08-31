// Cloudflare D1 adapter. Exposes a Postgres-like tagged-template `sql` so the
// handlers keep using sql`select ... ${v}` unchanged; here it compiles to D1's
// prepare/bind API. The D1 binding ("DB") is provided per-request via _middleware.
function d1() {
  const env = globalThis.__ENV || {};
  const db = env.DB || (globalThis.process && globalThis.process.env && globalThis.process.env.DB);
  if (!db) throw new Error('D1 binding "DB" not found');
  return db;
}
function norm(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === undefined) return null;
  return v;
}
export async function sql(strings, ...values) {
  let q = "";
  for (let i = 0; i < strings.length; i++) { q += strings[i]; if (i < values.length) q += "?"; }
  const res = await d1().prepare(q).bind(...values.map(norm)).all();
  return res.results || [];
}
sql.query = async (text, params = []) => {
  const res = await d1().prepare(text).bind(...params.map(norm)).all();
  return res.results || [];
};
