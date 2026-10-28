CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  send_at TEXT NOT NULL DEFAULT '08:00',
  send_empty INTEGER NOT NULL DEFAULT 0,
  reminders_enabled INTEGER NOT NULL DEFAULT 1,
  daily_limit INTEGER NOT NULL DEFAULT 5,
  notification_channel TEXT NOT NULL DEFAULT 'serverchan'
    CHECK (notification_channel IN ('serverchan', 'pushdeer', 'wecom')),
  wecom_channel_id TEXT NOT NULL DEFAULT ''
);
INSERT INTO settings_new (id, send_at, send_empty, reminders_enabled, daily_limit, notification_channel)
  SELECT id, send_at, send_empty, reminders_enabled, daily_limit, notification_channel FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
