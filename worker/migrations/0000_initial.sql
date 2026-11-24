CREATE TABLE IF NOT EXISTS settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workouts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  date         TEXT NOT NULL,                 -- YYYY-MM-DD
  location     TEXT NOT NULL,                 -- gym | home
  split_day    TEXT NOT NULL,                 -- push, pull, legs, upper, ...
  status       TEXT NOT NULL DEFAULT 'completed', -- planned | completed
  plan_json    TEXT,                          -- plan returned by Claude
  notes        TEXT,
  duration_min INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise   TEXT NOT NULL,
  set_index  INTEGER NOT NULL,
  reps       INTEGER NOT NULL,
  weight     REAL,                            -- NULL = bodyweight
  rpe        REAL
);

CREATE INDEX IF NOT EXISTS idx_workouts_status_date ON workouts(status, date);
CREATE INDEX IF NOT EXISTS idx_sets_workout ON sets(workout_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise ON sets(exercise);
