-- What a notification points at.
--
-- The domain model has carried `targetId` since the notification screen was
-- built — the post, message, story or achievement the line is about — but the
-- column was missed when the social schema was written, so a notification
-- could be stored with its text and no way back to the thing it described.
--
-- Nullable and added in place: existing rows keep everything they had, and a
-- notification that points at nothing simply points at nothing, which is what
-- the reading code already handles.

ALTER TABLE notifications ADD COLUMN target_id TEXT;
