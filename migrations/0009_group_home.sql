-- The group itself.
--
-- This application has exactly one group and one conversation in it — that is
-- a product fact, not a limitation waiting to be lifted, and every screen is
-- built around it. Both rows are therefore structure rather than data: they
-- carry no personal information, name nobody, and exist so that membership,
-- posts and messages have something to point at on a database that has never
-- had a user in it.
--
-- Fixed ids, because the application refers to them by name. `created_by` is
-- left null: the group predates every account, and attributing it to whoever
-- happens to sign up first would be a lie the schema then has to carry.
--
-- Safe to apply to an empty production database. It seeds no people, no
-- workouts, no posts and no messages.

INSERT INTO groups (id, name, created_by, created_at)
VALUES ('grp_circuit', 'Circuit', NULL, '2026-01-01T00:00:00.000Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO conversations (id, group_id, title, created_at)
VALUES ('cnv_circuit', 'grp_circuit', 'Circuit', '2026-01-01T00:00:00.000Z')
ON CONFLICT(id) DO NOTHING;
