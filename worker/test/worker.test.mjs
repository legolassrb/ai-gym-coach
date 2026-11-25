// Offline test: runs the Worker against an in-memory SQLite "D1" and a mocked Claude API.
// Run: node --experimental-sqlite test/worker.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function fakeD1(...files) {
  const db = new DatabaseSync(":memory:");
  for (const f of files) db.exec(readFileSync(new URL(f, import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  // like D1, a batch is one transaction: any failing statement rolls back the whole batch
  const batch = async (stmts) => {
    db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      db.exec("COMMIT");
      return out;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
  return { db, prepare: (sql) => stmt(sql), batch };
}

const MIGRATIONS = ["../migrations/0000_initial.sql", "../migrations/0001_multi_user.sql", "../migrations/0002_plan_usage.sql"];
const env = { DB: fakeD1(...MIGRATIONS), APP_PASSPHRASE: "secret", ANTHROPIC_API_KEY: "sk-test", ALLOWED_ORIGINS: "https://x.github.io", PLAN_DAILY_LIMIT: "3" };
let lastClaudeRequest;
globalThis.fetch = async (url, init) => {
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  lastClaudeRequest = JSON.parse(init.body);
  return new Response(
    JSON.stringify({
      content: [
        {
          type: "tool_use",
          name: "submit_workout_plan",
          input: {
            title: "Push day",
            split_day: "push",
            location: "gym",
            estimated_minutes: 55,
            exercises: [{ name: "Bench Press", movement: "horizontal_press", sets: 3, reps: "8", target_weight: 62.5, rest_seconds: 120 }],
          },
        },
      ],
    }),
    { status: 200 }
  );
};

const call = async (method, path, body, token) => {
  const res = await worker.fetch(
    new Request("https://api.test" + path, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: "https://x.github.io", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
};

// ---------- accounts ----------
assert.equal((await call("GET", "/api/health")).status, 200);
assert.equal((await call("GET", "/api/settings")).status, 401);
assert.equal((await call("GET", "/api/settings", null, "bogus")).status, 401);

assert.equal((await call("POST", "/api/auth/register", { username: "x", password: "longenough" })).status, 400);
assert.equal((await call("POST", "/api/auth/register", { username: "alice", password: "short" })).status, 400);
assert.equal((await call("POST", "/api/auth/register", { username: "boss", password: "longenough", admin_code: "nope" })).status, 403);

let r = await call("POST", "/api/auth/register", { username: "Boss", password: "admin-pass-1", admin_code: "secret" });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.deepEqual(r.body.user, { id: 1, username: "boss", role: "admin" });
const admin = r.body.token;

r = await call("POST", "/api/auth/register", { username: "alice", password: "alice-pass-1" });
assert.equal(r.body.user.role, "user");
let alice = r.body.token;
assert.equal((await call("POST", "/api/auth/register", { username: "ALICE", password: "whatever-1" })).status, 409);
r = await call("POST", "/api/auth/register", { username: "bob", password: "bob-pass-12" });
const bob = r.body.token;
const bobId = r.body.user.id;

assert.equal((await call("POST", "/api/auth/login", { username: "alice", password: "wrong-pass" })).status, 401);
assert.equal((await call("POST", "/api/auth/login", { username: "nobody", password: "wrong-pass" })).status, 401);
r = await call("POST", "/api/auth/login", { username: "Alice", password: "alice-pass-1" });
assert.equal(r.status, 200);
assert.equal((await call("POST", "/api/auth/logout", null, alice)).status, 200);
assert.equal((await call("GET", "/api/me", null, alice)).status, 401, "logged-out token is dead");
alice = r.body.token;
assert.equal((await call("GET", "/api/me", null, alice)).body.username, "alice");

// ---------- settings (per user) ----------
r = await call("GET", "/api/settings", null, alice);
assert.equal(r.body.split, "ppl");
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://x.github.io");
r = await call("PUT", "/api/settings", { split: "bogus", units: "kg", home_equipment: "2x 20kg dumbbells, bands" }, alice);
assert.equal(r.body.split, "ppl");
assert.equal(r.body.home_equipment, "2x 20kg dumbbells, bands");
assert.equal((await call("GET", "/api/settings", null, bob)).body.home_equipment, "Bodyweight only", "settings are per user");

// rotation starts at push
assert.equal((await call("GET", "/api/next", null, alice)).body.next, "push");

// ---------- plan ----------
r = await call("POST", "/api/plan", { location: "gym", minutes: 60, date: "2026-11-20", notes: "left shoulder a bit tight" }, alice);
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.plan.split_day, "push");
assert.equal(r.body.plan.exercises[0].movement, "horizontal_press");
assert.equal(lastClaudeRequest.tool_choice.type, "auto");
assert.equal(lastClaudeRequest.tools[0].name, "submit_workout_plan");
assert.ok(lastClaudeRequest.tools[0].input_schema.properties.exercises.items.properties.movement.enum.includes("squat"));
assert.match(lastClaudeRequest.messages[0].content, /left shoulder a bit tight/);
const planId = r.body.id;

// planned workout is not in history yet
assert.equal((await call("GET", "/api/workouts", null, alice)).body.workouts.length, 0);

// bob can't complete alice's planned workout; it becomes a new workout of his instead
r = await call("POST", "/api/workouts", { id: planId, date: "2026-11-19", split_day: "legs", exercises: [{ name: "Squat", sets: [{ reps: 5, weight: 100 }] }] }, bob);
assert.notEqual(r.body.id, planId);
const bobWorkout = r.body.id;

// complete it
r = await call("POST", "/api/workouts", {
  id: planId,
  date: "2026-11-20",
  location: "gym",
  split_day: "push",
  duration_min: 52,
  exercises: [{ name: "Bench Press", sets: [{ reps: 8, weight: 62.5 }, { reps: 8, weight: 62.5 }, { reps: 7, weight: 62.5, rpe: 9 }] }],
}, alice);
assert.equal(r.status, 200);
assert.equal(r.body.id, planId);
assert.equal(r.body.status, "completed");
assert.equal(r.body.exercises[0].sets.length, 3);
assert.ok(r.body.plan, "plan kept on completed workout");

// rotation advances, history + stats feed next prompt — only alice's own
assert.equal((await call("GET", "/api/next", null, alice)).body.next, "pull");
r = await call("GET", "/api/stats", null, alice);
assert.equal(r.body.lifts.length, 1);
assert.equal(r.body.lifts[0].exercise, "Bench Press");
assert.equal(r.body.lifts[0].max_weight, 62.5);
await call("POST", "/api/plan", { location: "home", minutes: 30 }, alice);
assert.match(lastClaudeRequest.messages[0].content, /Bench Press: 8x62.5, 8x62.5, 7x62.5@9/);
assert.doesNotMatch(lastClaudeRequest.messages[0].content, /Squat/);
assert.match(lastClaudeRequest.messages[0].content, /Session to plan: pull/);
assert.match(lastClaudeRequest.messages[0].content, /2x 20kg dumbbells/);

// daily plan limit (3) for users, not admins
assert.equal((await call("POST", "/api/plan", {}, alice)).status, 200);
assert.equal((await call("POST", "/api/plan", {}, alice)).status, 429);
for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/api/plan", {}, admin)).status, 200);

// deleting plans doesn't hand back the daily limit
{
  const planned = env.DB.db.prepare("SELECT id FROM workouts WHERE user_id = 2 AND status = 'planned'").all();
  assert.ok(planned.length >= 2);
  for (const { id } of planned) assert.equal((await call("DELETE", `/api/workouts/${id}`, null, alice)).status, 200);
  assert.equal((await call("POST", "/api/plan", {}, alice)).status, 429, "limit survives deleting plans");
}

// a failed Claude call doesn't use up a plan
{
  const carol = (await call("POST", "/api/auth/register", { username: "carol", password: "carol-pass-1" })).body.token;
  const okFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("overloaded", { status: 529 });
  for (let i = 0; i < 4; i++) assert.equal((await call("POST", "/api/plan", {}, carol)).status, 502);
  globalThis.fetch = okFetch;
  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/api/plan", {}, carol)).status, 200, "failed calls didn't count");
  assert.equal((await call("POST", "/api/plan", {}, carol)).status, 429);
}

// saving a workout is atomic: a failure mid-save leaves no completed workout without its sets
{
  const realBatch = env.DB.batch;
  env.DB.batch = (stmts) => realBatch([...stmts, { run: async () => { throw new Error("D1 hiccup"); } }]);
  const before = (await call("GET", "/api/workouts?limit=200", null, alice)).body.workouts.length;
  r = await call("POST", "/api/workouts", { date: "2026-11-22", split_day: "legs", exercises: [{ name: "Squat", sets: [{ reps: 5, weight: 100 }] }] }, alice);
  assert.equal(r.status, 500);
  // re-completing an existing planned workout rolls back too
  const { id: plannedId } = env.DB.db.prepare("SELECT id FROM workouts WHERE user_id = 1 AND status = 'planned' LIMIT 1").get();
  r = await call("POST", "/api/workouts", { id: plannedId, split_day: "push", exercises: [{ name: "Bench Press", sets: [{ reps: 5, weight: 80 }] }] }, admin);
  assert.equal(r.status, 500);
  env.DB.batch = realBatch;
  assert.equal((await call("GET", "/api/workouts?limit=200", null, alice)).body.workouts.length, before, "no half-saved workout in history");
  assert.equal(env.DB.db.prepare("SELECT status FROM workouts WHERE id = ?").get(plannedId).status, "planned", "update rolled back");
  assert.equal(env.DB.db.prepare("SELECT COUNT(*) AS n FROM sets s JOIN workouts w ON w.id = s.workout_id WHERE w.status = 'planned'").get().n, 0);
}

// ---------- progress ----------
await call("POST", "/api/workouts", { date: "2026-11-24", split_day: "push", exercises: [{ name: "Bench Press", sets: [{ reps: 5, weight: 70 }] }] }, alice);
r = await call("GET", "/api/progress", null, alice);
assert.equal(r.body.totals.workouts, 2);
assert.equal(r.body.exercise, "Bench Press");
assert.deepEqual(r.body.series.map((p) => p.date), ["2026-11-20", "2026-11-24"]);
assert.equal(r.body.series[1].top_weight, 70);
assert.deepEqual(r.body.weekly.map((w) => w.week), ["2026-11-16", "2026-11-23"]);
assert.equal(r.body.weekly[0].volume, Math.round(8 * 62.5 * 2 + 7 * 62.5));
assert.equal(r.body.units, "kg");
assert.equal((await call("GET", "/api/progress?exercise=Squat", null, alice)).body.exercise, "Bench Press", "can't peek at others' exercises");

// ---------- permissions ----------
assert.equal((await call("GET", `/api/workouts/${planId}`, null, bob)).status, 404);
assert.equal((await call("DELETE", `/api/workouts/${planId}`, null, bob)).status, 404);
assert.equal((await call("GET", "/api/admin/users", null, alice)).status, 403);
assert.equal((await call("GET", "/api/diag", null, alice)).status, 403);

// users delete their own logs
assert.equal((await call("DELETE", `/api/workouts/${bobWorkout}`, null, bob)).status, 200);
assert.equal((await call("GET", "/api/workouts", null, bob)).body.workouts.length, 0);

// ---------- admin ----------
r = await call("GET", "/api/admin/users", null, admin);
assert.deepEqual(r.body.users.map((u) => [u.username, u.role, u.workouts]), [["boss", "admin", 0], ["alice", "user", 2], ["bob", "user", 0], ["carol", "user", 0]]);
r = await call("GET", "/api/admin/workouts", null, admin);
assert.equal(r.body.workouts.length, 2);
assert.equal(r.body.workouts[0].username, "alice");
assert.equal((await call("GET", `/api/admin/workouts?user_id=${bobId}`, null, admin)).body.workouts.length, 0);

assert.equal((await call("DELETE", `/api/workouts/${planId}`, null, admin)).status, 200, "admin deletes any log");
assert.equal((await call("GET", "/api/workouts", null, alice)).body.workouts.length, 1);

assert.equal((await call("PUT", "/api/admin/users/1", { role: "user" }, admin)).status, 400, "no self-demotion");
assert.equal((await call("PUT", `/api/admin/users/${bobId}`, { role: "root" }, admin)).status, 400);
assert.equal((await call("PUT", `/api/admin/users/${bobId}`, { role: "admin" }, admin)).body.role, "admin");
assert.equal((await call("GET", "/api/admin/users", null, bob)).status, 200, "role change applies to live session");
assert.equal((await call("DELETE", `/api/admin/users/${bobId}`, null, admin)).status, 200);
assert.equal((await call("GET", "/api/me", null, bob)).status, 401, "deleted user's session is gone");

// key diagnostics + cleaning
r = await call("GET", "/api/diag", null, admin);
assert.match(r.body.anthropic_key, /unknown format, 7 chars/);
const { cleanKey, describeKey } = await import("../src/index.js");
assert.equal(cleanKey(' "sk-ant-api03-abc"\n'), "sk-ant-api03-abc");
assert.match(describeKey("sk-ant-oat01-xyz"), /OAuth/);
assert.equal((await call("GET", "/api/nope", null, alice)).status, 404);

// ---------- migration: old single-user DB keeps its data ----------
{
  const legacy = fakeD1(MIGRATIONS[0]);
  legacy.db.exec(`INSERT INTO settings (id, data) VALUES (1, '{"split":"upper_lower","units":"lb"}');
    INSERT INTO workouts (date, location, split_day, status) VALUES ('2026-11-01', 'gym', 'upper', 'completed');
    INSERT INTO sets (workout_id, exercise, set_index, reps, weight) VALUES (1, 'Row', 0, 10, 60);`);
  for (const m of MIGRATIONS.slice(1)) legacy.db.exec(readFileSync(new URL(m, import.meta.url), "utf8"));
  const saved = env.DB;
  env.DB = legacy;
  const first = (await call("POST", "/api/auth/register", { username: "owner", password: "owner-pass-1", admin_code: "secret" })).body.token;
  assert.equal((await call("GET", "/api/workouts", null, first)).body.workouts[0].exercises[0].name, "Row");
  assert.equal((await call("GET", "/api/settings", null, first)).body.split, "upper_lower");
  const second = (await call("POST", "/api/auth/register", { username: "admin2", password: "admin-pass-2", admin_code: "secret" })).body.token;
  assert.equal((await call("GET", "/api/workouts", null, second)).body.workouts.length, 0, "only the first admin claims old data");
  env.DB = saved;
}

console.log("All worker tests passed ✔");
