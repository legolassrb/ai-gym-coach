// AI Gym Coach — PWA frontend (no build step)
import { sketchSvg } from "./sketches.js";
import { barChart, lineChart, wireCharts, compact } from "./charts.js";

const DEFAULT_API_URL = "https://ai-gym-coach-api.lazarc-gym-ai.workers.dev";
const CFG_KEY = "gc.cfg";
const AUTH_KEY = "gc.auth";
const view = document.getElementById("view");
const titleEl = document.getElementById("title");
const tabbar = document.querySelector(".tabbar");

const state = {
  tab: "today",
  planner: { location: "gym", minutes: 60, split_day: "", notes: "" },
  next: null,
  settings: null,
  busy: false,
  authMode: "login",
  progressEx: null,
  adminUser: "",
};

// ---------- storage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const drop = (k) => { try { localStorage.removeItem(k); } catch {} };
const getCfg = () => load(CFG_KEY, { apiUrl: "" });
const apiBase = () => (getCfg().apiUrl || DEFAULT_API_URL).replace(/\/+$/, "");
const getAuth = () => load(AUTH_KEY, null);
const setAuth = (a) => (a ? save(AUTH_KEY, a) : drop(AUTH_KEY));
const isAdmin = () => getAuth()?.user.role === "admin";
// the in-progress workout is kept per user so a shared phone doesn't mix sessions
const sessionKey = () => `gc.session.${getAuth()?.user.id}`;
const getSession = () => load(sessionKey(), null);
const setSession = (s) => (s ? save(sessionKey(), s) : drop(sessionKey()));

// ---------- api ----------
async function api(path, { method = "GET", body } = {}) {
  const auth = getAuth();
  const res = await fetch(apiBase() + path, {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth && !path.startsWith("/api/auth/")) {
    setAuth(null);
    render();
    throw new Error("Your session expired. Please sign in again.");
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- ui helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const label = (s) => esc(String(s ?? "").replace(/_/g, " "));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

let toastTimer;
function toast(msg, ok = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (ok ? " ok" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

// ---------- rest timer ----------
let restTimer;
function startRest(seconds) {
  if (!seconds) return;
  const box = document.getElementById("rest");
  const out = document.getElementById("rest-time");
  const end = Date.now() + seconds * 1000;
  clearInterval(restTimer);
  box.classList.remove("hidden");
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    out.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    if (left === 0) {
      clearInterval(restTimer);
      navigator.vibrate?.(300);
      setTimeout(() => box.classList.add("hidden"), 1500);
    }
  };
  tick();
  restTimer = setInterval(tick, 500);
}
function stopRest() {
  clearInterval(restTimer);
  document.getElementById("rest").classList.add("hidden");
}
document.getElementById("rest-skip").onclick = stopRest;

// ---------- tabs ----------
document.querySelectorAll(".tabbar button").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab))
);
function switchTab(tab) {
  if (tab === "admin" && !isAdmin()) tab = "today";
  state.tab = tab;
  window.scrollTo(0, 0);
  render();
}

function updateChrome() {
  const signedIn = !!getAuth();
  tabbar.classList.toggle("hidden", !signedIn);
  tabbar.querySelector('[data-tab="admin"]').classList.toggle("hidden", !isAdmin());
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  titleEl.textContent = !signedIn
    ? state.authMode === "login" ? "Sign in" : "Create account"
    : { today: "Today", history: "History", progress: "Progress", admin: "Admin", settings: "Settings" }[state.tab];
}

function render() {
  if (!getAuth()) {
    updateChrome();
    return renderLogin();
  }
  if (state.tab === "admin" && !isAdmin()) state.tab = "today";
  updateChrome();
  if (state.tab === "today") return getSession() ? renderSession() : renderPlanner();
  if (state.tab === "history") return renderHistory();
  if (state.tab === "progress") return renderProgress();
  if (state.tab === "admin") return renderAdmin();
  return renderSettings();
}

// ---------- login / sign-up ----------
function renderLogin() {
  const reg = state.authMode === "register";
  view.innerHTML = `
    <form class="card stack" id="auth-form">
      <div class="segmented">
        <button type="button" data-action="auth-mode" data-v="login" class="${reg ? "" : "on"}">Sign in</button>
        <button type="button" data-action="auth-mode" data-v="register" class="${reg ? "on" : ""}">Create account</button>
      </div>
      <div><label>Username</label><input id="auth-user" autocomplete="username" autocapitalize="off" required /></div>
      <div><label>Password</label><input id="auth-pass" type="password" autocomplete="${reg ? "new-password" : "current-password"}" required minlength="${reg ? 8 : 1}" />
        ${reg ? '<div class="muted" style="margin-top:4px">At least 8 characters.</div>' : ""}</div>
      ${reg ? `<details class="more"><summary>I have an admin code</summary>
        <div style="margin-top:8px"><input id="auth-code" type="password" placeholder="Admin code" autocomplete="off" /></div></details>` : ""}
      <details class="more"><summary>Server</summary>
        <div style="margin-top:8px"><input id="auth-url" type="url" placeholder="${esc(DEFAULT_API_URL)}" value="${esc(getCfg().apiUrl)}" autocapitalize="off" /></div></details>
      <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>
        ${state.busy ? '<span class="spinner"></span>' : reg ? "Create account" : "Sign in"}</button>
    </form>`;
}

async function submitAuth() {
  const v = (id) => document.getElementById(id)?.value ?? "";
  save(CFG_KEY, { apiUrl: v("auth-url").trim() });
  const reg = state.authMode === "register";
  const body = { username: v("auth-user").trim(), password: v("auth-pass") };
  if (reg && v("auth-code")) body.admin_code = v("auth-code");
  state.busy = true;
  renderLogin();
  try {
    const res = await api(reg ? "/api/auth/register" : "/api/auth/login", { method: "POST", body });
    setAuth(res);
    Object.assign(state, { tab: "today", next: null, settings: null, progressEx: null, adminUser: "" });
    toast(`Welcome, ${res.user.username}${res.user.role === "admin" ? " (admin)" : ""}`, true);
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function logout() {
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  stopRest();
  setAuth(null);
  Object.assign(state, { tab: "today", next: null, settings: null, authMode: "login" });
  render();
}

// ---------- today: planner ----------
async function renderPlanner() {
  const p = state.planner;
  const rotation = state.next?.rotation ?? [];
  view.innerHTML = `
    <div class="card">
      <div class="row between">
        <div><div class="muted">Next in your split</div>
          <h2 style="margin-top:4px">${state.next ? label(p.split_day || state.next.next) : '<span class="spinner"></span>'}</h2></div>
        ${state.next ? `<span class="pill">${label(state.next.split)}</span>` : ""}
      </div>
      ${state.next?.last ? `<div class="muted">Last session: ${label(state.next.last)}</div>` : ""}
    </div>
    <div class="card stack">
      <div><label>Where are you training?</label>
        <div class="segmented">
          <button data-action="loc" data-v="gym" class="${p.location === "gym" ? "on" : ""}">🏋️ Gym</button>
          <button data-action="loc" data-v="home" class="${p.location === "home" ? "on" : ""}">🏠 Home</button>
        </div></div>
      <div><label>Time available</label>
        <div class="segmented">
          ${[30, 45, 60, 75, 90].map((m) => `<button data-action="min" data-v="${m}" class="${p.minutes === m ? "on" : ""}">${m}</button>`).join("")}
        </div></div>
      ${rotation.length ? `<div><label>Session</label>
        <select data-field="split_day">
          <option value="">Auto (${label(state.next.next)})</option>
          ${rotation.map((d) => `<option value="${esc(d)}" ${p.split_day === d ? "selected" : ""}>${label(d)}</option>`).join("")}
        </select></div>` : ""}
      <div><label>Anything the coach should know today?</label>
        <textarea data-field="notes" placeholder="e.g. slept badly, left shoulder a bit tight">${esc(p.notes)}</textarea></div>
      <button class="primary" data-action="plan" ${state.busy ? "disabled" : ""}>
        ${state.busy ? '<span class="spinner"></span>&nbsp; Coach is planning…' : "✨ Plan my workout"}</button>
    </div>`;
  if (!state.next) {
    try {
      state.next = await api("/api/next");
      if (state.tab === "today" && getAuth() && !getSession()) renderPlanner();
    } catch (e) {
      toast(e.message);
    }
  }
}

async function planWorkout() {
  state.busy = true;
  renderPlanner();
  try {
    const p = state.planner;
    const res = await api("/api/plan", {
      method: "POST",
      body: { location: p.location, minutes: p.minutes, split_day: p.split_day || undefined, notes: p.notes, date: today() },
    });
    const plan = res.plan;
    setSession({
      id: res.id,
      date: res.date,
      plan,
      startedAt: Date.now(),
      notes: "",
      log: plan.exercises.map((ex) => ({
        name: ex.name,
        rest: ex.rest_seconds,
        sets: Array.from({ length: Math.max(1, ex.sets || 1) }, () => ({
          reps: parseInt(ex.reps, 10) || "",
          weight: ex.target_weight ?? "",
          done: false,
        })),
      })),
    });
    state.planner.notes = "";
    state.next = null;
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- today: active session ----------
function renderSession() {
  const s = getSession();
  const plan = s.plan;
  const doneCount = s.log.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);
  const total = s.log.reduce((n, e) => n + e.sets.length, 0);
  view.innerHTML = `
    <div class="card">
      <div class="row between"><span class="pill">${label(plan.split_day)} · ${esc(plan.location)}</span>
        <span class="muted">~${esc(plan.estimated_minutes)} min</span></div>
      <h2 style="margin-top:10px">${esc(plan.title)}</h2>
      ${plan.coach_notes ? `<p class="muted" style="margin:6px 0 0">${esc(plan.coach_notes)}</p>` : ""}
    </div>
    ${plan.warmup ? `<div class="card"><h3>Warm-up</h3><p class="muted" style="margin:6px 0 0">${esc(plan.warmup)}</p></div>` : ""}
    ${plan.exercises.map((ex, i) => {
      const log = s.log[i];
      return `<div class="card exercise">
        <div class="ex-head">${sketchSvg(ex.name, ex.movement)}
          <div><h3>${esc(ex.name)}</h3>
          <div class="meta muted">${esc(ex.sets)} × ${esc(ex.reps)}${ex.target_weight != null ? ` @ ${esc(ex.target_weight)}` : ""} · rest ${esc(ex.rest_seconds)}s${ex.equipment ? ` · ${esc(ex.equipment)}` : ""}</div></div>
        </div>
        ${ex.notes ? `<div class="muted" style="margin:-4px 0 10px">💡 ${esc(ex.notes)}</div>` : ""}
        <div class="sets">
          <span class="h">#</span><span class="h">Reps</span><span class="h">Weight</span><span></span>
          ${log.sets.map((set, j) => `
            <span class="idx">${j + 1}</span>
            <input inputmode="numeric" data-ex="${i}" data-set="${j}" data-k="reps" value="${esc(set.reps)}" />
            <input inputmode="decimal" data-ex="${i}" data-set="${j}" data-k="weight" value="${esc(set.weight)}" placeholder="BW" />
            <button class="check ${set.done ? "done" : ""}" data-action="done" data-ex="${i}" data-set="${j}" aria-label="Set done">✓</button>`).join("")}
        </div>
        <div class="row" style="margin-top:10px">
          <button class="ghost small" data-action="add-set" data-ex="${i}">+ Set</button>
          ${log.sets.length > 1 ? `<button class="ghost small" data-action="rm-set" data-ex="${i}">− Set</button>` : ""}
        </div>
      </div>`;
    }).join("")}
    ${plan.cooldown ? `<div class="card"><h3>Cool-down</h3><p class="muted" style="margin:6px 0 0">${esc(plan.cooldown)}</p></div>` : ""}
    <div class="card stack">
      <div><label>Session notes</label><textarea data-field="session-notes" placeholder="How did it feel?">${esc(s.notes)}</textarea></div>
      <button class="primary" data-action="finish" ${state.busy ? "disabled" : ""}>✅ Finish & save (${doneCount}/${total} sets)</button>
      <button class="danger" data-action="discard" style="width:100%">Discard workout</button>
    </div>`;
}

async function finishWorkout() {
  const s = getSession();
  const exercises = s.log
    .map((e) => ({
      name: e.name,
      sets: e.sets.filter((x) => x.done).map((x) => ({ reps: Number(x.reps) || 0, weight: x.weight === "" ? null : Number(x.weight) })),
    }))
    .filter((e) => e.sets.length);
  if (!exercises.length && !confirm("No sets are ticked as done. Save anyway?")) return;
  state.busy = true;
  renderSession();
  try {
    await api("/api/workouts", {
      method: "POST",
      body: {
        id: s.id,
        date: s.date,
        location: s.plan.location,
        split_day: s.plan.split_day,
        duration_min: Math.round((Date.now() - s.startedAt) / 60000),
        notes: s.notes,
        exercises,
      },
    });
    setSession(null);
    state.next = null;
    stopRest();
    toast("Workout saved 💪", true);
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- history ----------
function workoutItem(w, { showUser = false } = {}) {
  const movement = (name) => w.plan?.exercises?.find((e) => e.name === name)?.movement;
  return `
    <details class="card history-item">
      <summary><div class="row between"><div><strong>${label(w.split_day)}</strong> <span class="muted">· ${esc(w.location)}${showUser ? ` · 👤 ${esc(w.username ?? "unassigned")}` : ""}</span></div>
        <span class="muted">${esc(w.date)}</span></div>
        <div class="muted">${plural(w.exercises.length, "exercise")} · ${plural(w.exercises.reduce((n, e) => n + e.sets.length, 0), "set")}${w.duration_min ? ` · ${w.duration_min} min` : ""}</div></summary>
      <ul>${w.exercises.map((e) => `<li class="ex">${sketchSvg(e.name, movement(e.name), "sm")}
        <span><strong>${esc(e.name)}</strong> — ${e.sets.map((s) => `${s.reps}×${s.weight ?? "BW"}`).join(", ")}</span></li>`).join("")}</ul>
      ${w.notes ? `<p class="muted">📝 ${esc(w.notes)}</p>` : ""}
      <button class="danger small" data-action="delete" data-id="${w.id}">Delete</button>
    </details>`;
}

async function renderHistory() {
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading…</div>`;
  try {
    const { workouts } = await api("/api/workouts?limit=50");
    if (state.tab !== "history") return;
    view.innerHTML = workouts.length
      ? workouts.map((w) => workoutItem(w)).join("")
      : `<div class="card"><p class="muted">No workouts yet. Plan one on the Today tab.</p></div>`;
  } catch (e) {
    view.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`;
  }
}

// ---------- progress ----------
function lastMondays(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d);
    m.setDate(d.getDate() - 7 * (n - 1 - i));
    return ymd(m);
  });
}

async function renderProgress() {
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading…</div>`;
  let p;
  try {
    p = await api(`/api/progress${state.progressEx ? `?exercise=${encodeURIComponent(state.progressEx)}` : ""}`);
  } catch (e) {
    view.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`;
    return;
  }
  if (state.tab !== "progress") return;
  if (!p.totals.workouts) {
    view.innerHTML = `<div class="card"><h2>No data yet</h2><p class="muted">Finish a workout and your progress charts appear here.</p></div>`;
    return;
  }
  const u = p.units;
  const byWeek = new Map(p.weekly.map((w) => [w.week, w]));
  const weeks = lastMondays(12).map((wk) => ({ week: wk, ...(byWeek.get(wk) ?? { workouts: 0, sets: 0, volume: 0 }) }));
  const thisWeek = weeks[weeks.length - 1];
  const vol4 = weeks.slice(-4).reduce((n, w) => n + (w.volume || 0), 0);

  const usesWeight = p.series.some((s) => s.est_1rm != null);
  const metric = usesWeight ? "Estimated 1RM" : "Best reps";
  const pts = p.series.map((s) => ({
    t: Date.parse(`${s.date}T12:00:00`),
    value: usesWeight ? s.est_1rm : s.best_reps,
    label: shortDate(s.date),
    tip: usesWeight
      ? `${shortDate(s.date)} · e1RM ${s.est_1rm} ${u} (top set ${s.top_weight} ${u})`
      : `${shortDate(s.date)} · ${s.best_reps} reps`,
  }));

  view.innerHTML = `
    <div class="tiles">
      <div class="tile"><div class="v">${p.totals.workouts}</div><div class="k">Workouts logged</div></div>
      <div class="tile"><div class="v">${thisWeek.workouts}</div><div class="k">This week</div></div>
      <div class="tile"><div class="v">${compact(vol4)}</div><div class="k">Volume, last 4 weeks (${esc(u)})</div></div>
      <div class="tile"><div class="v">${p.totals.avg_minutes ?? "–"}</div><div class="k">Avg session (min)</div></div>
    </div>
    <div class="card">
      <h2>Weekly volume</h2>
      <div class="muted">Reps × weight per week, last 12 weeks (${esc(u)}). Bodyweight sets count as 0.</div>
      ${barChart(weeks.map((w) => ({
        label: shortDate(w.week),
        value: w.volume || 0,
        tip: `Week of ${shortDate(w.week)} · ${compact(w.volume || 0)} ${u} · ${plural(w.workouts, "workout")}`,
      })), "Weekly training volume")}
    </div>
    ${p.exercise ? `<div class="card">
      <div class="row between"><h2>${metric}</h2></div>
      <select data-field="progress-ex" style="margin:6px 0 2px">
        ${p.lifts.map((l) => `<option ${l.exercise === p.exercise ? "selected" : ""}>${esc(l.exercise)}</option>`).join("")}
      </select>
      ${pts.length ? lineChart(pts, `${metric} for ${p.exercise}`) : ""}
      <details class="chart-data"><summary>Show data</summary>
        <table class="lifts"><tr><th>Date</th><th class="n">${usesWeight ? `e1RM (${esc(u)})` : "Reps"}</th>${usesWeight ? `<th class="n">Top set</th>` : ""}</tr>
        ${p.series.map((s) => `<tr><td>${esc(s.date)}</td><td class="n">${esc(usesWeight ? s.est_1rm : s.best_reps)}</td>${usesWeight ? `<td class="n">${esc(s.top_weight)}</td>` : ""}</tr>`).join("")}
        </table></details>
    </div>` : ""}
    <div class="card"><h2>Best lifts</h2>
      <table class="lifts"><tr><th>Exercise</th><th class="n">Best</th><th class="n">e1RM</th><th class="n">Last</th></tr>
      ${p.lifts.slice(0, 20).map((l) => `<tr><td>${esc(l.exercise)}</td><td class="n">${l.max_weight ?? "BW×" + esc(l.max_reps)}</td><td class="n">${esc(l.est_1rm ?? "–")}</td><td class="n">${esc(l.last_date?.slice(5))}</td></tr>`).join("")}
      </table></div>`;
  wireCharts(view);
}

// ---------- admin ----------
async function renderAdmin() {
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading…</div>`;
  try {
    const q = state.adminUser ? `&user_id=${state.adminUser}` : "";
    const [{ users }, { workouts }] = await Promise.all([api("/api/admin/users"), api(`/api/admin/workouts?limit=100${q}`)]);
    if (state.tab !== "admin") return;
    const me = getAuth().user.id;
    view.innerHTML = `
      <div class="card"><h2>Users (${users.length})</h2>
        ${users.map((u) => `<div class="user-row">
          <div class="who"><strong>${esc(u.username)}</strong> <span class="pill ${u.role === "admin" ? "admin" : ""}">${esc(u.role)}</span>
            <div class="muted">${plural(u.workouts, "workout")}${u.last_date ? ` · last ${esc(u.last_date)}` : ""} · joined ${esc(u.created_at.slice(0, 10))}</div></div>
          ${u.id === me ? '<span class="muted">you</span>' : `
            <button class="ghost small" data-action="admin-role" data-id="${u.id}" data-role="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "Make user" : "Make admin"}</button>
            <button class="danger small" data-action="admin-del-user" data-id="${u.id}" data-name="${esc(u.username)}">Delete</button>`}
        </div>`).join("")}
      </div>
      <div class="card stack"><h2>Workout logs</h2>
        <select data-field="admin-user">
          <option value="">All users</option>
          ${users.map((u) => `<option value="${u.id}" ${String(u.id) === state.adminUser ? "selected" : ""}>${esc(u.username)}</option>`).join("")}
        </select>
      </div>
      ${workouts.length ? workouts.map((w) => workoutItem(w, { showUser: true })).join("") : `<div class="card"><p class="muted">No workouts logged.</p></div>`}`;
  } catch (e) {
    view.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`;
  }
}

// ---------- settings ----------
async function renderSettings() {
  const auth = getAuth();
  const s = state.settings;
  view.innerHTML = `
    <div class="card stack">
      <h2>Account</h2>
      <div class="row between"><div><strong>${esc(auth.user.username)}</strong> <span class="pill ${isAdmin() ? "admin" : ""}">${esc(auth.user.role)}</span></div>
        <button class="ghost small" data-action="logout">Sign out</button></div>
      <div class="muted">Server: ${esc(apiBase())}</div>
    </div>
    ${s ? `<div class="card stack">
      <h2>Training</h2>
      <div><label>Split</label><select id="s-split">
        ${[["ppl", "Push / Pull / Legs"], ["upper_lower", "Upper / Lower"], ["full_body", "Full body (A/B/C)"]]
          .map(([v, t]) => `<option value="${v}" ${s.split === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="row">
        <div style="flex:1"><label>Goal</label><select id="s-goal">
          ${["hypertrophy", "strength", "general fitness", "fat loss", "endurance"].map((g) => `<option ${s.goal === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        <div style="flex:1"><label>Experience</label><select id="s-exp">
          ${["beginner", "intermediate", "advanced"].map((g) => `<option ${s.experience === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div style="flex:1"><label>Days / week</label><input id="s-days" type="number" min="1" max="7" value="${esc(s.days_per_week)}" /></div>
        <div style="flex:1"><label>Units</label><select id="s-units">
          ${["kg", "lb"].map((u) => `<option ${s.units === u ? "selected" : ""}>${u}</option>`).join("")}</select></div>
      </div>
      <div><label>Gym equipment</label><textarea id="s-gym">${esc(s.gym_equipment)}</textarea></div>
      <div><label>Home equipment</label><textarea id="s-home">${esc(s.home_equipment)}</textarea></div>
      <div><label>General notes for the coach</label><textarea id="s-notes" placeholder="e.g. prefer dumbbells for pressing, want stronger pull-ups">${esc(s.notes)}</textarea></div>
      <button class="primary" data-action="save-settings">Save training settings</button>
    </div>` : `<div class="card"><span class="spinner"></span> Loading training settings…</div>`}
    <p class="muted" style="text-align:center">Install: Safari → Share → Add to Home Screen</p>`;
  if (!s) {
    try {
      state.settings = await api("/api/settings");
      if (state.tab === "settings") renderSettings();
    } catch (e) {
      toast(e.message);
    }
  }
}

// ---------- events ----------
view.addEventListener("submit", (ev) => {
  if (ev.target.id !== "auth-form") return;
  ev.preventDefault();
  if (!state.busy) submitAuth();
});

view.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-action]");
  if (!btn) return;
  const a = btn.dataset.action;
  const p = state.planner;
  const s = getSession();

  if (a === "auth-mode") { state.authMode = btn.dataset.v; return render(); }
  if (a === "logout") return logout();
  if (a === "loc") { p.location = btn.dataset.v; return renderPlanner(); }
  if (a === "min") { p.minutes = Number(btn.dataset.v); return renderPlanner(); }
  if (a === "plan") return planWorkout();

  if (a === "done") {
    const set = s.log[btn.dataset.ex].sets[btn.dataset.set];
    set.done = !set.done;
    setSession(s);
    if (set.done) startRest(s.log[btn.dataset.ex].rest);
    return renderSession();
  }
  if (a === "add-set") {
    const sets = s.log[btn.dataset.ex].sets;
    const last = sets[sets.length - 1];
    sets.push({ reps: last?.reps ?? "", weight: last?.weight ?? "", done: false });
    setSession(s);
    return renderSession();
  }
  if (a === "rm-set") { s.log[btn.dataset.ex].sets.pop(); setSession(s); return renderSession(); }
  if (a === "finish") return finishWorkout();
  if (a === "discard") {
    if (confirm("Discard this workout?")) { setSession(null); stopRest(); render(); }
    return;
  }

  if (a === "delete") {
    if (!confirm("Delete this workout log? This can't be undone.")) return;
    try { await api(`/api/workouts/${btn.dataset.id}`, { method: "DELETE" }); state.next = null; toast("Workout deleted", true); render(); }
    catch (e) { toast(e.message); }
    return;
  }

  if (a === "admin-role") {
    try { await api(`/api/admin/users/${btn.dataset.id}`, { method: "PUT", body: { role: btn.dataset.role } }); renderAdmin(); }
    catch (e) { toast(e.message); }
    return;
  }
  if (a === "admin-del-user") {
    if (!confirm(`Delete user "${btn.dataset.name}" and all their workouts? This can't be undone.`)) return;
    try {
      await api(`/api/admin/users/${btn.dataset.id}`, { method: "DELETE" });
      if (state.adminUser === btn.dataset.id) state.adminUser = "";
      toast("User deleted", true);
      renderAdmin();
    } catch (e) { toast(e.message); }
    return;
  }

  if (a === "save-settings") {
    const v = (id) => document.getElementById(id).value;
    try {
      state.settings = await api("/api/settings", {
        method: "PUT",
        body: {
          split: v("s-split"), goal: v("s-goal"), experience: v("s-exp"), days_per_week: Number(v("s-days")),
          units: v("s-units"), gym_equipment: v("s-gym"), home_equipment: v("s-home"), notes: v("s-notes"),
        },
      });
      state.next = null;
      toast("Settings saved", true);
    } catch (e) { toast(e.message); }
  }
});

view.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.dataset.field === "notes") state.planner.notes = t.value;
  if (t.dataset.field === "split_day") state.planner.split_day = t.value;
  if (t.dataset.field === "session-notes") { const s = getSession(); s.notes = t.value; setSession(s); }
  if (t.dataset.k) {
    const s = getSession();
    s.log[t.dataset.ex].sets[t.dataset.set][t.dataset.k] = t.value;
    setSession(s);
  }
});
view.addEventListener("change", (ev) => {
  const f = ev.target.dataset.field;
  if (f === "split_day") { state.planner.split_day = ev.target.value; renderPlanner(); }
  if (f === "progress-ex") { state.progressEx = ev.target.value; renderProgress(); }
  if (f === "admin-user") { state.adminUser = ev.target.value; renderAdmin(); }
});

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
