// Offline test: runs the Worker against an in-memory SQLite "D1" and a mocked Claude API.
// Run: node --experimental-sqlite test/worker.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return { prepare: (sql) => stmt(sql), batch: async (stmts) => Promise.all(stmts.map((s) => s.run())) };
}

const env = { DB: fakeD1(), APP_PASSPHRASE: "secret", ANTHROPIC_API_KEY: "sk-test", ALLOWED_ORIGINS: "https://x.github.io" };
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
            exercises: [{ name: "Bench Press", sets: 3, reps: "8", target_weight: 62.5, rest_seconds: 120 }],
          },
        },
      ],
    }),
    { status: 200 }
  );
};

const call = async (method, path, body, token = "secret") => {
  const res = await worker.fetch(
    new Request("https://api.test" + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, Origin: "https://x.github.io", "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env
  );
  return { status: res.status, body: await res.json(), headers: res.headers };
};

// auth
assert.equal((await call("GET", "/api/settings", null, "wrong")).status, 401);
assert.equal((await call("GET", "/api/health", null, "wrong")).status, 200);

// settings
let r = await call("GET", "/api/settings");
assert.equal(r.body.split, "ppl");
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://x.github.io");
r = await call("PUT", "/api/settings", { split: "bogus", units: "kg", home_equipment: "2x 20kg dumbbells, bands" });
assert.equal(r.body.split, "ppl");
assert.equal(r.body.home_equipment, "2x 20kg dumbbells, bands");

// rotation starts at push
r = await call("GET", "/api/next");
assert.equal(r.body.next, "push");

// plan
r = await call("POST", "/api/plan", { location: "gym", minutes: 60, date: "2026-11-20", notes: "left shoulder a bit tight" });
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.plan.split_day, "push");
assert.equal(lastClaudeRequest.tool_choice.name, "submit_workout_plan");
assert.match(lastClaudeRequest.messages[0].content, /left shoulder a bit tight/);
const planId = r.body.id;

// planned workout is not in history yet
assert.equal((await call("GET", "/api/workouts")).body.workouts.length, 0);

// complete it
r = await call("POST", "/api/workouts", {
  id: planId,
  date: "2026-11-20",
  location: "gym",
  split_day: "push",
  duration_min: 52,
  exercises: [{ name: "Bench Press", sets: [{ reps: 8, weight: 62.5 }, { reps: 8, weight: 62.5 }, { reps: 7, weight: 62.5, rpe: 9 }] }],
});
assert.equal(r.status, 200);
assert.equal(r.body.status, "completed");
assert.equal(r.body.exercises[0].sets.length, 3);
assert.ok(r.body.plan, "plan kept on completed workout");

// rotation advances, history + stats feed next prompt
assert.equal((await call("GET", "/api/next")).body.next, "pull");
r = await call("GET", "/api/stats");
assert.equal(r.body.lifts[0].exercise, "Bench Press");
assert.equal(r.body.lifts[0].max_weight, 62.5);
await call("POST", "/api/plan", { location: "home", minutes: 30 });
assert.match(lastClaudeRequest.messages[0].content, /Bench Press: 8x62.5, 8x62.5, 7x62.5@9/);
assert.match(lastClaudeRequest.messages[0].content, /Session to plan: pull/);
assert.match(lastClaudeRequest.messages[0].content, /2x 20kg dumbbells/);

// key diagnostics + cleaning
r = await call("GET", "/api/diag");
assert.match(r.body.anthropic_key, /unknown format, 7 chars/);
const { cleanKey, describeKey } = await import("../src/index.js");
assert.equal(cleanKey(' "sk-ant-api03-abc"\n'), "sk-ant-api03-abc");
assert.match(describeKey("sk-ant-oat01-xyz"), /OAuth/);

// delete
r = await call("DELETE", `/api/workouts/${planId}`);
assert.equal((await call("GET", "/api/workouts")).body.workouts.length, 0);
assert.equal((await call("GET", "/api/nope")).status, 404);

console.log("All worker tests passed ✔");
