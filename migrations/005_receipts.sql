CREATE TABLE occurrence_receipts (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurrence_id BIGINT      NOT NULL UNIQUE REFERENCES payment_occurrences (id) ON DELETE CASCADE,
  kind          TEXT        NOT NULL CHECK (kind IN ('file', 'link')),
  url           TEXT        CHECK (length(url) BETWEEN 1 AND 2000),
  filename      TEXT        CHECK (length(filename) BETWEEN 1 AND 120),
  mime          TEXT        CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png')),
  size          INTEGER     CHECK (size BETWEEN 1 AND 10485760),
  sha256        CHAR(64),
  data          BYTEA,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    BIGINT      REFERENCES users (id) ON DELETE SET NULL,
  created_login TEXT        CHECK (length(created_login) <= 64),
  created_name  TEXT,
  CONSTRAINT occurrence_receipts_shape CHECK (
    (kind = 'link' AND url IS NOT NULL AND data IS NULL AND filename IS NULL AND mime IS NULL AND size IS NULL AND sha256 IS NULL) OR
    (kind = 'file' AND url IS NULL AND data IS NOT NULL AND filename IS NOT NULL AND mime IS NOT NULL AND size IS NOT NULL AND sha256 IS NOT NULL)
  )
);
