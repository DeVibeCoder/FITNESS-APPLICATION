-- 0003 — the group feed, social surfaces, chat, media and notifications.
--
-- The important table here is `group_updates`, and the important thing about
-- it is what it does NOT have: any reference to the workout it describes.
--
-- An announcement is a historical snapshot of something that happened, not a
-- live view of a record. That is why deleting a workout leaves its
-- announcement standing, why editing a workout does not rewrite one, and why
-- the row carries its own rendered text and its own JSON of the numbers as
-- they were at the time. `dedupe_key` being UNIQUE is the database enforcing
-- one announcement per real-world event — the constraint version of the
-- transaction that had to do the job in the browser.

PRAGMA foreign_keys = ON;

CREATE TABLE group_updates (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  -- Rendered when the event happened. Never recomputed from live records.
  text       TEXT NOT NULL,
  -- JSON snapshot: kcal, duration, steps, weight — whatever it was then.
  meta       TEXT,
  dedupe_key TEXT UNIQUE,
  created_at TEXT NOT NULL
  -- Deliberately no FOREIGN KEY to workout_sessions. The announcement is
  -- meant to outlive the record, so a reference would be a bug, not a link.
);

CREATE INDEX idx_updates_created ON group_updates(created_at DESC);
CREATE INDEX idx_updates_user ON group_updates(user_id);

CREATE TABLE update_reactions (
  id         TEXT PRIMARY KEY,
  update_id  TEXT NOT NULL REFERENCES group_updates(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- One reaction per person per update; tapping another replaces it.
  UNIQUE (update_id, user_id)
);

-- --- Media ----------------------------------------------------------------
--
-- Metadata and an R2 key. No bytes, ever — the rule the browser version
-- already followed, now written down where the storage can hold us to it.

CREATE TABLE media_assets (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('image', 'video')),
  mime_type     TEXT NOT NULL,
  bytes         INTEGER,
  width         INTEGER,
  height        INTEGER,
  duration_sec  INTEGER,
  -- pending until the upload is committed; orphaned once nothing points here,
  -- which is what the sweeper looks for rather than deleting inline.
  state         TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending', 'ready', 'orphaned')),
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_media_owner ON media_assets(owner_user_id);
CREATE INDEX idx_media_state ON media_assets(state);

-- --- Posts, comments, stories --------------------------------------------

CREATE TABLE posts (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  text          TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'group'
                CHECK (visibility IN ('private', 'group', 'public')),
  shared_type   TEXT,
  shared_data_id TEXT,
  motivation    INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_user ON posts(user_id);

CREATE TABLE post_media (
  id       TEXT PRIMARY KEY,
  post_id  TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (post_id, media_id)
);

CREATE TABLE post_reactions (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (post_id, user_id)
);

CREATE TABLE comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_comments_post ON comments(post_id, created_at);

CREATE TABLE stories (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  text       TEXT,
  background TEXT,
  media_id   TEXT REFERENCES media_assets(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_stories_user ON stories(user_id, created_at DESC);
CREATE INDEX idx_stories_expiry ON stories(expires_at);

CREATE TABLE story_views (
  id         TEXT PRIMARY KEY,
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at  TEXT NOT NULL,
  UNIQUE (story_id, user_id)
);

CREATE TABLE motivation_videos (
  id         TEXT PRIMARY KEY,
  added_by   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  url        TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);

-- --- Chat -----------------------------------------------------------------
--
-- Conversations exist as a table even though there is one group room today,
-- because a Durable Object is addressed per conversation and adding the
-- second room should not need a migration.

CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,
  group_id   TEXT REFERENCES groups(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE conversation_participants (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TEXT,
  joined_at       TEXT NOT NULL,
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX idx_participants_user ON conversation_participants(user_id);

CREATE TABLE messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text            TEXT NOT NULL DEFAULT '',
  reply_to_id     TEXT REFERENCES messages(id) ON DELETE SET NULL,
  shared_type     TEXT,
  shared_data_id  TEXT,
  sticker_id      TEXT,
  pinned_at       TEXT,
  pinned_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
  -- Soft delete: replies keep quoting it, and the quote reads "Message
  -- deleted" rather than answering nothing.
  deleted_at      TEXT,
  created_at      TEXT NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_messages_pinned ON messages(conversation_id, pinned_at) WHERE pinned_at IS NOT NULL;

CREATE TABLE message_reactions (
  id         TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (message_id, user_id)
);

-- --- Progress, challenges, notifications ----------------------------------

CREATE TABLE achievement_definitions (
  key         TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  icon        TEXT NOT NULL,
  group_name  TEXT NOT NULL,
  criteria    TEXT NOT NULL,
  tier        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE user_achievements (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL REFERENCES achievement_definitions(key) ON DELETE CASCADE,
  unlocked_at     TEXT NOT NULL,
  UNIQUE (user_id, achievement_key)
);

CREATE TABLE challenges (
  id         TEXT PRIMARY KEY,
  group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  metric     TEXT NOT NULL CHECK (metric IN ('steps', 'workouts', 'checkins', 'water', 'nutrition')),
  target     REAL NOT NULL,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- One challenge per group per week; a race creates a conflict, not a
  -- second board.
  UNIQUE (group_id, week_start)
);

CREATE TABLE challenge_participants (
  id           TEXT PRIMARY KEY,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  taking_part  INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL,
  UNIQUE (challenge_id, user_id)
);

CREATE TABLE notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  link       TEXT,
  actor_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;
