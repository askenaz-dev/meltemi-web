-- The identity service's data: exactly four tables (spec identity-account, "What the service
-- holds"). No provider token, no raw User-Agent, no request log: `sessions.label` holds a coarse
-- label such as "Edge on Windows" and nothing else about the browser.
--
-- Times are ISO-8601 text in UTC with milliseconds (they sort as text); booleans are 0 or 1.
-- The foreign keys cascade, but the store deletes explicitly as well and never relies on them.

CREATE TABLE users (
  id         TEXT NOT NULL PRIMARY KEY,
  name       TEXT NOT NULL,
  picture    TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE identities (
  provider       TEXT NOT NULL,
  provider_id    TEXT NOT NULL,
  user_id        TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  email_verified INTEGER NOT NULL CHECK (email_verified IN (0, 1)),
  -- The time the provider last reported the email verified; NULL while it is not.
  verified_at    TEXT,
  handle         TEXT NOT NULL,
  linked_at      TEXT NOT NULL,
  PRIMARY KEY (provider, provider_id)
) STRICT;

CREATE INDEX identities_user_id ON identities (user_id);

-- Finds the identity that holds an email verified, ignoring case (SQLite folds ASCII letters).
CREATE INDEX identities_verified_email ON identities (lower(email)) WHERE email_verified = 1;

CREATE TABLE sessions (
  sid        TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  label      TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE INDEX sessions_user_id ON sessions (user_id);

-- The deletion events waiting for, or past, delivery to a product. No foreign key: the outbox
-- keeps its events after the user they name is gone.
CREATE TABLE outbox (
  id           TEXT NOT NULL PRIMARY KEY,
  product      TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_at      TEXT NOT NULL,
  delivered_at TEXT,
  failed_at    TEXT
) STRICT;

-- The scheduled run reads only the events still to deliver.
CREATE INDEX outbox_due ON outbox (next_at) WHERE delivered_at IS NULL AND failed_at IS NULL;
