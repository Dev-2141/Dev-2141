// Builds the live SVG cards in generated/ from GitHub data.
// Runs daily in .github/workflows/build.yml; locally: GITHUB_TOKEN=$(gh auth token) node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../profile.config.json", import.meta.url)));
const OUT = new URL("../generated/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
const USER = config.user;

const SANS = "'Segoe UI', Ubuntu, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ConsolasFallback, Consolas, 'SFMono-Regular', Menlo, 'Liberation Mono', monospace";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const write = (name, svg) => writeFileSync(new URL(name, OUT), svg.replace(/\n\s*/g, "\n"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const { user } = await graphql(
  `query($login: String!) {
    user(login: $login) {
      login createdAt
      followers { totalCount }
      contributionsCollection { contributionYears totalCommitContributions contributionCalendar { totalContributions } }
      repositoriesContributedTo(first: 1, includeUserRepositories: false, contributionTypes: [COMMIT, PULL_REQUEST, REPOSITORY]) { totalCount }
      repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: { field: PUSHED_AT, direction: DESC }) {
        totalCount
        nodes {
          name description url isFork isArchived stargazerCount forkCount createdAt pushedAt
          primaryLanguage { name color }
          languages(first: 6, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
          repositoryTopics(first: 6) { nodes { topic { name } } }
          defaultBranchRef { target { ... on Commit { history { totalCount } committedDate messageHeadline } } }
        }
      }
    }
  }`,
  { login: USER },
);

// All-time contributions: one aliased query over every contribution year.
const years = user.contributionsCollection.contributionYears;
const yearly = await graphql(
  `query($login: String!) { user(login: $login) { ${years
    .map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { contributionCalendar { totalContributions } }`)
    .join("\n")} } }`,
  { login: USER },
);
const allTimeContributions = years.reduce((n, y) => n + yearly.user[`y${y}`].contributionCalendar.totalContributions, 0);

const repos = user.repositories.nodes.filter((r) => !r.isFork);
const stars = repos.reduce((n, r) => n + r.stargazerCount, 0);

// Lines of code: additions/deletions authored by USER, from the contributor stats endpoint.
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
  let entry = cache[r.name];
  if (Array.isArray(stats)) {
    const mine = stats.find((s) => s.author?.login?.toLowerCase() === USER.toLowerCase());
    entry = mine ? mine.weeks.reduce((a, w) => ({ add: a.add + w.a, del: a.del + w.d }), { add: 0, del: 0 }) : { add: 0, del: 0 };
    cache[r.name] = entry;
  }
  if (entry) loc = { add: loc.add + entry.add, del: loc.del + entry.del };
}
writeFileSync(cachePath, JSON.stringify(cache, null, 2) + "\n");

// Commit timestamps for the rhythm card.
const commitDates = [];
for (const r of repos) {
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(`/repos/${USER}/${r.name}/commits?author=${USER}&per_page=100&page=${page}`).catch(() => []);
    if (!Array.isArray(batch) || !batch.length) break;
    commitDates.push(...batch.map((c) => c.commit.author.date));
    if (batch.length < 100) break;
  }
}

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

/* ------------------------------------------------------------- neofetch */

const ASCII = String.raw`
               _.-~~~~-._
            .-'  .----.  '-.
          .'   .'  __  '.   '.
         /    /  ,'  ', \     \
        /    |  ( o  o ) |     \
       |     |   \ /\ /  |      |
       |      \   '--'  /       |
        \      '.  ||  .'      /
         '.      '-\/-'      .'
           '-.    /  \    .-'
              '-./    \.-'
                 |    |
                 |    |
          _.---._\    /_.---._
       .-'  .-.  '-..-'  .-.  '-.
      /    /   \        /   \    \
     |    |     '------'     |    |
      \    '-.            .-'    /
       '-._   '----------'   _.-'
           '---..______..---'
`.split("\n").slice(1, -1);

function neofetch(theme) {
  const dark = theme === "dark";
  const c = dark
    ? { bg: "#0d1117", border: "#30363d", text: "#c9d1d9", key: "#ffa657", value: "#a5d6ff", dots: "#484f58", add: "#3fb950", del: "#f85149", a1: "#39d353", a2: "#a371f7" }
    : { bg: "#f6f8fa", border: "#d0d7de", text: "#24292f", key: "#953800", value: "#0a3069", dots: "#afb8c1", add: "#1a7f37", del: "#cf222e", a1: "#1a7f37", a2: "#8250df" };
  const WIDTH = 60; // characters per info line
  const topLangs = (() => {
    const bytes = {};
    for (const r of repos) for (const e of r.languages.edges) bytes[e.node.name] = (bytes[e.node.name] ?? 0) + e.size;
    return Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n).join(", ") || "—";
  })();
  const last = repos.find((r) => !config.launches.hide.includes(r.name)) ?? repos[0];

  // Each row is a list of [text, class] segments; `kv` pads the key and value apart with dots.
  const kv = (key, value) => {
    const k = key.split(".");
    const keyParts = k.flatMap((p, i) => (i ? [[".", ""], [p, "key"]] : [[p, "key"]]));
    const used = 2 + key.length + 1 + String(value).length + 2;
    return [[". ", "cc"], ...keyParts, [":", ""], [` ${".".repeat(Math.max(1, WIDTH - used))} `, "cc"], [value, "value"]];
  };
  const rule = (title) => [[`- ${title} `, ""], ["—".repeat(Math.max(2, WIDTH - title.length - 3)), "cc"]];
  const rows = [
    [[`hebi@${USER.toLowerCase()} `, "a"], ["—".repeat(WIDTH - USER.length - 6), "cc"]],
    kv("OS", config.neofetch.OS),
    kv("Uptime", uptime(user.createdAt)),
    kv("Host", config.neofetch.Host),
    kv("Kernel", config.neofetch.Kernel),
    kv("IDE", config.neofetch.IDE),
    [[". ", "cc"]],
    kv("Languages.Programming", topLangs),
    kv("Hobbies.Software", config.neofetch["Hobbies.Software"]),
    kv("Hobbies.Hardware", config.neofetch["Hobbies.Hardware"]),
    [[". ", "cc"]],
    rule("Latest Commit"),
    kv("Repo", last ? last.name : "—"),
    kv("Message", last?.defaultBranchRef ? last.defaultBranchRef.target.messageHeadline.slice(0, 34) : "—"),
    kv("When", last ? ago(last.pushedAt) : "—"),
    [[". ", "cc"]],
    rule("GitHub Stats"),
    [...kv("Repos", `${repos.length} {Contributed: ${user.repositoriesContributedTo.totalCount}}`).slice(0, -1), [`${repos.length}`, "value"], [" {", ""], ["Contributed", "key"], [": ", ""], [`${user.repositoriesContributedTo.totalCount}`, "value"], ["}", ""]],
    kv("Stars", fmt(stars)),
    kv("Followers", fmt(user.followers.totalCount)),
    kv("Contributions", `${fmt(allTimeContributions)} all-time · ${fmt(user.contributionsCollection.contributionCalendar.totalContributions)} this year`),
    [...kv("Lines of Code", `${fmt(loc.add - loc.del)} ( +${fmt(loc.add)}, -${fmt(loc.del)} )`).slice(0, -1), [fmt(loc.add - loc.del), "value"], [" ( ", ""], [`+${fmt(loc.add)}`, "add"], [", ", ""], [`-${fmt(loc.del)}`, "del"], [" )", ""]],
  ];
  const X = 400, Y0 = 34, LH = 20;
  const info = rows
    .map((segs, i) => `<text x="${X}" y="${Y0 + i * LH}" class="row" style="animation-delay:${(0.15 + i * 0.07).toFixed(2)}s">${segs.map(([t, cls]) => `<tspan${cls ? ` class="${cls}"` : ""}>${esc(t)}</tspan>`).join("")}</text>`)
    .join("");
  const endY = Y0 + rows.length * LH;
  const palette = ["#f85149", "#ffa657", "#e3b341", "#3fb950", "#56d4dd", "#58a6ff", "#a371f7", "#f778ba"]
    .map((col, i) => `<rect x="${X + i * 30}" y="${endY + 4}" width="26" height="14" rx="3" fill="${col}" class="blk" style="animation-delay:${(i * 0.15).toFixed(2)}s"/>`)
    .join("");
  const art = ASCII.map((l, i) => `<tspan x="24" y="${Y0 + i * 22}">${esc(l)}</tspan>`).join("");
  const H = Math.max(endY + 40, Y0 + ASCII.length * 22 + 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 985 ${H}" width="985" height="${H}" role="img" aria-label="${USER} neofetch">
  <defs>
    <linearGradient id="art" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="360" y2="${H}">
      <stop offset="0" stop-color="${c.a1}"/><stop offset="0.5" stop-color="${c.a2}"/><stop offset="1" stop-color="${c.a1}"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="0 -${H};0 ${H}" dur="6s" repeatCount="indefinite"/>
    </linearGradient>
  </defs>
  <style>
    @font-face { src: local('Consolas'), local('Consolas Bold'); font-family: 'ConsolasFallback'; font-display: swap; size-adjust: 109%; }
    text, tspan { white-space: pre; font: 16px ${MONO}; fill: ${c.text}; }
    .key { fill: ${c.key}; } .value { fill: ${c.value}; } .cc { fill: ${c.dots}; }
    .add { fill: ${c.add}; } .del { fill: ${c.del}; } .a { fill: ${c.a1}; font-weight: 700; }
    .art tspan { fill: url(#art); font-size: 15px; }
    .row { opacity: 0; animation: in .45s ease-out forwards; }
    @keyframes in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
    .blk { animation: blk 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes blk { 0%, 70%, 100% { transform: none; } 35% { transform: translateY(-4px); } }
    .cursor { fill: ${c.a1}; animation: blink 1s steps(1) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .stamp { font-size: 11px; fill: ${c.dots}; }
  </style>
  <rect x=".5" y=".5" width="984" height="${H - 1}" rx="15" fill="${c.bg}" stroke="${c.border}"/>
  <text class="art">${art}</text>
  ${info}
  ${palette}
  <rect x="${X + 8 * 30 + 6}" y="${endY + 3}" width="9" height="16" class="cursor"/>
  <text x="961" y="${H - 12}" class="stamp" text-anchor="end">live · updated ${today}</text>
</svg>`;
}
write("neofetch-dark.svg", neofetch("dark"));
write("neofetch-light.svg", neofetch("light"));

/* ------------------------------------------------------- launch cards */

const ACCENTS = [["#a371f7", "#f778ba"], ["#39d353", "#56d4dd"], ["#ffa657", "#f85149"], ["#58a6ff", "#a371f7"], ["#e3b341", "#39d353"]];
const launches = repos.filter((r) => !config.launches.hide.includes(r.name) && !r.isArchived);

function launchCard(r, i) {
  const o = config.launches.overrides[r.name] ?? {};
  const [a1, a2] = o.accent ?? ACCENTS[i % ACCENTS.length];
  const W = 900, H = 250;
  const tagline = wrap(o.tagline ?? r.description ?? "Something new is shipping.", 62).slice(0, 2);
  const tags = [...(o.tags ?? []), ...r.repositoryTopics.nodes.map((t) => t.topic.name)].slice(0, 4);
  const commits = r.defaultBranchRef?.target.history.totalCount ?? 0;
  const monogram = (r.name.match(/[A-Z]|(?<=^|[-_ ])[a-z]/g) ?? [r.name[0]]).slice(0, 2).join("").toUpperCase();
  const launched = new Date(r.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const langs = r.languages.edges.filter((e, _, all) => e.size / all.reduce((n, x) => n + x.size, 0) >= 0.01);
  const total = langs.reduce((n, e) => n + e.size, 0) || 1;

  let x = 0;
  const bar = langs
    .map((e) => {
      const w = (e.size / total) * 300;
      const seg = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="8" fill="${e.node.color ?? "#8b949e"}"/>`;
      x += w;
      return seg;
    })
    .join("");
  const legend = langs
    .slice(0, 3)
    .map((e, k) => `<circle cx="${k * 100 + 5}" cy="24" r="4" fill="${e.node.color ?? "#8b949e"}"/><text x="${k * 100 + 14}" y="28" class="s">${esc(e.node.name)} ${((e.size / total) * 100).toFixed(0)}%</text>`)
    .join("");

  let tx = 0;
  const tagEls = tags
    .map((t) => {
      const w = t.length * 7.4 + 22;
      const el = `<g transform="translate(${tx},0)"><rect width="${w}" height="24" rx="12" fill="${a1}" fill-opacity=".12" stroke="${a1}" stroke-opacity=".35"/><text x="${w / 2}" y="16.5" class="tag" text-anchor="middle">${esc(t)}</text></g>`;
      tx += w + 8;
      return el;
    })
    .join("");

  // Confetti drifting up behind the content.
  let seed = [...r.name].reduce((n, ch) => n + ch.charCodeAt(0), 7);
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const confetti = Array.from({ length: 22 }, (_, k) => {
    const cx = 40 + rnd() * (W - 80), s = 3 + rnd() * 5, col = [a1, a2, "#e3b341", "#56d4dd"][k % 4];
    return `<rect x="${cx.toFixed(0)}" y="${H + 10}" width="${s.toFixed(1)}" height="${(s * 1.6).toFixed(1)}" rx="1" fill="${col}" class="cf" style="animation-delay:-${(rnd() * 9).toFixed(2)}s;animation-duration:${(7 + rnd() * 5).toFixed(1)}s"/>`;
  }).join("");

  const stats = [
    ["★", fmt(r.stargazerCount), "stars"],
    ["⑂", fmt(r.forkCount), "forks"],
    ["◆", fmt(commits), "commits"],
    ["↑", ago(r.pushedAt).replace(" ago", ""), "since last ship"],
  ];
  const statEls = stats
    .map(([icon, v, label], k) => `<g transform="translate(${k * 118},0)"><text class="sv"><tspan class="si">${icon}</tspan> ${esc(v)}</text><text y="18" class="s">${label}</text></g>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(r.name)} launch card">
  <defs>
    <linearGradient id="logo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a1}"/><stop offset="1" stop-color="${a2}"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${a1}"/><stop offset=".35" stop-color="#30363d"/><stop offset=".65" stop-color="#30363d"/><stop offset="1" stop-color="${a2}"/>
      <animateTransform attributeName="gradientTransform" type="rotate" values="0 .5 .5;360 .5 .5" dur="8s" repeatCount="indefinite"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.12" cy="0.3" r="0.6"><stop offset="0" stop-color="${a1}" stop-opacity=".18"/><stop offset="1" stop-color="${a1}" stop-opacity="0"/></radialGradient>
    <clipPath id="card"><rect width="${W}" height="${H}" rx="18"/></clipPath>
    <clipPath id="logoClip"><rect width="104" height="104" rx="24"/></clipPath>
  </defs>
  <style>
    text { font-family: ${SANS}; fill: #e6edf3; }
    .eyebrow { font: 700 12px ${MONO}; letter-spacing: 2.5px; fill: ${a1}; }
    .name { font-size: 34px; font-weight: 800; }
    .tl { font-size: 16.5px; fill: #adbac7; }
    .tag { font-size: 12px; font-weight: 600; fill: ${a1}; }
    .s { font-size: 12px; fill: #768390; }
    .sv { font-size: 17px; font-weight: 700; }
    .si { fill: ${a1}; }
    .mono { font-size: 42px; font-weight: 900; fill: #0d1117; }
    .up { font-size: 26px; font-weight: 800; }
    .upl { font: 700 10px ${MONO}; letter-spacing: 2px; fill: #768390; }
    .live { animation: pulse 1.6s ease-out infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes pulse { from { transform: scale(1); opacity: .7; } to { transform: scale(3.2); opacity: 0; } }
    .float { animation: float 5s ease-in-out infinite; }
    @keyframes float { 50% { transform: translateY(-6px); } }
    .shine { animation: shine 3.5s ease-in-out infinite; }
    @keyframes shine { 0%, 55% { transform: translateX(-140px) skewX(-20deg); } 100% { transform: translateX(160px) skewX(-20deg); } }
    .arrow { animation: bob 1.8s ease-in-out infinite; }
    @keyframes bob { 50% { transform: translateY(-5px); } }
    .grow { transform-box: fill-box; transform-origin: left; animation: grow 1.4s cubic-bezier(.2,.8,.2,1) both .4s; }
    @keyframes grow { from { transform: scaleX(0); } }
    .cf { opacity: .55; animation: rise linear infinite; transform-box: fill-box; transform-origin: center; }
    @keyframes rise { from { transform: translateY(0) rotate(0); } to { transform: translateY(-${H + 40}px) rotate(540deg); } }
    .in { opacity: 0; animation: in .6s ease-out forwards; }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  </style>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="#0d1117"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    ${confetti}
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="17" fill="none" stroke="url(#edge)" stroke-width="2"/>

  <g transform="translate(36,36)"><g class="float">
    <g clip-path="url(#logoClip)">
      <rect width="104" height="104" fill="url(#logo)"/>
      <rect x="20" y="-20" width="40" height="150" fill="#fff" opacity=".25" class="shine"/>
    </g>
    <text x="52" y="67" class="mono" text-anchor="middle">${esc(monogram)}</text>
  </g></g>

  <g transform="translate(168,44)">
    <g class="in" style="animation-delay:.05s">
      <circle cx="5" cy="-4" r="5" fill="${a1}" class="live"/><circle cx="5" cy="-4" r="5" fill="${a1}"/>
      <text x="18" y="0" class="eyebrow">NOW LIVE · LAUNCHED ${launched.toUpperCase()}</text>
    </g>
    <text y="40" class="name in" style="animation-delay:.15s">${esc(r.name)}</text>
    ${tagline.map((l, k) => `<text y="${70 + k * 22}" class="tl in" style="animation-delay:${0.25 + k * 0.08}s">${esc(l)}</text>`).join("")}
    <g transform="translate(0,${tagline.length > 1 ? 104 : 86})"><g class="in" style="animation-delay:.45s">${tagEls}</g></g>
  </g>

  <a href="${r.url}">
    <g transform="translate(${W - 128},36)"><g class="in" style="animation-delay:.3s">
      <rect width="92" height="104" rx="16" fill="#161b22" stroke="${a1}" stroke-width="1.5"/>
      <path d="M46 18 l14 16 h-28 z" fill="${a1}" class="arrow"/>
      <text x="46" y="68" class="up" text-anchor="middle">${fmt(r.stargazerCount)}</text>
      <text x="46" y="88" class="upl" text-anchor="middle">UPVOTE</text>
    </g></g>
  </a>

  <path d="M36 180 H${W - 36}" stroke="#21262d"/>
  <g transform="translate(36,208)"><g class="in" style="animation-delay:.55s">${statEls}</g></g>
  <g transform="translate(${W - 336},196)"><g class="in" style="animation-delay:.6s">
    <g clip-path="inset(0 round 4px)"><g class="grow">${bar}</g></g>
    ${legend}
  </g></g>
</svg>`;
}
launches.forEach((r, i) => write(`launch-${r.name}.svg`, launchCard(r, i)));

/* -------------------------------------------------------------- rhythm */

const hourOf = (iso) => Number(new Date(iso).toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: config.timezone }));
const dayOf = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", timeZone: config.timezone });
const buckets = [
  ["Morning", "6am – 12pm", "#e3b341", (h) => h >= 6 && h < 12],
  ["Daytime", "12pm – 6pm", "#ffa657", (h) => h >= 12 && h < 18],
  ["Evening", "6pm – 12am", "#a371f7", (h) => h >= 18],
  ["Night", "12am – 6am", "#58a6ff", (h) => h < 6],
].map(([name, range, color, test]) => ({ name, range, color, n: commitDates.filter((d) => test(hourOf(d))).length }));
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const perDay = DAYS.map((d) => commitDates.filter((c) => dayOf(c) === d).length);
const totalCommits = commitDates.length || 1;
const top = [...buckets].sort((a, b) => b.n - a.n)[0];
const persona = { Morning: "an Early Bird", Daytime: "a Daylight Builder", Evening: "an Evening Hacker", Night: "a Night Owl" }[top.name];
const bestDay = DAYS[perDay.indexOf(Math.max(...perDay))];

// Tiny drawn icons: sun, half-sun, moon, crescent+star.
const ICONS = {
  Morning: (c) => `<circle r="6" fill="${c}"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path d="M0 -9 V-12" stroke="${c}" stroke-width="2" stroke-linecap="round" transform="rotate(${a})"/>`).join("")}`,
  Daytime: (c) => `<circle r="8" fill="${c}"/>`,
  Evening: (c) => `<path d="M-9 3 A9 9 0 0 1 9 3 Z" fill="${c}"/><path d="M-12 6 H12" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  Night: (c) => `<path d="M3 -9 A9 9 0 1 0 9 4 A7 7 0 0 1 3 -9 Z" fill="${c}"/>`,
};

function rhythm() {
  const W = 900, H = 300;
  const rowsEl = buckets
    .map((b, i) => {
      const pct = (b.n / totalCommits) * 100;
      const y = 92 + i * 44;
      return `<g transform="translate(40,${y})">
        <g transform="translate(10,-5)" class="ic" style="animation-delay:${i * 0.4}s">${ICONS[b.name](b.color)}</g>
        <text x="34" y="0" class="b">${b.name}</text><text x="34" y="16" class="s">${b.range}</text>
        <rect x="150" y="-12" width="380" height="16" rx="8" fill="#161b22"/>
        <rect x="150" y="-12" width="${Math.max(4, (pct / 100) * 380).toFixed(1)}" height="16" rx="8" fill="${b.color}" class="grow" style="animation-delay:${0.3 + i * 0.15}s"/>
        <text x="548" y="1" class="v">${pct.toFixed(1)}%</text><text x="548" y="16" class="s">${plural(b.n, "commit")}</text>
      </g>`;
    })
    .join("");
  const maxDay = Math.max(1, ...perDay);
  const dayEls = perDay
    .map((n, i) => {
      const h = (n / maxDay) * 120;
      const hot = DAYS[i] === bestDay;
      return `<g transform="translate(${i * 27},0)">
        <rect x="0" y="${-h}" width="20" height="${Math.max(2, h)}" rx="5" fill="${hot ? "#39d353" : "#26a641"}" fill-opacity="${hot ? 1 : 0.45}" class="rise" style="animation-delay:${0.5 + i * 0.08}s"/>
        <text x="10" y="18" class="s" text-anchor="middle">${DAYS[i][0]}</text>
      </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="I'm ${persona}">
  <style>
    text { font-family: ${SANS}; fill: #e6edf3; }
    .h { font-size: 24px; font-weight: 800; }
    .hl { fill: ${top.color}; }
    .sub { font: 12px ${MONO}; fill: #768390; letter-spacing: 1.5px; }
    .b { font-size: 15px; font-weight: 700; }
    .s { font-size: 11.5px; fill: #768390; }
    .v { font-size: 15px; font-weight: 700; font-family: ${MONO}; }
    .grow { transform-box: fill-box; transform-origin: left; animation: grow 1.3s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes grow { from { transform: scaleX(0); } }
    .rise { transform-box: fill-box; transform-origin: bottom; animation: rise 1s cubic-bezier(.2,.8,.2,1) both; }
    @keyframes rise { from { transform: scaleY(0); } }
    .ic { animation: ic 3.2s ease-in-out infinite; }
    @keyframes ic { 0%, 70%, 100% { transform: translate(10px,-5px) scale(1); } 35% { transform: translate(10px,-5px) scale(1.25); } }
  </style>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="16" fill="#0d1117" stroke="#30363d"/>
  <text x="40" y="48" class="h">I'm <tspan class="hl">${persona}</tspan></text>
  <text x="40" y="68" class="sub">WHEN I COMMIT · ${plural(commitDates.length, "COMMIT").toUpperCase()} · ${config.timezone.toUpperCase()}</text>
  ${rowsEl}
  <path d="M660 40 V${H - 40}" stroke="#21262d"/>
  <text x="690" y="52" class="b">Busiest day</text>
  <text x="690" y="72" class="s">${commitDates.length ? `${bestDay} — ${plural(Math.max(...perDay), "commit")}` : "no commits yet"}</text>
  <g transform="translate(690,238)">${dayEls}</g>
</svg>`;
}
write("rhythm.svg", rhythm());

/* --------------------------------------------------------------- helix */
// jh3y-style: two strands of dots twisting in 3D, colours follow the viewer's light/dark setting.
{
  const W = 900, H = 90, N = 56, P = 5;
  const dots = [0, 1]
    .flatMap((strand) =>
      Array.from({ length: N }, (_, i) => {
        const x = 24 + (i * (W - 48)) / (N - 1);
        const delay = -((i / N) * P * 2 + strand * P / 2);
        return `<circle cx="${x.toFixed(1)}" cy="${H / 2}" r="4" class="d s${strand}" style="animation-delay:${delay.toFixed(2)}s"/>`;
      }),
    )
    .join("");
  write("helix.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="twisting helix">
  <style>
    .s0 { fill: #1a7f37; } .s1 { fill: #8250df; }
    @media (prefers-color-scheme: dark) { .s0 { fill: #39d353; } .s1 { fill: #a371f7; } }
    .d { transform-box: fill-box; transform-origin: center; }
    @media (prefers-reduced-motion: no-preference) { .d { animation: twist ${P}s linear infinite; } }
    @keyframes twist {
      0%   { transform: translateY(0) scale(1.5); opacity: 1; animation-timing-function: ease-out; }
      25%  { transform: translateY(26px) scale(1); opacity: .6; animation-timing-function: ease-in; }
      50%  { transform: translateY(0) scale(.45); opacity: .2; animation-timing-function: ease-out; }
      75%  { transform: translateY(-26px) scale(1); opacity: .6; animation-timing-function: ease-in; }
      100% { transform: translateY(0) scale(1.5); opacity: 1; }
    }
  </style>
  ${dots}
</svg>`);
}

/* ------------------------------------------------ README launch section */
{
  const readmeUrl = new URL("../README.md", import.meta.url);
  const readme = readFileSync(readmeUrl, "utf8");
  const block = launches
    .map((r) => `<a href="${r.url}"><img src="./generated/launch-${r.name}.svg" width="100%" alt="${r.name} — launch card"/></a>`)
    .join("\n");
  writeFileSync(readmeUrl, readme.replace(/(<!-- LAUNCHES:START -->)[\s\S]*?(<!-- LAUNCHES:END -->)/, `$1\n${block}\n$2`));
}

console.log(`built: neofetch, ${launches.length} launch cards, rhythm (${commitDates.length} commits), LOC +${loc.add}/-${loc.del}`);
