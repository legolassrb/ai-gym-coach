-- Multi-user accounts with roles. Existing single-user data (user_id IS NULL, settings id = 1)
-- is claimed by the first admin account created with the admin code.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,            -- lowercase
  password_hash TEXT NOT NULL,                   -- pbkdf2$<iterations>$<salt>$<hash>
  role          TEXT NOT NULL DEFAULT 'user',    -- user | admin
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,                   -- sha-256 of the bearer token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data    TEXT NOT NULL
);

ALTER TABLE workouts ADD COLUMN user_id INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, status, date);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
