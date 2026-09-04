-- 0005 — align the auth tables with what Better Auth actually expects.
--
-- Phase 1 sketched these tables before the library was chosen, so the column
-- names were guesses. Better Auth's adapter looks for a specific set, and the
-- honest fix is to match it rather than to write a mapping layer that has to
-- stay correct forever.
--
-- Safe to recreate: the development database has no users, and production has
-- no database at all. `users` itself is only extended, never dropped, because
-- twenty foreign keys in 0002 and 0003 point at it.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS auth_verification_tokens;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_accounts;

-- Better Auth writes a boolean here; the ISO timestamp column it replaces was
-- the guess. Kept as an INTEGER because SQLite has no boolean.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
-- The library's own avatar field. The app's avatar_media_id stays as it is —
-- that one points at R2 and is ours.
ALTER TABLE users ADD COLUMN image TEXT;

-- One row per credential: a password row and a Google row are two accounts
-- belonging to one person, which is what makes linking possible later.
CREATE TABLE auth_accounts (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  -- The password verifier for 'credential' rows. Never a password, never
  -- returned to a client, never logged. NULL for OAuth rows.
  password                 TEXT,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TEXT,
  refresh_token_expires_at TEXT,
  scope                    TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE (provider_id, account_id)
);

CREATE INDEX idx_auth_accounts_user ON auth_accounts(user_id);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- What the cookie carries. Never a user id: an identifier the client can
  -- read is an identifier the client can change.
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

-- Password resets and email verification. Single-use and short-lived; the row
-- is deleted on use rather than flagged, so a leaked token is worth nothing
-- once it has been spent.
CREATE TABLE auth_verification_tokens (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_verification_identifier ON auth_verification_tokens(identifier);

PRAGMA foreign_keys = ON;
