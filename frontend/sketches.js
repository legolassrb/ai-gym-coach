// Hand-drawn style exercise sketches. Every movement shares one 120x80 canvas, the same stroke
// weights, a ground line and the #pencil filter (defined in index.html), so they look uniform.
// body = stick figure (text color), head = [cx, cy], gear = equipment (accent), plates = circles.

const SKETCHES = {
  squat: {
    head: [62, 18],
    body: "M61 25 L54 46 M54 46 L70 52 L64 72 L72 72 M60 30 L50 33 L48 28",
    gear: "M28 28 L92 28 M32 20 L32 36 M36 22 L36 34 M88 20 L88 36 M84 22 L84 34",
  },
  hinge: {
    head: [80, 30],
    body: "M75 34 L50 40 M50 40 L54 56 L52 72 L60 72 M72 36 L70 56",
    plates: [[70, 62, 10], [70, 62, 2]],
  },
  lunge: {
    head: [60, 14],
    body: "M60 20 L60 42 M60 42 L76 52 L76 72 L84 72 M60 42 L48 64 L36 70 M60 25 L58 44",
    gear: "M52 46 L64 46 M52 42 L52 50 M64 42 L64 50",
  },
  horizontal_press: {
    head: [34, 45],
    body: "M41 49 L70 50 M70 50 L82 42 L86 72 M46 50 L52 38 L54 24",
    gear: "M26 56 L92 56 M36 56 L36 72 M84 56 L84 72",
    plates: [[56, 15, 8], [56, 15, 2]],
  },
  vertical_press: {
    head: [60, 22],
    body: "M60 28 L60 50 M60 50 L54 72 M60 50 L66 72 M60 31 L48 24 L48 11 M60 31 L72 24 L72 11",
    gear: "M30 10 L90 10 M34 3 L34 17 M38 5 L38 15 M86 3 L86 17 M82 5 L82 15",
  },
  push_up: {
    head: [90, 41],
    body: "M84 46 L26 68 L22 72 M80 48 L80 72 L86 72",
  },
  horizontal_pull: {
    head: [52, 28],
    body: "M52 34 L48 58 M48 58 L66 50 L84 62 M51 38 L40 45 L58 46",
    gear: "M38 60 L60 60 M49 60 L49 72 M96 18 L96 72 M90 62 L90 70 M96 46 L58 46",
  },
  vertical_pull: {
    head: [60, 21],
    body: "M60 27 L60 50 M46 8 L48 24 L57 28 M74 8 L72 24 L63 28 M60 50 L54 62 L60 70 M60 50 L66 62 L70 70",
    gear: "M26 8 L94 8 M30 8 L30 2 M90 8 L90 2",
  },
  curl: {
    head: [56, 14],
    body: "M56 20 L56 46 M56 46 L50 72 M56 46 L62 72 M56 24 L58 40 L70 30",
    gear: "M64 30 L76 30 M64 25 L64 35 M76 25 L76 35",
  },
  triceps: {
    head: [58, 16],
    body: "M58 22 L56 48 M56 48 L52 72 M56 48 L62 72 M58 26 L60 38 L72 48",
    gear: "M92 4 L92 72 M92 10 L86 10 L74 46 M68 48 L78 48",
  },
  lateral_raise: {
    head: [60, 16],
    body: "M60 22 L60 48 M60 48 L52 72 M60 48 L68 72 M60 26 L38 28 M60 26 L82 28",
    gear: "M35 23 L35 33 M85 23 L85 33",
  },
  calf: {
    head: [60, 14],
    body: "M60 20 L60 42 M60 42 L58 58 L64 64 M60 24 L56 42 M60 24 L64 42",
    gear: "M44 64 L78 64 L78 72 M44 64 L44 72 M90 54 L90 40 M86 44 L90 40 L94 44",
  },
  core: {
    head: [94, 44],
    body: "M88 49 L24 66 L22 72 M84 51 L84 70 L96 70",
  },
  carry: {
    head: [60, 12],
    body: "M60 18 L60 44 M60 44 L50 72 M60 44 L70 70 M60 22 L53 44 M60 22 L67 44",
    plates: [[52, 51, 5], [68, 51, 5]],
  },
  cardio: {
    head: [67, 14],
    body: "M65 20 L58 42 M58 42 L72 52 L80 62 M58 42 L50 56 L38 58 M63 24 L72 32 L78 26 M63 24 L52 30 L48 38",
    gear: "M18 30 L32 30 M14 40 L28 40 M20 50 L30 50",
  },
  mobility: {
    head: [56, 12],
    body: "M56 18 L56 44 M56 44 L72 54 L72 72 M56 44 L44 64 L32 72 M56 22 L44 8 M56 22 L68 8",
  },
  general: {
    head: [60, 14],
    body: "M60 20 L60 46 M60 46 L52 72 M60 46 L68 72 M60 24 L50 40 M60 24 L70 40",
    gear: "M46 40 L54 40 M66 40 L74 40",
  },
};

// Keyword fallback for exercises without a movement tag (older history, manual logs). First match wins.
const RULES = [
  ["mobility", /stretch|mobility|yoga|foam|cat.?cow|warm.?up/],
  ["cardio", /\brun|jog|sprint|bike|cycl|rower|rowing machine|erg\b|elliptical|jump|burpee|skip|rope|cardio|stair/],
  ["calf", /calf|calves/],
  ["hinge", /deadlift|\brdl\b|romanian|good morning|hip thrust|glute bridge|swing|leg curl|hamstring|back extension|hyperextension/],
  ["lunge", /lunge|split squat|step.?up|bulgarian/],
  ["squat", /squat|leg press|hack|leg extension|wall sit/],
  ["vertical_pull", /pull.?up|chin.?up|pulldown|pull.?down|lat\b/],
  ["horizontal_pull", /row|face pull|reverse fly/],
  ["curl", /curl/],
  ["triceps", /tricep|pushdown|push.?down|skull|dip|kickback|overhead extension/],
  ["core", /plank|crunch|sit.?up|\babs?\b|core|dead bug|hollow|russian|leg raise|pallof|bird dog|rollout|twist/],
  ["lateral_raise", /lateral|raise|fly|flye|rear delt|shrug/],
  ["vertical_press", /overhead|shoulder press|military|\bohp\b|arnold|push press|landmine press/],
  ["push_up", /push.?up|press.?up/],
  ["horizontal_press", /bench|chest press|incline|decline|floor press|dumbbell press|press/],
  ["carry", /carry|farmer|suitcase|walk|kettlebell/],
];

export function movementFor(name, movement) {
  if (movement && SKETCHES[movement]) return movement;
  const n = String(name ?? "").toLowerCase();
  return RULES.find(([, re]) => re.test(n))?.[0] ?? "general";
}

export function sketchSvg(name, movement, size = "") {
  const key = movementFor(name, movement);
  const s = SKETCHES[key];
  const plates = (s.plates ?? []).map(([cx, cy, r]) => `<circle class="gear" cx="${cx}" cy="${cy}" r="${r}"/>`).join("");
  const [hx, hy] = s.head;
  return `<svg class="sketch ${size}" viewBox="0 0 120 80" role="img" aria-label="${key.replace(/_/g, " ")} sketch">
    <g filter="url(#pencil)" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path class="ground" d="M8 73 L112 73"/>
      ${s.gear ? `<path class="gear" d="${s.gear}"/>` : ""}${plates}
      <path class="body ghost" d="${s.body}" transform="translate(.9 .7)"/>
      <path class="body" d="${s.body}"/>
      <circle class="body" cx="${hx}" cy="${hy}" r="6"/>
    </g></svg>`;
}
