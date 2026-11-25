// AI Gym Coach — Cloudflare Worker
// Holds the Claude API key, stores per-user workout history in D1, and asks Claude to plan sessions.

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

// Movement patterns the frontend has a sketch for.
export const MOVEMENTS = [
  "squat", "hinge", "lunge", "horizontal_press", "vertical_press", "push_up", "horizontal_pull",
  "vertical_pull", "curl", "triceps", "lateral_raise", "calf", "core", "carry", "cardio", "mobility",
];

const SETTINGS_KEYS = Object.keys(DEFAULT_SETTINGS);
const DEFAULT_MODEL = "claude-sonnet-5-5";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100000; // Workers cap PBKDF2 at 100k iterations
const DEFAULT_PLAN_DAILY_LIMIT = 20;

const PLAN_TOOL = {
  name: "submit_workout_plan",
  description: "Return the planned training session in structured form.",
  strict: true,
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
            movement: { type: "string", enum: MOVEMENTS, description: "Closest movement pattern; picks the exercise sketch" },
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
          required: ["name", "movement", "sets", "reps", "rest_seconds"],
          additionalProperties: false,
        },
      },
      cooldown: { type: "string" },
      coach_notes: {
        type: "string",
        description: "2-4 sentences: progression vs. last session and what to focus on",
      },
    },
    required: ["title", "split_day", "location", "estimated_minutes", "exercises"],
    additionalProperties: false,
  },
};

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/health") return json({ ok: true }, 200, cors);
      const user = await currentUser(request, env);
      const body = await route(request, env, url, user);
      return json(body, 200, cors);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return json({ error: err.message || "internal error" }, status, cors);
    }
  },
};

// ---------- routing ----------

async function route(request, env, url, user) {
  const { pathname } = url;
  const method = request.method;

  // public
  if (pathname === "/api/auth/register" && method === "POST") return register(env, await readJson(request));
  if (pathname === "/api/auth/login" && method === "POST") return login(env, await readJson(request));

  if (!user) throw httpError(401, "unauthorized");

  if (pathname === "/api/auth/logout" && method === "POST") {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(bearer(request))).run();
    return { ok: true };
  }
  if (pathname === "/api/me" && method === "GET") return publicUser(user);

  if (pathname === "/api/settings") {
    if (method === "GET") return getSettings(env, user.id);
    if (method === "PUT") return saveSettings(env, user.id, await readJson(request));
  }
  if (pathname === "/api/next" && method === "GET") {
    return nextSplitDay(env, user.id, await getSettings(env, user.id));
  }
  if (pathname === "/api/plan" && method === "POST") {
    return createPlan(env, user, await readJson(request));
  }
  if (pathname === "/api/workouts") {
    if (method === "GET") {
      const limit = clampInt(url.searchParams.get("limit"), 1, 200, 30);
      return { workouts: await listWorkouts(env, user.id, limit) };
    }
    if (method === "POST") return saveWorkout(env, user.id, await readJson(request));
  }
  const m = pathname.match(/^\/api\/workouts\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    const w = await getWorkout(env, id);
    // users only see their own logs; admins can manage everyone's
    if (!w || (w.user_id !== user.id && user.role !== "admin")) throw httpError(404, "workout not found");
    if (method === "GET") return w;
    if (method === "DELETE") {
      await deleteWorkouts(env, "id = ?", id);
      return { deleted: id };
    }
  }
  if (pathname === "/api/stats" && method === "GET") return { lifts: await getStats(env, user.id) };
  if (pathname === "/api/progress" && method === "GET") {
    return getProgress(env, user.id, url.searchParams.get("exercise"));
  }

  // admin
  if (pathname.startsWith("/api/admin/") || pathname === "/api/diag") {
    if (user.role !== "admin") throw httpError(403, "admin only");
  }
  if (pathname === "/api/diag" && method === "GET") {
    return { anthropic_key: describeKey(env.ANTHROPIC_API_KEY), model: env.MODEL || DEFAULT_MODEL };
  }
  if (pathname === "/api/admin/users" && method === "GET") return { users: await listUsers(env) };
  if (pathname === "/api/admin/workouts" && method === "GET") {
    const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
    const userId = url.searchParams.get("user_id") ? Number(url.searchParams.get("user_id")) : null;
    return { workouts: await listWorkouts(env, userId, limit) };
  }
  const um = pathname.match(/^\/api\/admin\/users\/(\d+)$/);
  if (um) {
    const id = Number(um[1]);
    if (id === user.id) throw httpError(400, "you can't change or delete your own account here");
    const target = await env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
    if (!target) throw httpError(404, "user not found");
    if (method === "PUT") {
      const { role } = await readJson(request);
      if (!["user", "admin"].includes(role)) throw httpError(400, "role must be user or admin");
      await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, id).run();
      return { id, role };
    }
    if (method === "DELETE") {
      await deleteWorkouts(env, "user_id = ?", id);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
        env.DB.prepare("DELETE FROM user_settings WHERE user_id = ?").bind(id),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
      ]);
      return { deleted: id };
    }
  }

  throw httpError(404, "not found");
}

// ---------- accounts ----------

function normUsername(v) {
  const u = String(v ?? "").trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(u)) throw httpError(400, "username must be 3-32 characters: letters, digits, _ . -");
  return u;
}

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role };
}

async function register(env, body) {
  const username = normUsername(body.username);
  const password = String(body.password ?? "");
  if (password.length < 8) throw httpError(400, "password must be at least 8 characters");
  const adminCode = String(body.admin_code ?? "");
  if (adminCode && !(env.APP_PASSPHRASE && timingSafeEqual(adminCode, env.APP_PASSPHRASE))) {
    throw httpError(403, "wrong admin code");
  }
  const role = adminCode ? "admin" : "user";
  if (await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first()) {
    throw httpError(409, "username is taken");
  }
  const res = await env.DB.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)")
    .bind(username, await hashPassword(password), role)
    .run();
  const user = { id: res.meta.last_row_id, username, role };
  if (role === "admin") await claimLegacyData(env, user.id);
  return createSession(env, user);
}

// Data from the single-user version (no owner) goes to the first admin.
async function claimLegacyData(env, userId) {
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
  if (n !== 1) return;
  await env.DB.batch([
    env.DB.prepare("UPDATE workouts SET user_id = ? WHERE user_id IS NULL").bind(userId),
    env.DB.prepare("INSERT OR IGNORE INTO user_settings (user_id, data) SELECT ?, data FROM settings WHERE id = 1").bind(userId),
  ]);
}

async function login(env, body) {
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  // hash even for unknown users so response time doesn't reveal which usernames exist
  const ok = row ? await verifyPassword(password, row.password_hash) : (await hashPassword(password), false);
  if (!ok) throw httpError(401, "wrong username or password");
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  return createSession(env, row);
}

async function createSession(env, user) {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))")
    .bind(await sha256Hex(token), user.id, `+${SESSION_DAYS} days`)
    .run();
  return { token, user: publicUser(user) };
}

async function currentUser(request, env) {
  const token = bearer(request);
  if (!token) return null;
  return env.DB.prepare(
    `SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > datetime('now')`
  )
    .bind(await sha256Hex(token))
    .first();
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.username, u.role, u.created_at,
            COUNT(w.id) AS workouts, MAX(w.date) AS last_date
       FROM users u LEFT JOIN workouts w ON w.user_id = u.id AND w.status = 'completed'
      GROUP BY u.id
      ORDER BY u.created_at, u.id`
  ).all();
  return results;
}

// ---------- settings ----------

async function getSettings(env, userId) {
  const row = await env.DB.prepare("SELECT data FROM user_settings WHERE user_id = ?").bind(userId).first();
  const stored = row ? safeParse(row.data, {}) : {};
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...stored });
}

async function saveSettings(env, userId, body) {
  const merged = sanitizeSettings({ ...(await getSettings(env, userId)), ...body });
  await env.DB.prepare(
    "INSERT INTO user_settings (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data"
  )
    .bind(userId, JSON.stringify(merged))
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

export async function nextSplitDay(env, userId, settings) {
  const rotation = SPLITS[settings.split];
  const last = await env.DB.prepare(
    "SELECT split_day FROM workouts WHERE user_id = ? AND status = 'completed' ORDER BY date DESC, id DESC LIMIT 1"
  )
    .bind(userId)
    .first();
  const lastDay = last?.split_day ?? null;
  const idx = rotation.indexOf(lastDay);
  const next = idx === -1 ? rotation[0] : rotation[(idx + 1) % rotation.length];
  return { split: settings.split, rotation, last: lastDay, next };
}

// ---------- planning ----------

async function createPlan(env, user, body) {
  if (!env.ANTHROPIC_API_KEY) throw httpError(500, "ANTHROPIC_API_KEY secret is not set");
  const location = body.location === "home" ? "home" : "gym";
  const minutes = clampInt(body.minutes, 15, 180, 60);
  const date = isIsoDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const userNotes = String(body.notes ?? "").slice(0, 500);

  const settings = await getSettings(env, user.id);
  const next = await nextSplitDay(env, user.id, settings);
  const splitDay =
    body.split_day && next.rotation.includes(body.split_day) ? body.split_day : next.next;

  const history = await listWorkouts(env, user.id, 12);
  const lifts = (await getStats(env, user.id)).slice(0, 40);

  const { system, user: prompt } = buildPrompt({ settings, location, minutes, splitDay, userNotes, history, lifts, date });
  const usageId = await reservePlan(env, user);
  let plan;
  try {
    plan = await callClaude(env, system, prompt);
  } catch (err) {
    // a failed Claude call doesn't use up one of the user's daily plans
    if (usageId) await env.DB.prepare("DELETE FROM plan_usage WHERE id = ?").bind(usageId).run();
    throw err;
  }
  plan.location = location;
  plan.split_day = splitDay;

  // drop stale, never-completed plans and usage rows the daily limit no longer looks at
  await env.DB.batch([
    env.DB.prepare("DELETE FROM workouts WHERE status = 'planned' AND created_at < datetime('now', '-3 days')"),
    env.DB.prepare("DELETE FROM plan_usage WHERE created_at < datetime('now', '-2 days')"),
  ]);

  const res = await env.DB.prepare(
    "INSERT INTO workouts (user_id, date, location, split_day, status, plan_json) VALUES (?, ?, ?, ?, 'planned', ?)"
  )
    .bind(user.id, date, location, splitDay, JSON.stringify(plan))
    .run();

  return { id: res.meta.last_row_id, date, plan };
}

// Sign-up is open, so cap Claude calls per user. Usage lives in its own table: deleting a
// workout must not give the request back. The row is reserved before the call so parallel
// requests can't all slip under the limit. Returns the usage row id (null for admins).
async function reservePlan(env, user) {
  if (user.role === "admin") return null;
  const limit = clampInt(env.PLAN_DAILY_LIMIT, 0, 1000, DEFAULT_PLAN_DAILY_LIMIT);
  const res = await env.DB.prepare(
    `INSERT INTO plan_usage (user_id)
       SELECT ?1 WHERE (SELECT COUNT(*) FROM plan_usage WHERE user_id = ?1 AND created_at > datetime('now', '-1 day')) < ?2`
  )
    .bind(user.id, limit)
    .run();
  if (!res.meta.changes) throw httpError(429, `daily limit of ${limit} plans reached, try again tomorrow`);
  return res.meta.last_row_id;
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
      // room for adaptive thinking before the tool call
      max_tokens: 16000,
      system,
      tools: [PLAN_TOOL],
      // newer models reject forced tool_choice; the system prompt names the tool instead
      tool_choice: { type: "auto" },
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

async function saveWorkout(env, userId, body) {
  const exercises = Array.isArray(body.exercises) ? body.exercises : [];
  const date = isIsoDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  const location = body.location === "home" ? "home" : "gym";
  const splitDay = String(body.split_day ?? "").slice(0, 50) || "custom";
  const notes = String(body.notes ?? "").slice(0, 1000);
  const duration = body.duration_min == null ? null : clampInt(body.duration_min, 0, 600, null);

  let id = Number(body.id) || null;
  if (id) {
    const exists = await env.DB.prepare("SELECT id FROM workouts WHERE id = ? AND user_id = ?").bind(id, userId).first();
    if (!exists) id = null;
  }
  if (!id) {
    // New workouts start as an empty 'planned' row so the completing batch below has an id.
    // If that batch fails, the row stays invisible and the stale-plan cleanup removes it.
    const res = await env.DB.prepare(
      "INSERT INTO workouts (user_id, date, location, split_day, status) VALUES (?, ?, ?, ?, 'planned')"
    )
      .bind(userId, date, location, splitDay)
      .run();
    id = res.meta.last_row_id;
  }

  // One batch = one transaction: the workout is never left completed with missing sets.
  const stmts = [
    env.DB.prepare(
      "UPDATE workouts SET date = ?, location = ?, split_day = ?, status = 'completed', notes = ?, duration_min = ? WHERE id = ?"
    ).bind(date, location, splitDay, notes, duration, id),
    env.DB.prepare("DELETE FROM sets WHERE workout_id = ?").bind(id),
  ];
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
  await env.DB.batch(stmts);
  return getWorkout(env, id);
}

// userId null = every user's workouts (admin view)
async function listWorkouts(env, userId, limit) {
  const { results: rows } = await env.DB.prepare(
    `SELECT w.*, u.username FROM workouts w LEFT JOIN users u ON u.id = w.user_id
      WHERE w.status = 'completed' AND (?1 IS NULL OR w.user_id = ?1)
      ORDER BY w.date DESC, w.id DESC LIMIT ?2`
  )
    .bind(userId, limit)
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
  const row = await env.DB.prepare(
    "SELECT w.*, u.username FROM workouts w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = ?"
  )
    .bind(id)
    .first();
  if (!row) return null;
  const { results: sets } = await env.DB.prepare("SELECT * FROM sets WHERE workout_id = ? ORDER BY id")
    .bind(id)
    .all();
  return shapeWorkout(row, sets);
}

async function deleteWorkouts(env, where, value) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sets WHERE workout_id IN (SELECT id FROM workouts WHERE ${where})`).bind(value),
    env.DB.prepare(`DELETE FROM workouts WHERE ${where}`).bind(value),
  ]);
}

function shapeWorkout(row, sets) {
  const byName = new Map();
  for (const s of sets) {
    if (!byName.has(s.exercise)) byName.set(s.exercise, []);
    byName.get(s.exercise).push({ reps: s.reps, weight: s.weight, rpe: s.rpe });
  }
  return {
    id: row.id,
    user_id: row.user_id,
    username: row.username ?? null,
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

async function getStats(env, userId) {
  const { results } = await env.DB.prepare(
    `SELECT s.exercise,
            MAX(s.weight) AS max_weight,
            ROUND(MAX(s.weight * (1 + s.reps / 30.0)), 1) AS est_1rm,
            MAX(s.reps) AS max_reps,
            COUNT(*) AS total_sets,
            MAX(w.date) AS last_date
       FROM sets s JOIN workouts w ON w.id = s.workout_id
      WHERE w.status = 'completed' AND w.user_id = ?
      GROUP BY s.exercise
      ORDER BY last_date DESC, s.exercise`
  )
    .bind(userId)
    .all();
  return results;
}

// Totals, weekly volume and one exercise's per-session trend for the Progress page.
async function getProgress(env, userId, exercise) {
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS workouts, ROUND(AVG(duration_min)) AS avg_minutes, MIN(date) AS first_date
       FROM workouts WHERE user_id = ? AND status = 'completed'`
  )
    .bind(userId)
    .first();
  // week = Monday of the workout's week
  const { results: weekly } = await env.DB.prepare(
    `SELECT date(w.date, 'weekday 0', '-6 days') AS week,
            COUNT(DISTINCT w.id) AS workouts,
            COUNT(s.id) AS sets,
            ROUND(SUM(s.reps * COALESCE(s.weight, 0))) AS volume
       FROM workouts w LEFT JOIN sets s ON s.workout_id = w.id
      WHERE w.user_id = ? AND w.status = 'completed'
      GROUP BY week ORDER BY week DESC LIMIT 52`
  )
    .bind(userId)
    .all();
  const lifts = await getStats(env, userId);
  const name = exercise && lifts.some((l) => l.exercise === exercise) ? exercise : lifts[0]?.exercise ?? null;
  let series = [];
  if (name) {
    ({ results: series } = await env.DB.prepare(
      `SELECT w.date,
              MAX(s.weight) AS top_weight,
              ROUND(MAX(s.weight * (1 + s.reps / 30.0)), 1) AS est_1rm,
              MAX(s.reps) AS best_reps
         FROM sets s JOIN workouts w ON w.id = s.workout_id
        WHERE w.user_id = ? AND w.status = 'completed' AND s.exercise = ?
        GROUP BY w.date ORDER BY w.date`
    )
      .bind(userId, name)
      .all());
  }
  const { units } = await getSettings(env, userId);
  return { units, totals, weekly: weekly.reverse(), lifts, exercise: name, series };
}

// ---------- helpers ----------

function bearer(request) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(await pbkdf2(password, salt, PBKDF2_ITERATIONS))}`;
}

async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored).split("$");
  if (scheme !== "pbkdf2") return false;
  const actual = b64url(await pbkdf2(password, b64urlDecode(salt), Number(iter)));
  return timingSafeEqual(actual, hash);
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
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
