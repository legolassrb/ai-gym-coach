// Small inline-SVG charts (single series, accent color). Each chart has a hover/tap tooltip;
// call wireCharts(root) after inserting the markup.

const W = 320;
const H = 160;
const M = { top: 16, right: 14, bottom: 22, left: 38 };

export const compact = (n) =>
  n == null ? "–" : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : String(Math.round(n * 10) / 10);

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((m) => m >= v);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function frame(yMax, inner, tips, label) {
  const ih = H - M.top - M.bottom;
  const ticks = [0, 0.5, 1].map((f) => {
    const y = M.top + ih * (1 - f);
    return `<line class="grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>
      <text class="tick" x="${M.left - 6}" y="${y + 4}" text-anchor="end">${compact(yMax * f)}</text>`;
  });
  return `<div class="chart" data-tips='${esc(JSON.stringify(tips))}'>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${ticks.join("")}${inner}
      <line class="crosshair hidden" y1="${M.top}" y2="${H - M.bottom}"/></svg>
    <div class="chart-tip hidden"></div></div>`;
}

// points: [{ label, value, tip }]; highlightLast draws earlier bars muted
export function barChart(points, label, { highlightLast = false } = {}) {
  const ih = H - M.top - M.bottom;
  const iw = W - M.left - M.right;
  const yMax = niceMax(Math.max(...points.map((p) => p.value || 0)));
  const band = iw / points.length;
  const bw = Math.min(24, band - 2);
  const tips = [];
  const bars = points.map((p, i) => {
    const cx = M.left + band * i + band / 2;
    const h = ((p.value || 0) / yMax) * ih;
    const x = cx - bw / 2;
    const y = M.top + ih - h;
    const r = Math.min(4, h, bw / 2);
    tips.push({ x: cx, text: p.tip });
    const bar = h > 0
      ? `<path class="bar${highlightLast && i < points.length - 1 ? " muted" : ""}" data-i="${i}" d="M${x} ${M.top + ih} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + bw - r} Q${x + bw} ${y} ${x + bw} ${y + r} V${M.top + ih} Z"/>`
      : "";
    const every = Math.ceil(points.length / 5);
    const showLabel = i === points.length - 1 || (i % every === 0 && points.length - 1 - i >= every / 2);
    return `${bar}${showLabel ? `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(p.label)}</text>` : ""}`;
  });
  return frame(yMax, `<line class="axis" x1="${M.left}" x2="${W - M.right}" y1="${M.top + ih}" y2="${M.top + ih}"/>${bars.join("")}`, tips, label);
}

// points: [{ t (ms), value, label, tip }] sorted by t
export function lineChart(points, label) {
  const ih = H - M.top - M.bottom;
  const iw = W - M.left - M.right;
  const vals = points.map((p) => p.value);
  const yMax = niceMax(Math.max(...vals) * 1.1);
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const sx = (t) => (t1 === t0 ? M.left + iw / 2 : M.left + ((t - t0) / (t1 - t0)) * iw);
  const sy = (v) => M.top + ih - (v / yMax) * ih;
  const xy = points.map((p) => [sx(p.t), sy(p.value)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)} ${M.top + ih} L${xy[0][0].toFixed(1)} ${M.top + ih} Z`;
  const [ex, ey] = xy[xy.length - 1];
  const last = points[points.length - 1];
  const tips = points.map((p, i) => ({ x: xy[i][0], y: xy[i][1], text: p.tip }));
  const inner = `
    <line class="axis" x1="${M.left}" x2="${W - M.right}" y1="${M.top + ih}" y2="${M.top + ih}"/>
    <path class="area" d="${area}"/><path class="line" d="${line}"/>
    ${xy.length > 1 ? xy.slice(0, -1).map(([x, y]) => `<circle class="pt" cx="${x}" cy="${y}" r="2.5"/>`).join("") : ""}
    <circle class="dot" cx="${ex}" cy="${ey}" r="4"/>
    <circle class="dot hover hidden" r="4"/>
    <text class="end-label" x="${Math.min(ex, W - M.right - 2)}" y="${ey - 10}" text-anchor="${ex > W - 60 ? "end" : "middle"}">${esc(compact(last.value))}</text>
    <text class="tick" x="${M.left}" y="${H - 6}">${esc(points[0].label)}</text>
    ${points.length > 1 ? `<text class="tick" x="${W - M.right}" y="${H - 6}" text-anchor="end">${esc(last.label)}</text>` : ""}`;
  return frame(yMax, inner, tips, label);
}

export function wireCharts(root) {
  root.querySelectorAll(".chart").forEach((el) => {
    const tips = JSON.parse(el.dataset.tips || "[]");
    const svg = el.querySelector("svg");
    const tip = el.querySelector(".chart-tip");
    const cross = el.querySelector(".crosshair");
    const hoverDot = el.querySelector(".dot.hover");
    const hide = () => {
      tip.classList.add("hidden");
      cross.classList.add("hidden");
      hoverDot?.classList.add("hidden");
      el.querySelectorAll(".bar.on").forEach((b) => b.classList.remove("on"));
    };
    const show = (ev) => {
      if (!tips.length) return;
      const box = svg.getBoundingClientRect();
      const vx = ((ev.clientX - box.left) / box.width) * W;
      let i = 0;
      tips.forEach((t, j) => { if (Math.abs(t.x - vx) < Math.abs(tips[i].x - vx)) i = j; });
      const t = tips[i];
      cross.setAttribute("x1", t.x);
      cross.setAttribute("x2", t.x);
      cross.classList.remove("hidden");
      if (hoverDot && t.y != null) {
        hoverDot.setAttribute("cx", t.x);
        hoverDot.setAttribute("cy", t.y);
        hoverDot.classList.remove("hidden");
      }
      el.querySelectorAll(".bar").forEach((b) => b.classList.toggle("on", Number(b.dataset.i) === i));
      tip.textContent = t.text;
      tip.classList.remove("hidden");
      const px = (t.x / W) * box.width;
      tip.style.left = `${Math.max(4, Math.min(px - tip.offsetWidth / 2, box.width - tip.offsetWidth - 4))}px`;
    };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", hide);
  });
}
