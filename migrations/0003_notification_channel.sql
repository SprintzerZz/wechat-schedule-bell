ALTER TABLE settings ADD COLUMN notification_channel TEXT NOT NULL DEFAULT 'serverchan'
  CHECK (notification_channel IN ('serverchan', 'pushdeer'));
