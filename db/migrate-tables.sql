-- Floor plan + punctuality. Safe to re-run: every statement is guarded.

create table if not exists tables (
  id integer primary key autoincrement,
  code text not null,                     -- what staff call it: "T4", "Terrasse 2"
  zone text not null default 'inside',    -- inside | terrace
  seats integer not null default 2,
  shape text not null default 'round',    -- round | square | rect
  x real not null default 10,             -- % of plan width  (0-100)
  y real not null default 10,             -- % of plan height (0-100)
  rot integer not null default 0,
  active integer not null default 1,
  note text
);
create unique index if not exists idx_tables_code on tables(code);
create index if not exists idx_tables_zone on tables(zone);

-- assignment + punctuality live on the reservation
alter table reservations add column table_id integer references tables(id) on delete set null;
alter table reservations add column arrived_at text;
alter table reservations add column seated_at text;
alter table reservations add column late_minutes integer;
alter table reservations add column source text default 'web';   -- web | owner | phone
alter table reservations add column waiting integer default 0;   -- late, waiting for a table

create index if not exists idx_res_table on reservations(table_id);

-- punctuality history on the client
alter table clients add column on_time integer default 0;
alter table clients add column late_count integer default 0;
