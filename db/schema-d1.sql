-- Les Émirs — Cloudflare D1 (SQLite) schema

create table if not exists clients (
  id                 integer primary key autoincrement,
  phone              text unique not null,
  name               text not null,
  email              text,
  created_at         text default (datetime('now')),
  bookings_total     integer default 0,
  bookings_completed integer default 0,
  no_shows           integer default 0,
  last_visit         text,
  is_blocked         integer default 0,
  notes              text
);

create table if not exists reservations (
  id          integer primary key autoincrement,
  reference   text unique not null,
  client_id   integer references clients(id) on delete set null,
  name        text not null,
  phone       text not null,
  email       text,
  res_date    text not null,
  res_time    text not null,
  party_size  integer not null,
  seating     text not null default 'inside',
  service     text,
  status      text not null default 'pending',
  note        text,
  created_at  text default (datetime('now')),
  updated_at  text default (datetime('now'))
);
create index if not exists idx_res_date   on reservations(res_date);
create index if not exists idx_res_status on reservations(status);
create index if not exists idx_res_phone  on reservations(phone);

create table if not exists blacklist (
  id         integer primary key autoincrement,
  phone      text unique not null,
  name       text,
  reason     text,
  created_at text default (datetime('now')),
  created_by text
);

create table if not exists blocks (
  id         integer primary key autoincrement,
  block_date text not null,
  start_time text not null,
  end_time   text not null,
  seating    text not null default 'all',
  reason     text,
  created_at text default (datetime('now'))
);
create index if not exists idx_blocks_date on blocks(block_date);

create table if not exists events (
  id         integer primary key autoincrement,
  type       text not null,
  path       text,
  meta       text,
  created_at text default (datetime('now'))
);
create index if not exists idx_events_created on events(created_at);

create table if not exists push_subscriptions (
  id         integer primary key autoincrement,
  role       text not null default 'owner',
  endpoint   text unique not null,
  sub        text not null,
  created_at text default (datetime('now'))
);

create table if not exists settings ( key text primary key, value text );

create table if not exists messages (
  id             integer primary key autoincrement,
  direction      text not null default 'inbound',
  client_id      integer references clients(id) on delete set null,
  reservation_id integer references reservations(id) on delete set null,
  name           text,
  phone          text,
  email          text,
  body           text not null,
  is_read        integer default 0,
  created_at     text default (datetime('now'))
);
create index if not exists idx_messages_created on messages(created_at);

insert or ignore into settings(key, value) values
  ('capacity', '{"inside":12,"terrace":10}'),
  ('hours', '{"lunch":{"from":"12:00","to":"15:30"},"dinner":{"from":"19:00","to":"23:00"}}'),
  ('policy', '{"noshow_blacklist":true,"loyal_threshold":5}');
