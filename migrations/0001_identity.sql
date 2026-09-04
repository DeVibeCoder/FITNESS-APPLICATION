-- 0001 — identity, sessions and group membership.
--
-- The spine everything else hangs from. `users.status` is the admin-approval
-- gate that Dexie v5 had to give up on when it turned out a local admin screen
-- could only ever see its own device; with a server it becomes real again.
--
-- No password column here. Credentials live in `auth_accounts` so that a
-- Google sign-in and an email/password sign-in are two rows against one
-- person rather than two competing shapes on the user record.

PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  handle            TEXT NOT NULL,
  name              TEXT NOT NULL,
  email             TEXT,
  email_verified_at TEXT,
  role              TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  -- pending until an admin decides; disabled is a later state that needs no
  -- new mechanism because every guard already tests for 'approved'.
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),
  decided_at        TEXT,
  decided_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  avatar_media_id   TEXT,
  avatar_color      TEXT NOT NULL DEFAULT '#c2410c',
  birth_date        TEXT,
  sex               TEXT CHECK (sex IN ('male', 'female')),
  height_cm         REAL,
  start_weight_kg   REAL,
  target_weight_kg  REAL,
  goal              TEXT,
  activity_level    TEXT,
  calorie_target_override INTEGER,
  step_goal         INTEGER NOT NULL DEFAULT 8000,
  water_goal_l      REAL NOT NULL DEFAULT 2.5,
  workouts_per_week_goal INTEGER NOT NULL DEFAULT 4,
  weigh_in_day      INTEGER NOT NULL DEFAULT 0 CHECK (weigh_in_day BETWEEN 0 AND 6),
  units             TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  workout_apps      TEXT NOT NULL DEFAULT '[]',
  onboarded_at      TEXT,
  joined_at         TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_users_handle ON users(LOWER(handle));
CREATE UNIQUE INDEX idx_users_email ON users(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_users_status ON users(status);

-- One row per credential. `provider` is 'password' or an OAuth provider id.
CREATE TABLE auth_accounts (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  -- Only ever a derived verifier, never a password. Null for OAuth rows.
  password_hash     TEXT,
  access_token      TEXT,
  refresh_token     TEXT,
  expires_at        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX idx_auth_accounts_user ON auth_accounts(user_id);

CREATE TABLE auth_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The cookie carries this, never the user id.
  token      TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

-- Single-use and short-lived; the row is deleted on use rather than flagged.
CREATE TABLE auth_verification_tokens (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  purpose    TEXT NOT NULL CHECK (purpose IN ('password_reset', 'email_verify')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_verification_identifier ON auth_verification_tokens(identifier);

CREATE TABLE groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  id        TEXT PRIMARY KEY,
  group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);
