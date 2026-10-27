/* Les Émirs — scheduled jobs (see wrangler.toml) */
const NIGHTLY = "30 2 * * *";
const KEEP_DAYS = 35;

/* every table, as JSON rows plus its CREATE statement — enough to rebuild the
   database anywhere. Internal tables and the rate-limit counters are skipped. */
async function backup(env) {
  const tables = (await env.DB.prepare(
    "select name, sql from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '_cf_%' and name != 'rate_limits'"
  ).all()).results;
  const out = { taken_at: new Date().toISOString(), tables: {} };
  for (const t of tables) {
    const rows = (await env.DB.prepare(`select * from "${t.name}"`).all()).results;
    out.tables[t.name] = { sql: t.sql, rows };
  }
  const key = "backup-" + out.taken_at.slice(0, 10);
  const body = JSON.stringify(out);
  await env.BACKUPS.put(key, body, { expirationTtl: KEEP_DAYS * 86400, metadata: { bytes: body.length, tables: tables.length } });
  console.log("backup", key, body.length, "bytes", tables.length, "tables");
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === NIGHTLY) { ctx.waitUntil(backup(env)); return; }
    ctx.waitUntil(
      fetch("https://lesemirs.com/api/cron", { method: "POST", headers: { "x-cron-key": env.CRON_KEY } })
        .then((r) => r.text()).then((t) => console.log("cron", t.slice(0, 300)))
        .catch((e) => console.error("cron failed", e))
    );
  },
};
