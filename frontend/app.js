// AI Gym Coach — PWA frontend (no build step)
import { sketchSvg } from "./sketches.js";
import { barChart, lineChart, wireCharts, compact } from "./charts.js";

const DEFAULT_API_URL = "https://ai-gym-coach-api.lazarc-gym-ai.workers.dev";
const CFG_KEY = "gc.cfg";
const AUTH_KEY = "gc.auth";
const view = document.getElementById("view");
const tabbar = document.querySelector(".tabbar");

const state = {
  tab: "today",        // today | train | progress  (coach is not available yet)
  screen: null,        // null | history | settings | admin  (sub-screens)
  planner: { location: "gym", minutes: 60, split_day: "", notes: "" },
  next: null,
  settings: null,
  history: null,
  progress: null,
  busy: false,
  authMode: "login",
  progressEx: null,
  range: 4,            // progress range in weeks: 4 | 8 | 26
  exIdx: null,         // exercise shown in the live workout
  adminUser: "",
  rest: null,          // { end, total } while the rest timer runs
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

// Loads the named data sets that aren't cached yet, then re-renders if the same screen is still open.
const LOADERS = {
  next: async () => (state.next = await api("/api/next")),
  settings: async () => (state.settings = await api("/api/settings")),
  history: async () => (state.history = (await api("/api/workouts?limit=50")).workouts),
  progress: async () => (state.progress = await api(`/api/progress${state.progressEx ? `?exercise=${encodeURIComponent(state.progressEx)}` : ""}`)),
};
const loading = new Set();
const failedLoads = new Set(); // not retried until invalidated, so a failing call can't loop
async function ensure(keys) {
  const missing = keys.filter((k) => state[k] == null && !loading.has(k) && !failedLoads.has(k));
  if (!missing.length) return;
  const where = `${state.tab}/${state.screen}`;
  missing.forEach((k) => loading.add(k));
  const results = await Promise.allSettled(missing.map((k) => LOADERS[k]()));
  missing.forEach((k, i) => {
    loading.delete(k);
    if (results[i].status === "rejected") failedLoads.add(k);
  });
  const failed = results.find((r) => r.status === "rejected");
  if (failed && getAuth()) toast(failed.reason.message);
  if (getAuth() && where === `${state.tab}/${state.screen}`) render();
}
function invalidate(...keys) { keys.forEach((k) => { state[k] = null; failedLoads.delete(k); }); }

// ---------- ui helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const label = (s) => esc(String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const shortDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const clock = (sec) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};
const SPLIT_NAMES = { ppl: "Push / Pull / Legs", upper_lower: "Upper / Lower", full_body: "Full body" };
const units = () => state.settings?.units ?? state.progress?.units ?? "kg";

const SVG = (d, extra = "") => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  sparkle: (c) => SVG('<path d="M12 3c.9 4.6 2.4 6.1 7 7-4.6.9-6.1 2.4-7 7-.9-4.6-2.4-6.1-7-7 4.6-.9 6.1-2.4 7-7Z"/>', c),
  back: (c) => SVG('<path d="M15 5l-7 7 7 7"/>', c),
  pause: (c) => SVG('<path d="M9 5v14M15 5v14"/>', c),
  check: (c) => SVG('<path d="M5 12.5l4.5 4.5L19 7.5"/>', c),
  dumbbell: (c) => SVG('<path d="M2.5 12h2M19.5 12h2M8 12h8"/><rect x="4.5" y="8" width="3.5" height="8" rx="1"/><rect x="16" y="8" width="3.5" height="8" rx="1"/>', c),
  chevron: (c) => SVG('<path d="M9 5l7 7-7 7"/>', c),
  chat: (c) => SVG('<path d="M4 5h16v11H9l-5 4z"/>', c),
};
// designed control that the app doesn't support yet: visible, disabled, announced as such
const soon = (inner, cls, name, style = "") =>
  `<button class="${cls} unavail" disabled aria-disabled="true" aria-label="${esc(name)}, coming soon"${style ? ` style="${style}"` : ""}>${inner}<span class="soon">Soon</span></button>`;

let toastTimer;
function toast(msg, ok = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = "toast" + (ok ? " ok" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3500);
}

// ---------- timers (rest + elapsed) ----------
function startRest(seconds) {
  if (!seconds) return;
  state.rest = { end: Date.now() + seconds * 1000, total: seconds };
  tick();
}
function stopRest() {
  state.rest = null;
  tick();
}
function tick() {
  const s = getAuth() && getSession();
  const el = document.getElementById("elapsed");
  if (el && s) el.textContent = clock((Date.now() - s.startedAt) / 1000);
  const ring = document.getElementById("rest-ring");
  if (state.rest) {
    const left = (state.rest.end - Date.now()) / 1000;
    if (left <= 0) {
      state.rest = null;
      navigator.vibrate?.(300);
    }
  }
  if (!ring) return;
  const total = state.rest?.total ?? Number(ring.dataset.rest) ?? 0;
  const left = state.rest ? (state.rest.end - Date.now()) / 1000 : total;
  const C = 2 * Math.PI * 44;
  ring.querySelector(".prog").style.strokeDashoffset = state.rest ? String(C * (1 - left / total)) : "0";
  ring.querySelector(".t").textContent = clock(left);
  const skip = document.getElementById("rest-skip");
  if (skip) skip.disabled = !state.rest;
  const status = document.getElementById("rest-status");
  if (status) status.textContent = state.rest ? "Resting" : "Rest timer";
}
setInterval(tick, 500);

// ---------- navigation ----------
tabbar.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => !b.disabled && switchTab(b.dataset.tab)));
function switchTab(tab) {
  state.tab = tab;
  state.screen = null;
  window.scrollTo(0, 0);
  render();
}
function openScreen(screen) {
  if (screen === "admin" && !isAdmin()) return;
  state.screen = screen;
  window.scrollTo(0, 0);
  render();
}

function render() {
  const signedIn = !!getAuth();
  tabbar.classList.toggle("hidden", !signedIn);
  if (!signedIn) return renderLogin();
  tabbar.querySelectorAll(".tab").forEach((b) => {
    const on = b.dataset.tab === state.tab;
    b.classList.toggle("active", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  if (state.screen === "history") return renderHistory();
  if (state.screen === "settings") return renderSettings();
  if (state.screen === "admin" && isAdmin()) return renderAdmin();
  if (state.tab === "train") return renderTrain();
  if (state.tab === "progress") return renderProgress();
  return renderToday();
}

const screenHead = (title, backTo, sub = "") => `
  <header class="screen-head">
    <button class="icon-btn" data-action="back" data-to="${backTo}" aria-label="Back">${ICON.back()}</button>
    <div class="title"><h2>${title}</h2>${sub}</div><span></span>
  </header>`;

// ---------- sign in / sign up ----------
function renderLogin() {
  const reg = state.authMode === "register";
  const t = window.gcTheme.current();
  view.innerHTML = `
    <div class="brand"><img src="${t === "main" ? "apple-touch-icon.png" : `icons/themes/${t}-180.png`}" alt="" />
      <h1>AI Gym Coach</h1><p class="muted" style="margin-top:6px">${reg ? "Create your account" : "Sign in to plan and log your training"}</p></div>
    <form class="card lg stack" id="auth-form">
      <div class="segmented">
        <button type="button" data-action="auth-mode" data-v="login" class="${reg ? "" : "on"}">Sign in</button>
        <button type="button" data-action="auth-mode" data-v="register" class="${reg ? "on" : ""}">Create account</button>
      </div>
      <div><label class="label" for="auth-user">Username</label><input id="auth-user" autocomplete="username" autocapitalize="off" required /></div>
      <div><label class="label" for="auth-pass">Password</label><input id="auth-pass" type="password" autocomplete="${reg ? "new-password" : "current-password"}" required minlength="${reg ? 8 : 1}" />
        ${reg ? '<div class="muted" style="margin-top:4px">At least 8 characters.</div>' : ""}</div>
      ${reg ? `<details class="plain" id="auth-code-box"><summary class="muted">I have an admin code ${ICON.chevron("sm")}</summary>
        <!-- text, not password: iOS fills every password field in the form with the new password -->
        <input id="auth-code" type="text" class="masked" placeholder="Admin code" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Admin code" /></details>` : ""}
      <details class="plain"><summary class="muted">Server ${ICON.chevron("sm")}</summary>
        <input id="auth-url" type="url" placeholder="${esc(DEFAULT_API_URL)}" value="${esc(getCfg().apiUrl)}" autocapitalize="off" aria-label="Server URL" /></details>
      <button class="btn-primary" type="submit" ${state.busy ? "disabled" : ""}>
        ${state.busy ? '<span class="spinner"></span>' : reg ? "Create account" : "Sign in"}</button>
    </form>`;
}

async function submitAuth() {
  const v = (id) => document.getElementById(id)?.value ?? "";
  save(CFG_KEY, { apiUrl: v("auth-url").trim() });
  const reg = state.authMode === "register";
  const body = { username: v("auth-user").trim(), password: v("auth-pass") };
  const code = v("auth-code").trim();
  if (reg && code && document.getElementById("auth-code-box")?.open) body.admin_code = code;
  state.busy = true;
  renderLogin();
  try {
    const res = await api(reg ? "/api/auth/register" : "/api/auth/login", { method: "POST", body });
    setAuth(res);
    Object.assign(state, { tab: "today", screen: null, progressEx: null, adminUser: "", exIdx: null });
    invalidate("next", "settings", "history", "progress");
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
  Object.assign(state, { tab: "today", screen: null, authMode: "login" });
  invalidate("next", "settings", "history", "progress");
  render();
}

// ---------- Today ----------
function mondayOf(d) {
  const m = new Date(d);
  m.setHours(12, 0, 0, 0);
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
function lastMondays(n) {
  const mon = mondayOf(new Date());
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(mon);
    m.setDate(mon.getDate() - 7 * (n - 1 - i));
    return ymd(m);
  });
}
// consecutive weeks (ending this week, or last week if this one isn't done yet) that hit the weekly target
function weekStreak(weekly, target) {
  const byWeek = new Map(weekly.map((w) => [w.week, w.workouts]));
  const weeks = lastMondays(52).reverse();
  let streak = 0;
  for (let i = 0; i < weeks.length; i++) {
    const hit = (byWeek.get(weeks[i]) ?? 0) >= target;
    if (hit) streak++;
    else if (i > 0) break;
  }
  return streak;
}

function renderToday() {
  const auth = getAuth();
  const s = getSession();
  const p = state.planner;
  const now = new Date();
  const name = auth.user.username;

  // week strip
  const done = new Set((state.history ?? []).map((w) => w.date));
  const mon = mondayOf(now);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const iso = ymd(d);
    const isToday = iso === today();
    const isDone = done.has(iso);
    const cls = [isDone && "done", isToday && "today", isToday && s && !isDone && "planned", !isToday && !isDone && iso < today() && "rest"].filter(Boolean).join(" ");
    const status = isDone ? "workout logged" : isToday ? (s ? "today, workout planned" : "today") : iso < today() ? "rest day" : "";
    return `<div class="day ${cls}" role="listitem" aria-label="${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric" })}${status ? `, ${status}` : ""}">
      <span class="wd" aria-hidden="true">${d.toLocaleDateString(undefined, { weekday: "short" }).slice(0, 3)}</span><span class="dn" aria-hidden="true">${d.getDate()}</span></div>`;
  }).join("");

  // hero
  let hero;
  if (s) {
    const plan = s.plan;
    const doneSets = s.log.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);
    const total = s.log.reduce((n, e) => n + e.sets.length, 0);
    hero = `<section class="hero">
      <div class="eyebrow">${ICON.sparkle("sm")} AI plan for today</div>
      <h2>${esc(plan.title)}</h2>
      <div class="meta">${plural(plan.exercises.length, "exercise")} · ~${esc(plan.estimated_minutes)} min · ${label(plan.location)}</div>
      ${plan.coach_notes ? `<p class="why">${esc(plan.coach_notes)}</p>` : ""}
      <button class="btn-hero" data-action="start">${doneSets ? `Resume workout · ${doneSets}/${total} sets` : "Start workout"}</button>
    </section>`;
  } else {
    const rotation = state.next?.rotation ?? [];
    const day = p.split_day || state.next?.next;
    hero = `<section class="hero">
      <div class="eyebrow">${ICON.sparkle("sm")} AI plan for today</div>
      <h2>${state.next ? label(day) : '<span class="spinner"></span>'}</h2>
      ${state.next ? `<div class="meta">${esc(SPLIT_NAMES[state.next.split] ?? state.next.split)}${state.next.last ? ` · last session ${label(state.next.last)}` : ""}</div>` : ""}
      <div class="controls">
        <div><span class="label">Where are you training?</span>
          <div class="segmented" role="group" aria-label="Location" style="margin-top:6px">
            <button data-action="loc" data-v="gym" class="${p.location === "gym" ? "on" : ""}" aria-pressed="${p.location === "gym"}">Gym</button>
            <button data-action="loc" data-v="home" class="${p.location === "home" ? "on" : ""}" aria-pressed="${p.location === "home"}">Home</button>
          </div></div>
        <div><span class="label">Minutes available</span>
          <div class="segmented" role="group" aria-label="Minutes available" style="margin-top:6px">
            ${[30, 45, 60, 75, 90].map((m) => `<button data-action="min" data-v="${m}" class="${p.minutes === m ? "on" : ""}" aria-pressed="${p.minutes === m}">${m}</button>`).join("")}
          </div></div>
        ${rotation.length ? `<div><label class="label" for="plan-day">Session</label>
          <select id="plan-day" data-field="split_day" style="margin-top:6px">
            <option value="">Auto (${label(state.next.next)})</option>
            ${rotation.map((d) => `<option value="${esc(d)}" ${p.split_day === d ? "selected" : ""}>${label(d)}</option>`).join("")}
          </select></div>` : ""}
        <div><label class="label" for="plan-notes">Anything the coach should know today?</label>
          <textarea id="plan-notes" data-field="notes" placeholder="e.g. slept badly, left shoulder a bit tight" style="margin-top:6px">${esc(p.notes)}</textarea></div>
      </div>
      <button class="btn-hero" data-action="plan" ${state.busy ? "disabled" : ""}>
        ${state.busy ? '<span class="spinner"></span> Coach is planning…' : `${ICON.sparkle("sm")} Plan my workout`}</button>
    </section>`;
  }

  // stats
  const target = state.settings?.days_per_week;
  const weekly = state.progress?.weekly;
  const thisWeek = weekly?.find((w) => w.week === ymd(mondayOf(now)));
  const statsReady = weekly && target;
  const tiles = `<div class="tiles3">
    <div class="tile"><div class="k">Streak</div><div class="v">${statsReady ? `${weekStreak(weekly, target)}<small> wk</small>` : "—"}</div></div>
    <div class="tile"><div class="k">This week</div><div class="v">${statsReady ? `${thisWeek?.workouts ?? 0}<small>/${target}</small>` : "—"}</div></div>
    <div class="tile"><div class="k">Volume</div><div class="v">${weekly ? `${compact(thisWeek?.volume ?? 0)}<small> ${esc(units())}</small>` : "—"}</div></div>
  </div>`;

  // up next = the split day after today's
  const rotation = state.next?.rotation ?? [];
  const current = s ? s.plan.split_day : p.split_day || state.next?.next;
  const upNext = rotation.length && current ? rotation[(rotation.indexOf(current) + 1) % rotation.length] : null;

  view.innerHTML = `
    <header class="hello">
      <div><div class="muted">${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
        <h1 style="margin-top:4px">Hi, ${esc(name)}</h1></div>
      <button class="avatar" data-action="open" data-screen="settings" aria-label="Account and settings">${esc(name.slice(0, 2))}</button>
    </header>
    <div class="week" role="list" aria-label="This week">${days}</div>
    ${hero}
    ${tiles}
    <section>
      <div class="section-head"><h3>Up next</h3><button class="btn-link" data-action="open" data-screen="history">History</button></div>
      <div class="card next-card">
        <span class="icon-btn" aria-hidden="true">${ICON.dumbbell()}</span>
        <div class="grow">${upNext ? `<h3>${label(upNext)}</h3><div class="muted">Next in your rotation, after ${label(current)}</div>`
          : `<div class="muted">${state.next ? "—" : '<span class="spinner"></span>'}</div>`}</div>
      </div>
    </section>`;
  ensure(["next", "history", "progress", "settings"]);
}

async function planWorkout() {
  state.busy = true;
  render();
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
    state.exIdx = null;
    invalidate("next");
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- Train (live workout) ----------
function lastTime(name, skipId) {
  const w = (state.history ?? []).find((h) => h.id !== skipId && h.exercises.some((e) => e.name === name));
  if (!w) return "—";
  const sets = w.exercises.find((e) => e.name === name).sets;
  const top = Math.max(...sets.map((x) => x.weight ?? -1));
  return top >= 0 ? `${top} ${esc(units())}` : `BW × ${Math.max(...sets.map((x) => x.reps))}`;
}

function renderTrain() {
  const s = getSession();
  if (!s) {
    view.innerHTML = `
      <h1>Train</h1>
      <div class="card lg stack"><h3>No workout in progress</h3>
        <p class="muted">Plan today's session on the Today tab, then start it here.</p>
        <button class="btn-primary" data-action="tab" data-tab="today">Go to Today</button></div>`;
    return;
  }
  const plan = s.plan;
  const exDone = (i) => s.log[i].sets.every((x) => x.done);
  if (state.exIdx == null || state.exIdx >= plan.exercises.length) {
    const first = s.log.findIndex((_, i) => !exDone(i));
    state.exIdx = first === -1 ? plan.exercises.length - 1 : first;
  }
  const i = state.exIdx;
  const ex = plan.exercises[i];
  const log = s.log[i];
  const cur = log.sets.findIndex((x) => !x.done);
  const nextSet = cur === -1 ? null : log.sets[cur];
  const u = esc(units());
  const doneCount = s.log.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0);
  const total = s.log.reduce((n, e) => n + e.sets.length, 0);
  const C = (2 * Math.PI * 44).toFixed(1);

  view.innerHTML = `
    <header class="screen-head" style="grid-template-columns:44px 1fr auto">
      <button class="icon-btn" data-action="tab" data-tab="today" aria-label="Back to Today">${ICON.back()}</button>
      <div class="title"><h2>${esc(plan.title)}</h2><div class="muted" id="elapsed" aria-label="Elapsed time">0:00</div></div>
      ${soon(ICON.pause("sm"), "btn-ghost small-btn", "Pause")}
    </header>

    <nav class="segbar" aria-label="Exercises">
      ${plan.exercises.map((e, j) => `<button class="seg ${j === i ? "current" : exDone(j) ? "done" : ""}" data-action="jump" data-i="${j}"
        aria-label="Exercise ${j + 1}: ${esc(e.name)}${exDone(j) ? ", done" : ""}" ${j === i ? 'aria-current="step"' : ""}></button>`).join("")}
    </nav>

    <section class="card lg">
      <div class="ex-head">${sketchSvg(ex.name, ex.movement)}
        <div class="grow"><div class="label">Exercise ${i + 1} of ${plan.exercises.length}</div><h2>${esc(ex.name)}</h2></div></div>
      <div class="ex-facts">
        <div>Target<strong>${esc(ex.sets)} × ${esc(ex.reps)}${ex.target_weight != null ? ` @ ${esc(ex.target_weight)}` : ""}</strong></div>
        <div>Last time<strong>${lastTime(ex.name, s.id)}</strong></div>
        ${ex.equipment ? `<div>Equipment<strong>${esc(ex.equipment)}</strong></div>` : ""}
      </div>
    </section>

    <section class="card rest-card" aria-label="Rest timer">
      <div class="ring" id="rest-ring" data-rest="${esc(ex.rest_seconds)}">
        <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="44"/><circle class="prog" cx="50" cy="50" r="44" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
        <span class="t" role="timer">${clock(ex.rest_seconds)}</span>
      </div>
      <div class="grow stack">
        <div><div class="label" id="rest-status">Rest timer</div>
          <div style="margin-top:2px">${nextSet ? `Next: set ${cur + 1} at ${nextSet.weight === "" ? "BW" : `${esc(nextSet.weight)} ${u}`}` : "All sets done"}</div></div>
        <div class="row">
          ${soon("+30 s", "btn-ghost small-btn", "Add 30 seconds")}
          <button class="btn-ghost small-btn" id="rest-skip" data-action="rest-skip" ${state.rest ? "" : "disabled"}>Skip</button>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="sets">
        <span class="h">Set</span><span class="h">${u}</span><span class="h">Reps</span><span class="h">Done</span>
        ${log.sets.map((set, j) => `<div class="set-row ${set.done ? "done" : ""} ${j === cur ? "current" : ""}">
          <span class="idx">${j + 1}</span>
          <input inputmode="decimal" data-ex="${i}" data-set="${j}" data-k="weight" value="${esc(set.weight)}" placeholder="BW" aria-label="Set ${j + 1} weight" />
          <input inputmode="numeric" data-ex="${i}" data-set="${j}" data-k="reps" value="${esc(set.reps)}" aria-label="Set ${j + 1} reps" />
          <button class="check ${set.done ? "done" : ""}" data-action="done" data-ex="${i}" data-set="${j}" aria-pressed="${set.done}" aria-label="Set ${j + 1} done">${ICON.check()}</button>
        </div>`).join("")}
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn-ghost small-btn" data-action="add-set" data-ex="${i}">+ Set</button>
        ${log.sets.length > 1 ? `<button class="btn-ghost small-btn" data-action="rm-set" data-ex="${i}">− Set</button>` : ""}
        <span class="grow"></span>
        ${i < plan.exercises.length - 1 ? `<button class="btn-ghost small-btn" data-action="jump" data-i="${i + 1}">Next exercise ${ICON.chevron("sm")}</button>` : ""}
      </div>
    </section>

    ${ex.notes ? `<section class="card tip">${ICON.sparkle()}<p>${esc(ex.notes)}</p></section>` : ""}

    ${soon(`${ICON.chat("sm")} Ask coach about this exercise`, "btn-ghost", "Ask coach about this exercise", "width:100%;display:flex;gap:8px;justify-content:center;align-items:center")}

    ${plan.warmup ? `<details class="card plain"><summary><h3>Warm-up</h3>${ICON.chevron("sm")}</summary><p class="muted" style="margin-top:6px">${esc(plan.warmup)}</p></details>` : ""}
    ${plan.cooldown ? `<details class="card plain"><summary><h3>Cool-down</h3>${ICON.chevron("sm")}</summary><p class="muted" style="margin-top:6px">${esc(plan.cooldown)}</p></details>` : ""}

    <section class="card stack">
      <div><label class="label" for="session-notes">Session notes</label><textarea id="session-notes" data-field="session-notes" placeholder="How did it feel?" style="margin-top:6px">${esc(s.notes)}</textarea></div>
      <button class="btn-primary" data-action="finish" ${state.busy ? "disabled" : ""}>Finish & save (${doneCount}/${total} sets)</button>
      <button class="btn-danger" data-action="discard" style="width:100%">Discard workout</button>
    </section>`;
  tick();
  ensure(["history", "settings"]);
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
  render();
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
    invalidate("next", "history", "progress");
    stopRest();
    state.exIdx = null;
    state.tab = "today";
    toast("Workout saved", true);
  } catch (e) {
    toast(e.message);
  } finally {
    state.busy = false;
    render();
  }
}

// ---------- History ----------
function workoutItem(w, { showUser = false } = {}) {
  const movement = (name) => w.plan?.exercises?.find((e) => e.name === name)?.movement;
  return `
    <details class="card history-item">
      <summary><div class="row between"><div><h3>${label(w.split_day)}</h3>
        <div class="muted">${label(w.location)}${showUser ? ` · ${esc(w.username ?? "unassigned")}` : ""}</div></div>
        <span class="muted mono">${esc(w.date)}</span></div>
        <div class="muted" style="margin-top:4px">${plural(w.exercises.length, "exercise")} · ${plural(w.exercises.reduce((n, e) => n + e.sets.length, 0), "set")}${w.duration_min ? ` · ${w.duration_min} min` : ""}</div></summary>
      <ul>${w.exercises.map((e) => `<li>${sketchSvg(e.name, movement(e.name), "sm")}
        <span><strong>${esc(e.name)}</strong> — ${e.sets.map((s) => `${s.reps}×${s.weight ?? "BW"}`).join(", ")}</span></li>`).join("")}</ul>
      ${w.notes ? `<p class="muted">Notes: ${esc(w.notes)}</p>` : ""}
      <button class="btn-danger small-btn" data-action="delete" data-id="${w.id}" style="margin-top:8px">Delete</button>
    </details>`;
}

function renderHistory() {
  const list = state.history;
  view.innerHTML = `${screenHead("History", "today")}
    ${list == null ? '<div class="card"><span class="spinner"></span> Loading…</div>'
      : list.length ? list.map((w) => workoutItem(w)).join("")
      : '<div class="card"><p class="muted">No workouts yet. Plan one on the Today tab.</p></div>'}`;
  ensure(["history"]);
}

// ---------- Progress ----------
function renderProgress() {
  const p = state.progress;
  const ranges = [[4, "4W"], [8, "8W"], [26, "6M"]];
  const head = `<h1>Progress</h1>
    <div class="segmented" role="group" aria-label="Range">
      ${ranges.map(([n, t]) => `<button data-action="range" data-v="${n}" class="${state.range === n ? "on" : ""}" aria-pressed="${state.range === n}">${t}</button>`).join("")}
    </div>`;
  const insight = `<section class="card unavail" aria-disabled="true"><div class="row">${ICON.sparkle()}<h3>AI insight</h3><span class="soon">Soon</span></div>
    <p class="muted" style="margin-top:6px">Not available yet</p></section>`;
  if (!p) {
    view.innerHTML = `${head}<div class="card">${failedLoads.has("progress") ? '<p class="muted">Couldn\'t load progress.</p>' : '<span class="spinner"></span> Loading…'}</div>`;
    ensure(["progress"]);
    return;
  }
  if (!p.totals.workouts) {
    view.innerHTML = `${head}<div class="card lg"><h3>No data yet</h3><p class="muted" style="margin-top:6px">Finish a workout and your progress appears here.</p></div>${insight}`;
    return;
  }
  const u = esc(p.units);
  const byWeek = new Map(p.weekly.map((w) => [w.week, w]));
  const all = lastMondays(state.range * 2).map((wk) => ({ week: wk, ...(byWeek.get(wk) ?? { workouts: 0, volume: 0 }) }));
  const weeks = all.slice(state.range);
  const sum = (ws) => ws.reduce((n, w) => n + (w.volume || 0), 0);
  const totalVol = sum(weeks);
  const prevVol = sum(all.slice(0, state.range));
  const change = prevVol > 0 ? Math.round(((totalVol - prevVol) / prevVol) * 100) : null;
  const rangeName = state.range === 26 ? "6 months" : `${state.range} weeks`;

  const usesWeight = p.series.some((s) => s.est_1rm != null);
  const metric = usesWeight ? "Estimated 1RM" : "Best reps";
  const pts = p.series.map((s) => ({
    t: Date.parse(`${s.date}T12:00:00`),
    value: usesWeight ? s.est_1rm : s.best_reps,
    label: shortDate(s.date),
    tip: usesWeight ? `${shortDate(s.date)} · e1RM ${s.est_1rm} ${p.units} (top set ${s.top_weight} ${p.units})` : `${shortDate(s.date)} · ${s.best_reps} reps`,
  }));

  view.innerHTML = `${head}
    <section class="card lg">
      <div class="row between"><span class="label">Weekly volume · last ${rangeName}</span>
        <span class="badge ${change > 0 ? "up" : ""}" aria-label="Change versus previous ${rangeName}">${change == null ? "—" : `${change > 0 ? "+" : ""}${change}%`}</span></div>
      <div class="big" style="margin-top:8px">${compact(totalVol)} <small>${u}</small></div>
      <p class="muted" style="margin-top:4px">Reps × weight. Bodyweight sets count as 0.</p>
      ${barChart(weeks.map((w) => ({
        label: shortDate(w.week),
        value: w.volume || 0,
        tip: `Week of ${shortDate(w.week)} · ${compact(w.volume || 0)} ${p.units} · ${plural(w.workouts, "workout")}`,
      })), "Weekly training volume", { highlightLast: true })}
    </section>
    ${insight}
    <section class="card">
      <h3>Personal records</h3>
      ${p.lifts.slice(0, 20).map((l) => `<div class="list-row">
        <div class="grow"><div>${esc(l.exercise)}</div><div class="muted">last ${esc(shortDate(l.last_date))}${l.est_1rm != null ? ` · e1RM ${esc(l.est_1rm)}` : ""}</div></div>
        <div class="v">${l.max_weight != null ? `${esc(l.max_weight)} ${u}` : `BW × ${esc(l.max_reps)}`}</div></div>`).join("")}
    </section>
    ${p.exercise ? `<section class="card">
      <h3>${metric}</h3>
      <select data-field="progress-ex" aria-label="Exercise" style="margin-top:10px">
        ${p.lifts.map((l) => `<option ${l.exercise === p.exercise ? "selected" : ""}>${esc(l.exercise)}</option>`).join("")}
      </select>
      ${pts.length ? lineChart(pts, `${metric} for ${p.exercise}`) : ""}
      <details class="chart-data"><summary>Show data</summary>
        <table class="lifts"><tr><th>Date</th><th class="n">${usesWeight ? `e1RM (${u})` : "Reps"}</th>${usesWeight ? `<th class="n">Top set</th>` : ""}</tr>
        ${p.series.map((s) => `<tr><td>${esc(s.date)}</td><td class="n">${esc(usesWeight ? s.est_1rm : s.best_reps)}</td>${usesWeight ? `<td class="n">${esc(s.top_weight)}</td>` : ""}</tr>`).join("")}
        </table></details>
    </section>` : ""}`;
  wireCharts(view);
}

// ---------- Settings ----------
function renderSettings() {
  const auth = getAuth();
  const s = state.settings;
  const themes = window.gcTheme.list;
  const cur = window.gcTheme.current();
  view.innerHTML = `${screenHead("Settings", "today")}
    <section class="card stack">
      <div class="row between"><div><h3>${esc(auth.user.username)}</h3><span class="pill">${esc(auth.user.role)}</span></div>
        <button class="btn-ghost small-btn" data-action="logout">Sign out</button></div>
      <div class="muted">Server: ${esc(apiBase())}</div>
    </section>
    <section class="card stack">
      <h3>Theme</h3>
      <div class="themes">
        ${Object.entries(themes).map(([id, t]) => `<button class="theme-opt" data-action="theme" data-v="${id}" aria-pressed="${id === cur}">
          <img src="icons/icon-${id}.svg" alt="" />${esc(t.name)}</button>`).join("")}
      </div>
      <p class="muted">The home-screen icon follows the theme you pick before tapping Add to Home Screen.</p>
    </section>
    ${s ? `<section class="card stack">
      <h3>Training</h3>
      <div><label class="label" for="s-split">Split</label><select id="s-split">
        ${Object.entries(SPLIT_NAMES).map(([v, t]) => `<option value="${v}" ${s.split === v ? "selected" : ""}>${t}${v === "full_body" ? " (A/B/C)" : ""}</option>`).join("")}</select></div>
      <div class="row">
        <div class="grow"><label class="label" for="s-goal">Goal</label><select id="s-goal">
          ${["hypertrophy", "strength", "general fitness", "fat loss", "endurance"].map((g) => `<option ${s.goal === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        <div class="grow"><label class="label" for="s-exp">Experience</label><select id="s-exp">
          ${["beginner", "intermediate", "advanced"].map((g) => `<option ${s.experience === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
      </div>
      <div class="row">
        <div class="grow"><label class="label" for="s-days">Days / week</label><input id="s-days" type="number" min="1" max="7" value="${esc(s.days_per_week)}" /></div>
        <div class="grow"><label class="label" for="s-units">Units</label><select id="s-units">
          ${["kg", "lb"].map((x) => `<option ${s.units === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div>
      <div><label class="label" for="s-gym">Gym equipment</label><textarea id="s-gym">${esc(s.gym_equipment)}</textarea></div>
      <div><label class="label" for="s-home">Home equipment</label><textarea id="s-home">${esc(s.home_equipment)}</textarea></div>
      <div><label class="label" for="s-notes">General notes for the coach</label><textarea id="s-notes" placeholder="e.g. prefer dumbbells for pressing, want stronger pull-ups">${esc(s.notes)}</textarea></div>
      <button class="btn-primary" data-action="save-settings">Save training settings</button>
    </section>` : '<div class="card"><span class="spinner"></span> Loading training settings…</div>'}
    ${isAdmin() ? `<button class="card row between" data-action="open" data-screen="admin" style="width:100%;text-align:left">
      <span><h3>Admin</h3><span class="muted">Users and everyone's workout logs</span></span>${ICON.chevron()}</button>` : ""}
    <p class="muted" style="text-align:center">Install: Safari → Share → Add to Home Screen</p>`;
  ensure(["settings"]);
}

// ---------- Admin ----------
async function renderAdmin() {
  view.innerHTML = `${screenHead("Admin", "settings")}<div class="card"><span class="spinner"></span> Loading…</div>`;
  try {
    const q = state.adminUser ? `&user_id=${state.adminUser}` : "";
    const [{ users }, { workouts }] = await Promise.all([api("/api/admin/users"), api(`/api/admin/workouts?limit=100${q}`)]);
    if (state.screen !== "admin") return;
    const me = getAuth().user.id;
    view.innerHTML = `${screenHead("Admin", "settings")}
      <section class="card"><h3>Users (${users.length})</h3>
        ${users.map((u) => `<div class="user-row">
          <div class="who"><strong>${esc(u.username)}</strong> <span class="pill">${esc(u.role)}</span>
            <div class="muted">${plural(u.workouts, "workout")}${u.last_date ? ` · last ${esc(u.last_date)}` : ""} · joined ${esc(u.created_at.slice(0, 10))}</div></div>
          ${u.id === me ? '<span class="muted">you</span>' : `
            <button class="btn-ghost small-btn" data-action="admin-role" data-id="${u.id}" data-role="${u.role === "admin" ? "user" : "admin"}">${u.role === "admin" ? "Make user" : "Make admin"}</button>
            <button class="btn-danger small-btn" data-action="admin-del-user" data-id="${u.id}" data-name="${esc(u.username)}">Delete</button>`}
        </div>`).join("")}
      </section>
      <section class="card stack"><h3>Workout logs</h3>
        <select data-field="admin-user" aria-label="Filter by user">
          <option value="">All users</option>
          ${users.map((u) => `<option value="${u.id}" ${String(u.id) === state.adminUser ? "selected" : ""}>${esc(u.username)}</option>`).join("")}
        </select>
      </section>
      ${workouts.length ? workouts.map((w) => workoutItem(w, { showUser: true })).join("") : '<div class="card"><p class="muted">No workouts logged.</p></div>'}`;
  } catch (e) {
    view.innerHTML = `${screenHead("Admin", "settings")}<div class="card"><p class="muted">${esc(e.message)}</p></div>`;
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
  if (!btn || btn.disabled) return;
  const a = btn.dataset.action;
  const p = state.planner;
  const s = getSession();

  if (a === "auth-mode") { state.authMode = btn.dataset.v; return render(); }
  if (a === "logout") return logout();
  if (a === "tab") return switchTab(btn.dataset.tab);
  if (a === "open") return openScreen(btn.dataset.screen);
  if (a === "back") return btn.dataset.to === "settings" ? openScreen("settings") : switchTab(btn.dataset.to);
  if (a === "loc") { p.location = btn.dataset.v; return render(); }
  if (a === "min") { p.minutes = Number(btn.dataset.v); return render(); }
  if (a === "plan") return planWorkout();
  if (a === "start") return switchTab("train");
  if (a === "range") { state.range = Number(btn.dataset.v); return render(); }
  if (a === "theme") { window.gcTheme.choose(btn.dataset.v); return render(); }

  if (a === "jump") { state.exIdx = Number(btn.dataset.i); window.scrollTo(0, 0); return render(); }
  if (a === "rest-skip") return stopRest();
  if (a === "done") {
    const set = s.log[btn.dataset.ex].sets[btn.dataset.set];
    set.done = !set.done;
    setSession(s);
    if (set.done) startRest(s.log[btn.dataset.ex].rest);
    return render();
  }
  if (a === "add-set") {
    const sets = s.log[btn.dataset.ex].sets;
    const last = sets[sets.length - 1];
    sets.push({ reps: last?.reps ?? "", weight: last?.weight ?? "", done: false });
    setSession(s);
    return render();
  }
  if (a === "rm-set") { s.log[btn.dataset.ex].sets.pop(); setSession(s); return render(); }
  if (a === "finish") return finishWorkout();
  if (a === "discard") {
    if (confirm("Discard this workout?")) { setSession(null); stopRest(); state.exIdx = null; switchTab("today"); }
    return;
  }

  if (a === "delete") {
    if (!confirm("Delete this workout log? This can't be undone.")) return;
    try {
      await api(`/api/workouts/${btn.dataset.id}`, { method: "DELETE" });
      invalidate("next", "history", "progress");
      toast("Workout deleted", true);
      render();
    } catch (e) { toast(e.message); }
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
      invalidate("next");
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
  if (f === "split_day") { state.planner.split_day = ev.target.value; render(); }
  if (f === "progress-ex") { state.progressEx = ev.target.value; invalidate("progress"); render(); }
  if (f === "admin-user") { state.adminUser = ev.target.value; renderAdmin(); }
});

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
