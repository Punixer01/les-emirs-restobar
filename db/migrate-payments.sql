-- Online payment by ClicToPay: group deposits and Crédit balances
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                 -- 'deposit' | 'credit'
  reservation_id INTEGER,
  account_id INTEGER,
  amount REAL NOT NULL,               -- DT
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed
  gateway_order TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pay_res ON payments(reservation_id);
ALTER TABLE reservations ADD COLUMN deposit_due REAL;
ALTER TABLE reservations ADD COLUMN deposit_paid REAL;
