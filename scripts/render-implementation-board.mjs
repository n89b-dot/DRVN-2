// Renders the living implementation board (an HTML page) from
// src/lib/docs/implementation-registry.ts — the same single source of truth
// behind /docs/implementation. Compiles the registry with tsc into a temp dir,
// imports it, writes the HTML to the path given as argv[2].
// Usage: node scripts/render-implementation-board.mjs /tmp/board.html
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/render-implementation-board.mjs <out.html>");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "drvn-board-"));
execSync(
  `npx tsc src/lib/docs/implementation-registry.ts --outDir "${work}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: "inherit" },
);
const registry = await import(pathToFileURL(join(work, "implementation-registry.js")).href);
const { GROUPS, IMPLEMENTATION_REGISTRY, STATUS_LABEL } = registry;

const esc = (s) =>
  String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const STATUS_ORDER = ["validated", "implemented", "in-progress", "planned", "blocked-external", "deferred"];
const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
for (const item of IMPLEMENTATION_REGISTRY) counts[item.status] += 1;
const active = IMPLEMENTATION_REGISTRY.filter((i) => i.status !== "deferred");
const done = counts.validated + counts.implemented;

const fact = (label, value) =>
  value ? `<p class="fact"><span class="fl">${label}</span> <span class="fv">${value}</span></p>` : "";

const card = (item) => `
  <article class="card" id="${item.id}">
    <header class="card__head">
      <h3>${esc(item.name)}</h3>
      <span class="card__meta"><span class="ref">§${esc(item.brief)}</span><span class="chip chip--${item.status}">${STATUS_LABEL[item.status]}</span></span>
    </header>
    ${item.status === "deferred" ? `<p class="fact"><span class="fv">${esc(item.changing)}</span></p>` : `
    ${fact("Benefit", esc(item.benefit))}
    ${fact("Today", esc(item.existsToday))}
    ${fact("Changing", esc(item.changing))}
    ${item.decisions?.length ? fact("Decisions", esc(item.decisions.join(" "))) : ""}
    ${fact("Validation", esc(item.validation))}
    ${item.externalStep ? fact("External step", esc(item.externalStep)) : ""}`}
  </article>`;

const section = (group) => {
  const items = IMPLEMENTATION_REGISTRY.filter((i) => i.group === group.id);
  if (!items.length) return "";
  return `
  <section class="group" id="g-${group.id}">
    <header class="group__head">
      <span class="idx">${group.index}</span>
      <div><h2>${esc(group.title)}</h2><p class="sub">${esc(group.sub)}</p></div>
    </header>
    <div class="cards">${items.map(card).join("")}</div>
  </section>`;
};

const meter = STATUS_ORDER.filter((s) => counts[s] > 0)
  .map((s) => `<span class="seg seg--${s}" style="flex:${counts[s]}" title="${STATUS_LABEL[s]}: ${counts[s]}"></span>`)
  .join("");

const html = `<title>DRVN Evolution Board</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>
:root{
  --paper:#efede6;--tile:#f8f6f0;--ink:#20232a;--dim:#565963;
  --rule:rgba(32,35,42,.28);--rule-soft:rgba(32,35,42,.09);
  --live:#c02c14;--live-tint:rgba(203,49,24,.14);--live-text:#a82410;
  --ok:#256b42;--ok-tint:rgba(34,128,74,.16);--ok-text:#145c35;
  --warn:#8a5a00;--warn-tint:rgba(196,140,20,.18);--warn-text:#6f4a00;
  --info:#1d5c8a;--info-tint:rgba(38,113,163,.15);--info-text:#14527f;
  --ghost:rgba(32,35,42,.055);
  --sans:"IBM Plex Sans",-apple-system,"Helvetica Neue",sans-serif;
  --mono:"IBM Plex Mono","SF Mono",monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#17181c;--tile:#1f2127;--ink:#e9e7e0;--dim:#a3a6ae;
    --rule:rgba(233,231,224,.3);--rule-soft:rgba(233,231,224,.12);
    --live:#e8593d;--live-tint:rgba(232,89,61,.18);--live-text:#f08a75;
    --ok:#4caf7d;--ok-tint:rgba(76,175,125,.16);--ok-text:#7fd0a5;
    --warn:#d8a03a;--warn-tint:rgba(216,160,58,.16);--warn-text:#e6bc6d;
    --info:#5b9fd0;--info-tint:rgba(91,159,208,.16);--info-text:#8dbfe2;
    --ghost:rgba(233,231,224,.07);
  }
}
:root[data-theme="dark"]{
  --paper:#17181c;--tile:#1f2127;--ink:#e9e7e0;--dim:#a3a6ae;
  --rule:rgba(233,231,224,.3);--rule-soft:rgba(233,231,224,.12);
  --live:#e8593d;--live-tint:rgba(232,89,61,.18);--live-text:#f08a75;
  --ok:#4caf7d;--ok-tint:rgba(76,175,125,.16);--ok-text:#7fd0a5;
  --warn:#d8a03a;--warn-tint:rgba(216,160,58,.16);--warn-text:#e6bc6d;
  --info:#5b9fd0;--info-tint:rgba(91,159,208,.16);--info-text:#8dbfe2;
  --ghost:rgba(233,231,224,.07);
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.55;font-size:15px}
.wrap{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,48px)}
.micro{font-family:var(--mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}
header.bar{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;border-bottom:1px solid var(--rule);padding-bottom:14px}
header.bar h1{font-size:clamp(22px,3.4vw,30px);font-weight:700;letter-spacing:-.02em;margin:0;text-wrap:balance}
header.bar h1 em{font-style:normal;color:var(--live)}
.progress{margin:22px 0 6px}
.meter{display:flex;gap:2px;height:10px;border-radius:3px;overflow:hidden;margin:10px 0 12px}
.seg--validated{background:var(--ok)}.seg--implemented{background:var(--info)}
.seg--in-progress{background:var(--live)}.seg--planned{background:var(--ghost)}
.seg--blocked-external{background:var(--warn)}.seg--deferred{background:var(--rule-soft)}
.legend{display:flex;flex-wrap:wrap;gap:8px 16px;font-family:var(--mono);font-size:12px}
.legend b{font-weight:600;font-variant-numeric:tabular-nums}
.jumprow{display:flex;flex-wrap:wrap;gap:6px 14px;margin:26px 0 6px;padding-top:14px;border-top:1px solid var(--rule-soft)}
.jumprow a{font-family:var(--mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);text-decoration:none;border-bottom:1px solid transparent}
.jumprow a:hover,.jumprow a:focus-visible{color:var(--live);border-bottom-color:var(--live);outline:none}
.group{margin-top:44px}
.group__head{display:flex;gap:14px;align-items:baseline;border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:16px}
.idx{font-family:var(--mono);font-weight:600;color:var(--live);font-size:13px}
.group__head h2{margin:0;font-size:19px;font-weight:600;letter-spacing:-.01em}
.group__head .sub{margin:2px 0 0;color:var(--dim);font-size:13px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(430px,100%),1fr));gap:14px}
.card{background:var(--tile);border-radius:10px;padding:16px 18px;display:flex;flex-direction:column;gap:8px}
.card__head{display:flex;justify-content:space-between;gap:10px;align-items:baseline;flex-wrap:wrap}
.card__head h3{margin:0;font-size:15px;font-weight:600}
.card__meta{display:flex;gap:8px;align-items:center}
.ref{font-family:var(--mono);font-size:11px;color:var(--dim)}
.chip{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border-radius:6px;white-space:nowrap}
.chip--validated{background:var(--ok-tint);color:var(--ok-text)}
.chip--implemented{background:var(--info-tint);color:var(--info-text)}
.chip--in-progress{background:var(--live-tint);color:var(--live-text)}
.chip--planned{background:var(--ghost);color:var(--dim)}
.chip--blocked-external{background:var(--warn-tint);color:var(--warn-text)}
.chip--deferred{background:none;color:var(--dim);box-shadow:inset 0 0 0 1px var(--rule-soft)}
.fact{margin:0;font-size:13px}
.fl{font-family:var(--mono);font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-right:6px}
.fv{color:var(--ink)}
.fact:first-of-type .fv{font-weight:500}
footer{margin-top:52px;padding-top:14px;border-top:1px solid var(--rule);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}
</style>
<div class="wrap">
  <header class="bar">
    <h1>DRVN<em>.</em> Platform Evolution</h1>
    <span class="micro">Implementation record — regenerated from implementation-registry.ts</span>
  </header>
  <div class="progress">
    <span class="micro">${IMPLEMENTATION_REGISTRY.length} initiatives · ${active.length} in scope · ${done} landed · updated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</span>
    <div class="meter" role="img" aria-label="Progress by status">${meter}</div>
    <div class="legend">${STATUS_ORDER.filter((s) => counts[s] > 0)
      .map((s) => `<span class="chip chip--${s}">${STATUS_LABEL[s]}</span> <b>${counts[s]}</b>`)
      .join(" ")}</div>
  </div>
  <nav class="jumprow" aria-label="Groups">${GROUPS.filter((g) => IMPLEMENTATION_REGISTRY.some((i) => i.group === g.id))
    .map((g) => `<a href="#g-${g.id}">${g.index} ${esc(g.title)}</a>`)
    .join("")}</nav>
  ${GROUPS.map(section).join("")}
  <footer>
    <span class="micro">DRVN — living implementation artifact</span>
    <span class="micro">In-app twin: /docs/implementation</span>
  </footer>
</div>`;

writeFileSync(out, html);
console.log("wrote", out);
