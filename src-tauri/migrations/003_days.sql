CREATE TABLE days (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL UNIQUE,
  focus TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

