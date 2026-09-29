// Builds every SVG in generated/ from live GitHub data, in the Edusphere design language
// with a royal palette. Runs daily in .github/workflows/build.yml.
// Locally: GITHUB_TOKEN=$(gh auth token) node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const config = JSON.parse(readFileSync(new URL("profile.config.json", root)));
const portrait = JSON.parse(readFileSync(new URL("assets/portrait.json", root)));
const icons = JSON.parse(readFileSync(new URL("assets/icons/icons.json", root)));
const OUT = new URL("generated/", root);
mkdirSync(OUT, { recursive: true });
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN is required");
const USER = config.user;

/* ---------------------------------------------------------------- design */

// Edusphere tokens, re-cut in royal jewel tones.
const C = {
  ink: "#150e26", ink2: "#1f1537", royal: "#3a1f73", amethyst: "#6b44c9",
  lilac: "#c6b4ff", lilacLt: "#e1d7ff", lilacDk: "#9d85ff",
  gold: "#e9b949", goldLt: "#ffe08f", goldDk: "#a87a12",
  cream: "#fff8ec", paper: "#f4ecdd",
  crimson: "#c0304f", rose: "#ff8da0", sapphire: "#2f4fd8", emerald: "#1f7a57", mint: "#a8f0d4",
};
const EASE_OUT = "cubic-bezier(.16,1,.3,1)";
const EASE_POP = "cubic-bezier(.34,1.56,.64,1)";

const FONT_FILES = {
  display: ["Bricolage", 800, "bricolage-800"], displaySemi: ["Bricolage", 600, "bricolage-600"],
  hand: ["Caveat", 700, "caveat-700"], body: ["DM Sans", 400, "dmsans-400"], bodyBold: ["DM Sans", 700, "dmsans-700"],
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
  display: "'Bricolage', 'Arial Black', sans-serif",
  hand: "'Caveat', 'Segoe Print', cursive",
  body: "'DM Sans', 'Segoe UI', sans-serif",
  mono: "'DM Mono', Consolas, monospace",
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const write = (name, svg) => writeFileSync(new URL(name, OUT), svg.replace(/\n\s+/g, "\n"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svgOpen = (W, H, label) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">`;

// A butterfly facing +x, centred on 0,0; wings fold on the y axis. Colours from the portrait.
function butterfly(wing, wing2, dur = 0.32) {
  const half = `<path d="M1 0 C0 -9 9 -20 17 -15 C22 -11 15 -3 1 0Z" fill="${wing}"/><path d="M1 0 C-9 -3 -15 -13 -7 -15 C-2 -16 1 -7 1 0Z" fill="${wing2}"/><circle cx="12" cy="-12" r="2" fill="${C.cream}" opacity=".85"/>`;
  return `<g><g style="animation:flap ${dur}s ease-in-out infinite alternate">${half}<g transform="scale(1,-1)">${half}</g></g>
    <path d="M-7 0 H9" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><path d="M9 0 l6 -4 M9 0 l6 4" stroke="${C.ink}" stroke-width="1" fill="none"/></g>`;
}
const FLAP = `@keyframes flap{from{transform:scaleY(1)}to{transform:scaleY(.18)}}`;
const flight = (path, dur, begin, b) =>
  `<g><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" rotate="auto" path="${path}"/>${b}</g>`;

// Four-point sparkle.
const sparkle = (x, y, s, col, delay) =>
  `<g transform="translate(${x},${y}) scale(${s})"><path d="M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10Z" fill="${col}" class="tw" style="animation-delay:${delay}s"/></g>`;
const TWINKLE = `.tw{transform-box:fill-box;transform-origin:center;animation:tw 2.8s ease-in-out infinite}@keyframes tw{0%,100%{transform:scale(.2) rotate(0);opacity:.2}50%{transform:scale(1) rotate(90deg);opacity:1}}`;

// Drawn crown, centred on 0,0.
const crown = (s = 1) => `<g transform="scale(${s})">
  <path d="M-26 12 L-30 -14 L-14 -1 L0 -22 L14 -1 L30 -14 L26 12 Z" fill="${C.gold}" stroke="${C.goldDk}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="-27" y="12" width="54" height="8" rx="3" fill="${C.goldDk}"/>
  <circle cx="0" cy="3" r="4.5" fill="${C.crimson}"/><circle cx="-15" cy="6" r="3" fill="${C.sapphire}"/><circle cx="15" cy="6" r="3" fill="${C.emerald}"/>
  <circle cx="-30" cy="-14" r="3" fill="${C.goldLt}"/><circle cx="0" cy="-22" r="3" fill="${C.goldLt}"/><circle cx="30" cy="-14" r="3" fill="${C.goldLt}"/></g>`;

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
      contributionsCollection { contributionYears contributionCalendar { totalContributions } }
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
    .map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { contributionCalendar { totalContributions } }`)
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
const launches = repos.filter((r) => !config.launches.hide.includes(r.name) && !r.isArchived);

/* ---------------------------------------------------------------- header */
{
  const W = 900, H = 380;
  const phrases = config.header.phrases;
  const P = 3.6;
  const lead = phrases
    .map((p, i) => `<text x="0" y="0" class="lead" style="animation-delay:${(1.4 + i * P).toFixed(1)}s">${esc(p)}</text>`)
    .join("");
  const seal = "HEBI ✦ ERNAKULAM ✦ KERALA ✦ INDIA ✦ ";
  write("header.svg", `${svgOpen(W, H, "Devapriyan G S")}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset=".6" stop-color="#241446"/><stop offset="1" stop-color="${C.royal}"/></linearGradient>
    <radialGradient id="sun"><stop offset="0" stop-color="${C.goldLt}" stop-opacity=".9"/><stop offset=".35" stop-color="${C.gold}" stop-opacity=".35"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient>
    <linearGradient id="foil" x1="0" x2="1"><stop offset="0" stop-color="${C.goldDk}"/><stop offset=".45" stop-color="${C.goldLt}"/><stop offset=".55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDk}"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0" dur="4s" repeatCount="indefinite"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="28"/></clipPath>
    <clipPath id="line1"><rect x="0" y="-80" width="700" height="100"/></clipPath>
    <path id="ring" d="M0 -78 a78 78 0 1 1 -0.1 0"/>
  </defs>
  <style>
    ${fonts("display", "hand", "body", "bodyBold")}
    .name{font:800 76px ${F.display};fill:${C.cream};letter-spacing:-1.5px}
    .dot{fill:${C.gold}}
    .hand{font:700 30px ${F.hand};fill:${C.gold}}
    .lead{font:400 19px ${F.body};fill:${C.lilacLt};opacity:0;animation:cycle ${P * phrases.length}s ${EASE_OUT} infinite}
    @keyframes cycle{0%{opacity:0;transform:translateY(14px)}5%,28%{opacity:1;transform:none}33%,100%{opacity:0;transform:translateY(-10px)}}
    .btn{font:700 15px ${F.body};fill:${C.ink}}
    .seal{font:600 12.5px ${F.body};letter-spacing:3.2px;fill:${C.gold}}
    .rise{animation:rise 1.3s ${EASE_OUT} both}
    @keyframes rise{from{transform:translateY(100px)}}
    .fade{opacity:0;animation:fade .9s ${EASE_OUT} forwards}
    @keyframes fade{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    .scrib{stroke-dasharray:260;stroke-dashoffset:260;animation:draw 1.1s ${EASE_OUT} 1.1s forwards}
    @keyframes draw{to{stroke-dashoffset:0}}
    .pop{animation:pop .9s ${EASE_POP} both 1.6s}
    @keyframes pop{from{transform:scale(0) rotate(-20deg)}}
    .bob{animation:bob 3s ease-in-out infinite}
    @keyframes bob{50%{transform:translateY(-4px)}}
    .spin{animation:spin 26s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .crown{animation:crown 3.4s ease-in-out infinite}
    @keyframes crown{0%,100%{transform:rotate(-6deg) translateY(0)}50%{transform:rotate(4deg) translateY(-5px)}}
    .blob1{animation:drift 14s ease-in-out infinite alternate}
    .blob2{animation:drift 18s ease-in-out infinite alternate-reverse}
    @keyframes drift{to{transform:translate(-40px,14px) scale(1.04)}}
    .sun{animation:sun 5s ease-in-out infinite}
    @keyframes sun{50%{opacity:.7}}
    ${TWINKLE} ${FLAP}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <circle cx="70" cy="40" r="170" fill="url(#sun)" class="sun"/>
    <path class="blob1" fill="${C.amethyst}" opacity=".35" d="M-60 300C80 190 210 330 360 260s220-200 400-150 260 150 260 150V460H-60z"/>
    <path class="blob2" fill="${C.sapphire}" opacity=".22" d="M380 460c30-120 160-190 300-170s260-50 260-50v220z"/>
    <path class="blob1" fill="${C.lilacDk}" opacity=".18" d="M-40 420c150-80 240 20 420-40s250-150 430-100 170 90 170 90v150H-40z"/>
    ${sparkle(470, 70, 0.9, C.goldLt, 0)}${sparkle(610, 320, 0.6, C.gold, 0.9)}${sparkle(840, 60, 0.7, C.goldLt, 1.6)}${sparkle(40, 250, 0.5, C.lilac, 2.1)}${sparkle(560, 30, 0.45, C.lilac, 1.2)}

    <g transform="translate(56,86) rotate(-4)"><text class="hand fade" style="animation-delay:.2s">hey there, I'm</text></g>
    <g transform="translate(56,178)" clip-path="url(#line1)"><text class="name rise" style="animation-delay:.35s">Devapriyan G S<tspan class="dot">.</tspan></text></g>
    <g transform="translate(58,196)"><path d="M0 8c90-14 190-16 290-4s130 6 190-8" fill="none" stroke="${C.crimson}" stroke-width="5" stroke-linecap="round" class="scrib"/></g>
    <g transform="translate(58,244)">${lead}</g>

    <g transform="translate(56,280)"><g class="fade" style="animation-delay:1.3s"><g class="bob">
      <rect width="246" height="52" rx="26" fill="${C.cream}"/>
      <text x="26" y="31" class="btn">Explore my launches</text>
      <circle cx="220" cy="26" r="18" fill="${C.gold}"/>
      <path d="M212 26h15M222 20.5 227.5 26 222 31.5" stroke="${C.ink}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </g></g></g>

    <g transform="translate(730,190)"><g class="pop">
      <circle r="104" fill="${C.ink}" opacity=".45"/>
      <circle r="96" fill="none" stroke="${C.gold}" stroke-width="1.5" stroke-dasharray="2 6" opacity=".7"/>
      <g class="spin"><text class="seal"><textPath href="#ring" textLength="486" lengthAdjust="spacing">${seal}</textPath></text></g>
      <circle r="60" fill="${C.royal}" stroke="url(#foil)" stroke-width="3"/>
      <g class="crown">${crown(1.25)}</g>
    </g></g>

    ${flight("M-40 120 C 200 20, 380 200, 600 90 S 980 40, 940 220 S 500 400, 200 330 S -120 220, -40 120", 22, 0, `<g transform="scale(1.1)">${butterfly("#4f8dff", "#2f4fd8")}</g>`)}
    ${flight("M960 300 C 780 360, 640 250, 520 330 S 250 380, 120 200 S 300 -20, 560 60 S 1000 140, 960 300", 26, -9, `<g transform="scale(.9)">${butterfly(C.gold, "#d9a520", 0.28)}</g>`)}
    ${flight("M500 -30 C 420 80, 700 150, 820 110 S 900 -40, 700 -20 S 560 -60, 500 -30", 15, -4, `<g transform="scale(.75)">${butterfly(C.rose, C.crimson, 0.26)}</g>`)}
    ${flight("M100 400 C 250 330, 330 380, 420 300 S 380 200, 300 240 S 20 440, 100 400", 19, -12, `<g transform="scale(.7)">${butterfly("#a78bfa", C.amethyst, 0.3)}</g>`)}
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="27" fill="none" stroke="${C.gold}" stroke-opacity=".35" stroke-width="2"/>
</svg>`);
}

/* ------------------------------------------------------ section titles */
// Edusphere-style heading: chunky display title, a handwritten aside and a drawn scribble.
function title(file, heading, note, accent) {
  const W = 900, H = 130;
  write(file, `${svgOpen(W, H, heading)}
  <style>
    ${fonts("display", "hand")}
    .h{font:800 50px ${F.display};letter-spacing:-1px;fill:${C.ink};text-anchor:middle}
    .n{font:700 25px ${F.hand};fill:${C.crimson};text-anchor:middle}
    @media (prefers-color-scheme: dark){.h{fill:${C.cream}}.n{fill:${C.gold}}}
    .up{opacity:0;animation:up 1s ${EASE_OUT} forwards}
    @keyframes up{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
    .scrib{stroke-dasharray:300;stroke-dashoffset:300;animation:draw 1.2s ${EASE_OUT} .7s forwards}
    @keyframes draw{to{stroke-dashoffset:0}}
    ${TWINKLE}
  </style>
  <text x="450" y="64" class="h up">${esc(heading)}</text>
  <g transform="translate(450,104) rotate(-2)"><text class="n up" style="animation-delay:.35s">${esc(note)}</text></g>
  <path d="M330 116c50-10 100-12 150-4s70 4 100-6" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" class="scrib"/>
  ${sparkle(190, 44, 0.8, C.gold, 0)}${sparkle(716, 30, 0.6, C.lilacDk, 1)}
</svg>`);
}
title("title-launches.svg", "Fresh launches", "every repo ships with a launch card, refreshed daily", C.gold);
title("title-toolbox.svg", "The royal toolbox", "thirty-five tools, one very curious mind", C.crimson);
title("title-activity.svg", "Activity, live", "hebi means snake, and this one eats my graph", C.amethyst);

/* ------------------------------------------------------------- neofetch */
function neofetch(theme) {
  const dark = theme === "dark";
  const t = dark
    ? { bg: C.ink, bg2: "#1d1238", border: C.gold, text: C.lilacLt, key: C.gold, value: C.lilacLt, dots: "#4b3d6b", add: "#5fd39a", del: C.rose, head: C.gold, rule: "#3a2d5c" }
    : { bg: C.cream, bg2: C.paper, border: C.goldDk, text: C.ink, key: C.crimson, value: C.royal, dots: "#d4c4a6", add: C.emerald, del: C.crimson, head: C.royal, rule: "#e3d5bb" };
  const PX = 28, PY = 44;
  const { cols, cw, ch } = portrait;
  const art = portrait.dark // the dark render reads best; light theme frames it as a dark "screen"
    .map((runs, y) => {
      const spans = runs.map(([s, col]) => (col ? `<tspan fill="${col}">${esc(s)}</tspan>` : esc(s))).join("");
      return `<text x="${PX}" y="${PY + y * ch}" textLength="${cols * cw}" lengthAdjust="spacingAndGlyphs" class="px" style="animation-delay:${(y * 0.022).toFixed(3)}s">${spans}</text>`;
    })
    .join("");
  const artH = portrait.rows * ch;

  const WIDTH = 52;
  const topLangs = (() => {
    const bytes = {};
    for (const r of repos) for (const e of r.languages.edges) bytes[e.node.name] = (bytes[e.node.name] ?? 0) + e.size;
    return Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n).join(", ") || "—";
  })();
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
    kv("Message", (last?.defaultBranchRef?.target.messageHeadline ?? "—").slice(0, 30)),
    kv("When", last ? ago(last.pushedAt) : "—"),
    blank,
    rule("GitHub Stats"),
    kv("Repos", repoLine, [[`${repos.length}`, "v"], [" {", ""], ["Contributed", "k"], [": ", ""], [`${user.repositoriesContributedTo.totalCount}`, "v"], ["}", ""]]),
    kv("Stars", fmt(stars)), kv("Followers", fmt(user.followers.totalCount)),
    kv("Contributions", `${fmt(allTimeContributions)} all-time`),
    kv("Lines of Code", locLine, [[fmt(loc.add - loc.del), "v"], [" ( ", ""], [`+${fmt(loc.add)}`, "a"], [", ", ""], [`-${fmt(loc.del)}`, "x"], [" )", ""]]),
  ];
  const X = 500, LH = 20.5;
  const info = rows
    .map((segs, i) => `<text x="${X}" y="${PY + i * LH}" class="row" style="animation-delay:${(0.5 + i * 0.06).toFixed(2)}s">${segs.map(([s, cls]) => `<tspan${cls ? ` class="${cls}"` : ""}>${esc(s)}</tspan>`).join("")}</text>`)
    .join("");
  const endY = PY + rows.length * LH;
  const jewels = [C.crimson, C.rose, C.gold, C.goldLt, C.emerald, C.sapphire, C.amethyst, C.lilac]
    .map((col, i) => `<g transform="translate(${X + 4 + i * 30},${endY + 2})"><rect width="24" height="14" rx="4" fill="${col}" class="gem" style="animation-delay:${(i * 0.12).toFixed(2)}s"/></g>`)
    .join("");
  const W = 1000, H = Math.max(endY + 46, PY + artH + 24);

  return `${svgOpen(W, H, `${USER} — neofetch with live GitHub stats`)}
  <defs>
    <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.goldLt}" stop-opacity="${dark ? 0.28 : 0.4}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient>
    <clipPath id="artClip"><rect x="${PX - 8}" y="${PY - 14}" width="${cols * cw + 16}" height="${artH + 12}" rx="14"/></clipPath>
  </defs>
  <style>
    ${fonts("mono", "monoBold", "hand")}
    text,tspan{white-space:pre}
    .row,.row tspan{font:400 14px ${F.mono};fill:${t.text}}
    .k{fill:${t.key}!important} .v{fill:${t.value}!important} .d{fill:${t.dots}!important} .r{fill:${t.rule}!important}
    .a{fill:${t.add}!important} .x{fill:${t.del}!important} .h{fill:${t.head}!important;font-weight:500!important}
    .px{font:500 ${(cw / 0.6).toFixed(2)}px ${F.mono};fill:${C.lilacLt};opacity:0;animation:print .5s ${EASE_OUT} forwards}
    @keyframes print{from{opacity:0;transform:translateX(-10px)}to{opacity:1;transform:none}}
    .row{opacity:0;animation:slide .6s ${EASE_OUT} forwards}
    @keyframes slide{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}
    .scan{animation:scan 5s ${EASE_OUT} 1.4s infinite}
    @keyframes scan{from{transform:translateY(-60px)}to{transform:translateY(${artH + 60}px)}}
    .gem{transform-box:fill-box;transform-origin:center bottom;animation:gem 2.6s ${EASE_POP} infinite}
    @keyframes gem{0%,60%,100%{transform:none}30%{transform:translateY(-5px) scaleY(1.1)}}
    .cur{fill:${t.head};animation:blink 1s steps(1) infinite}
    @keyframes blink{50%{opacity:0}}
    .stamp{font:700 17px ${F.hand};fill:${t.dots}}
    ${FLAP}
  </style>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="28" fill="${t.bg}" stroke="${t.border}" stroke-opacity=".5" stroke-width="2"/>
  <rect x="${PX - 8}" y="${PY - 14}" width="${cols * cw + 16}" height="${artH + 12}" rx="14" fill="${C.ink}"/>
  <g clip-path="url(#artClip)">
    ${art}
    <rect class="scan" x="${PX - 8}" y="${PY - 40}" width="${cols * cw + 16}" height="46" fill="url(#scan)"/>
  </g>
  <rect x="${PX - 8}" y="${PY - 14}" width="${cols * cw + 16}" height="${artH + 12}" rx="14" fill="none" stroke="${t.border}" stroke-opacity=".35"/>
  ${flight(`M${PX + 440} ${PY + 30} C ${PX + 480} ${PY - 20}, ${PX + 380} ${PY - 40}, ${PX + 340} ${PY - 6} S ${PX + 420} ${PY + 80}, ${PX + 440} ${PY + 30}`, 9, 0, `<g transform="scale(.6)">${butterfly("#4f8dff", C.sapphire, 0.25)}</g>`)}
  ${flight(`M${PX - 10} ${PY + artH - 30} C ${PX + 40} ${PY + artH + 20}, ${PX + 120} ${PY + artH - 10}, ${PX + 60} ${PY + artH - 60} S ${PX - 40} ${PY + artH - 80}, ${PX - 10} ${PY + artH - 30}`, 11, -3, `<g transform="scale(.5)">${butterfly(C.gold, "#d9a520", 0.28)}</g>`)}
  ${info}
  ${jewels}
  <rect x="${X + 8 * 30 + 8}" y="${endY + 1}" width="9" height="16" rx="1" class="cur"/>
  <text x="${W - 30}" y="${H - 16}" class="stamp" text-anchor="end">live · refreshed ${today}</text>
</svg>`;
}
write("neofetch-dark.svg", neofetch("dark"));
write("neofetch-light.svg", neofetch("light"));

/* ------------------------------------------------------- launch cards */
const CRESTS = [[C.royal, C.amethyst], [C.sapphire, "#5b7cff"], [C.crimson, "#e0587a"], [C.emerald, "#35a57a"]];
const PILLS = [C.lilac, C.mint, C.goldLt, C.rose, C.lilacLt];

function launchCard(r, i) {
  const o = config.launches.overrides[r.name] ?? {};
  const [c1, c2] = CRESTS[i % CRESTS.length];
  const W = 900, H = 320;
  const tagline = wrap(o.tagline ?? r.description ?? "Something new is shipping.", 58).slice(0, 2);
  const tags = [...(o.tags ?? []), ...r.repositoryTopics.nodes.map((t) => t.topic.name)].slice(0, 4);
  const commits = r.defaultBranchRef?.target.history.totalCount ?? 0;
  const monogram = (r.name.match(/[A-Z]|(?<=^|[-_ ])[a-z]/g) ?? [r.name[0]]).slice(0, 2).join("").toUpperCase();
  const launched = new Date(r.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  const all = r.languages.edges.reduce((n, e) => n + e.size, 0) || 1;
  const langs = r.languages.edges.filter((e) => e.size / all >= 0.01);
  const total = langs.reduce((n, e) => n + e.size, 0) || 1;

  let x = 0;
  const bar = langs.map((e, k) => {
    const w = (e.size / total) * 260;
    const seg = `<rect x="${x.toFixed(1)}" width="${Math.max(0, w - 3).toFixed(1)}" height="10" rx="5" fill="${e.node.color ?? C.lilacDk}" class="grow" style="animation-delay:${(0.9 + k * 0.12).toFixed(2)}s"/>`;
    x += w;
    return seg;
  }).join("");
  let lx = 0;
  const legend = langs.slice(0, 3).map((e) => {
    const label = `${e.node.name} ${((e.size / total) * 100).toFixed(0)}%`;
    const el = `<circle cx="${lx + 5}" cy="28" r="4.5" fill="${e.node.color ?? C.lilacDk}"/><text x="${lx + 15}" y="32.5" class="s">${esc(label)}</text>`;
    lx += label.length * 6.6 + 30;
    return el;
  }).join("");

  let tx = 0;
  const tagEls = tags.map((tag, k) => {
    const w = tag.length * 7.6 + 30;
    const el = `<g transform="translate(${tx + w / 2},13)"><g class="pop" style="animation-delay:${(0.7 + k * 0.08).toFixed(2)}s"><rect x="${-w / 2}" y="-13" width="${w}" height="26" rx="13" fill="${PILLS[(k + i) % PILLS.length]}" stroke="${C.ink}" stroke-width="1.5"/><text y="4.5" class="tag" text-anchor="middle">${esc(tag)}</text></g></g>`;
    tx += w + 8;
    return el;
  }).join("");

  const stats = [["★", fmt(r.stargazerCount), "stars"], ["⑂", fmt(r.forkCount), "forks"], ["◆", fmt(commits), "commits"], ["↑", ago(r.pushedAt).replace(" ago", ""), "since last ship"]];
  let sx = 0;
  const statEls = stats.map(([icon, v, label], k) => {
    const text = `${v} ${label}`;
    const w = text.length * 7.3 + 44;
    const el = `<g transform="translate(${sx},0)"><g class="up" style="animation-delay:${(0.8 + k * 0.07).toFixed(2)}s"><rect width="${w}" height="32" rx="16" fill="${C.cream}" stroke="${C.ink}" stroke-opacity=".18"/><circle cx="16" cy="16" r="10" fill="${C.ink}"/><text x="16" y="20" class="si" text-anchor="middle">${icon}</text><text x="32" y="21" class="sv"><tspan class="svb">${esc(v)}</tspan> ${label}</text></g></g>`;
    sx += w + 8;
    return el;
  }).join("");

  const scallop = Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2, a2 = ((k + 0.5) / 24) * Math.PI * 2;
    return `${k ? "L" : "M"}${(Math.cos(a) * 50).toFixed(1)} ${(Math.sin(a) * 50).toFixed(1)} L${(Math.cos(a2) * 44).toFixed(1)} ${(Math.sin(a2) * 44).toFixed(1)}`;
  }).join(" ") + "Z";

  return `${svgOpen(W, H, `${r.name} — launch card`)}
  <defs>
    <linearGradient id="crest" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="foil" x1="0" x2="1"><stop offset="0" stop-color="${C.goldDk}"/><stop offset=".45" stop-color="${C.goldLt}"/><stop offset=".55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldDk}"/>
      <animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0" dur="3.5s" repeatCount="indefinite"/></linearGradient>
    <clipPath id="card"><rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="28"/></clipPath>
    <clipPath id="crestClip"><rect width="112" height="112" rx="26"/></clipPath>
  </defs>
  <style>
    ${fonts("display", "hand", "body", "bodyBold")}
    text{font-family:${F.body};fill:${C.ink}}
    .name{font:800 46px ${F.display};letter-spacing:-1px}
    .tl{font-size:17px;fill:#4a3f5c}
    .hand{font:700 26px ${F.hand};fill:${C.crimson}}
    .tag{font:700 12.5px ${F.body}}
    .s{font-size:12.5px;fill:#6b5f80}
    .sv{font-size:13px;fill:#4a3f5c} .svb{font-weight:700;fill:${C.ink}}
    .si{font-size:11px;font-weight:700;fill:${C.gold}}
    .mono{font:800 46px ${F.display};fill:url(#foil)}
    .seal{font:800 26px ${F.display};fill:${C.cream}}
    .sealL{font:700 10px ${F.body};letter-spacing:2px;fill:${C.goldLt}}
    .live{font:800 13px ${F.display};letter-spacing:1.5px;fill:${C.ink}}
    .btn{font:700 14px ${F.body};fill:${C.cream}}
    .up{opacity:0;animation:up .8s ${EASE_OUT} forwards}
    @keyframes up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
    .pop{animation:pop .8s ${EASE_POP} both}
    @keyframes pop{from{transform:scale(0) rotate(-12deg)}}
    .tilt{animation:tilt 5s ease-in-out infinite}
    @keyframes tilt{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(-2deg) translateY(-4px)}}
    .sticker{animation:sticker 2.8s ${EASE_POP} infinite}
    @keyframes sticker{0%,70%,100%{transform:rotate(8deg) scale(1)}80%{transform:rotate(3deg) scale(1.08)}}
    .spin{animation:spin 18s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    .bounce{animation:bounce 1.6s ${EASE_POP} infinite}
    @keyframes bounce{0%,60%,100%{transform:none}30%{transform:translateY(-6px)}}
    .shine{animation:shine 3.6s ${EASE_OUT} infinite}
    @keyframes shine{0%,50%{transform:translateX(-160px) skewX(-20deg)}100%{transform:translateX(200px) skewX(-20deg)}}
    .grow{transform-box:fill-box;transform-origin:left;animation:grow 1.2s ${EASE_OUT} both}
    @keyframes grow{from{transform:scaleX(0)}}
    .scrib{stroke-dasharray:420;stroke-dashoffset:420;animation:draw 1.1s ${EASE_OUT} .6s forwards}
    @keyframes draw{to{stroke-dashoffset:0}}
    .blob{animation:blob 12s ease-in-out infinite alternate}
    @keyframes blob{to{transform:translate(-30px,-16px) scale(1.06)}}
    .pulse{transform-box:fill-box;transform-origin:center;animation:pulse 1.6s ease-out infinite}
    @keyframes pulse{from{transform:scale(1);opacity:.8}to{transform:scale(3);opacity:0}}
    .arrow{animation:nudge 1.4s ${EASE_POP} infinite}
    @keyframes nudge{50%{transform:translateX(3px)}}
    ${TWINKLE}
  </style>

  <rect x="6" y="12" width="${W - 12}" height="${H - 12}" rx="28" fill="${C.ink}"/>
  <g clip-path="url(#card)">
    <rect width="${W}" height="${H}" fill="${C.cream}"/>
    <path class="blob" fill="${PILLS[i % PILLS.length]}" opacity=".55" d="M620 360c20-120 110-190 220-170s110-60 110-60v260z"/>
    <path class="blob" fill="${C.lilacLt}" opacity=".6" d="M-40 300c90-40 160 20 250-10s120-60 190-30v80H-40z" style="animation-duration:15s"/>
    ${sparkle(600, 44, 0.7, C.gold, 0)}${sparkle(770, 250, 0.55, C.amethyst, 1.1)}${sparkle(170, 250, 0.5, C.crimson, 2)}
  </g>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="28" fill="none" stroke="${C.ink}" stroke-width="2.5"/>

  <g transform="translate(40,58) rotate(-4)"><text class="hand up">Launch #${String(i + 1).padStart(2, "0")} · ${esc(launched)}</text></g>

  <g transform="translate(96,142)"><g class="tilt"><g transform="translate(-56,-56)">
    <rect x="5" y="7" width="112" height="112" rx="26" fill="${C.ink}"/>
    <g clip-path="url(#crestClip)"><rect width="112" height="112" fill="url(#crest)"/><rect x="20" y="-30" width="36" height="180" fill="#fff" opacity=".22" class="shine"/></g>
    <rect width="112" height="112" rx="26" fill="none" stroke="${C.ink}" stroke-width="2.5"/>
    <text x="56" y="72" class="mono" text-anchor="middle">${esc(monogram)}</text>
  </g></g></g>

  <g transform="translate(180,108)">
    <text y="0" class="name up" style="animation-delay:.1s">${esc(r.name)}</text>
    <path d="M2 14c70-10 150-12 230-3s90 4 130-6" fill="none" stroke="${C.gold}" stroke-width="5" stroke-linecap="round" class="scrib"/>
    ${tagline.map((l, k) => `<text y="${46 + k * 23}" class="tl up" style="animation-delay:${(0.25 + k * 0.08).toFixed(2)}s">${esc(l)}</text>`).join("")}
    <g transform="translate(0,${tagline.length > 1 ? 86 : 64})">${tagEls}</g>
  </g>

  <g transform="translate(${W - 104},118)"><g class="pop" style="animation-delay:.5s">
    <g class="spin"><path d="${scallop}" fill="url(#crest)" stroke="${C.ink}" stroke-width="2"/></g>
    <circle r="36" fill="none" stroke="${C.goldLt}" stroke-width="1.5" stroke-dasharray="3 4"/>
    <g class="bounce"><path d="M0 -26 l10 11 h-20z" fill="${C.goldLt}"/></g>
    <text y="10" class="seal" text-anchor="middle">${fmt(r.stargazerCount)}</text>
    <text y="26" class="sealL" text-anchor="middle">UPVOTE</text>
  </g></g>

  <g transform="translate(${W - 200},40)"><g class="sticker">
    <rect x="-8" y="-17" width="104" height="32" rx="10" fill="${C.gold}" stroke="${C.ink}" stroke-width="2"/>
    <circle cx="8" cy="-1" r="5" fill="${C.crimson}" class="pulse"/><circle cx="8" cy="-1" r="5" fill="${C.crimson}"/>
    <text x="20" y="4" class="live">NOW LIVE</text>
  </g></g>

  <path d="M40 ${H - 74} H${W - 40}" stroke="${C.ink}" stroke-opacity=".12" stroke-dasharray="4 6"/>
  <g transform="translate(40,${H - 58})">${statEls}</g>
  <g transform="translate(${W - 300},${H - 128})">${bar}${legend}</g>
</svg>`;
}
launches.forEach((r, i) => write(`launch-${r.name}.svg`, launchCard(r, i)));

/* --------------------------------------------------------------- toolbox */
{
  const W = 900, LABEL = 170, X0 = 196, XMAX = W - 36, ROW = 46;
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
        <rect width="${w}" height="36" rx="18" fill="${C.ink2}" stroke="${C.gold}" stroke-opacity=".28"/>
        <rect width="${w}" height="36" rx="18" fill="none" stroke="${C.goldLt}" stroke-width="1.6" class="glint" style="animation-delay:${wave}s"/>
        <circle cx="18" cy="18" r="14" fill="${C.royal}"/>
        ${path ? `<g transform="translate(9.6,9.6) scale(.7)"><path d="${path}" fill="${C.gold}"/></g>` : `<text x="18" y="22.5" class="ab" text-anchor="middle">${esc(name[0])}</text>`}
        <text x="40" y="23" class="lb">${esc(name)}</text>
      </g></g>`;
      x += w + 9;
      k++;
    }
    body += `<g transform="translate(40,${rowsStart + 24}) rotate(-3)"><text class="grp up" style="animation-delay:${(0.1 + k * 0.02).toFixed(2)}s">${esc(group)}</text></g>${chips}`;
    y += ROW + 16;
  }
  const H = y + 14;
  write("toolbox.svg", `${svgOpen(W, H, "Toolbox: " + icons.groups.flatMap((g) => g[1]).join(", "))}
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset="1" stop-color="#26154a"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="28"/></clipPath>
  </defs>
  <style>
    ${fonts("hand", "bodyBold")}
    .lb{font:700 13.5px ${F.body};fill:${C.cream}}
    .ab{font:700 14px ${F.body};fill:${C.gold}}
    .grp{font:700 27px ${F.hand};fill:${C.gold}}
    .chip{animation:chip .7s ${EASE_POP} both}
    @keyframes chip{from{transform:translateY(22px) scale(.6);opacity:0}}
    .glint{opacity:0;animation:glint 6s ease-in-out infinite}
    @keyframes glint{0%,100%{opacity:0}8%{opacity:1}20%{opacity:0}}
    .up{opacity:0;animation:up .8s ${EASE_OUT} forwards}
    @keyframes up{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
    .blob{animation:blob 16s ease-in-out infinite alternate}
    @keyframes blob{to{transform:translate(-40px,20px) scale(1.05)}}
    ${TWINKLE}
  </style>
  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <path class="blob" fill="${C.amethyst}" opacity=".22" d="M560 -40c60 120 200 150 300 110s120 0 120 0V-40z"/>
    <path class="blob" fill="${C.sapphire}" opacity=".16" d="M-40 ${H - 60}c140-60 220 40 360 0s180-40 260 20v80H-40z" style="animation-duration:20s"/>
    ${sparkle(W - 50, 30, 0.6, C.goldLt, 0.4)}${sparkle(24, H - 26, 0.5, C.lilac, 1.4)}
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="27" fill="none" stroke="${C.gold}" stroke-opacity=".35" stroke-width="2"/>
  ${body}
</svg>`);
}

/* --------------------------------------------------------------- divider */
write("divider.svg", `${svgOpen(900, 64, "")}
  <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${C.gold}" stop-opacity="0"/><stop offset=".5" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></linearGradient></defs>
  <style>
    .l{stroke-dasharray:420;stroke-dashoffset:420;animation:draw 1.6s ${EASE_OUT} forwards}
    @keyframes draw{to{stroke-dashoffset:0}}
    .gem{animation:gem 6s ease-in-out infinite}
    @keyframes gem{50%{transform:rotate(180deg)}}
    ${TWINKLE} ${FLAP}
  </style>
  <path d="M430 32 C 330 32, 250 24, 30 32" fill="none" stroke="url(#g)" stroke-width="2" class="l"/>
  <path d="M470 32 C 570 32, 650 40, 870 32" fill="none" stroke="url(#g)" stroke-width="2" class="l"/>
  <path d="M400 32 c10 -10 20 -10 26 0 M500 32 c-10 10 -20 10 -26 0" fill="none" stroke="${C.gold}" stroke-width="2" stroke-linecap="round"/>
  <g transform="translate(450,32)"><g class="gem"><path d="M0 -13 L13 0 L0 13 L-13 0Z" fill="${C.amethyst}" stroke="${C.gold}" stroke-width="2"/><circle r="3" fill="${C.goldLt}"/></g></g>
  ${sparkle(320, 22, 0.4, C.gold, 0.5)}${sparkle(590, 44, 0.4, C.lilacDk, 1.5)}
  ${flight("M-30 40 C 200 0, 350 60, 450 20 S 750 60, 930 20", 14, 0, `<g transform="scale(.6)">${butterfly(C.gold, "#d9a520", 0.26)}</g>`)}
</svg>`);

/* ---------------------------------------------------------------- footer */
{
  const W = 900, H = 200;
  const wave = (amp, off, y) => {
    let d = `M 0 ${H}`;
    for (let x = 0; x <= W * 2; x += 15) d += ` L ${x} ${(y + Math.sin((x / W) * Math.PI * 4 + off) * amp).toFixed(1)}`;
    return d + ` L ${W * 2} ${H} Z`;
  };
  write("footer.svg", `${svgOpen(W, H, "thanks for stopping by")}
  <defs><clipPath id="f"><rect width="${W}" height="${H}" rx="28"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.ink}"/><stop offset="1" stop-color="#241446"/></linearGradient></defs>
  <style>
    ${fonts("hand", "display")}
    .w1{animation:drift 11s linear infinite}.w2{animation:drift 7s linear infinite reverse}.w3{animation:drift 15s linear infinite}
    @keyframes drift{from{transform:translateX(0)}to{transform:translateX(-${W / 2}px)}}
    .t{font:700 36px ${F.hand};fill:${C.gold};text-anchor:middle}
    .s{font:800 13px ${F.display};letter-spacing:4px;fill:${C.lilac};text-anchor:middle}
    .up{opacity:0;animation:up 1s ${EASE_OUT} forwards}
    @keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
    .crown{animation:crown 3.4s ease-in-out infinite}
    @keyframes crown{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(6deg) translateY(-4px)}}
    ${TWINKLE} ${FLAP}
  </style>
  <g clip-path="url(#f)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <path d="${wave(12, 0, 132)}" fill="${C.amethyst}" opacity=".35" class="w1"/>
    <path d="${wave(10, 2, 148)}" fill="${C.royal}" opacity=".9" class="w2"/>
    <path d="${wave(8, 4, 166)}" fill="${C.gold}" opacity=".25" class="w3"/>
    ${sparkle(120, 50, 0.6, C.goldLt, 0)}${sparkle(780, 70, 0.7, C.gold, 1)}${sparkle(660, 30, 0.4, C.lilac, 2)}
    ${flight("M-40 90 C 150 20, 300 120, 450 70 S 750 20, 940 90", 16, 0, `<g transform="scale(.8)">${butterfly("#4f8dff", C.sapphire)}</g>`)}
    ${flight("M940 60 C 760 120, 600 30, 450 90 S 150 120, -40 50", 19, -6, `<g transform="scale(.65)">${butterfly(C.rose, C.crimson, 0.27)}</g>`)}
  </g>
  <g transform="translate(450,34)"><g class="crown">${crown(0.5)}</g></g>
  <text x="450" y="84" class="t up">thanks for stopping by</text>
  <text x="450" y="108" class="s up" style="animation-delay:.3s">DEVAPRIYAN G S  ✦  DEV-2141</text>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="27" fill="none" stroke="${C.gold}" stroke-opacity=".35" stroke-width="2"/>
</svg>`);
}

/* ------------------------------------------------ README launch section */
{
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

console.log(`built: header, neofetch, ${launches.length} launch cards, toolbox, titles, divider, footer · LOC +${loc.add}/-${loc.del}`);
