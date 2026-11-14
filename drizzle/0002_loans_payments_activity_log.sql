DROP TABLE entries;
--> statement-breakpoint
CREATE TABLE loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  borrower_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL,
  principal INTEGER NOT NULL,
  fee_percent REAL NOT NULL DEFAULT 0,
  total_due INTEGER NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'menunggu',
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);
--> statement-breakpoint
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL DEFAULT 'tunai',
  note TEXT NOT NULL DEFAULT '',
  paid_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id INTEGER NOT NULL REFERENCES loans(id),
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_payments_loan ON payments(loan_id);
--> statement-breakpoint
CREATE INDEX idx_activity_loan ON activity_log(loan_id);
--> statement-breakpoint
CREATE INDEX idx_loans_status ON loans(status);
