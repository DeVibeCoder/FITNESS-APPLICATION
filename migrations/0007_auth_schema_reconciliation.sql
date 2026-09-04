-- 0007 — the auth tables, as Better Auth 1.7.2 actually defines them.
--
-- Phase 6 corrected this schema one failing request at a time and found a new
-- missing column on every attempt, which is a method with no end. This is the
-- library's own answer instead: the tables below are built from what
-- `getAuthTables()` reports for our real configuration, so there is nothing
-- left to discover.
--
-- What was actually wrong: `auth_accounts` had no `issuer` column, and Better
-- Auth requires one. Everything else matched once the camelCase→snake_case
-- mapping was added in Phase 6. The three tables are rebuilt rather than
-- patched so the result is known-correct rather than incrementally repaired.
--
-- Safe: development holds zero users, and production has no database at all.
-- `users` is NOT rebuilt — twenty foreign keys point at it, and it already
-- carries every column Better Auth asks for. The application's own fields
-- (status, role, handle, joined_at, email_verified, image) stay exactly as
-- they are; status and role keep their defaults so the client cannot choose
-- them and a row created by the library still arrives pending.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS auth_accounts;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_verification_tokens;

-- account: one row per credential. A password row and a Google row are two
-- accounts belonging to one person.
CREATE TABLE auth_accounts (
  id                       TEXT PRIMARY KEY,
  -- Required by Better Auth and missing until now. For a password credential
  -- it records the issuing origin; for OAuth, the provider's issuer.
  issuer                   TEXT NOT NULL DEFAULT '',
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TEXT,
  refresh_token_expires_at TEXT,
  scope                    TEXT,
  -- The PBKDF2 verifier. Never a password, never returned, never logged.
  password                 TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_auth_accounts_user ON auth_accounts(user_id);
CREATE UNIQUE INDEX idx_auth_accounts_provider ON auth_accounts(provider_id, account_id);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  -- What the cookie carries. Never a user id.
  token      TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE auth_verification_tokens (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_verification_identifier ON auth_verification_tokens(identifier);

PRAGMA foreign_keys = ON;
