ALTER TABLE users ADD COLUMN email TEXT
  CHECK (email IS NULL OR (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'));
CREATE UNIQUE INDEX users_email_uq ON users (email) WHERE email IS NOT NULL;

ALTER TABLE reminders ADD COLUMN recipient TEXT NOT NULL DEFAULT '';
ALTER TABLE reminders DROP CONSTRAINT reminders_once_per_occurrence;
ALTER TABLE reminders DROP CONSTRAINT reminders_channel_check;
ALTER TABLE reminders ADD CONSTRAINT reminders_channel_check CHECK (channel IN ('telegram', 'email'));
ALTER TABLE reminders ADD CONSTRAINT reminders_once_per_recipient UNIQUE (occurrence_id, channel, recipient);
