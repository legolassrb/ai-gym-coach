-- Ledger of Claude plan requests for the daily limit. Kept apart from workouts so that
-- deleting a planned or completed workout doesn't hand the request back.
CREATE TABLE IF NOT EXISTS plan_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_usage_user ON plan_usage(user_id, created_at);

-- Carry over today's plans so the limit holds across the deploy.
INSERT INTO plan_usage (user_id, created_at)
  SELECT user_id, created_at FROM workouts
   WHERE user_id IS NOT NULL AND plan_json IS NOT NULL AND created_at > datetime('now', '-1 day');
