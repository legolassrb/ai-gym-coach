// AI Gym Coach — PWA frontend (no build step)

const CFG_KEY = "gc.cfg";
const SESSION_KEY = "gc.session";
const view = document.getElementById("view");
const titleEl = document.getElementById("title");

const state = {
  tab: "today",
  planner: { location: "gym", minutes: 60, split_day: "", notes: "" },
  next: null,
  settings: null,
  busy: false,
};

// ---------- storage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const getCfg = () => load(CFG_KEY, { apiUrl: "", passphrase: "" });
const getSession = () => load(SESSION_KEY, null);
const setSession = (s) => (s ? save(SESSION_KEY, s) : localStorage.removeItem(SESSION_KEY));

// ---------- api ----------
async function api(path, { method = "GET", body } = {}) {
  const cfg = getCfg();
  if (!cfg.apiUrl) throw new Error("Add your Worker URL in Settings first.");
  const res = await fetch(cfg.apiUrl.replace(/\/+$/, "") + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.passphrase}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 401 ? "Wrong passphrase (check Settings)." : data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- ui helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const label = (s) => esc(String(s ?? "").replace(/_/g, " "));
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

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
  state.tab = tab;
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  titleEl.textContent = { today: "Today", history: "History", settings: "Settings" }[tab];
  window.scrollTo(0, 0);
  render();
}

function render() {
  if (state.tab === "today") return getSession() ? renderSession() : renderPlanner();
  if (state.tab === "history") return renderHistory();
  return renderSettings();
}

// ---------- today: planner ----------
async function renderPlanner() {
  const cfg = getCfg();
  if (!cfg.apiUrl) {
    view.innerHTML = `<div class="card stack"><h2>Welcome 👋</h2>
      <p class="muted">Connect the app to your Cloudflare Worker to start planning workouts.</p>
      <button class="primary" data-action="go-settings">Open Settings</button></div>`;
    return;
  }
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
      if (state.tab === "today" && !getSession()) renderPlanner();
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
        <h3>${esc(ex.name)}</h3>
        <div class="meta muted">${esc(ex.sets)} × ${esc(ex.reps)}${ex.target_weight != null ? ` @ ${esc(ex.target_weight)}` : ""} · rest ${esc(ex.rest_seconds)}s${ex.equipment ? ` · ${esc(ex.equipment)}` : ""}</div>
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
async function renderHistory() {
  view.innerHTML = `<div class="card"><span class="spinner"></span> Loading…</div>`;
  try {
    const [{ workouts }, { lifts }] = await Promise.all([api("/api/workouts?limit=50"), api("/api/stats")]);
    if (state.tab !== "history") return;
    view.innerHTML = `
      ${lifts.length ? `<div class="card"><h2>Best lifts</h2>
        <table class="lifts"><tr><th>Exercise</th><th class="n">Best</th><th class="n">e1RM</th><th class="n">Last</th></tr>
        ${lifts.slice(0, 15).map((l) => `<tr><td>${esc(l.exercise)}</td><td class="n">${l.max_weight ?? "BW×" + esc(l.max_reps)}</td><td class="n">${esc(l.est_1rm ?? "–")}</td><td class="n">${esc(l.last_date?.slice(5))}</td></tr>`).join("")}
        </table></div>` : ""}
      ${workouts.length ? workouts.map((w) => `
        <details class="card history-item">
          <summary><div class="row between"><div><strong>${label(w.split_day)}</strong> <span class="muted">· ${esc(w.location)}</span></div>
            <span class="muted">${esc(w.date)}</span></div>
            <div class="muted">${plural(w.exercises.length, "exercise")} · ${plural(w.exercises.reduce((n, e) => n + e.sets.length, 0), "set")}${w.duration_min ? ` · ${w.duration_min} min` : ""}</div></summary>
          <ul>${w.exercises.map((e) => `<li><strong>${esc(e.name)}</strong> — ${e.sets.map((s) => `${s.reps}×${s.weight ?? "BW"}`).join(", ")}</li>`).join("")}</ul>
          ${w.notes ? `<p class="muted">📝 ${esc(w.notes)}</p>` : ""}
          <button class="danger small" data-action="delete" data-id="${w.id}">Delete</button>
        </details>`).join("") : `<div class="card"><p class="muted">No workouts yet. Plan one on the Today tab.</p></div>`}`;
  } catch (e) {
    view.innerHTML = `<div class="card"><p class="muted">${esc(e.message)}</p></div>`;
  }
}

// ---------- settings ----------
async function renderSettings() {
  const cfg = getCfg();
  const s = state.settings;
  view.innerHTML = `
    <div class="card stack">
      <h2>Connection</h2>
      <div><label>Worker URL</label><input id="cfg-url" type="url" placeholder="https://ai-gym-coach-api.you.workers.dev" value="${esc(cfg.apiUrl)}" autocapitalize="off" /></div>
      <div><label>Passphrase</label><input id="cfg-pass" type="password" value="${esc(cfg.passphrase)}" autocomplete="current-password" /></div>
      <button class="ghost" data-action="save-cfg">Save & test connection</button>
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
    </div>` : cfg.apiUrl ? `<div class="card"><span class="spinner"></span> Loading training settings…</div>` : ""}
    <p class="muted" style="text-align:center">Install: Safari → Share → Add to Home Screen</p>`;
  if (!s && cfg.apiUrl) {
    try {
      state.settings = await api("/api/settings");
      if (state.tab === "settings") renderSettings();
    } catch (e) {
      toast(e.message);
    }
  }
}

// ---------- events ----------
view.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("[data-action]");
  if (!btn) return;
  const a = btn.dataset.action;
  const p = state.planner;
  const s = getSession();

  if (a === "go-settings") return switchTab("settings");
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
    if (!confirm("Delete this workout from history?")) return;
    try { await api(`/api/workouts/${btn.dataset.id}`, { method: "DELETE" }); state.next = null; renderHistory(); }
    catch (e) { toast(e.message); }
    return;
  }

  if (a === "save-cfg") {
    save(CFG_KEY, { apiUrl: document.getElementById("cfg-url").value.trim(), passphrase: document.getElementById("cfg-pass").value });
    state.settings = null;
    state.next = null;
    try { state.settings = await api("/api/settings"); toast("Connected ✔", true); }
    catch (e) { toast(e.message); }
    return renderSettings();
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
  if (ev.target.dataset.field === "split_day") { state.planner.split_day = ev.target.value; renderPlanner(); }
});

// ---------- boot ----------
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
render();
