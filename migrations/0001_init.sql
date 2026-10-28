CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  remind_time TEXT,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_day ON events(day, start_time, id);

CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  first_day TEXT NOT NULL,
  interval_days INTEGER NOT NULL,
  slots_per_cycle INTEGER NOT NULL,
  stop_after_day TEXT,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS series_active ON series(first_day, stop_after_day);

CREATE TABLE IF NOT EXISTS series_versions (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  effective_from_day TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(series_id, effective_from_day)
);

CREATE TABLE IF NOT EXISTS cycle_slots (
  version_id TEXT NOT NULL REFERENCES series_versions(id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  remind_time TEXT,
  title_override TEXT,
  note_override TEXT,
  PRIMARY KEY(version_id, slot_index)
);

CREATE TABLE IF NOT EXISTS occurrence_overrides (
  series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  start_time TEXT,
  end_time TEXT,
  remind_time TEXT,
  title TEXT,
  note TEXT,
  PRIMARY KEY(series_id, day)
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  send_at TEXT NOT NULL DEFAULT '08:00',
  send_empty INTEGER NOT NULL DEFAULT 0,
  reminders_enabled INTEGER NOT NULL DEFAULT 1,
  daily_limit INTEGER NOT NULL DEFAULT 5
);
INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS deliveries (
  key TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS deliveries_by_day ON deliveries(day, status);
