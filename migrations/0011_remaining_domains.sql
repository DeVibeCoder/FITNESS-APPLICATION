-- Columns the remaining domains actually need.
--
-- The tables for these have existed since 0002 and 0003, but they were written
-- from the plan rather than from the application, and a handful of fields the
-- screens genuinely use have nowhere to go. Each column below exists because
-- something on a screen would otherwise be lost on the way to the server: a
-- challenge that forgets whether its target is per person, a plan that forgets
-- whether it is for beginners, a video that forgets which service it is on.
--
-- All additive and all nullable or defaulted, so every existing row keeps
-- exactly what it had. No data of any kind is inserted here.

-- A challenge is a sentence on a card, not just a number: the blurb under the
-- title, whether the target is each person's or the group's together, and the
-- unit and icon the card is drawn with.
ALTER TABLE challenges ADD COLUMN blurb      TEXT;
ALTER TABLE challenges ADD COLUMN per_member INTEGER NOT NULL DEFAULT 0;
ALTER TABLE challenges ADD COLUMN unit       TEXT;
ALTER TABLE challenges ADD COLUMN icon       TEXT;

-- Taking part is a decision with two dates, not a flag. `taking_part` stays as
-- the thing queries filter on; these record when the decision was made, which
-- is what the row is really for.
ALTER TABLE challenge_participants ADD COLUMN joined_at TEXT;
ALTER TABLE challenge_participants ADD COLUMN left_at   TEXT;

-- Body measurements: the two fields the form collects that the table had no
-- column for. `neck_cm` stays where it is — nothing writes it, and dropping a
-- column to tidy up is not worth rewriting a table for.
ALTER TABLE measurements ADD COLUMN body_fat_pct REAL;
ALTER TABLE measurements ADD COLUMN note         TEXT;

-- A plan says who it is for and what it works on. Both are shown on the card
-- that offers it. `focus` is a JSON array of short tags, stored as text the
-- way `workout_apps` already is on a user.
ALTER TABLE plans ADD COLUMN level TEXT;
ALTER TABLE plans ADD COLUMN focus TEXT NOT NULL DEFAULT '[]';

-- What a day of a plan is expected to cost, in minutes. Shown before starting.
ALTER TABLE plan_days ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 0;

-- A motivation video is a link to somebody else's server plus what the group
-- needs to draw a card for it. Never the video.
ALTER TABLE motivation_videos ADD COLUMN provider       TEXT;
ALTER TABLE motivation_videos ADD COLUMN thumbnail_url  TEXT;
ALTER TABLE motivation_videos ADD COLUMN duration_sec   INTEGER;
ALTER TABLE motivation_videos ADD COLUMN is_active      INTEGER NOT NULL DEFAULT 1;
ALTER TABLE motivation_videos ADD COLUMN rotation_order INTEGER;

-- The player records a set against the plan exercise it came from. That column
-- exists, but nothing enforced that a session's sets belong to that session's
-- owner; the foreign key to workout_sessions already cascades, which is what
-- actually protects it. This index is what the player reads by.
CREATE INDEX IF NOT EXISTS idx_set_results_session ON set_results(session_id, set_index);
CREATE INDEX IF NOT EXISTS idx_measurements_user ON measurements(user_id, date);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON plan_enrollments(user_id, active);
