-- Les Émirs — reservation platform schema (PostgreSQL / Neon)

create table if not exists clients (
  id                 bigserial primary key,
  phone              text unique not null,
  name               text not null,
  email              text,
  created_at         timestamptz default now(),
  bookings_total     int default 0,
  bookings_completed int default 0,
  no_shows           int default 0,
  last_visit         timestamptz,
  is_blocked         boolean default false,
  notes              text
);

create table if not exists reservations (
  id          bigserial primary key,
  reference   text unique not null,
  client_id   bigint references clients(id) on delete set null,
  name        text not null,
  phone       text not null,
  email       text,
  res_date    date not null,
  res_time    time not null,
  party_size  int  not null,
  seating     text not null default 'inside',   -- inside | terrace
  service     text,                             -- lunch | dinner
  status      text not null default 'pending',  -- pending|accepted|declined|arrived|seated|no_show|cancelled
  note        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_res_date   on reservations(res_date);
create index if not exists idx_res_status on reservations(status);
create index if not exists idx_res_phone  on reservations(phone);

create table if not exists blacklist (
  id         bigserial primary key,
  phone      text unique not null,
  name       text,
  reason     text,
  created_at timestamptz default now(),
  created_by text
);

-- "Complet" windows: no bookings for a date + time range (+ optional place)
create table if not exists blocks (
  id         bigserial primary key,
  block_date date not null,
  start_time time not null,
  end_time   time not null,
  seating    text not null default 'all',   -- inside | terrace | all
  reason     text,
  created_at timestamptz default now()
);
create index if not exists idx_blocks_date on blocks(block_date);

-- Site interaction analytics
create table if not exists events (
  id         bigserial primary key,
  type       text not null,
  path       text,
  meta       jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_events_created on events(created_at);

-- Owner web-push devices
create table if not exists push_subscriptions (
  id         bigserial primary key,
  role       text not null default 'owner',
  endpoint   text unique not null,
  sub        jsonb not null,
  created_at timestamptz default now()
);

create table if not exists settings (
  key   text primary key,
  value jsonb
);

insert into settings(key, value) values
  ('capacity', '{"inside":12,"terrace":10}'::jsonb),
  ('hours', '{"lunch":{"from":"12:00","to":"15:30"},"dinner":{"from":"19:00","to":"23:00"}}'::jsonb),
  ('policy', '{"noshow_blacklist":true,"loyal_threshold":5}'::jsonb)
on conflict (key) do nothing;
