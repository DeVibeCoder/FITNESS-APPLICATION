-- 0006 — let an auth library create a user row.
--
-- Signup failed with FAILED_TO_CREATE_USER: `handle` and `joined_at` were
-- declared NOT NULL with no default, and Better Auth cannot know about
-- columns that are not part of its model. The schema was written before the
-- library existed and assumed the app would always do the inserting.
--
-- `handle` becomes nullable — it is the old local login name, and an account
-- created by email or Google has no such thing until the person picks one.
-- `joined_at` keeps its meaning but defaults to now, which is what it always
-- was anyway.
--
-- Safe to rebuild: development has no users and production has no database.
-- Foreign keys are suspended for the swap because twenty tables reference
-- this one by name; after the rename they point at the new table.

PRAGMA foreign_keys = OFF;

/*
 * legacy_alter_table is what makes the rename below safe.
 *
 * Without it, SQLite helpfully rewrites every foreign key that referenced
 * `users` to reference `users_old` instead — all twenty-eight of them. The
 * new table is then created, the old one dropped, and every one of those
 * references points at a table that no longer exists. Nothing complains
 * until the first insert, which fails with "no such table: main.users_old"
 * and looks nothing like a migration bug.
 *
 * With it on, the rename is exactly a rename and the references stay pointed
 * at `users`, which is where the new table lands.
 */
PRAGMA legacy_alter_table = ON;

ALTER TABLE users RENAME TO users_old;

CREATE TABLE users (
  id                TEXT PRIMARY KEY,
  -- Nullable now: an email or Google account has no handle until asked.
  handle            TEXT,
  name              TEXT NOT NULL,
  email             TEXT,
  email_verified    INTEGER NOT NULL DEFAULT 0,
  email_verified_at TEXT,
  image             TEXT,
  role              TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'disabled')),
  decided_at        TEXT,
  decided_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  avatar_media_id   TEXT,
  avatar_color      TEXT NOT NULL DEFAULT '#c2410c',
  birth_date        TEXT,
  sex               TEXT CHECK (sex IS NULL OR sex IN ('male', 'female')),
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
  joined_at         TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users (
  id, handle, name, email, email_verified, email_verified_at, image, role, status,
  decided_at, decided_by, avatar_media_id, avatar_color, birth_date, sex, height_cm,
  start_weight_kg, target_weight_kg, goal, activity_level, calorie_target_override,
  step_goal, water_goal_l, workouts_per_week_goal, weigh_in_day, units, workout_apps,
  onboarded_at, joined_at, created_at, updated_at
)
SELECT
  id, handle, name, email, email_verified, email_verified_at, image, role, status,
  decided_at, decided_by, avatar_media_id, avatar_color, birth_date, sex, height_cm,
  start_weight_kg, target_weight_kg, goal, activity_level, calorie_target_override,
  step_goal, water_goal_l, workouts_per_week_goal, weigh_in_day, units, workout_apps,
  onboarded_at, joined_at, created_at, updated_at
FROM users_old;

DROP TABLE users_old;

PRAGMA legacy_alter_table = OFF;

CREATE UNIQUE INDEX idx_users_handle ON users(LOWER(handle)) WHERE handle IS NOT NULL;
CREATE UNIQUE INDEX idx_users_email ON users(LOWER(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_users_status ON users(status);

PRAGMA foreign_keys = ON;
