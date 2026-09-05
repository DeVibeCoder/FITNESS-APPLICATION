-- 0008 — point twenty-eight foreign keys back at a table that exists.
--
-- The first version of 0006 renamed `users` to `users_old` before rebuilding
-- it. SQLite treats a rename as a refactor and rewrote every foreign key that
-- referenced `users` to reference `users_old`; the old table was then dropped,
-- leaving those references pointing at nothing. Any insert into a user-owned
-- table failed with "no such table: main.users_old".
--
-- 0006 is fixed, so a database built from scratch is already correct. This is
-- for the ones that were built before it was — production, which was migrated
-- while the bug was live and holds no data worth protecting but does hold the
-- schema.
--
-- The repair uses the same mechanism that caused the problem, in reverse.
-- Renaming `users` out of the way rewrites nothing, because after the bug
-- nothing references `users` any more. Renaming it back rewrites every
-- reference to `users_old` into a reference to `users` — which is exactly the
-- twenty-eight that need it.
--
-- Verified on throwaway tables before being written: a child's foreign key
-- followed the parent to `t_parent_old` and back to `t_parent`.
--
-- Idempotent. On a database that is already correct the first rename moves
-- the references to `users_old` and the second moves them back, ending where
-- it started. Nothing is dropped and no row is touched.

PRAGMA foreign_keys = OFF;

ALTER TABLE users RENAME TO users_old;
ALTER TABLE users_old RENAME TO users;

PRAGMA foreign_keys = ON;
