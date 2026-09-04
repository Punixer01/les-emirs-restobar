import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, codeToRole } from "./_lib/auth.mjs";

// POST /api/setup (owner) — creates tables & seeds settings on Cloudflare D1. Safe to re-run.
const SCHEMA = `
create table if not exists clients (
  id integer primary key autoincrement, phone text unique not null, name text not null, email text,
  created_at text default (datetime('now')), bookings_total integer default 0, bookings_completed integer default 0,
  no_shows integer default 0, last_visit text, is_blocked integer default 0, notes text
);
create table if not exists reservations (
  id integer primary key autoincrement, reference text unique not null,
  client_id integer references clients(id) on delete set null,
  name text not null, phone text not null, email text,
  res_date text not null, res_time text not null, party_size integer not null,
  seating text not null default 'inside', service text, status text not null default 'pending',
  note text, created_at text default (datetime('now')), updated_at text default (datetime('now'))
);
create index if not exists idx_res_date on reservations(res_date);
create index if not exists idx_res_status on reservations(status);
create index if not exists idx_res_phone on reservations(phone);
create table if not exists blacklist (
  id integer primary key autoincrement, phone text unique not null, name text, reason text,
  created_at text default (datetime('now')), created_by text
);
create table if not exists blocks (
  id integer primary key autoincrement, block_date text not null, start_time text not null, end_time text not null,
  seating text not null default 'all', reason text, created_at text default (datetime('now'))
);
create index if not exists idx_blocks_date on blocks(block_date);
create table if not exists events (
  id integer primary key autoincrement, type text not null, path text, meta text, created_at text default (datetime('now'))
);
create index if not exists idx_events_created on events(created_at);
create table if not exists push_subscriptions (
  id integer primary key autoincrement, role text not null default 'owner', endpoint text unique not null,
  sub text not null, created_at text default (datetime('now'))
);
create table if not exists settings ( key text primary key, value text );
create table if not exists emails (
  id integer primary key autoincrement,
  from_addr text not null, from_name text, to_addr text,
  subject text, body text, snippet text,
  is_read integer not null default 0, size integer, direction text not null default 'in',
  created_at text default (datetime('now'))
);
create index if not exists idx_emails_created on emails(created_at desc);
create table if not exists rate_limits (
  key text primary key, count integer not null default 0, reset_at integer not null default 0
);
create table if not exists messages (
  id integer primary key autoincrement, direction text not null default 'inbound',
  client_id integer references clients(id) on delete set null,
  reservation_id integer references reservations(id) on delete set null,
  name text, phone text, email text, body text not null,
  is_read integer default 0, created_at text default (datetime('now'))
);
create index if not exists idx_messages_created on messages(created_at);
`;

// Floor plan + punctuality. `alter table add column` throws if the column is
// already there, which is fine — each statement is applied independently and
// "duplicate column" is swallowed as an expected no-op.
const UPGRADE = `
create table if not exists tables (
  id integer primary key autoincrement, code text not null, zone text not null default 'inside',
  seats integer not null default 2, shape text not null default 'round',
  x real not null default 10, y real not null default 10, rot integer not null default 0,
  active integer not null default 1, note text
);
create unique index if not exists idx_tables_code on tables(code);
create index if not exists idx_tables_zone on tables(zone);
alter table reservations add column table_id integer;
alter table reservations add column arrived_at text;
alter table reservations add column seated_at text;
alter table reservations add column late_minutes integer;
alter table reservations add column source text default 'web';
alter table reservations add column waiting integer default 0;
alter table reservations add column modified integer not null default 0;
alter table reservations add column mod_summary text;
create index if not exists idx_res_table on reservations(table_id);
alter table tables add column merged_into integer;
alter table tables add column blocked integer default 0;
alter table tables add column blocked_note text;
alter table clients add column on_time integer default 0;
alter table clients add column late_count integer default 0;
`;

const SEEDS = [
  `insert or ignore into settings(key,value) values ('capacity','{"inside":12,"terrace":10}')`,
  `insert or ignore into settings(key,value) values ('hours','{"lunch":{"from":"12:00","to":"15:30"},"dinner":{"from":"19:00","to":"23:00"}}')`,
  `insert or ignore into settings(key,value) values ('policy','{"noshow_blacklist":true,"loyal_threshold":5}')`,
];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body = await readBody(req);
  const me = auth(req, ["owner"]) || (codeToRole(body && body.code) === "owner" ? { role: "owner" } : null);
  if (!me) return json({ error: "unauthorized" }, 401);

  const split = (s) => s.split(";").map((x) => x.trim()).filter(Boolean);
  const statements = split(SCHEMA).concat(split(UPGRADE)).concat(SEEDS);
  let ok = 0, skipped = 0;
  const errors = [];
  for (const stmt of statements) {
    try { await sql.query(stmt); ok++; }
    catch (e) {
      const msg = String(e.message || e);
      if (/duplicate column/i.test(msg)) { skipped++; continue; }  // already migrated
      errors.push({ stmt: stmt.slice(0, 44), error: msg });
    }
  }
  return json({ ok: errors.length === 0, executed: ok, already: skipped, total: statements.length, errors });
};
