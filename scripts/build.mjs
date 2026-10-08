// Builds every SVG in generated/ from live GitHub data, in a black-and-blood snake theme.
// The three snakes (stipple, sketch, viper) live in assets/snake/ and are embedded into each card.
// Runs daily in .github/workflows/build.yml. Locally: GITHUB_TOKEN=$(gh auth token) node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("profile.config.json", root)));
const icons = JSON.parse(readFileSync(new URL("assets/icons/icons.json", root)));
const OUT = new URL("generated/", root);
mkdirSync(OUT, { recursive: true });
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
const USER = config.user;

/* ---------------------------------------------------------------- design */

// Deadly black, royal blood red, bone white.
const C = {
  void: "#030303", ink: "#08080a", ink2: "#111114", ash: "#1d1d21", smoke: "#2c2c31",
  bone: "#f1ebe6", boneDk: "#a8a29e", mute: "#6d6866",
  blood: "#b3001e", bloodLt: "#e3122f", bloodDk: "#5e0010", ember: "#ff2b40", wine: "#2a0008",
};
const HEAT = ["#161619", "#4a0711", "#7d0a1c", "#b5102a", "#ff2b40"];
const RAMP = [C.ember, C.blood, C.bone, C.bloodDk, C.boneDk, C.mute];
const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
const EASE_POP = "cubic-bezier(.34,1.56,.64,1)";

const FONT_FILES = {
  display: ["Cinzel", 900, "cinzel-900"], displaySemi: ["Cinzel", 600, "cinzel-600"],
  goth: ["Pirata One", 400, "pirata-400"], body: ["DM Sans", 400, "dmsans-400"], bodyBold: ["DM Sans", 700, "dmsans-700"],
  mono: ["DM Mono", 400, "dmmono-400"], monoBold: ["DM Mono", 500, "dmmono-500"],
};
const fontCache = {};
function fonts(...keys) {
  return keys
    .map((k) => {
      const [family, weight, file] = FONT_FILES[k];
      fontCache[file] ??= readFileSync(new URL(`fonts/${file}.woff2`, root)).toString("base64");
      return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fontCache[file]}) format('woff2');}`;
    })
    .join("");
}
const F = {
  display: "'Cinzel', 'Trajan Pro', Georgia, serif",
  goth: "'Pirata One', 'Old English Text MT', serif",
  body: "'DM Sans', 'Segoe UI', sans-serif",
  mono: "'DM Mono', Consolas, monospace",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const write = (name, svg) => writeFileSync(new URL(name, OUT), svg.replace(/\n\s+/g, "\n"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svgOpen = (W, H, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`;
const n1 = (v) => +v.toFixed(1);

// Deterministic randomness, so a rebuild only changes when the data does.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- snakes */

const asset = (file, mime) => `data:${mime};base64,${readFileSync(new URL(`assets/snake/${file}`, root)).toString("base64")}`;
const IMG = {
  stipple: [asset("stipple.jpg", "image/jpeg"), 300, 532],
  stippleSq: [asset("stipple-sq.jpg", "image/jpeg"), 420, 420],
  sketch: [asset("sketch.jpg", "image/jpeg"), 240, 557],
  viper: [asset("viper.png", "image/png"), 420, 386],
};
// Each snake as a luminance mask in bounding-box units: any shape with mask="url(#m-viper)" becomes that
// snake, filled with whatever colour or gradient the shape has.
const snakeMasks = (...keys) =>
  keys.map((k) => `<mask id="m-${k}" maskContentUnits="objectBoundingBox" x="0" y="0" width="1" height="1"><image href="${IMG[k][0]}" width="1" height="1" preserveAspectRatio="none"/></mask>`).join("");
// A snake at x,y, `w` wide, painted with `fill`.
const snake = (k, x, y, w, fill, attrs = "") => `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1((w * IMG[k][2]) / IMG[k][1])}" fill="${fill}" mask="url(#m-${k})" ${attrs}/>`;
// The viper's eyes, relative to its box (0..1).
const VIPER_EYES = [[0.24, 0.245, 28], [0.76, 0.245, -28]];
const viperEyes = (x, y, w, r = 1) => {
  const h = (w * IMG.viper[2]) / IMG.viper[1];
  return VIPER_EYES.map(([ex, ey, rot]) => `<g transform="translate(${n1(x + ex * w)},${n1(y + ey * h)}) rotate(${rot})"><ellipse rx="${n1(w * 0.05 * r)}" ry="${n1(w * 0.016 * r)}" fill="${C.ember}" filter="url(#glow)" class="eye"/><ellipse rx="${n1(w * 0.035 * r)}" ry="${n1(w * 0.009 * r)}" fill="#ffd9dc" class="eye"/></g>`).join("");
};

// A hand-sketched snake (the second reference): a bundle of jittery white outlines with a red scribble
// down the spine. It slithers in place by morphing between phase-shifted frames.
function sketchSnake({ len = 420, amp = 16, waves = 1.6, width = 9, seed = 1, frames = 8, dur = 2.4, strokes = 6 }) {
  const N = 46;
  const outline = (phase, jit) => {
    const spine = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const env = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      spine.push([t * len, amp * env * Math.sin(Math.PI * 2 * waves * t - phase)]);
    }
    const side = (s) =>
      spine.map(([x, y], i) => {
        const [x0, y0] = spine[Math.max(0, i - 1)], [x1, y1] = spine[Math.min(N, i + 1)];
        const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1;
        const t = i / N;
        let w = width * Math.min(1, 0.12 + t * 1.6);
        if (t > 0.9) w *= 1 + 1.3 * Math.sin(((t - 0.9) / 0.1) * Math.PI * 0.85); // the head
        if (t > 0.985) w *= 0.4;
        w += jit(i, s);
        return [x - (dy / l) * w * s, y + (dx / l) * w * s];
      });
    const pts = [...side(1), ...side(-1).reverse()];
    return pts.map(([x, y], i) => `${i ? "L" : "M"}${n1(x)} ${n1(y)}`).join("") + "Z";
  };
  const scribble = (phase) => {
    let d = "";
    for (let i = 0; i <= 120; i++) {
      const t = 0.04 + (i / 120) * 0.9;
      const env = 0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      const x = t * len + Math.cos(i * 1.7) * width * 0.35;
      const y = amp * env * Math.sin(Math.PI * 2 * waves * t - phase) + Math.sin(i * 1.7) * width * 0.4;
      d += `${i ? "L" : "M"}${n1(x)} ${n1(y)}`;
    }
    return d;
  };
  const phases = Array.from({ length: frames + 1 }, (_, f) => (f / frames) * Math.PI * 2);
  const r = rng(seed);
  let out = "";
  for (let s = 0; s < strokes; s++) {
    const a = r() * 6, b = 0.8 + r() * 1.6, c = (r() - 0.5) * 2.4;
    const jit = (i, side) => c + Math.sin(i * 0.35 * b + a + side) * 1.3;
    const ds = phases.map((p) => outline(p, jit));
    out += `<path d="${ds[0]}" fill="none" stroke="${C.bone}" stroke-opacity="${(0.35 + r() * 0.5).toFixed(2)}" stroke-width="${(0.6 + r() * 0.7).toFixed(2)}" stroke-linejoin="round"><animate attributeName="d" dur="${dur}s" repeatCount="indefinite" values="${ds.join(";")}"/></path>`;
  }
  const sc = phases.map(scribble);
  out += `<path d="${sc[0]}" fill="none" stroke="${C.bloodLt}" stroke-width=".9" stroke-opacity=".9"><animate attributeName="d" dur="${dur}s" repeatCount="indefinite" values="${sc.join(";")}"/></path>`;
  return `<g>${out}</g>`;
}

/* ------------------------------------------------------------ atmosphere */

const rgb = (hex) => [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));
// Fractal-noise smoke tinted `col`. Put it on an oversized rect and drift the rect.
const smokeFilter = (id, col, seed, freq = "0.0045 0.012", k = 2.6, c = 1.2) => {
  const [r, g, b] = rgb(col);
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="4" seed="${seed}"/>
    <feColorMatrix values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${k} 0 0 0 ${-c}"/></filter>`;
};
const COMMON_DEFS = `
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="9"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .075 0"/></filter>
  <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="3.5"/></filter>
  <filter id="haze" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
  <radialGradient id="vig" cx=".5" cy=".5" r=".75"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></radialGradient>
  <linearGradient id="boneBlood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bone}"/><stop offset=".55" stop-color="#e8c9c9"/><stop offset="1" stop-color="${C.blood}"/></linearGradient>
  <linearGradient id="bloodFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bloodLt}"/><stop offset="1" stop-color="${C.bloodDk}"/></linearGradient>`;
// Two drifting smoke banks, feathered top and bottom so they never show an edge.
const smokeLayers = (W, H, a = 0.55) => `
    <g mask="url(#feather)" opacity="${a}"><rect x="${-W * 0.4}" y="${H * 0.1}" width="${W * 1.8}" height="${H}" filter="url(#smokeA)" class="driftA"/></g>
    <g mask="url(#feather)" opacity="${a * 0.9}"><rect x="${-W * 0.4}" y="${H * 0.3}" width="${W * 1.8}" height="${H * 0.8}" filter="url(#smokeB)" class="driftB"/></g>`;
const SMOKE_DEFS = `${smokeFilter("smokeA", "#8f8a88", 3, "0.0045 0.012", 2.6, 1.42)}${smokeFilter("smokeB", C.blood, 11, "0.006 0.016", 2.4, 1.3)}
  <linearGradient id="featherG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000"/><stop offset=".35" stop-color="#fff"/><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
  <mask id="feather" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#featherG)"/></mask>`;
const BASE_CSS = `
    .driftA{animation:driftA 26s ease-in-out infinite alternate}
    .driftB{animation:driftB 34s ease-in-out infinite alternate}
    @keyframes driftA{from{transform:translate(0,0)}to{transform:translate(-${180}px,-24px)}}
    @keyframes driftB{from{transform:translate(-160px,10px)}to{transform:translate(40px,-30px)}}
    .eye{animation:eye 5s ease-in-out infinite}
    @keyframes eye{0%,44%,52%,100%{opacity:1}48%{opacity:.08}}
    .pulse{transform-box:fill-box;transform-origin:center;animation:pulse 1.8s ease-out infinite}
    @keyframes pulse{from{transform:scale(1);opacity:.8}to{transform:scale(3);opacity:0}}
    .up{opacity:0;animation:up .9s ${EASE_OUT} forwards}
    @keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    .scrib{stroke-dasharray:600;stroke-dashoffset:600;animation:draw 1.3s ${EASE_OUT} .5s forwards}
    @keyframes draw{to{stroke-dashoffset:0}}`;
// Embers rising through the smoke.
function embers(n, W, H, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const x = (r() * W).toFixed(0), s = (0.6 + r() * 1.6).toFixed(1), d = (6 + r() * 8).toFixed(1), dl = (-r() * 14).toFixed(1);
    const dx = ((r() - 0.5) * 90).toFixed(0);
    return `<circle cx="${x}" cy="${H + 6}" r="${s}" fill="${r() > 0.3 ? C.ember : C.bone}" class="ember" style="animation-duration:${d}s;animation-delay:${dl}s;--dx:${dx}px"/>`;
  }).join("");
}
const EMBER_CSS = (H) => `.ember{opacity:0;animation:ember linear infinite}@keyframes ember{0%{opacity:0;transform:translate(0,0)}12%{opacity:.95}70%{opacity:.5}100%{opacity:0;transform:translate(var(--dx),-${H + 20}px)}}`;
const frameEdge = (W, H, rx = 22) => `<rect width="${W}" height="${H}" fill="url(#vig)"/><rect width="${W}" height="${H}" filter="url(#grain)"/>`;
const border = (W, H, rx = 22) => `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${rx - 1}" fill="none" stroke="${C.blood}" stroke-opacity=".45" stroke-width="1.5"/>
  <path d="M14 40V14H40M${W - 40} 14H${W - 14}V40M${W - 14} ${H - 40}V${H - 14}H${W - 40}M40 ${H - 14}H14V${H - 40}" fill="none" stroke="${C.bloodLt}" stroke-width="2" stroke-linecap="square" opacity=".8"/>`;

/* ------------------------------------------------------------------ data */

async function gh(path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `bearer ${TOKEN}`, "User-Agent": USER, Accept: "application/vnd.github+json" },
    body: body && JSON.stringify(body),
  });
  if (res.status === 202) return { pending: true };
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
async function graphql(query, variables) {
  const { data, errors } = await gh("/graphql", { query, variables });
  if (errors) throw new Error(JSON.stringify(errors));
  return data;
}

const DAYS = `weeks { contributionDays { date contributionCount } }`;
const { user } = await graphql(
  `query($login: String!) {
    user(login: $login) {
      login createdAt
      followers { totalCount }
      contributionsCollection {
        contributionYears totalCommitContributions totalPullRequestContributions totalIssueContributions totalRepositoryContributions
        contributionCalendar { totalContributions ${DAYS} }
      }
      repositoriesContributedTo(first: 1, includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes {
          name description url isFork isArchived stargazerCount forkCount createdAt pushedAt
          languages(first: 6, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
          repositoryTopics(first: 6) { nodes { topic { name } } }
          defaultBranchRef { target { ... on Commit { history { totalCount } messageHeadline } } }
        }
      }
    }
  }`,
  { login: USER },
);
const years = user.contributionsCollection.contributionYears;
const yearly = await graphql(
  `query($login: String!) { user(login: $login) { ${years
    .map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { contributionCalendar { totalContributions ${DAYS} } }`)
    .join("\n")} } }`,
  { login: USER },
);
const allTimeContributions = years.reduce((n, y) => n + yearly.user[`y${y}`].contributionCalendar.totalContributions, 0);
const repos = user.repositories.nodes.filter((r) => !r.isFork);
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);

// Lines of code authored by USER, from contributor stats (cached, since GitHub computes them lazily).
const cachePath = new URL("cache.json", OUT);
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath)) : {};
let loc = { add: 0, del: 0 };
for (const r of repos) {
  let stats;
  for (let attempt = 0; attempt < 6; attempt++) {
    stats = await gh(`/repos/${USER}/${r.name}/stats/contributors`);
    if (!stats.pending) break;
    await sleep(3000);
  }
  if (Array.isArray(stats)) {
    const mine = stats.find((s) => s.author?.login?.toLowerCase() === USER.toLowerCase());
    cache[r.name] = mine ? mine.weeks.reduce((a, w) => ({ add: a.add + w.a, del: a.del + w.d }), { add: 0, del: 0 }) : { add: 0, del: 0 };
  }
  if (cache[r.name]) loc = { add: loc.add + cache[r.name].add, del: loc.del + cache[r.name].del };
}
writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");

/* --------------------------------------------------------------- helpers */

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fmt = (n) => n.toLocaleString("en-US");
function uptime(from) {
  const a = new Date(from), b = new Date();
  let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth(), d = b.getUTCDate() - a.getUTCDate();
  if (d < 0) { m--; d += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate(); }
  if (m < 0) { y--; m += 12; }
  return `${plural(y, "year")}, ${plural(m, "month")}, ${plural(d, "day")}`;
}
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  for (const [unit, sec] of [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]])
    if (s >= sec) return `${plural(Math.floor(s / sec), unit)} ago`;
  return "just now";
}
function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const w of text.split(/\s+/)) {
    if ((line + " " + w).trim().length > max) { lines.push(line.trim()); line = ""; }
    line += " " + w;
  }
  return [...lines, line.trim()].filter(Boolean);
}
const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: config.timezone });
const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: config.timezone });
const launches = repos.filter((r) => !config.launches.hide.includes(r.name) && !r.isArchived);
const commitsOf = (r) => r.defaultBranchRef?.target.history.totalCount ?? 0;

// Every contribution day since the account began, plus the last-365-days calendar.
const dayMap = new Map();
for (const y of years) for (const w of yearly.user[`y${y}`].contributionCalendar.weeks) for (const d of w.contributionDays) if (d.date <= todayISO) dayMap.set(d.date, d.contributionCount);
const allDays = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const calWeeks = user.contributionsCollection.contributionCalendar.weeks.map((w) => w.contributionDays.filter((d) => d.date <= todayISO));
const lastYear = calWeeks.flat();
const lastYearTotal = lastYear.reduce((n, d) => n + d.contributionCount, 0);
const streaks = (() => {
  let longest = 0, run = 0, longestEnd = null;
  for (const [date, c] of allDays) {
    run = c > 0 ? run + 1 : 0;
    if (run > longest) { longest = run; longestEnd = date; }
  }
  let current = 0, i = allDays.length - 1;
  if (i >= 0 && allDays[i][1] === 0) i--; // today isn't over yet
  for (; i >= 0 && allDays[i][1] > 0; i--) current++;
  return { current, longest, longestEnd };
})();
const bestDay = allDays.reduce((b, d) => (d[1] > b[1] ? d : b), ["", 0]);
const activeDays = lastYear.filter((d) => d.contributionCount > 0).length;
const shortDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const langBytes = (() => {
  const bytes = {};
  for (const r of repos) for (const e of r.languages.edges) bytes[e.node.name] = (bytes[e.node.name] ?? 0) + e.size;
  return Object.entries(bytes).sort((a, b) => b[1] - a[1]);
})();

/* ---------------------------------------------------------------- header */
{
  const W = 900, H = 380;
  const phrases = config.header.phrases;
  const P = 3.6;
  const lead = phrases
    .map((p, i) => `<text x="0" y="0" class="lead" style="animation-delay:${(1.4 + i * P).toFixed(1)}s"><tspan class="pr">›</tspan> ${esc(p)}</text>`)
    .join("");
  const cx = 722, cy = 190, R = 116;
  const orbit = Array.from({ length: 8 }, (_, k) => `<g transform="rotate(${k * 45}) translate(0,${-R - 34})">${snake("viper", -11, -10, 22, k % 2 ? C.bloodDk : C.blood)}</g>`).join("");
  const drips = [[60, 18, 0], [190, 26, 0.6], [318, 14, 1.2], [402, 22, 0.3]]
    .map(([x, h, d]) => `<path d="M${x} 6 q2 ${h * 0.6} 0 ${h} a3 3 0 1 1 -1 0 q-1 ${-h * 0.4} 1 ${-h}z" fill="${C.blood}" class="drip" style="animation-delay:${(1.8 + d).toFixed(1)}s"/>`)
    .join("");
  write("header.svg", `${svgOpen(W, H, "Devapriyan G S, aka Dedoo / Hebi")}
  <defs>
    ${COMMON_DEFS}${SMOKE_DEFS}${snakeMasks("stippleSq", "viper")}
    <radialGradient id="pool" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.blood}" stop-opacity=".55"/><stop offset=".5" stop-color="${C.bloodDk}" stop-opacity=".25"/><stop offset="1" stop-color="${C.bloodDk}" stop-opacity="0"/></radialGradient>
    <linearGradient id="name" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="${C.bone}"/><stop offset="1" stop-color="${C.boneDk}"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="22"/></clipPath>
    <clipPath id="dp"><circle r="${R}"/></clipPath>
    <clipPath id="line1"><rect x="-10" y="-70" width="640" height="90"/></clipPath>
  </defs>
  <style>
    ${fonts("display", "goth", "mono")}
    .name{font:900 50px ${F.display};fill:url(#name);letter-spacing:2px}
    .nameGlow{font:900 50px ${F.display};fill:${C.blood};letter-spacing:2px;animation:flick 4s steps(1) infinite}
    @keyframes flick{0%,100%{opacity:.9}41%{opacity:.3}43%{opacity:.95}71%{opacity:.5}72%{opacity:.9}}
    .goth{font:400 31px ${F.goth};fill:${C.bloodLt}}
    .lead{font:400 16px ${F.mono};fill:${C.boneDk};opacity:0;animation:cycle ${P * phrases.length}s ${EASE_OUT} infinite}
    .pr{fill:${C.bloodLt}}
    @keyframes cycle{0%{opacity:0;transform:translateX(-14px)}5%,28%{opacity:1;transform:none}33%,100%{opacity:0;transform:translateX(10px)}}
    .aka{font:400 13px ${F.mono};fill:${C.bone};letter-spacing:2.4px}
    .aka .r{fill:${C.bloodLt}}
    .rise{animation:rise 1.3s ${EASE_OUT} both}
    @keyframes rise{from{transform:translateY(90px)}}
    .fade{opacity:0;animation:fade 1s ${EASE_OUT} forwards}
    @keyframes fade{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
    .drip{transform-box:fill-box;transform-origin:top;transform:scaleY(0);animation:drip 6s ease-in infinite}
    @keyframes drip{0%{transform:scaleY(0)}30%{transform:scaleY(1)}80%{transform:scaleY(1.25);opacity:1}100%{transform:scaleY(1.4);opacity:0}}
    .breathe{animation:breathe 5s ease-in-out infinite}
    @keyframes breathe{50%{transform:scale(1.035)}}
    .poolP{animation:poolP 4s ease-in-out infinite}
    @keyframes poolP{50%{opacity:.55}}
    .spin{animation:spin 40s linear infinite}.spinR{animation:spin 24s linear infinite reverse}
    @keyframes spin{to{transform:rotate(360deg)}}
    .ring{animation:ring 3s ease-in-out infinite}
    @keyframes ring{50%{stroke-opacity:.25}}
    .sketch{animation:sk 18s ease-in-out infinite alternate}
    @keyframes sk{to{transform:translate(60px,-8px)}}
    .caret{animation:blink 1s steps(1) infinite}@keyframes blink{50%{opacity:0}}
    ${BASE_CSS} ${EMBER_CSS(H)}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.void}"/>
    <circle cx="${cx}" cy="${cy}" r="260" fill="url(#pool)" class="poolP"/>
    <g class="sketch" opacity=".16"><image href="${IMG.sketch[0]}" width="${IMG.sketch[1]}" height="${IMG.sketch[2]}" transform="translate(-40,372) rotate(-90) scale(.62)" style="mix-blend-mode:screen"/></g>
    ${smokeLayers(W, H, 0.5)}
    ${embers(26, W, H, 7)}

    <g transform="translate(54,92) rotate(-3)"><text class="goth fade" style="animation-delay:.2s">hey there, I'm</text></g>
    <g transform="translate(52,164)" clip-path="url(#line1)">
      <g class="rise" style="animation-delay:.35s"><text class="nameGlow" filter="url(#glow)">DEVAPRIYAN G S</text><text class="name">DEVAPRIYAN G S</text></g>
    </g>
    <g transform="translate(54,180)">
      <path d="M0 8c80-12 170-15 260-6s110 6 170-6" fill="none" stroke="${C.blood}" stroke-width="6" stroke-linecap="round" class="scrib"/>
      ${drips}
    </g>
    <g transform="translate(56,246)">${lead}</g>

    <g transform="translate(56,300)"><g class="fade" style="animation-delay:1.3s">
      <path d="M0 -4H28" stroke="${C.blood}" stroke-width="2"/>
      <text x="40" y="0" class="aka">Devapriyan.G.S <tspan class="r">aka</tspan> Dedoo/Hebi</text>
      <rect x="344" y="-12" width="8" height="15" fill="${C.bloodLt}" class="caret"/>
    </g></g>

    <g transform="translate(${cx},${cy})">
      <g class="spinR"><circle r="${R + 34}" fill="none" stroke="${C.blood}" stroke-opacity=".3" stroke-dasharray="1 7"/></g>
      <g class="spin">${orbit}</g>
      <circle r="${R + 10}" fill="none" stroke="${C.ember}" stroke-width="6" filter="url(#haze)" class="ring"/>
      <circle r="${R + 6}" fill="${C.void}" stroke="${C.blood}" stroke-width="2"/>
      <g clip-path="url(#dp)">
        <rect x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" fill="${C.void}"/>
        <g class="breathe">${snake("stippleSq", -R, -R, 2 * R, "url(#boneBlood)")}</g>
        <rect x="${-R}" y="${R * 0.25}" width="${2 * R}" height="${R}" filter="url(#smokeB)" opacity=".6" class="driftA"/>
      </g>
      <circle r="${R}" fill="none" stroke="${C.bone}" stroke-opacity=".12"/>
    </g>
  </g>
  ${frameEdge(W, H)}
  ${border(W, H)}
</svg>`);
}

/* ------------------------------------------------------ section titles */
function title(file, heading, note) {
  const W = 900, H = 120;
  write(file, `${svgOpen(W, H, heading)}
  <defs>${COMMON_DEFS}${SMOKE_DEFS}${snakeMasks("viper")}<clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath></defs>
  <style>
    ${fonts("display", "goth")}
    .h{font:900 38px ${F.display};letter-spacing:5px;fill:${C.bone};text-anchor:middle}
    .n{font:400 22px ${F.goth};fill:${C.bloodLt};text-anchor:middle}
    .bob{animation:bob 3.2s ease-in-out infinite}.bob2{animation:bob 3.2s ease-in-out -1.6s infinite}
    @keyframes bob{50%{transform:translateY(-4px)}}
    ${BASE_CSS}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.void}"/>
    ${smokeLayers(W, H, 0.35)}
  </g>
  <text x="450" y="58" class="h up">${esc(heading)}</text>
  <text x="450" y="94" class="n up" style="animation-delay:.3s">${esc(note)}</text>
  <path d="M250 70H330M570 70H650" stroke="${C.blood}" stroke-width="1.5" class="scrib"/>
  <g class="bob">${snake("viper", 92, 34, 52, "url(#bloodFade)")}${viperEyes(92, 34, 52)}</g>
  <g class="bob2">${snake("viper", W - 144, 34, 52, "url(#bloodFade)")}${viperEyes(W - 144, 34, 52)}</g>
  <rect width="${W}" height="${H}" filter="url(#grain)"/>
  <rect x=".75" y=".75" width="${W - 1.5}" height="${H - 1.5}" rx="17" fill="none" stroke="${C.blood}" stroke-opacity=".35"/>
</svg>`);
}
const toolCount = icons.groups.reduce((n, g) => n + g[1].length, 0);
title("title-launches.svg", "FRESH STRIKES", "every repo strikes with its own card, refreshed daily");
title("title-analytics.svg", "VENOM ANALYTICS", "every bite, counted");
title("title-toolbox.svg", "THE ARSENAL", `${toolCount} fangs, one very curious mind`);
title("title-activity.svg", "THE HUNT, LIVE", "hebi means snake, and this one eats my graph");

/* ------------------------------------------------------------- neofetch */
{
  const W = 900, PX = 28, PY = 44, X = 352, LH = 20.5, WIDTH = 56;
  const topLangs = langBytes.slice(0, 4).map(([n]) => n).join(", ") || "—";
  const last = launches[0] ?? repos[0];
  const kv = (key, value, valueSegs) => {
    const k = key.split(".");
    const keyParts = k.flatMap((p, i) => (i ? [[".", ""], [p, "k"]] : [[p, "k"]]));
    const used = 2 + key.length + 1 + String(value).length + 2;
    return [[". ", "d"], ...keyParts, [":", ""], [` ${".".repeat(Math.max(1, WIDTH - used))} `, "d"], ...(valueSegs ?? [[value, "v"]])];
  };
  const rule = (label) => [[`- ${label} `, "h"], ["—".repeat(Math.max(2, WIDTH - label.length - 3)), "r"]];
  const blank = [[". ", "d"]];
  const n = config.neofetch;
  const repoLine = `${repos.length} {Contributed: ${user.repositoriesContributedTo.totalCount}}`;
  const locLine = `${fmt(loc.add - loc.del)} ( +${fmt(loc.add)}, -${fmt(loc.del)} )`;
  const rows = [
    [[`hebi@${USER.toLowerCase()} `, "h"], ["—".repeat(WIDTH - USER.length - 6), "r"]],
    kv("OS", n.OS), kv("Uptime", uptime(user.createdAt)), kv("Host", n.Host), kv("Kernel", n.Kernel), kv("IDE", n.IDE),
    blank,
    kv("Languages.Programming", topLangs), kv("Hobbies.Software", n["Hobbies.Software"]), kv("Hobbies.Hardware", n["Hobbies.Hardware"]),
    blank,
    rule("Latest Launch"),
    kv("Repo", last?.name ?? "—"),
    kv("Message", (last?.defaultBranchRef?.target.messageHeadline ?? "—").slice(0, 34)),
    kv("When", last ? ago(last.pushedAt) : "—"),
    blank,
    rule("GitHub Stats"),
    kv("Repos", repoLine, [[`${repos.length}`, "v"], [" {", ""], ["Contributed", "k"], [": ", ""], [`${user.repositoriesContributedTo.totalCount}`, "v"], ["}", ""]]),
    kv("Stars", fmt(stars)), kv("Followers", fmt(user.followers.totalCount)),
    kv("Contributions", `${fmt(allTimeContributions)} all-time`),
    kv("Lines of Code", locLine, [[fmt(loc.add - loc.del), "v"], [" ( ", ""], [`+${fmt(loc.add)}`, "a"], [", ", ""], [`-${fmt(loc.del)}`, "x"], [" )", ""]]),
  ];
  const info = rows
    .map((segs, i) => `<text x="${X}" y="${PY + i * LH}" class="row" style="animation-delay:${(0.5 + i * 0.06).toFixed(2)}s">${segs.map(([s, cls]) => `<tspan${cls ? ` class="${cls}"` : ""}>${esc(s)}</tspan>`).join("")}</text>`)
    .join("");
  const endY = PY + rows.length * LH;
  const swatches = [C.void, C.ash, C.mute, C.boneDk, C.bone, C.bloodDk, C.blood, C.ember]
    .map((col, i) => `<g transform="translate(${X + 4 + i * 30},${endY + 2})"><rect width="24" height="14" rx="2" fill="${col}" stroke="${C.smoke}" class="gem" style="animation-delay:${(i * 0.12).toFixed(2)}s"/></g>`)
    .join("");
  const H = endY + 46;
  const panel = { x: PX - 8, y: 22, w: 308, h: H - 44 };
  const sh = panel.h - 20, sw = (sh * IMG.stipple[1]) / IMG.stipple[2];
  const sx = panel.x + (panel.w - sw) / 2, sy = panel.y + 10;

  write("neofetch.svg", `${svgOpen(W, H, `${USER} — neofetch with live GitHub stats`)}
  <defs>
    ${COMMON_DEFS}${SMOKE_DEFS}${snakeMasks("stipple")}
    <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.ember}" stop-opacity="0"/><stop offset=".5" stop-color="${C.ember}" stop-opacity=".35"/><stop offset="1" stop-color="${C.ember}" stop-opacity="0"/></linearGradient>
    <radialGradient id="pool" cx=".5" cy=".62" r=".6"><stop offset="0" stop-color="${C.blood}" stop-opacity=".35"/><stop offset="1" stop-color="${C.blood}" stop-opacity="0"/></radialGradient>
    <clipPath id="artClip"><rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="14"/></clipPath>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="22"/></clipPath>
  </defs>
  <style>
    ${fonts("mono", "monoBold", "goth")}
    text,tspan{white-space:pre}
    .row,.row tspan{font:400 14px ${F.mono};fill:${C.bone}}
    .k{fill:${C.bloodLt}!important} .v{fill:${C.bone}!important} .d{fill:#3a3a40!important} .r{fill:#3a1018!important}
    .a{fill:#d8d2cd!important} .x{fill:${C.ember}!important} .h{fill:${C.ember}!important;font-weight:500!important}
    .row{opacity:0;animation:slide .6s ${EASE_OUT} forwards}
    @keyframes slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
    .scan{animation:scan 5s ${EASE_OUT} 1.4s infinite}
    @keyframes scan{from{transform:translateY(-60px)}to{transform:translateY(${panel.h + 60}px)}}
    .gem{transform-box:fill-box;transform-origin:center bottom;animation:gem 2.6s ${EASE_POP} infinite}
    @keyframes gem{0%,60%,100%{transform:none}30%{transform:translateY(-5px) scaleY(1.1)}}
    .cur{fill:${C.ember};animation:blink 1s steps(1) infinite}
    @keyframes blink{50%{opacity:0}}
    .stamp{font:400 17px ${F.goth};fill:${C.mute}}
    .breathe{transform-box:fill-box;transform-origin:center;animation:breathe 6s ease-in-out infinite}
    @keyframes breathe{50%{transform:scale(1.025) translateY(-3px)}}
    .reveal{animation:reveal 2.4s ${EASE_OUT} both}
    @keyframes reveal{from{opacity:0;filter:blur(8px)}to{opacity:1;filter:blur(0)}}
    ${BASE_CSS} ${EMBER_CSS(panel.h)}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.ink}"/>
    ${smokeLayers(W, H, 0.22)}
  </g>
  <rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="14" fill="${C.void}"/>
  <g clip-path="url(#artClip)">
    <rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" fill="url(#pool)"/>
    <g class="reveal"><g class="breathe">${snake("stipple", sx, sy, sw, "url(#boneBlood)")}</g></g>
    <g transform="translate(0,${panel.y + panel.h * 0.35})">${smokeLayers(panel.w + panel.x, panel.h * 0.7, 0.6)}</g>
    <g transform="translate(${panel.x},${panel.y})">${embers(10, panel.w, panel.h, 21)}</g>
    <rect class="scan" x="${panel.x}" y="${panel.y - 30}" width="${panel.w}" height="40" fill="url(#scan)"/>
  </g>
  <rect x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="14" fill="none" stroke="${C.blood}" stroke-opacity=".5"/>
  ${info}
  ${swatches}
  <rect x="${X + 8 * 30 + 8}" y="${endY + 1}" width="9" height="16" rx="1" class="cur"/>
  <text x="${W - 30}" y="${H - 16}" class="stamp" text-anchor="end">live · refreshed ${today}</text>
  ${frameEdge(W, H)}
  ${border(W, H)}
</svg>`);
}

/* ------------------------------------------------------------- analytics */
{
  const W = 900, L = 40, R = W - 40, IW = R - L;
  const head = (x, y, label, aside = "") => `<g transform="translate(${x},${y})"><rect y="-10" width="3" height="13" fill="${C.ember}"/><text x="12" y="1.5" class="sh">${esc(label)}</text>${aside ? `<text x="${12 + label.length * 10.3 + 12}" y="1.5" class="sa">${esc(aside)}</text>` : ""}</g>`;

  // KPI tiles
  const kpis = [
    ["ALL-TIME", fmt(allTimeContributions), "contributions"],
    ["LAST 365 DAYS", fmt(lastYearTotal), `${activeDays} active days`],
    ["CURRENT STREAK", plural(streaks.current, "day"), streaks.current ? "still biting" : "lying in wait"],
    ["LONGEST STREAK", plural(streaks.longest, "day"), streaks.longestEnd ? `ended ${shortDate(streaks.longestEnd)}` : "—"],
    ["BEST DAY", fmt(bestDay[1]), bestDay[0] ? shortDate(bestDay[0]) : "—"],
    ["COMMITS", fmt(repos.reduce((n, r) => n + commitsOf(r), 0)), "on default branches"],
    ["PUBLIC REPOS", fmt(repos.length), `${fmt(stars)} stars · ${fmt(user.followers.totalCount)} followers`],
    ["NET LINES", fmt(loc.add - loc.del), `+${fmt(loc.add)} / -${fmt(loc.del)}`],
  ];
  const TW = (IW - 3 * 14) / 4, TH = 90;
  const tiles = kpis.map(([label, v, sub], i) => {
    const x = L + (i % 4) * (TW + 14), y = 34 + Math.floor(i / 4) * (TH + 14);
    return `<g transform="translate(${n1(x)},${y})"><g class="up" style="animation-delay:${(0.1 + i * 0.07).toFixed(2)}s">
      <rect width="${n1(TW)}" height="${TH}" rx="10" fill="${C.ink2}" stroke="${C.ash}"/>
      <rect y="14" width="3" height="${TH - 28}" fill="${C.blood}"/>
      <text x="18" y="26" class="tl">${label}</text>
      <text x="18" y="60" class="tv">${esc(v)}</text>
      <text x="18" y="78" class="ts">${esc(sub)}</text>
    </g></g>`;
  }).join("");

  // Heatmap, last 365 days
  const HY = 270, CELL = 11, GAP = 3, GX = L + 34;
  const nonZero = lastYear.map((d) => d.contributionCount).filter(Boolean).sort((a, b) => a - b);
  const q = (p) => nonZero[Math.min(nonZero.length - 1, Math.floor(p * nonZero.length))] ?? 1;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (c) => (c === 0 ? 0 : c <= cuts[0] ? 1 : c <= cuts[1] ? 2 : c <= cuts[2] ? 3 : 4);
  let cells = "", months = "", lastMonth = "";
  calWeeks.forEach((week, wi) => {
    for (const d of week) {
      const wd = new Date(d.date + "T00:00:00Z").getUTCDay();
      const x = GX + wi * (CELL + GAP), y = HY + 22 + wd * (CELL + GAP);
      const isToday = d.date === todayISO;
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="${HEAT[level(d.contributionCount)]}" class="cell" style="animation-delay:${((wi + wd) * 0.018).toFixed(3)}s"/>`;
      if (isToday) cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2.5" fill="none" stroke="${C.ember}" class="pulse"/>`;
    }
    const m = new Date((week[0]?.date ?? todayISO) + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
    if (m !== lastMonth && wi < calWeeks.length - 2) { months += `<text x="${GX + wi * (CELL + GAP)}" y="${HY + 14}" class="ax">${m}</text>`; lastMonth = m; }
  });
  const wdLabels = [[1, "Mon"], [3, "Wed"], [5, "Fri"]].map(([i, l]) => `<text x="${L}" y="${HY + 22 + i * (CELL + GAP) + 9}" class="ax">${l}</text>`).join("");
  const legendX = GX + calWeeks.length * (CELL + GAP) - 5 * (CELL + GAP) - 70;
  const heatLegend = `<g transform="translate(${legendX},${HY + 22 + 7 * (CELL + GAP) + 10})"><text x="0" y="9" class="ax">less</text>${HEAT.map((c, i) => `<rect x="${32 + i * (CELL + GAP)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${c}"/>`).join("")}<text x="${32 + 5 * (CELL + GAP) + 4}" y="9" class="ax">more</text></g>`;

  // Weekday rhythm (last 365 days, Monday first)
  const CY = 470, CH = 120;
  const wdTotals = [0, 0, 0, 0, 0, 0, 0];
  for (const d of lastYear) wdTotals[(new Date(d.date + "T00:00:00Z").getUTCDay() + 6) % 7] += d.contributionCount;
  const wdMax = Math.max(1, ...wdTotals);
  const wdTop = wdTotals.indexOf(Math.max(...wdTotals));
  const BW = 34, BG = (380 - 7 * BW) / 6;
  const wdBars = wdTotals.map((v, i) => {
    const h = Math.max(3, (v / wdMax) * CH), x = L + i * (BW + BG), y = CY + 30 + CH - h;
    return `<rect x="${n1(x)}" y="${n1(y)}" width="${BW}" height="${n1(h)}" rx="4" fill="${i === wdTop ? C.ember : C.blood}" fill-opacity="${i === wdTop ? 1 : 0.75}" class="bar" style="animation-delay:${(0.3 + i * 0.07).toFixed(2)}s"/>
      <text x="${n1(x + BW / 2)}" y="${n1(y - 6)}" class="bv" text-anchor="middle">${fmt(v)}</text>
      <text x="${n1(x + BW / 2)}" y="${CY + 30 + CH + 16}" class="ax" text-anchor="middle">${"MTWTFSS"[i]}</text>`;
  }).join("");

  // Language venom: stacked bar + ranked list
  const LX = 480, LWID = R - LX;
  const totalBytes = langBytes.reduce((n, [, b]) => n + b, 0) || 1;
  const langs = langBytes.slice(0, 5);
  const otherBytes = langBytes.slice(5).reduce((n, [, b]) => n + b, 0);
  if (otherBytes) langs.push(["Other", otherBytes]);
  let bx = 0;
  const langBar = langs.map(([, b], i) => {
    const w = (b / totalBytes) * LWID;
    const el = `<rect x="${n1(LX + bx)}" y="${CY + 22}" width="${n1(Math.max(0, w - 2))}" height="12" rx="3" fill="${RAMP[i]}" class="grow" style="animation-delay:${(0.4 + i * 0.1).toFixed(2)}s"/>`;
    bx += w;
    return el;
  }).join("");
  const langList = langs.map(([name, b], i) => {
    const y = CY + 60 + i * 20;
    const pct = ((b / totalBytes) * 100).toFixed(1);
    return `<g class="up" style="animation-delay:${(0.5 + i * 0.07).toFixed(2)}s"><rect x="${LX}" y="${y - 9}" width="10" height="10" rx="2" fill="${RAMP[i]}"/><text x="${LX + 18}" y="${y}" class="ll">${esc(name)}</text>
      <path d="M${LX + 18 + name.length * 7.6 + 8} ${y - 3}H${R - 52}" stroke="${C.ash}" stroke-dasharray="2 4"/><text x="${R}" y="${y}" class="lv" text-anchor="end">${pct}%</text></g>`;
  }).join("");

  // Monthly strikes, last 12 months
  const MY = 700, MH = 120, MX = L, MW = 440;
  const monthKeys = [];
  { const [ty, tm] = todayISO.split("-").map(Number); for (let k = 11; k >= 0; k--) { const d = new Date(Date.UTC(ty, tm - 1 - k, 1)); monthKeys.push(d.toISOString().slice(0, 7)); } }
  const monthTotals = monthKeys.map((k) => allDays.filter(([d]) => d.startsWith(k)).reduce((n, [, c]) => n + c, 0));
  const mMax = Math.max(1, ...monthTotals);
  const pts = monthTotals.map((v, i) => [MX + (i / 11) * MW, MY + 30 + MH - (v / mMax) * MH]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${n1(x)} ${n1(y)}`).join("");
  const area = `${line}L${MX + MW} ${MY + 30 + MH}L${MX} ${MY + 30 + MH}Z`;
  const peak = monthTotals.indexOf(Math.max(...monthTotals));
  const grid = [0, 0.5, 1].map((f) => `<path d="M${MX} ${n1(MY + 30 + MH - f * MH)}H${MX + MW}" stroke="${C.ash}" stroke-dasharray="${f ? "2 5" : "0"}"/><text x="${MX + MW + 8}" y="${n1(MY + 34 + MH - f * MH)}" class="ax">${fmt(Math.round(f * mMax))}</text>`).join("");
  const mLabels = monthKeys.map((k, i) => (i % 2 === 1 || i === 11) ? `<text x="${n1(pts[i][0])}" y="${MY + 30 + MH + 18}" class="ax" text-anchor="middle">${new Date(k + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</text>` : "").join("");
  const markers = pts.map(([x, y], i) => `<circle cx="${n1(x)}" cy="${n1(y)}" r="${i === peak || i === 11 ? 4.5 : 3}" fill="${i === peak ? C.ember : C.void}" stroke="${C.ember}" stroke-width="2" class="up" style="animation-delay:${(1 + i * 0.05).toFixed(2)}s"/>`).join("");
  const callouts = [...new Set([peak, 11])].map((i) => `<text x="${n1(Math.min(pts[i][0], MX + MW - 4))}" y="${n1(pts[i][1] - 12)}" class="bv" text-anchor="${i === 11 ? "end" : "middle"}">${fmt(monthTotals[i])}</text>`).join("");

  // Commits by repo
  const RX = 560, RWID = R - RX;
  const byRepo = [...repos].sort((a, b) => commitsOf(b) - commitsOf(a)).slice(0, 6);
  const rMax = Math.max(1, ...byRepo.map(commitsOf));
  const repoBars = byRepo.map((r, i) => {
    const y = MY + 30 + i * 24, w = Math.max(4, (commitsOf(r) / rMax) * (RWID - 150));
    return `<text x="${RX}" y="${y + 10}" class="ll">${esc(r.name.length > 16 ? r.name.slice(0, 15) + "…" : r.name)}</text>
      <rect x="${RX + 124}" y="${y}" width="${n1(w)}" height="12" rx="3" fill="${i ? C.blood : C.ember}" fill-opacity="${i ? 0.8 : 1}" class="grow" style="animation-delay:${(0.5 + i * 0.08).toFixed(2)}s"/>
      <text x="${n1(RX + 130 + w)}" y="${y + 10}" class="bv">${fmt(commitsOf(r))}</text>`;
  }).join("");

  const H = MY + 30 + MH + 50;
  write("analytics.svg", `${svgOpen(W, H, `Analytics: ${fmt(allTimeContributions)} contributions all-time, ${fmt(lastYearTotal)} in the last year, current streak ${streaks.current} days, longest ${streaks.longest} days`)}
  <defs>
    ${COMMON_DEFS}${SMOKE_DEFS}
    <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.ember}" stop-opacity=".45"/><stop offset="1" stop-color="${C.blood}" stop-opacity="0"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="22"/></clipPath>
  </defs>
  <style>
    ${fonts("display", "mono", "monoBold", "goth")}
    .tl{font:500 10.5px ${F.mono};letter-spacing:2px;fill:${C.boneDk}}
    .tv{font:900 27px ${F.display};fill:${C.bone}}
    .ts{font:400 11px ${F.mono};fill:${C.mute}}
    .sh{font:500 13px ${F.mono};letter-spacing:2.5px;fill:${C.bone}}
    .sa{font:400 17px ${F.goth};fill:${C.bloodLt}}
    .ax{font:400 10.5px ${F.mono};fill:${C.mute}}
    .bv{font:500 11px ${F.mono};fill:${C.bone}}
    .ll{font:400 12.5px ${F.mono};fill:${C.bone}}
    .lv{font:500 12.5px ${F.mono};fill:${C.boneDk}}
    .cell{transform-box:fill-box;transform-origin:center;animation:cell .6s ${EASE_POP} both}
    @keyframes cell{from{transform:scale(0);opacity:0}}
    .bar{transform-box:fill-box;transform-origin:bottom;animation:bar 1s ${EASE_OUT} both}
    @keyframes bar{from{transform:scaleY(0)}}
    .grow{transform-box:fill-box;transform-origin:left;animation:grow 1.2s ${EASE_OUT} both}
    @keyframes grow{from{transform:scaleX(0)}}
    .line{stroke-dasharray:1400;stroke-dashoffset:1400;animation:draw 2.2s ${EASE_OUT} .6s forwards}
    .areaF{opacity:0;animation:fadeIn 1.4s ease 1.2s forwards}@keyframes fadeIn{to{opacity:1}}
    ${BASE_CSS}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.ink}"/>
    ${smokeLayers(W, H, 0.18)}
  </g>
  ${tiles}
  ${head(L, HY, "LAST 365 DAYS", `${fmt(lastYearTotal)} contributions`)}
  ${months}${wdLabels}${cells}${heatLegend}
  ${head(L, CY, "WEEKDAY RHYTHM", `${["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"][wdTop]} bite hardest`)}
  <path d="M${L} ${CY + 30 + CH}H${L + 380}" stroke="${C.ash}"/>
  ${wdBars}
  ${head(LX, CY, "LANGUAGE VENOM")}
  ${langBar}${langList}
  ${head(MX, MY, "MONTHLY STRIKES", "last 12 months")}
  ${grid}
  <path d="${area}" fill="url(#areaG)" class="areaF"/>
  <path d="${line}" fill="none" stroke="${C.ember}" stroke-width="2" stroke-linejoin="round" class="line"/>
  ${markers}${callouts}${mLabels}
  ${head(RX, MY, "COMMITS BY REPO")}
  ${repoBars}
  ${frameEdge(W, H)}
  ${border(W, H)}
</svg>`);
}

/* ------------------------------------------------------- launch cards */
function launchCard(r, i) {
  const o = config.launches.overrides[r.name] ?? {};
  const W = 900, H = 320;
  const tagline = wrap(o.tagline ?? r.description ?? "Something new is shipping.", 58).slice(0, 2);
  const tags = [...(o.tags ?? []), ...r.repositoryTopics.nodes.map((t) => t.topic.name)].slice(0, 4);
  const commits = commitsOf(r);
  const monogram = (r.name.match(/[A-Z]|(?<=^|[-_ ])[a-z]/g) ?? [r.name[0]]).slice(0, 2).join("").toUpperCase();
  const launched = new Date(r.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const all = r.languages.edges.reduce((n, e) => n + e.size, 0) || 1;
  const langs = r.languages.edges.filter((e) => e.size / all >= 0.01);
  const total = langs.reduce((n, e) => n + e.size, 0) || 1;

  let x = 0;
  const bar = langs.map((e, k) => {
    const w = (e.size / total) * 260;
    const seg = `<rect x="${x.toFixed(1)}" width="${Math.max(0, w - 2).toFixed(1)}" height="10" rx="3" fill="${RAMP[k % RAMP.length]}" class="grow" style="animation-delay:${(0.9 + k * 0.12).toFixed(2)}s"/>`;
    x += w;
    return seg;
  }).join("");
  let lx = 0;
  const legend = langs.slice(0, 3).map((e, k) => {
    const label = `${e.node.name} ${((e.size / total) * 100).toFixed(0)}%`;
    const el = `<rect x="${lx}" y="23" width="9" height="9" rx="2" fill="${RAMP[k]}"/><text x="${lx + 15}" y="32" class="s">${esc(label)}</text>`;
    lx += label.length * 6.9 + 28;
    return el;
  }).join("");

  let tx = 0;
  const tagEls = tags.map((tag, k) => {
    const w = tag.length * 7.6 + 30;
    const el = `<g transform="translate(${tx + w / 2},13)"><g class="pop" style="animation-delay:${(0.7 + k * 0.08).toFixed(2)}s"><rect x="${-w / 2}" y="-13" width="${w}" height="26" rx="4" fill="${C.wine}" stroke="${C.blood}" stroke-opacity=".8"/><text y="4.5" class="tag" text-anchor="middle">${esc(tag)}</text></g></g>`;
    tx += w + 8;
    return el;
  }).join("");

  const stats = [["★", fmt(r.stargazerCount), "stars"], ["⑂", fmt(r.forkCount), "forks"], ["◆", fmt(commits), "commits"], ["↑", ago(r.pushedAt).replace(" ago", ""), "since last strike"]];
  let sx = 0;
  const statEls = stats.map(([icon, v, label], k) => {
    const text = `${v} ${label}`;
    const w = text.length * 7.3 + 44;
    const el = `<g transform="translate(${sx},0)"><g class="up" style="animation-delay:${(0.8 + k * 0.07).toFixed(2)}s"><rect width="${w}" height="32" rx="6" fill="${C.ink2}" stroke="${C.smoke}"/><circle cx="16" cy="16" r="10" fill="${C.bloodDk}"/><text x="16" y="20" class="si" text-anchor="middle">${icon}</text><text x="32" y="21" class="sv"><tspan class="svb">${esc(v)}</tspan> ${label}</text></g></g>`;
    sx += w + 8;
    return el;
  }).join("");

  // A ring of fangs around the star count.
  const fangs = Array.from({ length: 18 }, (_, k) => {
    const a = (k / 18) * Math.PI * 2, a1 = a - 0.11, a2 = a + 0.11;
    const p = (ang, rr) => `${(Math.cos(ang) * rr).toFixed(1)} ${(Math.sin(ang) * rr).toFixed(1)}`;
    return `M${p(a1, 50)} L${p(a, 38)} L${p(a2, 50)}Z`;
  }).join("");

  return `${svgOpen(W, H, `${r.name} — launch card`)}
  <defs>
    ${COMMON_DEFS}${SMOKE_DEFS}${snakeMasks("viper", "stipple")}
    <linearGradient id="crest" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bloodLt}"/><stop offset="1" stop-color="${C.wine}"/></linearGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="22"/></clipPath>
    <clipPath id="crestClip"><rect width="112" height="112" rx="14"/></clipPath>
  </defs>
  <style>
    ${fonts("display", "goth", "body", "bodyBold", "mono")}
    text{font-family:${F.body};fill:${C.bone}}
    .name{font:900 40px ${F.display};letter-spacing:1px;fill:${C.bone}}
    .tl{font-size:16.5px;fill:${C.boneDk}}
    .goth{font:400 25px ${F.goth};fill:${C.bloodLt}}
    .tag{font:700 12.5px ${F.body};fill:${C.bone}}
    .s{font:400 11.5px ${F.mono};fill:${C.boneDk}}
    .sv{font-size:13px;fill:${C.boneDk}} .svb{font-weight:700;fill:${C.bone}}
    .si{font-size:11px;font-weight:700;fill:${C.bone}}
    .mono{font:900 44px ${F.display};fill:${C.bone}}
    .seal{font:900 24px ${F.display};fill:${C.bone}}
    .sealL{font:500 9.5px ${F.mono};letter-spacing:2px;fill:${C.ember}}
    .live{font:500 12px ${F.mono};letter-spacing:2px;fill:${C.bone}}
    .pop{animation:pop .8s ${EASE_POP} both}
    @keyframes pop{from{transform:scale(0) rotate(-12deg)}}
    .tilt{animation:tilt 5s ease-in-out infinite}
    @keyframes tilt{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(-1deg) translateY(-4px)}}
    .sticker{animation:sticker 2.8s ${EASE_POP} infinite}
    @keyframes sticker{0%,70%,100%{transform:rotate(4deg) scale(1)}80%{transform:rotate(1deg) scale(1.08)}}
    .spin{animation:spin 22s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .bounce{animation:bounce 1.6s ${EASE_POP} infinite}
    @keyframes bounce{0%,60%,100%{transform:none}30%{transform:translateY(-6px)}}
    .shine{animation:shine 3.6s ${EASE_OUT} infinite}
    @keyframes shine{0%,50%{transform:translateX(-160px) skewX(-20deg)}100%{transform:translateX(200px) skewX(-20deg)}}
    .grow{transform-box:fill-box;transform-origin:left;animation:grow 1.2s ${EASE_OUT} both}
    @keyframes grow{from{transform:scaleX(0)}}
    .lurk{animation:lurk 9s ease-in-out infinite alternate}
    @keyframes lurk{from{transform:translate(0,0)}to{transform:translate(-18px,8px)}}
    ${BASE_CSS} ${EMBER_CSS(H)}
  </style>

  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${C.ink}"/>
    <g class="lurk" opacity=".22">${snake("viper", 560, 20, 340, "url(#bloodFade)")}</g>
    <g class="lurk" opacity=".55">${viperEyes(560, 20, 340, 0.8)}</g>
    ${smokeLayers(W, H, 0.3)}
    ${embers(10, W, H, 31 + i)}
  </g>

  <g transform="translate(40,58) rotate(-3)"><text class="goth up">Strike #${String(i + 1).padStart(2, "0")} · ${esc(launched)}</text></g>

  <g transform="translate(96,148)"><g class="tilt"><g transform="translate(-56,-56)">
    <rect x="5" y="7" width="112" height="112" rx="14" fill="${C.void}"/>
    <g clip-path="url(#crestClip)"><rect width="112" height="112" fill="url(#crest)"/>${snake("stipple", 30, -6, 70, "#000", 'opacity=".35"')}<rect x="20" y="-30" width="36" height="180" fill="#fff" opacity=".16" class="shine"/></g>
    <rect width="112" height="112" rx="14" fill="none" stroke="${C.ember}" stroke-opacity=".6" stroke-width="1.5"/>
    <text x="56" y="72" class="mono" text-anchor="middle">${esc(monogram)}</text>
  </g></g></g>

  <g transform="translate(180,112)">
    <text y="0" class="name up" style="animation-delay:.1s">${esc(r.name)}</text>
    <path d="M2 14c70-10 150-12 230-3s90 4 130-6" fill="none" stroke="${C.blood}" stroke-width="4" stroke-linecap="round" class="scrib"/>
    ${tagline.map((l, k) => `<text y="${46 + k * 23}" class="tl up" style="animation-delay:${(0.25 + k * 0.08).toFixed(2)}s">${esc(l)}</text>`).join("")}
    <g transform="translate(0,${tagline.length > 1 ? 86 : 64})">${tagEls}</g>
  </g>

  <g transform="translate(${W - 104},128)"><g class="pop" style="animation-delay:.5s">
    <g class="spin"><path d="${fangs}" fill="${C.bone}" fill-opacity=".85"/><circle r="50" fill="none" stroke="${C.blood}" stroke-width="2"/></g>
    <circle r="36" fill="${C.void}" stroke="${C.blood}" stroke-width="1.5" stroke-dasharray="3 4"/>
    <g class="bounce"><path d="M0 -26 l9 10 h-18z" fill="${C.ember}"/></g>
    <text y="9" class="seal" text-anchor="middle">${fmt(r.stargazerCount)}</text>
    <text y="24" class="sealL" text-anchor="middle">STARS</text>
  </g></g>

  <g transform="translate(${W - 214},44)"><g class="sticker">
    <rect x="-8" y="-17" width="118" height="32" rx="4" fill="${C.blood}" stroke="${C.ember}"/>
    <circle cx="8" cy="-1" r="5" fill="${C.bone}" class="pulse"/><circle cx="8" cy="-1" r="5" fill="${C.bone}"/>
    <text x="20" y="3.5" class="live">NOW LIVE</text>
  </g></g>

  <path d="M40 ${H - 74} H${W - 40}" stroke="${C.blood}" stroke-opacity=".3" stroke-dasharray="4 6"/>
  <g transform="translate(40,${H - 58})">${statEls}</g>
  <g transform="translate(${W - 300},${H - 128})">${bar}${legend}</g>
  ${frameEdge(W, H)}
  ${border(W, H)}
</svg>`;
}
launches.forEach((r, i) => write(`launch-${r.name}.svg`, launchCard(r, i)));

/* --------------------------------------------------------------- toolbox */
{
  const W = 900, X0 = 196, XMAX = W - 36, ROW = 46;
  let y = 56, k = 0, body = "";
  for (const [group, names] of icons.groups) {
    let x = X0;
    const rowsStart = y;
    let chips = "";
    for (const name of names) {
      const w = name.length * 7.9 + 58;
      if (x + w > XMAX) { x = X0; y += ROW; }
      const path = icons.paths[name];
      const delay = (0.15 + k * 0.035).toFixed(3);
      const wave = ((x / W) * 2.4 + (y / 400)).toFixed(2);
      chips += `<g transform="translate(${x},${y})"><g class="chip" style="animation-delay:${delay}s">
        <rect width="${w}" height="36" rx="6" fill="${C.ink2}" stroke="${C.blood}" stroke-opacity=".35"/>
        <rect width="${w}" height="36" rx="6" fill="none" stroke="${C.ember}" stroke-width="1.6" class="glint" style="animation-delay:${wave}s"/>
        <rect x="4" y="4" width="28" height="28" rx="4" fill="${C.wine}"/>
        ${path ? `<g transform="translate(9.6,9.6) scale(.7)"><path d="${path}" fill="${C.bloodLt}"/></g>` : `<text x="18" y="22.5" class="ab" text-anchor="middle">${esc(name[0])}</text>`}
        <text x="42" y="23" class="lb">${esc(name)}</text>
      </g></g>`;
      x += w + 9;
      k++;
    }
    body += `<g transform="translate(40,${rowsStart + 24}) rotate(-3)"><text class="grp up" style="animation-delay:${(0.1 + k * 0.02).toFixed(2)}s">${esc(group)}</text></g>${chips}`;
    y += ROW + 16;
  }
  const H = y + 14;
  write("toolbox.svg", `${svgOpen(W, H, "Toolbox: " + icons.groups.flatMap((g) => g[1]).join(", "))}
  <defs>${COMMON_DEFS}${SMOKE_DEFS}${snakeMasks("stipple")}<clipPath id="frame"><rect width="${W}" height="${H}" rx="22"/></clipPath></defs>
  <style>
    ${fonts("goth", "bodyBold")}
    .lb{font:700 13.5px ${F.body};fill:${C.bone}}
    .ab{font:700 14px ${F.body};fill:${C.bloodLt}}
    .grp{font:400 26px ${F.goth};fill:${C.bloodLt}}
    .chip{animation:chip .7s ${EASE_POP} both}
    @keyframes chip{from{transform:translateY(22px) scale(.6);opacity:0}}
    .glint{opacity:0;animation:glint 6s ease-in-out infinite}
    @keyframes glint{0%,100%{opacity:0}8%{opacity:1}20%{opacity:0}}
    .coil{animation:coil 8s ease-in-out infinite alternate}
    @keyframes coil{to{transform:translate(-10px,6px)}}
    ${BASE_CSS}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="${C.ink}"/>
    <g class="coil" opacity=".12">${snake("stipple", 20, H - 330, 170, C.bone)}</g>
    ${smokeLayers(W, H, 0.25)}
  </g>
  ${body}
  ${frameEdge(W, H)}
  ${border(W, H)}
</svg>`);
}

/* --------------------------------------------------------------- divider */
// A chain of viper heads (the footer's snake), linked by small rings, with a blood pulse running down it.
{
  const W = 900, H = 70, N = 17, GAP = 50, HW = 26, HH = (HW * IMG.viper[2]) / IMG.viper[1], CY = H / 2, DUR = 3.4;
  const x0 = (W - (N - 1) * GAP) / 2;
  const fade = (i) => (0.25 + 0.75 * Math.sin((Math.PI * (i + 0.5)) / N)).toFixed(2);
  let chain = "";
  for (let i = 0; i < N; i++) {
    const cx = x0 + i * GAP, delay = (-DUR + (i / N) * DUR).toFixed(2);
    if (i < N - 1) {
      const lx = cx + GAP / 2;
      chain += `<g opacity="${fade(i + 0.5)}"><line x1="${n1(cx + HW / 2 + 2)}" y1="${CY}" x2="${n1(lx - 6)}" y2="${CY}" stroke="${C.bloodDk}" stroke-width="1.2"/><line x1="${n1(lx + 6)}" y1="${CY}" x2="${n1(cx + GAP - HW / 2 - 2)}" y2="${CY}" stroke="${C.bloodDk}" stroke-width="1.2"/><ellipse cx="${n1(lx)}" cy="${CY}" rx="6" ry="3" fill="none" stroke="${C.blood}" stroke-width="1.3"/></g>`;
    }
    chain += `<g opacity="${fade(i)}">${snake("viper", cx - HW / 2, CY - HH / 2, HW, C.bloodDk, `class="pulse" style="animation-delay:${delay}s"`)}</g>`;
  }
  write("divider.svg", `${svgOpen(W, H, "")}
  <defs>${snakeMasks("viper")}</defs>
  <style>
    .pulse{animation:pulse ${DUR}s ease-in-out infinite}
    @keyframes pulse{0%,60%,100%{fill:${C.bloodDk};transform:translateY(0)}30%{fill:${C.ember};transform:translateY(-3px)}}
  </style>
  ${chain}
</svg>`);
}

/* ---------------------------------------------------------------- footer */
{
  const W = 900, H = 260, VW = 150, VX = (W - VW) / 2, VY = 24;
  write("footer.svg", `${svgOpen(W, H, "thanks for stopping by")}
  <defs>${COMMON_DEFS}${SMOKE_DEFS}${snakeMasks("viper")}<clipPath id="f"><rect width="${W}" height="${H}" rx="22"/></clipPath>
    <radialGradient id="pool" cx=".5" cy=".3" r=".5"><stop offset="0" stop-color="${C.blood}" stop-opacity=".45"/><stop offset="1" stop-color="${C.blood}" stop-opacity="0"/></radialGradient>
  </defs>
  <style>
    ${fonts("goth", "display")}
    .t{font:400 34px ${F.goth};fill:${C.bloodLt};text-anchor:middle}
    .s{font:900 13px ${F.display};letter-spacing:5px;fill:${C.boneDk};text-anchor:middle}
    .hover{animation:hover 4s ease-in-out infinite}
    @keyframes hover{50%{transform:translateY(-5px)}}
    .poolP{animation:poolP 4s ease-in-out infinite}@keyframes poolP{50%{opacity:.5}}
    ${BASE_CSS} ${EMBER_CSS(H)}
  </style>
  <g clip-path="url(#f)">
    <rect width="${W}" height="${H}" fill="${C.void}"/>
    <ellipse cx="450" cy="90" rx="320" ry="150" fill="url(#pool)" class="poolP"/>
    ${smokeLayers(W, H, 0.55)}
    ${embers(22, W, H, 99)}
    <g transform="translate(0,${H - 34})"><g class="crawlF">${sketchSnake({ len: 260, amp: 8, waves: 2, width: 5, seed: 8, dur: 1.4, strokes: 5 })}</g></g>
  </g>
  <g class="hover">${snake("viper", VX, VY, VW, "url(#bloodFade)")}${viperEyes(VX, VY, VW)}</g>
  <text x="450" y="194" class="t up">thanks for stopping by</text>
  <text x="450" y="218" class="s up" style="animation-delay:.3s">DEVAPRIYAN G S  ✦  DEV-2141</text>
  <style>.crawlF{animation:crawlF 20s linear infinite}@keyframes crawlF{from{transform:translateX(${W + 20}px) scaleX(-1)}to{transform:translateX(-20px) scaleX(-1)}}</style>
  ${frameEdge(W, H)}
  ${border(W, H)}
</svg>`);
}

/* ------------------------------------------------ README launch section */
{
  for (const old of ["neofetch-dark.svg", "neofetch-light.svg"]) rmSync(new URL(old, OUT), { force: true });
  const readmeUrl = new URL("README.md", root);
  const readme = readFileSync(readmeUrl, "utf8");
  const block = launches.map((r) => `<a href="${r.url}"><img src="./generated/launch-${r.name}.svg" width="100%" alt="${r.name} — launch card"/></a>`).join("\n");
  // Version stamp on every generated image so GitHub's image cache picks up each refresh.
  const v = Date.now().toString(36);
  writeFileSync(
    readmeUrl,
    readme
      .replace(/(<!-- LAUNCHES:START -->)[\s\S]*?(<!-- LAUNCHES:END -->)/, `$1\n${block}\n$2`)
      .replace(/(\.\/generated\/[\w.-]+\.svg)(\?v=\w+)?/g, `$1?v=${v}`),
  );
}

console.log(`built: header, neofetch, analytics, ${launches.length} launch cards, toolbox, titles, divider, footer · LOC +${loc.add}/-${loc.del} · streak ${streaks.current}/${streaks.longest}`);
