ALTER TABLE reminders DROP CONSTRAINT reminders_channel_check;
ALTER TABLE reminders ADD CONSTRAINT reminders_channel_check CHECK (channel IN ('telegram', 'email', 'webhook'));
