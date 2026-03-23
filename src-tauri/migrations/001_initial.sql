CREATE TABLE emoji_rules (
  id TEXT PRIMARY KEY,
  image TEXT NOT NULL,
  text TEXT NOT NULL,
  pattern TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE work_log_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  emoji_id TEXT REFERENCES emoji_rules(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_work_log_date ON work_log_entries(date);
