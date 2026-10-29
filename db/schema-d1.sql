-- Les Émirs — live D1 schema, exported 2026-10-27 (structure only, no data).
-- Regenerate: wrangler d1 export les-emirs-db --remote --no-data --output db/schema-d1.sql
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE clients (
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
, on_time integer default 0, late_count integer default 0);
CREATE TABLE reservations (
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
, table_id integer, arrived_at text, seated_at text, late_minutes integer, source text default 'web', waiting integer default 0, modified integer not null default 0, mod_summary text, arrival_undos integer not null default 0, lang text, reminded_at text);
CREATE TABLE blacklist (
  id         integer primary key autoincrement,
  phone      text unique not null,
  name       text,
  reason     text,
  created_at text default (datetime('now')),
  created_by text
);
CREATE TABLE blocks (
  id         integer primary key autoincrement,
  block_date text not null,
  start_time text not null,
  end_time   text not null,
  seating    text not null default 'all',
  reason     text,
  created_at text default (datetime('now'))
);
CREATE TABLE events (
  id         integer primary key autoincrement,
  type       text not null,
  path       text,
  meta       text,
  created_at text default (datetime('now'))
);
CREATE TABLE push_subscriptions (
  id         integer primary key autoincrement,
  role       text not null default 'owner',
  endpoint   text unique not null,
  sub        text not null,
  created_at text default (datetime('now'))
);
CREATE TABLE settings ( key text primary key, value text );
CREATE TABLE messages (
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
CREATE TABLE tables (
  id integer primary key autoincrement, code text not null, zone text not null default 'inside',
  seats integer not null default 2, shape text not null default 'round',
  x real not null default 10, y real not null default 10, rot integer not null default 0,
  active integer not null default 1, note text
, merged_into integer, blocked integer default 0, blocked_note text);
CREATE TABLE rate_limits (key text primary key, count integer not null default 0, reset_at integer not null default 0);
CREATE TABLE emails (id integer primary key autoincrement, from_addr text not null, from_name text, to_addr text, subject text, body text, snippet text, is_read integer not null default 0, size integer, created_at text default (datetime('now')), direction text not null default 'in', important INTEGER DEFAULT 0, html text, peer text GENERATED ALWAYS AS (
  lower(trim(
    CASE WHEN instr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END, '<') > 0
          AND instr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END, '>') >
              instr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END, '<')
         THEN substr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END,
                     instr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END, '<') + 1,
                     instr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END, '>') -
                     instr(CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END, '<') - 1)
         ELSE CASE WHEN direction = 'in' THEN from_addr ELSE coalesce(to_addr,'') END
    END
  ))
) VIRTUAL, provider_id text);
CREATE TABLE debts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, amount REAL NOT NULL, paid REAL NOT NULL DEFAULT 0, photo TEXT, note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), settled_at TEXT, photo_thumb TEXT, client_id INTEGER);
CREATE TABLE waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT, email TEXT, res_date TEXT NOT NULL, res_time TEXT, party_size INTEGER NOT NULL DEFAULT 2, seating TEXT NOT NULL DEFAULT 'inside', note TEXT, status TEXT NOT NULL DEFAULT 'waiting', created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT);
CREATE TABLE debt_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  client_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE debt_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT,
  note TEXT,
  photo TEXT,
  photo_thumb TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
, edited_at text, edited_by text);
DELETE FROM sqlite_sequence;
CREATE INDEX idx_res_date   on reservations(res_date);
CREATE INDEX idx_res_status on reservations(status);
CREATE INDEX idx_res_phone  on reservations(phone);
CREATE INDEX idx_blocks_date on blocks(block_date);
CREATE INDEX idx_events_created on events(created_at);
CREATE INDEX idx_messages_created on messages(created_at);
CREATE UNIQUE INDEX idx_tables_code on tables(code);
CREATE INDEX idx_tables_zone on tables(zone);
CREATE INDEX idx_res_table on reservations(table_id);
CREATE INDEX idx_emails_created on emails(created_at desc);
CREATE INDEX idx_debts_open ON debts(settled_at, created_at);
CREATE INDEX idx_waitlist_day ON waitlist(res_date, status);
CREATE TABLE missed (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, res_date TEXT NOT NULL, res_time TEXT, party_size INTEGER NOT NULL DEFAULT 2, seating TEXT NOT NULL DEFAULT 'inside', tries INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT);
CREATE INDEX idx_missed_phone_day ON missed(phone, res_date);
CREATE INDEX idx_ops_acct ON debt_ops(account_id, created_at);
CREATE INDEX idx_emails_unread on emails(is_read, direction) where is_read = 0;
CREATE INDEX idx_emails_peer ON emails(peer, created_at);
CREATE INDEX idx_emails_provider ON emails(provider_id);
CREATE INDEX idx_events_type_created ON events(type, created_at);
CREATE INDEX idx_ops_created ON debt_ops(created_at);
