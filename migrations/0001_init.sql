-- md.airat.top — shared documents.
--
-- A share is a snapshot of markdown that anyone holding its link can read for 24 hours.
-- It is stored as plaintext on purpose: `/{id}.md` has to hand the raw text to curl or
-- to a model, and neither of those can decrypt anything. The link is the only access
-- control, which the share dialog says in so many words before anything is uploaded.
--
-- Conventions mirror the other AiratTop projects:
--   ids         TEXT, ULID — 26 characters of Crockford base32.
--   timestamps  INTEGER, milliseconds since epoch (UTC) — cheap to compare in a WHERE.

CREATE TABLE shares (
  id                 TEXT PRIMARY KEY,
  content            TEXT NOT NULL,

  -- UTF-8 length of `content`, for the size cap and for stats.
  size_bytes         INTEGER NOT NULL,

  created_at         INTEGER NOT NULL,
  expires_at         INTEGER NOT NULL,

  -- SHA-256 (hex) of the token that lets the creator delete the share early. The token
  -- is returned once at creation and never stored, so a dump of this table cannot be
  -- used to delete anything.
  delete_token_hash  TEXT NOT NULL
);

-- The cron sweep's only query.
CREATE INDEX ix_shares_expires ON shares (expires_at);
