// LIQUID — builds every SVG in generated/ from live GitHub data, in an acid-yellow / ink-black / white theme.
// Shapes are morphing blobs pushed through a turbulence + goo filter, so everything flows like water.
// Runs daily in .github/workflows/build.yml. Locally: GITHUB_TOKEN=$(gh auth token) node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("profile.config.json", root)));
const icons = JSON.parse(readFileSync(new URL("assets/icons/icons.json", root)));
const OUT = new URL("generated/", root);
mkdirSync(OUT, { recursive: true });
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
const USER = config.user;

/* ---------------------------------------------------------------- design */

const Y = "#FFE600", K = "#0A0A0A", W = "#FFFFFF", G1 = "#141414", G2 = "#232323", MUTE = "#8C8C8C";
const HEAT = ["#1A1A1A", "#4D4500", "#8F8000", "#CCB800", Y];

const fontCache = {};
const font = (family, weight, file) => {
  fontCache[file] ??= readFileSync(new URL(`fonts/${file}.woff2`, root)).toString("base64");
  return `@font-face{font-family:'${family}';font-weight:${weight};src:url(data:font/woff2;base64,${fontCache[file]}) format('woff2');}`;
};
const STYLE = () => `<style>${font("DM Mono", 500, "dmmono-500")}${font("DM Sans", 700, "dmsans-700")}
  .d{font-family:'Arial Black','Archivo Black','DM Sans',Impact,sans-serif;font-weight:900}
  .m{font-family:'DM Mono','JetBrains Mono',Consolas,monospace;font-weight:500}
  .s{font-family:'DM Sans','Segoe UI',sans-serif;font-weight:700}
  .u{font-family:'Arial Black','Nirmala UI','Noto Sans','Noto Sans Devanagari','Noto Sans Malayalam','Noto Sans Tamil','Noto Sans Kannada','Noto Sans Telugu','Noto Sans Bengali','Yu Gothic UI','Hiragino Sans','Malgun Gothic','Microsoft YaHei','PingFang SC','Segoe UI',sans-serif;font-weight:900}
</style>`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const write = (name, svg) => writeFileSync(new URL(name, OUT), svg.replace(/\n\s+/g, "\n"));
const f = (n) => Math.round(n * 10) / 10;
const fmt = (n) => n.toLocaleString("en-US");
const open = (w, h, label) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title>${STYLE()}`;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- liquid */

// closed Catmull-Rom spline through the points, as cubic beziers
function smooth(pts) {
  const n = pts.length;
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + "Z";
}

// A blob keeps its noise per keyframe, so it can be redrawn at any scale/offset and
// inner contour rings follow the same liquid outline.
function blob({ cx, cy, r, n = 10, amp = 0.16, seed = 1, frames = 4 }) {
  const R = rng(seed);
  const noise = Array.from({ length: frames }, () => Array.from({ length: n }, () => R() * 2 - 1));
  const phase = R() * Math.PI;
  const at = (k, s = 1, ox = 0, oy = 0) =>
    smooth(noise[k].map((v, i) => {
      const a = phase + (i / n) * Math.PI * 2, rr = r * s * (1 + amp * v);
      return [cx + ox + Math.cos(a) * rr, cy + oy + Math.sin(a) * rr];
    }));
  return { frames, at };
}
function morph(b, dur, s = 1, ox = 0, oy = 0) {
  const vals = Array.from({ length: b.frames }, (_, k) => b.at(k, s, ox, oy));
  vals.push(vals[0]);
  const kt = vals.map((_, i) => f(i / (vals.length - 1))).join(";");
  const ks = Array(vals.length - 1).fill("0.45 0 0.55 1").join(";");
  return `<animate attributeName="d" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keyTimes="${kt}" keySplines="${ks}" values="${vals.join(";")}"/>`;
}
const blobPath = (b, dur, attrs = "", s = 1, ox = 0, oy = 0) => `<path d="${b.at(0, s, ox, oy)}" ${attrs}>${morph(b, dur, s, ox, oy)}</path>`;

// goo: blur -> turbulent displacement -> alpha threshold  (smooth, wobbling, merging liquid)
// wob: the same displacement field without the goo, for strokes drawn on top of the liquid
function liquidDefs(id, { blur = 10, wobble = 26, freq = [0.006, 0.011], speed = 16, animate = false } = {}) {
  const fq = freq.join(" "), fq2 = freq.map((v) => f(v * 1500) / 1000).join(" ");
  const turb = `<feTurbulence type="fractalNoise" baseFrequency="${fq}" numOctaves="2" seed="7" result="n">${animate ? `<animate attributeName="baseFrequency" dur="${speed}s" repeatCount="indefinite" values="${fq};${fq2};${fq}"/>` : ""}</feTurbulence>`;
  return `<filter id="goo-${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      ${turb}<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="b"/>
      <feDisplacementMap in="b" in2="n" scale="${wobble}" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feColorMatrix in="d" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11"/>
    </filter>
    <filter id="wob-${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      ${turb}<feDisplacementMap in="SourceGraphic" in2="n" scale="${wobble}" xChannelSelector="R" yChannelSelector="G"/>
    </filter>`;
}

const ease = "0.45 0 0.55 1";
// a droplet that stretches off a blob edge and falls away
const drip = (x, y0, y1, r, dur, delay) => `<circle cx="${x}" cy="${y0}" r="${r}">
    <animate attributeName="cy" values="${y0};${y0 + 6};${y1}" keyTimes="0;0.35;1" calcMode="spline" keySplines="${ease};0.55 0 1 1" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/>
    <animate attributeName="r" values="${r * 0.6};${r};${r * 0.75}" keyTimes="0;0.35;1" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/></circle>`;
// a droplet that wanders in and out of a blob
const bob = (x, y, dx, dy, r, dur, delay) => `<circle cx="${x}" cy="${y}" r="${r}">
    <animate attributeName="cx" values="${x};${x + dx};${x}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="${ease};${ease}"/>
    <animate attributeName="cy" values="${y};${y + dy};${y}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="${ease};${ease}"/></circle>`;
// a droplet that jumps out of a pool and falls back in
const hop = (x, y, h, r, dur, delay) => `<circle cx="${x}" cy="${y}" r="${r}"><animate attributeName="cy" values="${y};${y - h};${y}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.15 0.6 0.4 1;0.6 0 0.85 0.4"/></circle>`;

// seamless, horizontally scrolling wave (filled down to `bottom`)
function wave({ y, amp, period, bottom, dur, width = 1200, reverse = false, attrs = `fill="${Y}"` }) {
  let d = `M${-period * 2} ${bottom}L${-period * 2} ${y}`;
  for (let x = -period * 2; x < width + period * 2; x += period) d += `Q${x + period / 4} ${y - amp} ${x + period / 2} ${y}T${x + period} ${y}`;
  d += `L${width + period * 2} ${bottom}Z`;
  return `<g><path d="${d}" ${attrs}/><animateTransform attributeName="transform" type="translate" from="0 0" to="${reverse ? period : -period} 0" dur="${dur}s" repeatCount="indefinite"/></g>`;
}

const panel = (id, w, h, rx = 28) => `<clipPath id="clip-${id}"><rect width="${w}" height="${h}" rx="${rx}"/></clipPath>`;
const blink = `<animate attributeName="opacity" values="1;1;0;0" keyTimes="0;0.5;0.5;1" dur="1s" repeatCount="indefinite"/>`;
const fadeIn = (delay, dy = 10) =>
  `<animate attributeName="opacity" from="0" to="1" dur="0.6s" begin="${delay}s" fill="freeze"/><animateTransform attributeName="transform" type="translate" from="0 ${dy}" to="0 0" dur="0.7s" begin="${delay}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/>`;

/* ------------------------------------------------------------------ data */

async function gh(path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `bearer ${TOKEN}`, "User-Agent": USER, Accept: "application/vnd.github+json" },
    body: body && JSON.stringify(body),
  });
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
      login name createdAt avatarUrl(size: 360)
      followers { totalCount }
      contributionsCollection { contributionYears contributionCalendar { totalContributions ${DAYS} } }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
        nodes {
          name description isFork isArchived stargazerCount pushedAt
          primaryLanguage { name }
          languages(first: 8, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name } } }
          repositoryTopics(first: 4) { nodes { topic { name } } }
          readme: object(expression: "HEAD:README.md") { ... on Blob { text } }
          pkg: object(expression: "HEAD:package.json") { ... on Blob { text } }
          req: object(expression: "HEAD:requirements.txt") { ... on Blob { text } }
          tree: object(expression: "HEAD:") { ... on Tree { entries { name } } }
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

// the profile picture, embedded so it can live inside the liquid (an <img> SVG can't load external images)
let avatar = null;
try {
  const res = await fetch(user.avatarUrl);
  if (res.ok) avatar = `data:${res.headers.get("content-type") || "image/png"};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
} catch { /* falls back to initials */ }
// a transparent cartoon cutout in assets/avatar.png pops out of the liquid portal instead
const cutoutFile = new URL("assets/avatar.png", root);
const cutoutBuf = existsSync(cutoutFile) ? readFileSync(cutoutFile) : null;
const cutout = cutoutBuf && `data:image/png;base64,${cutoutBuf.toString("base64")}`;
const cutoutRatio = cutoutBuf ? cutoutBuf.readUInt32BE(20) / cutoutBuf.readUInt32BE(16) : 1; // PNG height / width

const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: config.timezone });
const repos = user.repositories.nodes.filter((r) => !r.isFork);
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);
const allTime = years.reduce((n, y) => n + yearly.user[`y${y}`].contributionCalendar.totalContributions, 0);
const dayMap = new Map();
for (const y of years) for (const w of yearly.user[`y${y}`].contributionCalendar.weeks) for (const d of w.contributionDays) if (d.date <= todayISO) dayMap.set(d.date, d.contributionCount);
const allDays = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const calWeeks = user.contributionsCollection.contributionCalendar.weeks.map((w) => w.contributionDays.filter((d) => d.date <= todayISO));
const lastYear = calWeeks.flat();
const lastYearTotal = lastYear.reduce((n, d) => n + d.contributionCount, 0);
const streaks = (() => {
  let longest = 0, run = 0;
  for (const [, c] of allDays) { run = c > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0, i = allDays.length - 1;
  if (i >= 0 && allDays[i][1] === 0) i--; // today isn't over yet
  for (; i >= 0 && allDays[i][1] > 0; i--) current++;
  return { current, longest };
})();
const activeDays = lastYear.filter((d) => d.contributionCount > 0).length;
const bestDay = Math.max(0, ...allDays.map((d) => d[1]));
const langs = (() => {
  const bytes = {};
  for (const r of repos) for (const e of r.languages.edges) bytes[e.node.name] = (bytes[e.node.name] ?? 0) + e.size;
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, b]) => ({ name, pct: (b / total) * 100 }));
})();
// --- what each repo is built with, read from its package.json / requirements.txt / root files
const FRAMEWORKS = {
  react: "React", next: "Next.js", vue: "Vue", svelte: "Svelte", "@sveltejs/kit": "SvelteKit", "@angular/core": "Angular",
  express: "Express", fastify: "Fastify", hono: "Hono", "react-native": "React Native", expo: "Expo", electron: "Electron",
  "@tauri-apps/api": "Tauri", three: "Three.js", "@react-three/fiber": "React Three Fiber", gsap: "GSAP",
  "framer-motion": "Framer Motion", motion: "Motion", astro: "Astro", "@capacitor/core": "Capacitor",
  flask: "Flask", fastapi: "FastAPI", django: "Django", streamlit: "Streamlit", langchain: "LangChain",
  torch: "PyTorch", tensorflow: "TensorFlow", "scikit-learn": "scikit-learn", "@modelcontextprotocol/sdk": "MCP SDK", mcp: "MCP SDK",
  ai: "AI SDK", openai: "OpenAI SDK", "@anthropic-ai/sdk": "Anthropic SDK", anthropic: "Anthropic SDK", "google-generativeai": "Gemini SDK", "@google/genai": "Gemini SDK",
};
const TECH = {
  vite: "Vite", tailwindcss: "Tailwind CSS", typescript: "TypeScript", "@supabase/supabase-js": "Supabase", firebase: "Firebase",
  prisma: "Prisma", mongoose: "MongoDB", pg: "PostgreSQL", sass: "Sass", eslint: "ESLint", vitest: "Vitest", jest: "Jest",
  webpack: "Webpack", "socket.io": "Socket.IO", zod: "Zod", numpy: "NumPy", pandas: "Pandas", "opencv-python": "OpenCV",
  matplotlib: "Matplotlib", pyserial: "PySerial", requests: "Requests", pydantic: "Pydantic", uvicorn: "Uvicorn",
};
const FILES = [
  [/^package\.json$/, "Node.js"], [/^Dockerfile$|^docker-compose/, "Docker"], [/^\.github$/, "GitHub Actions"], [/^vercel\.json$/, "Vercel"],
  [/^netlify\.toml$/, "Netlify"], [/^firebase\.json$/, "Firebase"], [/^supabase$/, "Supabase"], [/^pubspec\.yaml$/, "Flutter"],
  [/^Cargo\.toml$/, "Rust"], [/^go\.mod$/, "Go"], [/^platformio\.ini$|\.ino$/, "Arduino"], [/^tsconfig\.json$/, "TypeScript"],
  [/^tailwind\.config/, "Tailwind CSS"], [/^vite\.config/, "Vite"], [/^\.env\.example$/, "dotenv"], [/^index\.html$/, "HTML/CSS"],
];
const stackOf = (r) => {
  const fw = new Set(), tech = new Set();
  try {
    const p = JSON.parse(r.pkg?.text ?? "{}");
    for (const d of Object.keys({ ...p.dependencies, ...p.devDependencies })) { if (FRAMEWORKS[d]) fw.add(FRAMEWORKS[d]); if (TECH[d]) tech.add(TECH[d]); }
  } catch { /* not valid JSON */ }
  for (const line of (r.req?.text ?? "").split("\n")) {
    const d = line.trim().split(/[=<>~!\[; ]/)[0].toLowerCase();
    if (FRAMEWORKS[d]) fw.add(FRAMEWORKS[d]); if (TECH[d]) tech.add(TECH[d]);
  }
  for (const e of r.tree?.entries ?? []) for (const [re, label] of FILES) if (re.test(e.name)) (label === "Flutter" ? fw : tech).add(label);
  return { fw, tech };
};
const rank = (sets) => {
  const n = {};
  for (const s of sets) for (const x of s) n[x] = (n[x] ?? 0) + 1;
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
};
const stacks = repos.map(stackOf);
const topFrameworks = rank(stacks.map((s) => s.fw));
const topTech = rank(stacks.map((s) => s.tech));

// a project's blurb: config override, else its GitHub description, else the first real paragraph of its README
function blurb(r) {
  const d = (r.description ?? "").trim();
  if (d && !/^https?:\/\/\S+$/.test(d)) return d;
  const md = (r.readme?.text ?? "").replace(/```[\s\S]*?```/g, "").replace(/<[^>]+>/g, " ");
  for (const para of md.split(/\n\s*\n/)) {
    const t = para.split("\n").filter((l) => !/^\s*(#|!\[|\[!\[|\||>|-{3,}|={3,})/.test(l)).join(" ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").replace(/\s+/g, " ").trim();
    if (t.length >= 30) return t.length > 150 ? t.slice(0, 147).replace(/\s+\S*$/, "") + "…" : t;
  }
  return null;
}
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const busiestDow = (() => {
  const n = Array(7).fill(0);
  for (const [date, c] of allDays) n[new Date(date + "T00:00:00Z").getUTCDay()] += c;
  return DOW[n.indexOf(Math.max(...n))];
})();
const busiestMonth = (() => {
  const n = {};
  for (const d of lastYear) { const m = d.date.slice(0, 7); n[m] = (n[m] ?? 0) + d.contributionCount; }
  const [m] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? ["—"];
  return m === "—" ? m : new Date(m + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
})();
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: config.timezone });
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  for (const [u, sec] of [["y", 31536000], ["mo", 2592000], ["w", 604800], ["d", 86400], ["h", 3600], ["m", 60]]) if (s >= sec) return `${Math.floor(s / sec)}${u} ago`;
  return "just now";
}

function uptime(from) {
  const a = new Date(from), b = new Date();
  let y = b.getUTCFullYear() - a.getUTCFullYear(), m = b.getUTCMonth() - a.getUTCMonth();
  if (b.getUTCDate() < a.getUTCDate()) m--;
  if (m < 0) { y--; m += 12; }
  return `${y}y ${m}m on GitHub`;
}

/* ------------------------------------------------------------------ hero */
{
  const w = 1200, h = 480;
  const A = blob({ cx: -40, cy: -40, r: 330, seed: 11, amp: 0.14 });
  const B = blob({ cx: 1250, cy: 530, r: 345, seed: 23, amp: 0.15 });
  const C = blob({ cx: 170, cy: 565, r: 150, seed: 5, amp: 0.2, n: 8 });
  const D = blob({ cx: 1130, cy: -95, r: 160, seed: 41, amp: 0.2, n: 8 });
  const rings = (b, dur, scales, ox, oy) =>
    scales.map((s, i) => blobPath(b, dur, `fill="none" stroke="${K}" stroke-width="${7 - i * 1.5}" stroke-linecap="round"`, s, ox * (i + 1), oy * (i + 1))).join("");

  // the name: chunky letters, each bobbing like it floats on the water
  const name = (config.hero.name || user.name || USER).toUpperCase();
  const size = Math.min(118, 880 / (name.length * 0.68));
  const em = { I: 0.3, "-": 0.36, " ": 0.3, J: 0.6, L: 0.62, "1": 0.55 };
  const adv = [...name].map((c) => (em[c] ?? 0.72) * size + size * 0.06);
  const total = adv.reduce((a, b) => a + b, 0);
  let x = w / 2 - total / 2;
  const R = rng(99);
  const base = 272;
  const letters = [...name].map((c, i) => {
    const cx = x + adv[i] / 2; x += adv[i];
    const tilt = f((R() * 2 - 1) * 7);
    return `<g transform="rotate(${tilt} ${f(cx)} ${base - size * 0.35})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -9;0 3;0 0" keyTimes="0;0.4;0.75;1" dur="3.6s" begin="${f(-i * 0.3)}s" repeatCount="indefinite" calcMode="spline" keySplines="${ease};${ease};${ease}"/>
      <text x="${f(cx + 6)}" y="${base + 6}" text-anchor="middle" class="d" font-size="${f(size)}" fill="${Y}">${esc(c)}</text>
      <text x="${f(cx)}" y="${base}" text-anchor="middle" class="d" font-size="${f(size)}" fill="${W}" stroke="${K}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">${esc(c)}</text>
    </g></g>`;
  }).join("");

  // rotating phrases, "typed" into a yellow pill
  const phrases = config.hero.phrases;
  const cw = 10.8, per = 4, T = phrases.length * per, pillW = Math.max(...phrases.map((p) => p.length)) * cw + 70;
  const kt = `0;${f(0.3 / phrases.length * 100) / 100};${f(0.82 / phrases.length * 100) / 100};${f(0.95 / phrases.length * 100) / 100};1`;
  const typed = phrases.map((p, i) => {
    const tw = p.length * cw, tx = w / 2 - tw / 2 - 8;
    return `<clipPath id="type-${i}"><rect x="${f(tx)}" y="368" width="0" height="34"><animate attributeName="width" values="0;${f(tw + 4)};${f(tw + 4)};0;0" keyTimes="${kt}" dur="${T}s" begin="${i * per}s" repeatCount="indefinite"/></rect></clipPath>
      <text x="${f(tx + 2)}" y="392" class="m" font-size="18" fill="${K}" clip-path="url(#type-${i})">${esc(p)}</text>
      <rect x="${f(tx)}" y="374" width="10" height="22" fill="${K}" opacity="0"><animate attributeName="x" values="${f(tx)};${f(tx + tw + 4)};${f(tx + tw + 4)};${f(tx)};${f(tx)}" keyTimes="${kt}" dur="${T}s" begin="${i * per}s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;1;1;1;0" keyTimes="${kt}" calcMode="discrete" dur="${T}s" begin="${i * per}s" repeatCount="indefinite"/></rect>`;
  }).join("");

  const sticker = `<g transform="translate(1046 140)">
      <circle r="68" fill="${Y}" stroke="${K}" stroke-width="5"/>
      <circle r="45" fill="none" stroke="${K}" stroke-width="2" stroke-dasharray="3 6"/>
      <path id="ring" d="M0 -53a53 53 0 1 1 -0.1 0" fill="none"/>
      <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="14s" repeatCount="indefinite"/>
        <text class="m" font-size="13" letter-spacing="2.4" fill="${K}"><textPath href="#ring">${esc(config.hero.sticker)}</textPath></text></g>
      <g><animateTransform attributeName="transform" type="rotate" values="0;-360" dur="7s" repeatCount="indefinite"/>
        <path d="M0 -24C3 -6 6 -3 24 0C6 3 3 6 0 24C-3 6 -6 3 -24 0C-6 -3 -3 -6 0 -24Z" fill="${K}"/></g>
    </g>`;

  const twinkles = [[380, 70], [820, 56], [720, 440], [455, 445], [930, 335], [300, 185], [860, 150]].map(([tx, ty], i) =>
    `<path transform="translate(${tx} ${ty}) scale(${i % 2 ? 0.45 : 0.7})" d="M0 -16C2 -4 4 -2 16 0C4 2 2 4 0 16C-2 4 -4 2 -16 0C-4 -2 -2 -4 0 -16Z" fill="${i % 3 ? W : Y}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="${f(2.4 + i * 0.5)}s" begin="${f(i * 0.6)}s" repeatCount="indefinite"/></path>`).join("");
  const bubbles = [[560, 470, 9], [640, 490, 6], [770, 480, 11], [420, 500, 7], [880, 500, 5]].map(([bx, by, r], i) =>
    `<circle cx="${bx}" cy="${by}" r="${r}" fill="none" stroke="${W}" stroke-width="2.5" opacity="0">
      <animate attributeName="cy" values="${by};${by - 150}" dur="${5 + i}s" begin="${f(-i * 1.3)}s" repeatCount="indefinite"/>
      <animate attributeName="cx" values="${bx};${bx + 14};${bx - 10};${bx}" dur="${5 + i}s" begin="${f(-i * 1.3)}s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.7;1" dur="${5 + i}s" begin="${f(-i * 1.3)}s" repeatCount="indefinite"/></circle>`).join("");

  write("hero.svg", `${open(w, h, `${name} — ${phrases.join(" ")}`)}
  <defs>${liquidDefs("h", { blur: 11, wobble: 36, animate: true })}${panel("h", w, h, 30)}</defs>
  <g clip-path="url(#clip-h)">
    <rect width="${w}" height="${h}" fill="${K}"/>
    <g fill="${Y}" filter="url(#goo-h)">
      ${blobPath(A, 14)}${blobPath(B, 17)}${blobPath(C, 11)}${blobPath(D, 12)}
      ${drip(95, 285, 540, 15, 4.2, 0)}${drip(205, 232, 540, 11, 5.1, 1.7)}${drip(1010, 320, 540, 13, 4.6, 0.9)}
      ${bob(300, 120, 34, 22, 20, 6, 0)}${bob(330, 40, 26, -10, 13, 7.5, 1)}${bob(900, 350, -36, 18, 18, 6.5, 0.5)}
      ${bob(970, 240, -30, -16, 12, 8, 2)}${bob(1150, 120, -10, 30, 16, 7, 0.3)}${bob(300, 430, 30, -20, 14, 6.8, 1.4)}
    </g>
    <g filter="url(#wob-h)">${rings(A, 14, [0.78, 0.6], 6, 10)}${rings(B, 17, [0.8, 0.63], -10, -6)}${rings(C, 11, [0.72], 6, -10)}${rings(D, 12, [0.7], -6, 8)}</g>
    ${bubbles}${twinkles}
    <text x="600" y="128" text-anchor="middle" class="m" font-size="17" letter-spacing="7" fill="${W}">${esc(config.hero.kicker)}</text>
    ${letters}
    <text x="600" y="336" text-anchor="middle" class="m" font-size="18" letter-spacing="5" fill="${Y}">${esc(config.hero.aka)}</text>
    <rect x="${f(600 - pillW / 2)}" y="362" width="${f(pillW)}" height="44" rx="22" fill="${Y}"/>
    ${typed}
    ${sticker}
  </g></svg>`);
}

/* --------------------------------------------------------------- divider */
write("divider.svg", `${open(1200, 56, "liquid divider")}
  <defs>${liquidDefs("d", { blur: 6, wobble: 10, freq: [0.01, 0.04] })}</defs>
  <g fill="${Y}" filter="url(#goo-d)">
    ${wave({ y: 30, amp: 9, period: 160, bottom: 42, dur: 3.2 })}
    ${[120, 380, 610, 870, 1090].map((x, i) => hop(x, 32, 22 + (i % 2) * 6, 7 + (i % 3) * 2, f(1.8 + i * 0.35), f(i * 0.4))).join("")}
  </g></svg>`);

/* --------------------------------------------------------- section titles */
function title(file, num, heading, cmd, seed) {
  const w = 1200, h = 130, id = "t" + num;
  const b = blob({ cx: 62, cy: 58, r: 92, seed, amp: 0.2, n: 8 });
  const drops = [0, 1, 2].map((i) => drip(300 + i * 290 + seed * 7, -8, 150, 8 + i * 2, f(3.4 + i * 0.7), f(i * 0.9))).join("");
  write(file, `${open(w, h, heading)}
  <defs>${liquidDefs(id, { blur: 7, wobble: 16, freq: [0.008, 0.02] })}${panel(id, w, h, 26)}</defs>
  <g clip-path="url(#clip-${id})">
    <rect width="${w}" height="${h}" fill="${K}"/>
    <g fill="${Y}" filter="url(#goo-${id})">
      ${blobPath(b, 9)}<rect x="-20" y="-30" width="1240" height="26"/>${drops}
      ${wave({ y: 122, amp: 5, period: 120, bottom: 160, dur: 4 })}
    </g>
    <text x="60" y="80" text-anchor="middle" class="d" font-size="42" fill="${K}">${num}</text>
    <text x="178" y="84" class="d" font-size="46" letter-spacing="2" fill="${W}">${esc(heading)}</text>
    <text x="1160" y="80" text-anchor="end" class="m" font-size="18" fill="${Y}">${esc(cmd)} <tspan fill="${W}">█${blink}</tspan></text>
  </g></svg>`);
}
title("t-about.svg", "01", "ABOUT ME", "$ whoami", 3);
title("t-stack.svg", "02", "TECH STACK", "$ ls ~/tools", 8);
title("t-projects.svg", "03", "THINGS I BUILT", "$ git log --oneline", 13);
title("t-stats.svg", "04", "LIVE STATS", "$ cat stats.json", 19);

/* ----------------------------------------------------------------- about */
{
  const facts = [
    ...Object.entries(config.about),
    ["Uptime", uptime(user.createdAt)],
    ["Repos", `${repos.length} public · ★ ${stars} stars · ${user.followers.totalCount} followers`],
    ["Langs", langs.slice(0, 3).map((l) => l.name).join(" · ")],
  ];
  // long values wrap onto indented continuation lines (DM Mono is monospaced, so columns line up)
  const X = 500, rowH = 31, CH = 10.2, COLS = 64;
  let line = 0;
  const rows = facts.map(([k, v], i) => {
    const indent = k.length + 5, parts = wrap(String(v), COLS - indent);
    const y0 = 114 + line * rowH;
    line += parts.length;
    return `<g opacity="0">${fadeIn(f(0.3 + i * 0.12))}
      <text x="${X}" y="${y0}" class="m" font-size="17"><tspan fill="${Y}">${esc(k)}</tspan><tspan fill="${MUTE}">  ▸  </tspan><tspan fill="${W}">${esc(parts[0])}</tspan>${parts.slice(1).map((p, j) => `<tspan x="${f(X + indent * CH)}" y="${y0 + (j + 1) * rowH}" fill="${W}">${esc(p)}</tspan>`).join("")}</text></g>`;
  }).join("");
  const w = 1200, h = Math.max(440, 114 + line * rowH + 60), cx = 235, cy = h / 2;
  const pool = blob({ cx, cy, r: 172, seed: 61, amp: 0.13, n: 9 });
  const face = blob({ cx, cy, r: 138, seed: 62, amp: 0.07, n: 9 });
  const star = (x, y, sc, delay, fill) => `<path transform="translate(${x} ${y}) scale(${sc})" d="M0 -16C2 -4 4 -2 16 0C4 2 2 4 0 16C-2 4 -4 2 -16 0C-4 -2 -2 -4 0 -16Z" fill="${fill}" opacity="0"><animate attributeName="opacity" values="0;1;0" dur="2.6s" begin="${delay}s" repeatCount="indefinite"/></path>`;
  const rays = Array.from({ length: 18 }, (_, i) => {
    const a = (i * 20 * Math.PI) / 180, d = (3.5 * Math.PI) / 180, R = 230;
    return `M${cx} ${cy}L${f(cx + Math.cos(a - d) * R)} ${f(cy + Math.sin(a - d) * R)}L${f(cx + Math.cos(a + d) * R)} ${f(cy + Math.sin(a + d) * R)}Z`;
  }).join("");
  const ring = blobPath(face, 9, `fill="none" stroke="${K}" stroke-width="7"`);
  const imgW = 300, imgH = Math.round(imgW * cutoutRatio);
  const pic = cutout
    // the cartoon bust sits in a black portal with anime speed-lines; the head breaks out over the rim
    ? `<g clip-path="url(#face)"><rect x="${cx - 200}" y="${cy - 200}" width="400" height="400" fill="${K}"/>
        <g><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="40s" repeatCount="indefinite"/><path d="${rays}" fill="${Y}" fill-opacity=".28"/></g>
        <circle cx="${cx}" cy="${cy}" r="60" fill="${Y}" fill-opacity=".18"><animate attributeName="r" values="40;150;40" dur="4s" repeatCount="indefinite"/><animate attributeName="fill-opacity" values=".3;0;.3" dur="4s" repeatCount="indefinite"/></circle></g>
      ${ring}
      <image href="${cutout}" x="${cx - imgW / 2}" y="${cy + 165 - imgH}" width="${imgW}" height="${imgH}" clip-path="url(#popout)"/>
      <g clip-path="url(#lower)">${ring}</g>
      ${star(cx + 128, cy - 150, 0.8, 0, Y)}${star(cx - 135, cy - 118, 0.55, 1.1, W)}${star(cx + 158, cy - 70, 0.45, 1.8, W)}`
    : `${avatar ? `<image href="${avatar}" x="${cx - 150}" y="${cy - 150}" width="300" height="300" preserveAspectRatio="xMidYMid slice" clip-path="url(#face)"/>`
      : `<g clip-path="url(#face)"><rect x="${cx - 150}" y="${cy - 150}" width="300" height="300" fill="${G1}"/><text x="${cx}" y="${cy + 30}" text-anchor="middle" class="d" font-size="90" fill="${Y}">${esc(USER[0])}</text></g>`}${ring}`;
  const swatches = [Y, W, MUTE, G2, K].map((c, i) => `<rect x="${X + i * 44}" y="${102 + line * rowH}" width="36" height="20" rx="10" fill="${c}" stroke="${c === K ? W : "none"}" stroke-width="1.5"/>`).join("");

  write("about.svg", `${open(w, h, `About ${user.name || USER}: ` + facts.map((r) => r.join(": ")).join(", "))}
  <defs>${liquidDefs("a", { blur: 9, wobble: 22 })}${panel("a", w, h, 30)}
    <clipPath id="face"><path d="${face.at(0)}">${morph(face, 9)}</path></clipPath>
    <clipPath id="popout"><path d="${face.at(0)}">${morph(face, 9)}</path><rect x="${cx - 220}" y="0" width="440" height="${cy}"/></clipPath>
    <clipPath id="lower"><rect x="0" y="${cy + 20}" width="${w}" height="${h}"/></clipPath>
  </defs>
  <g clip-path="url(#clip-a)">
    <rect width="${w}" height="${h}" fill="${K}"/>
    <g fill="${Y}" filter="url(#goo-a)">
      ${blobPath(pool, 12)}
      ${bob(cx + 170, cy - 120, 30, -20, 22, 6, 0)}${bob(cx - 175, cy + 110, -24, 26, 18, 7, 1)}${bob(cx + 120, cy + 175, 26, 20, 14, 5.5, 0.6)}
      ${wave({ y: h - 15, amp: 6, period: 140, bottom: h + 20, dur: 5 })}
    </g>
    <path id="orbit" d="M${cx} ${cy - 196}a196 196 0 1 1 -0.1 0" fill="none"/>
    <g><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="30s" repeatCount="indefinite"/>
      <text class="m" font-size="14" letter-spacing="4" fill="${W}"><textPath href="#orbit">${esc(config.orbit)}</textPath></text></g>
    ${pic}
    <text x="${X}" y="72" class="m" font-size="19"><tspan fill="${Y}">hebi@${esc(USER.toLowerCase())}</tspan><tspan fill="${W}">:~$ neofetch </tspan><tspan fill="${Y}">█${blink}</tspan></text>
    <rect x="${X}" y="86" width="640" height="2" fill="${G2}"/>
    ${rows}${swatches}
  </g></svg>`);
}

/* ----------------------------------------------------------------- stack */
{
  const w = 1200, rowH = 70, names = icons.groups.flatMap((g) => g[1]);
  const rowsN = 3, per = Math.ceil(names.length / rowsN);
  let body = "";
  for (let r = 0; r < rowsN; r++) {
    const list = names.slice(r * per, (r + 1) * per);
    let x = 0, chips = "";
    list.forEach((name, i) => {
      const cw = name.length * 9.4 + 74, yel = (i + r) % 3 === 0, path = icons.paths[name];
      chips += `<g transform="translate(${f(x)} 0)">
        <rect width="${f(cw)}" height="48" rx="24" fill="${yel ? Y : G1}" stroke="${yel ? Y : W}" stroke-opacity="${yel ? 1 : 0.35}" stroke-width="1.5"/>
        <circle cx="25" cy="24" r="16" fill="${yel ? K : Y}"/>
        ${path ? `<g transform="translate(16.6 15.6) scale(.7)"><path d="${path}" fill="${yel ? Y : K}"/></g>` : `<text x="25" y="30" text-anchor="middle" class="d" font-size="15" fill="${yel ? Y : K}">${esc(name[0])}</text>`}
        <text x="50" y="30.5" class="s" font-size="17" fill="${yel ? K : W}">${esc(name)}</text></g>`;
      x += cw + 14;
    });
    const L = f(x), dur = f(L / 45), rev = r % 2 === 1;
    body += `<g transform="translate(0 ${48 + r * rowH})"><g>
      <animateTransform attributeName="transform" type="translate" from="${rev ? -L : 0} 0" to="${rev ? 0 : -L} 0" dur="${dur}s" repeatCount="indefinite"/>
      <g id="row${r}">${chips}</g><use href="#row${r}" x="${L}"/><use href="#row${r}" x="${L * 2}"/>
    </g></g>`;
  }
  const h = 48 + rowsN * rowH + 34;
  write("stack.svg", `${open(w, h, "Tech stack: " + names.join(", "))}
  <defs>${liquidDefs("k", { blur: 7, wobble: 14, freq: [0.008, 0.02] })}${panel("k", w, h, 28)}
    <linearGradient id="fadeL"><stop offset="0" stop-color="${K}"/><stop offset="1" stop-color="${K}" stop-opacity="0"/></linearGradient>
    <linearGradient id="fadeR"><stop offset="0" stop-color="${K}" stop-opacity="0"/><stop offset="1" stop-color="${K}"/></linearGradient>
  </defs>
  <g clip-path="url(#clip-k)">
    <rect width="${w}" height="${h}" fill="${K}"/>
    ${body}
    <rect width="120" height="${h}" fill="url(#fadeL)"/><rect x="${w - 120}" width="120" height="${h}" fill="url(#fadeR)"/>
    <g fill="${Y}" filter="url(#goo-k)">${wave({ y: h - 8, amp: 5, period: 130, bottom: h + 30, dur: 4.5, reverse: true })}${hop(300, h - 6, 20, 8, 2.4, 0)}${hop(860, h - 6, 24, 10, 2.9, 1)}</g>
    <text x="40" y="30" class="m" font-size="14" letter-spacing="3" fill="${MUTE}">${names.length} TOOLS · ALWAYS FLOWING</text>
  </g></svg>`);
}

/* ----------------------------------------------------------------- stats */
{
  const w = 1200;
  const tiles = [
    ["ALL-TIME", fmt(allTime), "contributions"],
    ["LAST 365 DAYS", fmt(lastYearTotal), "contributions"],
    ["CURRENT STREAK", fmt(streaks.current), streaks.current === 1 ? "day" : "days"],
    ["LONGEST STREAK", fmt(streaks.longest), streaks.longest === 1 ? "day" : "days"],
  ];
  const tw = 264, tg = 18, tx0 = (w - (tw * 4 + tg * 3)) / 2;
  const tileSvg = tiles.map(([lab, num, unit], i) => {
    const x = tx0 + i * (tw + tg), hot = i === 0;
    return `<g opacity="0">${fadeIn(f(0.1 + i * 0.12), 14)}
      <rect x="${x}" y="36" width="${tw}" height="150" rx="24" fill="${hot ? Y : G1}" stroke="${hot ? Y : G2}" stroke-width="2"/>
      <text x="${x + 24}" y="70" class="m" font-size="14" letter-spacing="2.5" fill="${hot ? K : Y}">${lab}</text>
      <text x="${x + 22}" y="140" class="d" font-size="58" fill="${hot ? K : W}">${num}</text>
      <text x="${x + 24}" y="168" class="m" font-size="14" fill="${hot ? K : MUTE}">${unit}</text></g>`;
  }).join("");

  // ---- the snake: a yellow serpent with a white head slithers column by column through the
  // last 52 weeks, eating every contribution box it passes; the grid refills each loop.
  const P = 15, cell = 12, hx = tx0, hy = 248, hw = 52 * P - (P - cell), hh = 7 * P - (P - cell);
  const maxC = Math.max(1, ...lastYear.map((d) => d.contributionCount));
  const level = (c) => (c === 0 ? 0 : Math.min(4, Math.ceil((c / maxC) * 4)));
  const weeks = calWeeks.slice(-52);
  const firstDow = new Date(weeks[0][0].date + "T00:00:00Z").getUTCDay();
  const center = (c, r) => [hx + c * P + cell / 2, hy + r * P + cell / 2];
  const order = [];
  for (let c = 0; c < 52; c++) for (let k = 0; k < 7; k++) order.push([c, c % 2 ? 6 - k : k]);
  const L = (order.length - 1) * P, S = 6 * P, step = 0.055, move = f(((L + S) / P) * step), T = f(move + 2.5);
  const snakePath = order.map(([c, r], i) => `${i ? "L" : "M"}${center(c, r).join(" ")}`).join("");
  const at = new Map(order.map(([c, r], i) => [`${c},${r}`, i]));
  const cells = weeks.map((wk, wi) => wk.map((d, di) => {
    const r = wi === 0 ? firstDow + di : new Date(d.date + "T00:00:00Z").getUTCDay(), lv = level(d.contributionCount);
    const eatAt = (at.get(`${wi},${r}`) * P) / (L + S) * (move / T);
    return `<rect x="${hx + wi * P}" y="${hy + r * P}" width="${cell}" height="${cell}" rx="3" fill="${HEAT[lv]}">${lv ? `<animate attributeName="fill" values="${HEAT[lv]};${HEAT[0]}" keyTimes="0;${eatAt.toFixed(4)}" calcMode="discrete" dur="${T}s" repeatCount="indefinite"/>` : ""}</rect>`;
  }).join("")).join("");
  const kt = `0;${(move / T).toFixed(4)};1`;
  const snake = `<path d="${snakePath}" fill="none" stroke="${Y}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${S} ${L + S + 40}" stroke-dashoffset="${S}">
      <animate attributeName="stroke-dashoffset" values="${S};${-L};${-L}" keyTimes="${kt}" dur="${T}s" repeatCount="indefinite"/></path>
    <path d="${snakePath}" fill="none" stroke="${W}" stroke-width="13" stroke-linecap="round" stroke-dasharray="12 ${L + S + 60}" stroke-dashoffset="12">
      <animate attributeName="stroke-dashoffset" values="12;${-L - S + 12};${-L - S + 12}" keyTimes="${kt}" dur="${T}s" repeatCount="indefinite"/></path>`;
  const legend = `<text x="${hx}" y="${hy + hh + 26}" class="m" font-size="12" fill="${MUTE}">less</text>
    ${HEAT.map((c, i) => `<rect x="${hx + 40 + i * 16}" y="${hy + hh + 15}" width="12" height="12" rx="3" fill="${c}"/>`).join("")}
    <text x="${hx + 128}" y="${hy + hh + 26}" class="m" font-size="12" fill="${MUTE}">more · the snake eats them, they grow back</text>`;

  const lx = 880, lw = 280;
  const bars = langs.map((l, i) => {
    const y = 270 + i * 38, fw = Math.max(16, (l.pct / langs[0].pct) * lw);
    return `<text x="${lx}" y="${y}" class="s" font-size="15" fill="${W}">${esc(l.name)}</text>
      <text x="${lx + lw}" y="${y}" text-anchor="end" class="m" font-size="14" fill="${Y}">${l.pct.toFixed(1)}%</text>
      <rect x="${lx}" y="${y + 8}" width="${lw}" height="13" rx="6.5" fill="${G2}"/>
      <rect x="${lx}" y="${y + 8}" width="0" height="13" rx="6.5" fill="${Y}"><animate attributeName="width" from="0" to="${f(fw)}" dur="1.2s" begin="${f(0.4 + i * 0.15)}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/></rect>`;
  }).join("");

  const chips = [`★ ${stars} stars`, `${user.followers.totalCount} followers`, `${repos.length} repos`, `${activeDays} active days`, `best day: ${bestDay}`];
  let chx = hx;
  const chipSvg = chips.map((c) => {
    const cw = c.length * 9 + 30, s = `<rect x="${chx}" y="${hy + hh + 46}" width="${cw}" height="34" rx="17" fill="none" stroke="${Y}" stroke-width="1.5"/><text x="${chx + cw / 2}" y="${hy + hh + 68}" text-anchor="middle" class="m" font-size="14" fill="${W}">${esc(c)}</text>`;
    chx += cw + 10;
    return s;
  }).join("");

  // ---- three columns: frameworks and technologies detected across repos, plus a pulse check
  const colY = 500, colW = 350, colX = [hx, hx + colW + 30, hx + 2 * (colW + 30)];
  const ranked = (x, items, empty) => items.length
    ? items.map(([name, n], j) => {
      const y = colY + 34 + j * 36;
      return `<g opacity="0">${fadeIn(f(0.5 + j * 0.1))}
        <text x="${x}" y="${y}" class="d" font-size="15" fill="${j === 0 ? Y : MUTE}">${String(j + 1).padStart(2, "0")}</text>
        <text x="${x + 36}" y="${y}" class="s" font-size="17" fill="${W}">${esc(name)}</text>
        ${Array.from({ length: Math.min(n, 8) }, (_, d) => `<circle cx="${x + colW - 12 - d * 13}" cy="${y - 5}" r="4.5" fill="${j === 0 ? Y : W}"/>`).join("")}
        <rect x="${x}" y="${y + 12}" width="${colW}" height="1" fill="${G2}"/></g>`;
    }).join("")
    : `<text x="${x}" y="${colY + 34}" class="m" font-size="14" fill="${MUTE}">${empty}</text>`;
  const latest = repos.find((r) => !config.projects.hide.includes(r.name));
  const pulse = [
    ["Busiest day", busiestDow],
    ["Peak month", busiestMonth],
    ["Latest push", latest ? `${latest.name} · ${shortDate(latest.pushedAt)}` : "—"],
    ["Top language", langs[0]?.name ?? "—"],
    ["Repos w/ CI", `${stacks.filter((s) => s.tech.has("GitHub Actions")).length} of ${repos.length}`],
  ].map(([k, v], j) => {
    const y = colY + 34 + j * 36;
    return `<g opacity="0">${fadeIn(f(0.5 + j * 0.1))}
      <text x="${colX[2]}" y="${y}" class="m" font-size="14" fill="${Y}">${esc(k)}</text>
      <text x="${colX[2] + colW}" y="${y}" text-anchor="end" class="s" font-size="16" fill="${W}">${esc(v.length > 26 ? v.slice(0, 25) + "…" : v)}</text>
      <rect x="${colX[2]}" y="${y + 12}" width="${colW}" height="1" fill="${G2}"/></g>`;
  }).join("");
  const h = colY + 34 + 5 * 36 + 60;
  const head = (x, y, t) => `<text x="${x}" y="${y}" class="m" font-size="14" letter-spacing="2.5" fill="${Y}">${t}</text>`;

  write("stats.svg", `${open(w, h, `Stats: ${fmt(allTime)} contributions all-time, ${fmt(lastYearTotal)} in the last year, current streak ${streaks.current} days, longest ${streaks.longest} days. Languages: ${langs.map((l) => l.name).join(", ")}. Frameworks: ${topFrameworks.map((x) => x[0]).join(", ")}. Technologies: ${topTech.map((x) => x[0]).join(", ")}`)}
  <defs>${liquidDefs("st", { blur: 9, wobble: 20 })}${panel("st", w, h, 30)}</defs>
  <g clip-path="url(#clip-st)">
    <rect width="${w}" height="${h}" fill="${K}"/>
    ${tileSvg}
    ${head(hx, 232, "THE SNAKE · LAST 52 WEEKS")}
    ${cells}${snake}${legend}${chipSvg}
    ${head(lx, 232, "TOP LANGUAGES")}${bars}
    <rect x="${hx}" y="${colY - 34}" width="${w - 2 * hx}" height="2" fill="${G2}"/>
    ${head(colX[0], colY, "TOP FRAMEWORKS")}${ranked(colX[0], topFrameworks, "nothing detected yet")}
    ${head(colX[1], colY, "TOP TECHNOLOGIES")}${ranked(colX[1], topTech, "nothing detected yet")}
    ${head(colX[2], colY, "PULSE")}${pulse}
    <g fill="${Y}" filter="url(#goo-st)">${wave({ y: h - 16, amp: 7, period: 180, bottom: h + 40, dur: 5 })}${hop(220, h - 14, 26, 10, 2.6, 0)}${hop(640, h - 14, 34, 12, 3.1, 0.8)}${hop(1010, h - 14, 22, 9, 2.4, 1.5)}</g>
  </g></svg>`);
}

/* -------------------------------------------------------------- projects */
function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > max) { lines.push(line.trim()); line = ""; }
    line += " " + word;
  }
  return [...lines, line.trim()].filter(Boolean);
}
const PW = 590, PH = 260;
const picked = repos.filter((r) => !config.projects.hide.includes(r.name) && !r.isArchived).slice(0, config.projects.max);
picked.forEach((r, i) => {
  const id = "p" + i, o = config.projects.overrides[r.name] ?? {};
  const tagline = o.tagline ?? blurb(r) ?? "Something cooking in the lab.";
  const st = stacks[repos.indexOf(r)];
  const tags = o.tags ?? [...r.repositoryTopics.nodes.map((t) => t.topic.name), ...st.fw].slice(0, 2);
  const b = blob({ cx: PW + 10, cy: -10, r: 120, seed: 70 + i, amp: 0.2, n: 8 });
  const lines = wrap(tagline, 50).slice(0, 3);
  const nm = r.name.length > 20 ? r.name.slice(0, 19) + "…" : r.name;
  let tx = 30;
  const tagSvg = [...tags.map((t) => [t, false]), ...(r.primaryLanguage ? [[r.primaryLanguage.name, true]] : [])].map(([t, lang]) => {
    const cw = t.length * 8.4 + 26, s = `<rect x="${tx}" y="200" width="${cw}" height="30" rx="15" fill="${lang ? Y : "none"}" stroke="${Y}" stroke-width="1.5"/><text x="${tx + cw / 2}" y="220" text-anchor="middle" class="m" font-size="13" fill="${lang ? K : W}">${esc(t)}</text>`;
    tx += cw + 8;
    return s;
  }).join("");
  write(`project-${r.name}.svg`, `${open(PW, PH, `${r.name} — ${tagline}`)}
  <defs>${liquidDefs(id, { blur: 8, wobble: 18 })}${panel(id, PW, PH, 26)}</defs>
  <g clip-path="url(#clip-${id})">
    <rect width="${PW}" height="${PH}" fill="${K}"/><rect x="1" y="1" width="${PW - 2}" height="${PH - 2}" rx="25" fill="none" stroke="${G2}" stroke-width="2"/>
    <g fill="${Y}" filter="url(#goo-${id})">${blobPath(b, 10 + i)}${bob(PW - 150, 40, -20, 16, 14, 6, i * 0.5)}${drip(PW - 60, 100, 300, 10, 4 + i * 0.3, i * 0.7)}</g>
    <text x="${PW - 30}" y="62" text-anchor="end" class="d" font-size="34" fill="${K}">${String(i + 1).padStart(2, "0")}</text>
    <text x="30" y="58" class="m" font-size="13" letter-spacing="2.5" fill="${Y}">★ ${r.stargazerCount} · PUSHED ${esc(shortDate(r.pushedAt).toUpperCase())}</text>
    <text x="30" y="100" class="d" font-size="32" fill="${W}">${esc(nm)}</text>
    ${lines.map((l, j) => `<text x="30" y="${136 + j * 22}" class="m" font-size="15" fill="${W}" fill-opacity=".78">${esc(l)}</text>`).join("")}
    ${tagSvg}
    <text x="${PW - 30}" y="222" text-anchor="end" class="d" font-size="24" fill="${Y}">↗</text>
  </g></svg>`);
});

// odd number of cards? the last slot becomes a "coming soon" card so the grid stays even
const soon = picked.length % 2 === 1;
if (soon) {
  const b = blob({ cx: 110, cy: 130, r: 70, seed: 91, amp: 0.22, n: 8 });
  write("project-coming-soon.svg", `${open(PW, PH, "Coming soon — " + config.projects.comingSoon)}
  <defs>${liquidDefs("cs", { blur: 8, wobble: 18 })}${panel("cs", PW, PH, 26)}</defs>
  <g clip-path="url(#clip-cs)">
    <rect width="${PW}" height="${PH}" fill="${K}"/>
    <rect x="3" y="3" width="${PW - 6}" height="${PH - 6}" rx="23" fill="none" stroke="${Y}" stroke-width="2.5" stroke-dasharray="10 9"><animate attributeName="stroke-dashoffset" from="0" to="-38" dur="1.2s" repeatCount="indefinite"/></rect>
    <g fill="${Y}" filter="url(#goo-cs)">${blobPath(b, 7)}${bob(170, 80, 22, -14, 14, 3.4, 0)}${bob(60, 200, -16, 12, 11, 4.2, 0.6)}${bob(175, 185, 18, 16, 9, 3.8, 1.2)}</g>
    <text x="110" y="144" text-anchor="middle" class="d" font-size="34" fill="${K}">?<animateTransform attributeName="transform" type="rotate" values="-12 110 132;12 110 132;-12 110 132" dur="2.4s" repeatCount="indefinite"/></text>
    <text x="230" y="98" class="d" font-size="34" fill="${W}">COMING SOON</text>
    ${wrap(config.projects.comingSoon, 34).map((l, j) => `<text x="230" y="${132 + j * 22}" class="m" font-size="15" fill="${W}" fill-opacity=".78">${esc(l)}</text>`).join("")}
    <rect x="230" y="190" width="300" height="12" rx="6" fill="${G2}"/>
    <rect x="230" y="190" width="0" height="12" rx="6" fill="${Y}"><animate attributeName="width" values="0;300;300" keyTimes="0;0.8;1" dur="3s" repeatCount="indefinite"/></rect>
    <text x="230" y="230" class="m" font-size="13" letter-spacing="2.5" fill="${Y}">LOADING NEXT DROP<tspan>...<animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></tspan></text>
  </g></svg>`);
}

/* --------------------------------------------------------- connect strip */
{
  const GH = "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.105 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12";
  const ICONS = {
    github: (c) => `<path d="${GH}" fill="${c}"/>`,
    repos: (c) => `<path d="M3 4.5A2.5 2.5 0 0 1 5.5 2H20v16H5.5A2.5 2.5 0 0 0 3 20.5zM3 20.5A2.5 2.5 0 0 0 5.5 23H20v-5" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/><path d="M8 7h8M8 11h5" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>`,
    follow: (c) => `<circle cx="9" cy="7.5" r="4.2" fill="${c}"/><path d="M1.5 22c0-4.6 3.4-7.6 7.5-7.6s7.5 3 7.5 7.6z" fill="${c}"/><path d="M19.5 6v8M15.5 10h8" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/>`,
  };
  config.connect.forEach((b, i) => {
    const w = 390, h = 104, id = "c" + i, hot = i === 1, bg = hot ? Y : K, fg = hot ? K : Y, ink = hot ? K : W;
    const pool = blob({ cx: 54, cy: 52, r: 54, seed: 120 + i, amp: 0.15, n: 8 });
    write(`${b.file}.svg`, `${open(w, h, `${b.title} — ${b.sub}`)}
  <defs>${liquidDefs(id, { blur: 6, wobble: 12, freq: [0.01, 0.025] })}${panel(id, w, h, 52)}</defs>
  <g clip-path="url(#clip-${id})">
    <rect width="${w}" height="${h}" fill="${bg}"/>
    <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="50" fill="none" stroke="${hot ? K : G2}" stroke-width="3"/>
    <g fill="${fg}" filter="url(#goo-${id})">${blobPath(pool, 6 + i)}${bob(104, 16, 10, 6, 8, 3.2, i * 0.4)}${bob(98, 90, 10, -6, 6, 3.8, i * 0.7)}</g>
    <g transform="translate(36 30) scale(1.8)">${ICONS[b.icon](hot ? Y : K)}</g>
    <text x="134" y="54" class="d" font-size="30" letter-spacing="1" fill="${ink}">${esc(b.title)}</text>
    <text x="136" y="80" class="m" font-size="15" letter-spacing="4" fill="${hot ? K : Y}">${esc(b.sub)}</text>
    <g><animateTransform attributeName="transform" type="translate" values="0 0;5 -5;0 0" dur="1.6s" begin="${i * 0.3}s" repeatCount="indefinite"/>
      <text x="${w - 34}" y="64" text-anchor="end" class="d" font-size="30" fill="${fg}">↗</text></g>
  </g></svg>`);
  });
}

/* ---------------------------------------------------------------- footer */
{
  const w = 1200, h = 320, N = config.outro.length, per = 1.8, T = f(N * per), win = 1 / N;
  const k = (...xs) => xs.map((x) => (x * win).toFixed(4)).join(";");
  const phrases = config.outro.map(([text, label], i) => `<g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;${k(0.08, 0.84, 0.98)};1" dur="${T}s" begin="${f(i * per)}s" repeatCount="indefinite"/>
      <animateTransform attributeName="transform" type="translate" values="0 40;0 -10;0 0;0 0;0 -40;0 -40" keyTimes="0;${k(0.1, 0.18, 0.84, 0.98)};1" dur="${T}s" begin="${f(i * per)}s" repeatCount="indefinite"/>
      <text x="600" y="150" text-anchor="middle" class="u" font-size="62" fill="${W}" stroke="${K}" stroke-width="8" paint-order="stroke">${esc(text)}</text>
      <text x="600" y="196" text-anchor="middle" class="m" font-size="16" letter-spacing="4" fill="${Y}">${esc(label)}</text></g>`).join("");
  write("footer.svg", `${open(w, h, "Outro: " + config.outro.map((o) => o[0]).join(" · "))}
  <defs>${liquidDefs("f", { blur: 9, wobble: 22, freq: [0.006, 0.015] })}${panel("f", w, h, 30)}</defs>
  <g clip-path="url(#clip-f)">
    <rect width="${w}" height="${h}" fill="${K}"/>
    ${wave({ y: 236, amp: 14, period: 300, bottom: 350, dur: 7, reverse: true, attrs: `fill="none" stroke="${W}" stroke-width="3"` })}
    <g fill="${Y}" filter="url(#goo-f)">
      ${wave({ y: 262, amp: 16, period: 260, bottom: 350, dur: 5 })}
      ${[110, 290, 910, 1090].map((x, i) => hop(x, 276, 90 + (i % 2) * 30, 12 + (i % 3) * 4, f(2.6 + (i % 3) * 0.6), f(i * 0.45))).join("")}
    </g>
    <text x="600" y="62" text-anchor="middle" class="m" font-size="15" letter-spacing="8" fill="${W}">✦ BYE-BYE~ ✦</text>
    ${phrases}
  </g></svg>`);
}

/* ------------------------------------------------------- README projects */
const readmePath = new URL("README.md", root);
const readme = readFileSync(readmePath, "utf8");
const cards = [
  ...picked.map((r) => `<a href="https://github.com/${USER}/${r.name}"><img src="./generated/project-${r.name}.svg" width="49%" alt="${esc(r.name)}"/></a>`),
  ...(soon ? [`<a href="https://github.com/${USER}?tab=repositories"><img src="./generated/project-coming-soon.svg" width="49%" alt="Coming soon"/></a>`] : []),
];
const grid = [];
for (let i = 0; i < cards.length; i += 2) grid.push(cards.slice(i, i + 2).join("\n"));
writeFileSync(readmePath, readme.replace(/<!-- PROJECTS:START -->[\s\S]*<!-- PROJECTS:END -->/, `<!-- PROJECTS:START -->\n${grid.join("\n<br/>\n")}\n<!-- PROJECTS:END -->`));

console.log(`built liquid profile · ${picked.length} projects${soon ? " + coming soon" : ""} · ${fmt(allTime)} contributions · streak ${streaks.current}/${streaks.longest} · frameworks: ${topFrameworks.map((x) => x.join("×")).join(", ")} · tech: ${topTech.map((x) => x.join("×")).join(", ")} · avatar ${avatar ? "embedded" : "fallback"}`);
