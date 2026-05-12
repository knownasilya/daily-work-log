CREATE TABLE day_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('focus', 'upcoming')),
  content TEXT NOT NULL,
  emoji_id TEXT REFERENCES emoji_rules(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_day_entries_date_kind ON day_entries(date, kind);

INSERT INTO day_entries (date, kind, content, sort_order)
SELECT day, 'focus', focus, 0
FROM days
WHERE focus IS NOT NULL AND TRIM(focus) != '';

ALTER TABLE days DROP COLUMN focus;

DELETE FROM app_settings WHERE key IN ('focus_patterns', 'focus_strip_prefix');
