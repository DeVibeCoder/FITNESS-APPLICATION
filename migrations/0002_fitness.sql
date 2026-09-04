-- 0002 — the fitness record: training, body, and the daily logs.
--
-- Two things are enforced here that the browser version could only enforce in
-- TypeScript:
--
--   * deleting a session takes its exercises and set results with it, through
--     ON DELETE CASCADE rather than a hand-written sweep;
--   * an exercise may only carry the fields its own kind uses, through CHECK
--     constraints. A timed row physically cannot hold reps or a distance.

PRAGMA foreign_keys = ON;

-- --- Reference: the exercise catalogue and plan structure -----------------

CREATE TABLE exercises (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  -- JSON array, matching the catalogue's own shape.
  muscle_groups TEXT NOT NULL DEFAULT '[]',
  equipment     TEXT,
  met           REAL NOT NULL DEFAULT 8.0,
  cue           TEXT
);

CREATE UNIQUE INDEX idx_exercises_name ON exercises(LOWER(name));

CREATE TABLE plans (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  description TEXT,
  total_days  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE plan_days (
  id         TEXT PRIMARY KEY,
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  name       TEXT NOT NULL,
  is_rest    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plan_id, day_number)
);

CREATE TABLE plan_exercises (
  id            TEXT PRIMARY KEY,
  plan_day_id   TEXT NOT NULL REFERENCES plan_days(id) ON DELETE CASCADE,
  exercise_id   TEXT NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position      INTEGER NOT NULL,
  sets          INTEGER,
  reps          INTEGER,
  duration_sec  INTEGER,
  rest_sec      INTEGER,
  UNIQUE (plan_day_id, position)
);

CREATE TABLE plan_enrollments (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id    TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_enrollments_user ON plan_enrollments(user_id, active);

-- --- Training records -----------------------------------------------------

CREATE TABLE workout_sessions (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('strength', 'cardio', 'general')),
  name           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
  duration_sec   INTEGER NOT NULL DEFAULT 0,
  calories_kcal  REAL NOT NULL DEFAULT 0,
  exercise_count INTEGER NOT NULL DEFAULT 0,
  difficulty     TEXT CHECK (difficulty IS NULL OR difficulty IN ('hard', 'just_right', 'easy')),
  note           TEXT,
  logged_via     TEXT NOT NULL CHECK (logged_via IN ('player', 'quick_log', 'manual')),
  source         TEXT,
  source_name    TEXT,
  plan_name      TEXT,
  day_number     INTEGER,
  started_at     TEXT NOT NULL,
  completed_at   TEXT,
  paused_at      TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX idx_sessions_user_date ON workout_sessions(user_id, date);
CREATE INDEX idx_sessions_user_status ON workout_sessions(user_id, status);

-- Exercises somebody wrote down by hand. Replaced wholesale on edit, which is
-- why the cascade matters more than a diff would.
CREATE TABLE logged_exercises (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  position     INTEGER NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('strength', 'timed', 'cardio')),
  sets         INTEGER,
  reps         INTEGER,
  weight_kg    REAL,
  duration_sec INTEGER,
  distance_km  REAL,
  note         TEXT,
  -- Each kind carries only its own fields. Strength has sets, reps and a
  -- weight; timed has a set count and a hold; cardio has a duration and a
  -- distance. Anything else is a shape the UI cannot render honestly.
  CHECK (kind <> 'strength' OR (duration_sec IS NULL AND distance_km IS NULL)),
  CHECK (kind <> 'timed'    OR (reps IS NULL AND weight_kg IS NULL AND distance_km IS NULL)),
  CHECK (kind <> 'cardio'   OR (sets IS NULL AND reps IS NULL AND weight_kg IS NULL)),
  UNIQUE (session_id, position)
);

CREATE TABLE set_results (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  plan_exercise_id    TEXT,
  set_index           INTEGER NOT NULL,
  reps                INTEGER,
  duration_sec        INTEGER,
  weight_kg           REAL,
  completed           INTEGER NOT NULL DEFAULT 1,
  skipped             INTEGER NOT NULL DEFAULT 0,
  completed_at        TEXT,
  UNIQUE (session_id, plan_exercise_id, set_index)
);

CREATE INDEX idx_set_results_session ON set_results(session_id);

-- --- Body and daily logs --------------------------------------------------

CREATE TABLE weights (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE measurements (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  chest_cm   REAL, waist_cm REAL, hips_cm REAL,
  arm_cm     REAL, thigh_cm REAL, neck_cm REAL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE progress_photos (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  media_id   TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_photos_user_date ON progress_photos(user_id, date);

CREATE TABLE food_entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  meal       TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snacks')),
  name       TEXT NOT NULL,
  portion    TEXT NOT NULL,
  quantity   REAL,
  unit       TEXT,
  note       TEXT,
  kcal       REAL NOT NULL DEFAULT 0,
  protein_g  REAL NOT NULL DEFAULT 0,
  carbs_g    REAL NOT NULL DEFAULT 0,
  fat_g      REAL NOT NULL DEFAULT 0,
  -- 'photo' rows came from the scan flow. The photo itself is never stored.
  source     TEXT NOT NULL CHECK (source IN ('manual', 'photo', 'favourite')),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_food_user_date ON food_entries(user_id, date);

CREATE TABLE water_entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  ml         INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_water_user_date ON water_entries(user_id, date);

CREATE TABLE step_entries (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  steps      INTEGER NOT NULL,
  source     TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE checkins (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  energy     INTEGER,
  soreness   TEXT CHECK (soreness IS NULL OR soreness IN ('none', 'low', 'medium', 'high')),
  feeling    TEXT,
  note       TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, date)
);

CREATE TABLE user_goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  target      REAL,
  unit        TEXT,
  due_date    TEXT,
  achieved_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_goals_user ON user_goals(user_id);
