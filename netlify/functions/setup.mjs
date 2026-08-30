import { sql } from "./_lib/db.mjs";
import { json, readBody } from "./_lib/util.mjs";
import { auth, codeToRole } from "./_lib/auth.mjs";

// POST /api/setup  (owner) — creates tables & seeds settings. Safe to run repeatedly.
const SCHEMA = `
create table if not exists clients (
  id bigserial primary key, phone text unique not null, name text not null, email text,
  created_at timestamptz default now(), bookings_total int default 0, bookings_completed int default 0,
  no_shows int default 0, last_visit timestamptz, is_blocked boolean default false, notes text
);
create table if not exists reservations (
  id bigserial primary key, reference text unique not null,
  client_id bigint references clients(id) on delete set null,
  name text not null, phone text not null, email text,
  res_date date not null, res_time time not null, party_size int not null,
  seating text not null default 'inside', service text, status text not null default 'pending',
  note text, created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists idx_res_date on reservations(res_date);
create index if not exists idx_res_status on reservations(status);
create index if not exists idx_res_phone on reservations(phone);
create table if not exists blacklist (
  id bigserial primary key, phone text unique not null, name text, reason text,
  created_at timestamptz default now(), created_by text
);
create table if not exists blocks (
  id bigserial primary key, block_date date not null, start_time time not null, end_time time not null,
  seating text not null default 'all', reason text, created_at timestamptz default now()
);
create index if not exists idx_blocks_date on blocks(block_date);
create table if not exists events (
  id bigserial primary key, type text not null, path text, meta jsonb, created_at timestamptz default now()
);
create index if not exists idx_events_created on events(created_at);
create table if not exists push_subscriptions (
  id bigserial primary key, role text not null default 'owner', endpoint text unique not null,
  sub jsonb not null, created_at timestamptz default now()
);
create table if not exists settings ( key text primary key, value jsonb );
create table if not exists messages (
  id bigserial primary key, direction text not null default 'inbound',
  client_id bigint references clients(id) on delete set null,
  reservation_id bigint references reservations(id) on delete set null,
  name text, phone text, email text, body text not null,
  is_read boolean default false, created_at timestamptz default now()
);
create index if not exists idx_messages_created on messages(created_at);
`;

const SEEDS = [
  `insert into settings(key,value) values ('capacity','{"inside":12,"terrace":10}'::jsonb) on conflict (key) do nothing`,
  `insert into settings(key,value) values ('hours','{"lunch":{"from":"12:00","to":"15:30"},"dinner":{"from":"19:00","to":"23:00"}}'::jsonb) on conflict (key) do nothing`,
  `insert into settings(key,value) values ('policy','{"noshow_blacklist":true,"loyal_threshold":5}'::jsonb) on conflict (key) do nothing`,
];

export default async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const body = await readBody(req);
  const me = auth(req, ["owner"]) || (codeToRole(body && body.code) === "owner" ? { role: "owner" } : null);
  if (!me) return json({ error: "unauthorized" }, 401);

  const statements = SCHEMA.split(";").map((s) => s.trim()).filter(Boolean).concat(SEEDS);
  // neon()'s tagged-template client has no .query(); run each DDL statement as a
  // single-string template (no interpolation, so this is safe for our own schema).
  const exec = (stmt) => { const ts = [stmt]; ts.raw = [stmt]; return sql(ts); };
  let ok = 0;
  const errors = [];
  for (const stmt of statements) {
    try { await exec(stmt); ok++; }
    catch (e) { errors.push({ stmt: stmt.slice(0, 40), error: String(e.message || e) }); }
  }
  return json({ ok: errors.length === 0, executed: ok, total: statements.length, errors });
};
