// AI Gym Coach — Cloudflare Worker
// Holds the Claude API key, stores workout history in D1, and asks Claude to plan sessions.

export const SPLITS = {
  ppl: ["push", "pull", "legs"],
  upper_lower: ["upper", "lower"],
  full_body: ["full_body_a", "full_body_b", "full_body_c"],
};

export const DEFAULT_SETTINGS = {
  split: "ppl",
  goal: "hypertrophy",
  experience: "intermediate",
  days_per_week: 4,
  units: "kg",
  gym_equipment:
    "Full commercial gym: barbells, dumbbells, squat rack, benches, cable stack, machines, pull-up bar",
  home_equipment: "Bodyweight only",
  notes: "",
};

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
const DEFAULT_MODEL = "claude-sonnet-5-5";

const PLAN_TOOL = {
  name: "submit_workout_plan",
  description: "Return the planned training session in structured form.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short session title, e.g. 'Push — heavy chest focus'" },
      split_day: { type: "string" },
      location: { type: "string", enum: ["gym", "home"] },
      estimated_minutes: { type: "integer" },
      warmup: { type: "string" },
      exercises: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Keep names identical to history for tracking" },
            equipment: { type: "string" },
            sets: { type: "integer" },
            reps: { type: "string", description: "Target reps, e.g. '8-10' or '12' or '30s'" },
            target_weight: {
              type: ["number", "null"],
              description: "Load per rep in the user's units; null for bodyweight",
            },
            rest_seconds: { type: "integer" },
            notes: { type: "string" },
          },
          required: ["name", "sets", "reps", "rest_seconds"],
        },
      },
      cooldown: { type: "string" },
      coach_notes: {
        type: "string",
        description: "2-4 sentences: progression vs. last session and what to focus on",
      },
    },
    required: ["title", "split_day", "location", "estimated_minutes", "exercises"],
  },
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health") return json({ ok: true }, 200, cors);
      if (!authorized(request, env)) return json({ error: "unauthorized" }, 401, cors);
      const body = await route(request, env, url);
      return json(body, 200, cors);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return json({ error: err.message || "internal error" }, status, cors);
    }
  },
};

// ---------- routing ----------

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === "/api/settings") {
    if (method === "GET") return getSettings(env);
    if (method === "PUT") return saveSettings(env, await readJson(request));
  }
  if (pathname === "/api/next" && method === "GET") {
    return nextSplitDay(env, await getSettings(env));
  }
  if (pathname === "/api/plan" && method === "POST") {
    return createPlan(env, await readJson(request));
  }
  if (pathname === "/api/workouts") {
    if (method === "GET") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 30);
      return { workouts: await listWorkouts(env, limit) };
    }
    if (method === "POST") return saveWorkout(env, await readJson(request));
  }
  const m = pathname.match(/^\/api\/workouts\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (method === "GET") {
      const w = await getWorkout(env, id);
      if (!w) throw httpError(404, "workout not found");
      return w;
    }
    if (method === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sets WHERE workout_id = ?").bind(id),
        env.DB.prepare("DELETE FROM workouts WHERE id = ?").bind(id),
      ]);
      return { deleted: id };
    }
  }
  if (pathname === "/api/stats" && method === "GET") return { lifts: await getStats(env) };
  if (pathname === "/api/diag" && method === "GET") {
    return { anthropic_key: describeKey(env.ANTHROPIC_API_KEY), model: env.MODEL || DEFAULT_MODEL };
  }

  throw httpError(404, "not found");
}

// ---------- settings ----------

async function getSettings(env) {
  const row = await env.DB.prepare("SELECT data FROM settings WHERE id = 1").first();
  const stored = row ? safeParse(row.data, {}) : {};
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

async function saveSettings(env, body) {
  const merged = sanitizeSettings({ ...(await getSettings(env)), ...body });
  await env.DB.prepare(
    "INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data"
  )
    .bind(JSON.stringify(merged))
    .run();
  return merged;
}

export function sanitizeSettings(input) {
  const out = {};
  for (const key of SETTINGS_KEYS) {
    let v = input[key] ?? DEFAULT_SETTINGS[key];
    if (typeof DEFAULT_SETTINGS[key] === "string") v = String(v).slice(0, 1000);
    out[key] = v;
  }
  if (!SPLITS[out.split]) out.split = DEFAULT_SETTINGS.split;
  if (!["kg", "lb"].includes(out.units)) out.units = "kg";
  out.days_per_week = clampInt(out.days_per_week, 1, 7, 4);
  return out;
}

// ---------- split rotation ----------

export async function nextSplitDay(env, settings) {
  const rotation = SPLITS[settings.split];
  const last = await env.DB.prepare(
    "SELECT split_day FROM workouts WHERE status = 'completed' ORDER BY date DESC, id DESC LIMIT 1"
  ).first();
  const lastDay = last?.split_day ?? null;
  const idx = rotation.indexOf(lastDay);
  const next = idx === -1 ? rotation[0] : rotation[(idx + 1) % rotation.length];
  return { split: settings.split, rotation, last: lastDay, next };
}

// ---------- planning ----------

async function createPlan(env, body) {
  if (!env.ANTHROPIC_API_KEY) throw httpError(500, "ANTHROPIC_API_KEY secret is not set");
  const location = body.location === "home" ? "home" : "gym";
  const minutes = clampInt(body.minutes, 15, 180, 60);
  const date = isIsoDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const userNotes = String(body.notes ?? "").slice(0, 500);

  const settings = await getSettings(env);
  const next = await nextSplitDay(env, settings);
  const splitDay =
    body.split_day && next.rotation.includes(body.split_day) ? body.split_day : next.next;

  const history = await listWorkouts(env, 12);
  const lifts = (await getStats(env)).slice(0, 40);

  const { system, user } = buildPrompt({ settings, location, minutes, splitDay, userNotes, history, lifts, date });
  const plan = await callClaude(env, system, user);
  plan.location = location;
  plan.split_day = splitDay;

  // drop stale, never-completed plans
  await env.DB.prepare(
    "DELETE FROM workouts WHERE status = 'planned' AND created_at < datetime('now', '-3 days')"
  ).run();

  const res = await env.DB.prepare(
    "INSERT INTO workouts (date, location, split_day, status, plan_json) VALUES (?, ?, ?, 'planned', ?)"
  )
    .bind(date, location, splitDay, JSON.stringify(plan))
    .run();

  return { id: res.meta.last_row_id, date, plan };
}

export function buildPrompt({ settings, location, minutes, splitDay, userNotes, history, lifts, date }) {
  const equipment = location === "gym" ? settings.gym_equipment : settings.home_equipment;
  const system = [
    "You are an experienced strength & conditioning coach planning ONE training session.",
    "Rules:",
    "- Use only the equipment available at the given location.",
    "- Apply progressive overload from the history: if all target reps were hit last time, add ~2.5-5% load or 1 rep; if reps were missed, keep or slightly reduce the load.",
    "- For bodyweight-only work, progress with reps, tempo, pauses or harder variations.",
    "- Fit the whole session (warm-up, working sets incl. rest, cool-down) into the time available; set estimated_minutes honestly.",
    "- Reuse exact exercise names from history when the same movement is used, so progress can be tracked.",
    "- Respect the athlete's notes (soreness, niggles, energy). Prefer safe substitutions over pushing through pain.",
    `- Weights are in ${settings.units}.`,
    "Always answer by calling the submit_workout_plan tool.",
  ].join("\n");

  const historyText = history.length
    ? history
        .map((w) => {
          const ex = w.exercises
            .map((e) => `  - ${e.name}: ${e.sets.map((s) => `${s.reps}x${s.weight ?? "BW"}${s.rpe ? `@${s.rpe}` : ""}`).join(", ")}`)
            .join("\n");
          return `${w.date} | ${w.split_day} | ${w.location}${w.duration_min ? ` | ${w.duration_min} min` : ""}${w.notes ? ` | notes: ${w.notes}` : ""}\n${ex || "  (no sets logged)"}`;
        })
        .join("\n")
    : "No workouts logged yet — choose conservative starting loads and say so in coach_notes.";

  const liftsText = lifts.length
    ? lifts.map((l) => `- ${l.exercise}: best ${l.max_weight ?? "BW"}, est. 1RM ${l.est_1rm ?? "-"}, last ${l.last_date}`).join("\n")
    : "none yet";

  const user = `Today: ${date}
Session to plan: ${splitDay} (split: ${settings.split}, rotation ${SPLITS[settings.split].join(" -> ")})
Location: ${location}
Equipment available: ${equipment}
Time available: ${minutes} minutes
Goal: ${settings.goal}; experience: ${settings.experience}; trains ${settings.days_per_week} days/week
General notes: ${settings.notes || "-"}
Notes for today: ${userNotes || "-"}

Recent completed workouts (newest first):
${historyText}

Best lifts:
${liftsText}`;

  return { system, user };
}

// Strip whitespace/newlines/quotes that often sneak in when pasting the secret.
export function cleanKey(raw) {
  return String(raw ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

// Safe fingerprint of the key for diagnostics (never the full key).
export function describeKey(raw) {
  const k = cleanKey(raw);
  if (!k) return "missing";
  const kind = k.startsWith("sk-ant-api") ? "API key" : k.startsWith("sk-ant-oat") ? "OAuth/subscription token (not usable here)" : "unknown format";
  return `${kind}, ${k.length} chars, starts "${k.slice(0, 12)}…", ends "…${k.slice(-4)}"`;
}

async function callClaude(env, system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": cleanKey(env.ANTHROPIC_API_KEY),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: 2500,
      system,
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: PLAN_TOOL.name },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    const hint = res.status === 401 ? ` | Worker key: ${describeKey(env.ANTHROPIC_API_KEY)}` : "";
    throw httpError(502, `Claude API error ${res.status}: ${text.slice(0, 300)}${hint}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === "tool_use");
  if (!block?.input?.exercises) throw httpError(502, "Claude did not return a plan");
  return block.input;
}

// ---------- workouts ----------

async function saveWorkout(env, body) {
  const exercises = Array.isArray(body.exercises) ? body.exercises : [];
  const date = isIsoDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const location = body.location === "home" ? "home" : "gym";
  const splitDay = String(body.split_day ?? "").slice(0, 50) || "custom";
  const notes = String(body.notes ?? "").slice(0, 1000);
  const duration = body.duration_min == null ? null : clampInt(body.duration_min, 0, 600, null);

  let id = Number(body.id) || null;
  if (id) {
    const exists = await env.DB.prepare("SELECT id FROM workouts WHERE id = ?").bind(id).first();
    if (!exists) id = null;
  }
  if (id) {
    await env.DB.prepare(
      "UPDATE workouts SET date = ?, location = ?, split_day = ?, status = 'completed', notes = ?, duration_min = ? WHERE id = ?"
    )
      .bind(date, location, splitDay, notes, duration, id)
      .run();
    await env.DB.prepare("DELETE FROM sets WHERE workout_id = ?").bind(id).run();
  } else {
    const res = await env.DB.prepare(
      "INSERT INTO workouts (date, location, split_day, status, notes, duration_min) VALUES (?, ?, ?, 'completed', ?, ?)"
    )
      .bind(date, location, splitDay, notes, duration)
      .run();
    id = res.meta.last_row_id;
  }

  const stmts = [];
  for (const ex of exercises.slice(0, 40)) {
    const name = String(ex.name ?? "").trim().slice(0, 100);
    if (!name || !Array.isArray(ex.sets)) continue;
    ex.sets.slice(0, 30).forEach((s, i) => {
      stmts.push(
        env.DB.prepare(
          "INSERT INTO sets (workout_id, exercise, set_index, reps, weight, rpe) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(id, name, i, clampInt(s.reps, 0, 1000, 0), numOrNull(s.weight), numOrNull(s.rpe))
      );
    });
  }
  if (stmts.length) await env.DB.batch(stmts);
  return getWorkout(env, id);
}

async function listWorkouts(env, limit) {
  const { results: rows } = await env.DB.prepare(
    "SELECT * FROM workouts WHERE status = 'completed' ORDER BY date DESC, id DESC LIMIT ?"
  )
    .bind(limit)
    .all();
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const { results: sets } = await env.DB.prepare(
    `SELECT * FROM sets WHERE workout_id IN (${ids.map(() => "?").join(",")}) ORDER BY workout_id, id`
  )
    .bind(...ids)
    .all();
  return rows.map((r) => shapeWorkout(r, sets.filter((s) => s.workout_id === r.id)));
}

async function getWorkout(env, id) {
  const row = await env.DB.prepare("SELECT * FROM workouts WHERE id = ?").bind(id).first();
  if (!row) return null;
  const { results: sets } = await env.DB.prepare("SELECT * FROM sets WHERE workout_id = ? ORDER BY id")
    .bind(id)
    .all();
  return shapeWorkout(row, sets);
}

function shapeWorkout(row, sets) {
  const byName = new Map();
  for (const s of sets) {
    if (!byName.has(s.exercise)) byName.set(s.exercise, []);
    byName.get(s.exercise).push({ reps: s.reps, weight: s.weight, rpe: s.rpe });
  }
  return {
    id: row.id,
    date: row.date,
    location: row.location,
    split_day: row.split_day,
    status: row.status,
    notes: row.notes,
    duration_min: row.duration_min,
    plan: row.plan_json ? safeParse(row.plan_json, null) : null,
    exercises: [...byName].map(([name, s]) => ({ name, sets: s })),
  };
}

async function getStats(env) {
  const { results } = await env.DB.prepare(
    `SELECT s.exercise,
            MAX(s.weight) AS max_weight,
            ROUND(MAX(s.weight * (1 + s.reps / 30.0)), 1) AS est_1rm,
            MAX(s.reps) AS max_reps,
            COUNT(*) AS total_sets,
            MAX(w.date) AS last_date
       FROM sets s JOIN workouts w ON w.id = s.workout_id
      WHERE w.status = 'completed'
      GROUP BY s.exercise
      ORDER BY last_date DESC, s.exercise`
  ).all();
  return results;
}

// ---------- helpers ----------

function authorized(request, env) {
  if (!env.APP_PASSPHRASE) throw httpError(500, "APP_PASSPHRASE secret is not set");
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(token, env.APP_PASSPHRASE);
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin");
  const allow = allowed.includes("*") ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "invalid JSON body");
  }
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function numOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isIsoDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function safeParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
