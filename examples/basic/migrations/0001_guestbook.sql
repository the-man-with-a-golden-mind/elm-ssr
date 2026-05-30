-- The schema for the /guestbook route's `query`/`execute` effects.
-- Portable enough for SQLite and Postgres (`INTEGER PRIMARY KEY` auto-increments
-- in SQLite; in Postgres it's just a primary key — use `SERIAL`/`IDENTITY` if
-- you want server-side sequence generation).

CREATE TABLE entries (
  id INTEGER PRIMARY KEY,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);
