CREATE TABLE custom_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  copy_to_new_day INTEGER NOT NULL DEFAULT 0,
  include_in_task_copy INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE custom_section_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES custom_sections(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  emoji_id TEXT REFERENCES emoji_rules(id),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_custom_section_entries_date_section ON custom_section_entries(date, section_id);
