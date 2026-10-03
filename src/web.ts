// Server-rendered pages: join, scoreboard, history. No framework; charts are drawn by a
// small inline script from JSON embedded in the page.
import * as db from "./db";
import type { Env, Player } from "./db";
import { dayStats, mealTotals, weekBoard } from "./game";
import { EMPTY_DAY, calorieGoalMet, proteinGoalMet, scoreDay, wakeGoalMet, wakeMinutes, wakeTarget, type DayStats } from "./scoring";
import { addDays, gameDay, prettyClock, prettyDay, prettyDuration, prettyTime, weekStart } from "./time";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Player colors: pink (Dara) and green (Mal), validated against both theme surfaces.
const SERIES = ["--series-1", "--series-2"];
const seriesVar = (i: number) => `var(${SERIES[i % SERIES.length]})`;

const CSS = `
/* Sport-watch look: panels like watch faces, big condensed numerals, small spaced-out labels.
   Follows the phone's light/dark setting. Soft pink and sage green, picked to stay distinct for colorblind readers.
   Status never uses a player hue: hits are a plain check in ink, misses are amber. */
:root {
  color-scheme: light;
  --page: #efefec; --surface: #ffffff; --raise: #f4f4f1; --ink: #0d0d0c; --ink-2: #4a4a46; --muted: #73736d;
  --grid: #ebebe7; --axis: #d6d6d0; --ring: #e4e4df;
  --series-1: #d17aa0; --series-2: #4b8f5d;
  --good: #0d0d0c; --critical: #a85d00;
  --sans: "Archivo", system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --page: #050505; --surface: #111212; --raise: #1a1b1b; --ink: #f5f5f2; --ink-2: #b9bab5; --muted: #8b8c88;
    --grid: #1f2021; --axis: #2c2d2e; --ring: #222324;
    --series-1: #f0a6c6; --series-2: #4f9a6a;
    --good: #f5f5f2; --critical: #f0a33a;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --page: #050505; --surface: #111212; --raise: #1a1b1b; --ink: #f5f5f2; --ink-2: #b9bab5; --muted: #8b8c88;
  --grid: #1f2021; --axis: #2c2d2e; --ring: #222324;
  --series-1: #f0a6c6; --series-2: #4f9a6a;
  --good: #f5f5f2; --critical: #f0a33a;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.45 var(--sans); }
main { max-width: 760px; margin: 0 auto; padding-block: 18px 56px; padding-inline: 16px; }
a { color: inherit; }
h1 { font: 800 15px/1 var(--sans); font-stretch: 112%; letter-spacing: 0.14em; text-transform: uppercase; margin: 0; }
h2 { font: 600 11px/1 var(--sans); letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 26px 4px 10px; }
h3 { font: 700 15px/1.2 var(--sans); margin: 0; }
.big, .v { font-weight: 800; font-stretch: 75%; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
nav { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
nav .links { display: flex; background: var(--surface); border-radius: 999px; padding: 3px; }
nav .links a { color: var(--muted); text-decoration: none; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
nav .links a[aria-current] { color: var(--ink); background: var(--raise); }
.card { background: var(--surface); border-radius: 22px; padding: 16px; }
.muted { color: var(--muted); }
.sub { color: var(--ink-2); }
.date { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); margin: 0 4px 10px; }
.faces { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.face { background: var(--surface); border-radius: 26px; padding: 16px 12px 14px; text-align: center; min-width: 0; }
.face svg { width: 100%; max-width: 150px; height: auto; display: block; margin: 0 auto; }
.face .n { font-weight: 700; font-stretch: 112%; letter-spacing: 0.08em; text-transform: uppercase; font-size: 13px; margin-top: 8px; }
.face .d { font-size: 12px; color: var(--muted); margin-top: 2px; }
.swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; }
.banner { margin-top: 10px; padding: 12px 16px; border-radius: 18px; background: var(--surface); font-size: 14px; color: var(--ink-2); }
.banner strong { color: var(--ink); }
.players { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
.pcard { background: var(--surface); border-radius: 22px; padding: 14px; }
.pcard .head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 2px 12px; }
.pcard .head .t { font-size: 13px; color: var(--muted); font-weight: 600; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--ring); border-radius: 16px; overflow: hidden; }
.stat { background: var(--raise); padding: 10px 12px 11px; min-width: 0; }
.stat .k { font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
.stat .v { font-size: 26px; line-height: 1.15; }
.stat .v small { font-size: 13px; color: var(--muted); font-weight: 500; font-stretch: 100%; letter-spacing: 0; }
.stat .s { font-size: 12px; font-weight: 600; color: var(--muted); }
.ok { color: var(--good); font-weight: 700; }
.ok::before { content: "✓ "; }
.bad { color: var(--critical); font-weight: 700; }
.bad::before { content: "▲ "; font-size: 0.85em; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--grid); font-size: 14px; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
@media (max-width: 480px) { th, td { padding: 9px 4px; } .wk th.n, .wk td.n { padding: 9px 3px; } }
th { color: var(--muted); font-weight: 600; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
td.n, th.n { text-align: right; }
td.p4 { color: var(--ink); font-weight: 800; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
.wk td.n { font-weight: 700; font-stretch: 85%; font-size: 16px; }
.table-wrap { overflow-x: auto; }
.rules { color: var(--muted); font-size: 12px; margin: 10px 2px 0; }
.meal { padding: 12px 2px; border-bottom: 1px solid var(--grid); }
.meal:first-child { padding-top: 2px; }
.meal:last-child { border-bottom: 0; padding-bottom: 2px; }
.meal ul { margin: 6px 0 0; padding-left: 16px; color: var(--ink-2); font-size: 14px; }
.meal ul .muted { font-variant-numeric: tabular-nums; }
.meal .tot { font-variant-numeric: tabular-nums; color: var(--ink-2); font-size: 14px; margin-top: 2px; }
.meal-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
.meal-head form, .day-head form { margin: 0; }
.pill, .meal-head button, .day-head button { margin: 0; padding: 6px 14px; font: 600 13px/1 var(--sans); border-radius: 999px; border: 0; background: var(--raise); color: var(--ink); cursor: pointer; }
.day-head button { background: var(--ink); color: var(--page); }
.meal-head button:hover, .day-head button:hover { filter: brightness(1.15); }
.day-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin: 26px 4px 10px; }
.day-head h2 { margin: 0; }
.chip { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: var(--raise); color: var(--ink-2); margin-left: 6px; }
.chip.on { color: var(--ink); background: var(--axis); }
.private-note { margin: 0 0 12px; padding: 12px 16px; border-radius: 18px; background: var(--surface); color: var(--ink-2); font-size: 14px; }
.chips { display: flex; gap: 6px; }
.chips a { padding: 6px 14px; border-radius: 999px; text-decoration: none; color: var(--muted); background: var(--surface); font-size: 13px; font-weight: 600; }
.chips a[aria-current] { color: var(--page); background: var(--ink); }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
.charts .card h3 { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); margin-bottom: 6px; }
.charts .card h3 .muted { text-transform: none; letter-spacing: 0; }
.chart { position: relative; height: 190px; outline: none; }
.chart:focus-visible { box-shadow: 0 0 0 2px var(--ink); border-radius: 8px; }
.chart svg { display: block; width: 100%; height: 100%; overflow: visible; font-family: var(--sans); }
.chart .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 14px; }
.tip { position: absolute; pointer-events: none; background: var(--raise); border-radius: 12px;
  padding: 7px 11px; font-size: 12px; white-space: nowrap; display: none; z-index: 2; }
.tip strong { display: block; font-size: 17px; font-weight: 800; font-stretch: 80%; }
details { margin: 10px 4px 0; }
summary { cursor: pointer; color: var(--muted); font-size: 13px; }
form label { display: block; margin: 14px 0 6px; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
input { width: 100%; padding: 12px 14px; font: inherit; border-radius: 14px; border: 1px solid var(--axis); background: var(--raise); color: var(--ink); }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
button { margin-top: 20px; padding: 12px 22px; font: 700 15px/1 var(--sans); border-radius: 999px; border: 0; background: var(--ink); color: var(--page); cursor: pointer; }
code, .key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.key { display: block; padding: 12px 14px; border-radius: 14px; background: var(--raise); word-break: break-all; user-select: all; }
.steps h3 { margin-top: 18px; }
.steps h3:first-child { margin-top: 0; }
ol li { margin-bottom: 8px; }
.error { color: var(--critical); font-weight: 600; }
/* Onboarding (join + you're in): one narrow column, like a phone even on a laptop. */
main.narrow { max-width: 460px; padding-block: 48px 64px; }
.onboard { text-align: center; margin-bottom: 22px; }
.onboard .mark { width: 64px; height: 40px; display: block; margin: 0 auto 14px; }
.onboard .title { margin: 0; font-size: 36px; text-align: center; text-transform: none; letter-spacing: 0; }
.onboard .lede { margin: 8px auto 0; text-align: center; max-width: 34ch; }
.form { padding: 20px; border-radius: 26px; }
.form label:first-of-type { margin-top: 0; }
.form input[type="text"], .form input:not([type]) { padding: 13px 14px; }
.form input::placeholder { color: var(--muted); }
.tiles { border: 0; padding: 0; margin: 18px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tiles legend { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; padding: 0; }
.tile { position: relative; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 10px 12px; border-radius: 20px;
  background: var(--raise); cursor: pointer; font-size: 14px; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--ink); }
.tile input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.tile svg { width: 48px; height: 48px; }
.tile:has(input:checked) { box-shadow: inset 0 0 0 2px var(--ink); }
.tile:has(input:focus-visible) { outline: 2px solid var(--ink); outline-offset: 2px; }
.opt { margin: 18px 0 0; }
.opt summary { list-style: none; cursor: pointer; font-size: 14px; color: var(--ink-2); padding: 12px 14px; border-radius: 14px; background: var(--raise); }
.opt summary::-webkit-details-marker { display: none; }
.opt summary span { color: var(--ink); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.opt[open] summary { margin-bottom: 10px; }
.hint { color: var(--muted); font-size: 13px; margin: 6px 2px 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
button.wide { width: 100%; margin-top: 20px; padding: 15px; font-size: 16px; }
.foot { color: var(--muted); font-size: 13px; text-align: center; margin: 16px 12px 0; }
.steps { list-style: none; counter-reset: step; padding: 6px 20px; border-radius: 26px; margin: 0; }
.steps > li { counter-increment: step; padding: 16px 0 16px 40px; position: relative; border-bottom: 1px solid var(--grid); margin: 0; }
.steps > li:last-child { border-bottom: 0; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 15px; width: 26px; height: 26px; border-radius: 50%;
  background: var(--ink); color: var(--page); font-weight: 800; font-size: 13px; display: grid; place-items: center; }
.steps h3 { font-size: 16px; }
.steps .field { margin: 12px 2px 0; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.copy { display: flex; gap: 8px; align-items: center; margin-top: 8px; padding: 6px 6px 6px 12px; border-radius: 14px; background: var(--raise); }
.copy code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.copy .pill { flex: none; background: var(--ink); color: var(--page); }
.links2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.go { display: block; padding: 16px; border-radius: 22px; background: var(--surface); text-decoration: none; }
.go b { display: block; font-size: 16px; }
.go span { display: block; color: var(--muted); font-size: 13px; margin-top: 4px; }
.go:hover { background: var(--raise); }
fieldset.colors { border: 0; padding: 0; margin: 14px 0 0; display: flex; gap: 8px; flex-wrap: wrap; }
fieldset.colors legend { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 6px; padding: 0; }
fieldset.colors label { margin: 0; display: flex; align-items: center; gap: 4px; padding: 10px 16px; border-radius: 999px; background: var(--raise);
  font-size: 14px; letter-spacing: 0; text-transform: none; color: var(--ink); font-weight: 600; cursor: pointer; }
fieldset.colors input { width: auto; margin: 0 6px 0 0; accent-color: var(--ink); }
fieldset.colors label:has(input:checked) { box-shadow: inset 0 0 0 2px var(--ink); }
.lede { color: var(--ink-2); margin: 8px 4px 16px; }
.title { font: 800 28px/1.1 var(--sans); font-stretch: 85%; margin: 6px 4px 0; }
`;

function layout(title: string, body: string, script = "", mainClass = ""): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title === "Health Bet" ? title : `${title} · Health Bet`)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="Health Bet"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#050505" media="(prefers-color-scheme: dark)"><meta name="theme-color" content="#efefec" media="(prefers-color-scheme: light)">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&display=swap">
<style>${CSS}</style></head>
<body><main${mainClass ? ` class="${mainClass}"` : ""}>${body}</main>${script}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function nav(current: "board" | "history" | "me"): string {
  const cur = (k: string) => (current === k ? 'aria-current="page"' : "");
  return `<nav><h1>Health Bet</h1><div class="links">
    <a href="/" ${cur("board")}>Scoreboard</a>
    <a href="/history" ${cur("history")}>History</a>
    <a href="/me" ${cur("me")}>My page</a></div></nav>`;
}

function mealBlock(m: db.MealWithItems, opts: { owner?: string; color?: string; full: boolean; shareForm?: string }): string {
  const t = mealTotals(m);
  const who = opts.owner ? `<span class="swatch" style="background:${opts.color}"></span>${esc(opts.owner)} · ` : "";
  const macros = opts.full ? ` · ${t.fat}g fat · ${t.carbs}g carbs` : "";
  const item = (it: db.FoodEntry) =>
    `<li>${esc(it.description)} <span class="muted">(${it.calories} cal, ${it.protein_g}g P${opts.full ? `, ${it.fat_g}g F, ${it.carbs_g}g C` : ""})</span></li>`;
  return `<div class="meal"><div class="meal-head"><div>${who}${m.name ? esc(m.name) : "Meal"}${
      opts.full ? (m.shared_at ? '<span class="chip on">shared</span>' : '<span class="chip">private</span>') : ""}</div>${opts.shareForm ?? ""}</div>
    <div class="tot">${fmt(t.calories)} cal · ${t.protein}g protein${macros}</div>
    <ul>${m.items.map(item).join("")}</ul></div>`;
}

// ---------- join ----------

/** Two interlocking rings, pink and green: the mark for the onboarding pages. */
const MARK = `<svg class="mark" viewBox="0 0 64 40" aria-hidden="true">
  <circle cx="20" cy="20" r="15" fill="none" stroke="var(--series-1)" stroke-width="5" stroke-linecap="round" stroke-dasharray="70 100" transform="rotate(-90 20 20)"/>
  <circle cx="44" cy="20" r="15" fill="none" stroke="var(--series-2)" stroke-width="5" stroke-linecap="round" stroke-dasharray="52 100" transform="rotate(-90 44 20)"/>
</svg>`;

function colorTile(value: "pink" | "green", label: string, series: string, arc: number): string {
  return `<label class="tile"><input type="radio" name="color" value="${value}" required>
    <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="18" fill="none" stroke="var(--axis)" stroke-width="6"/>
      <circle cx="24" cy="24" r="18" fill="none" stroke="var(${series})" stroke-width="6" stroke-linecap="round" stroke-dasharray="${arc} 120" transform="rotate(-90 24 24)"/></svg>
    <span>${label}</span></label>`;
}

export function joinPage(error = "", name = ""): Response {
  return layout(
    "Join",
    `<header class="onboard">${MARK}<h1 class="title">Join the bet</h1>
      <p class="lede">Food, sleep, and wake-up.<br>Lowest per week loses.</p></header>
    <form method="post" class="card form">
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <label for="code">Join code</label><input id="code" name="code" required autocomplete="off" autocapitalize="off" placeholder="From whoever set this up">
      <label for="name">Your name</label><input id="name" name="name" required maxlength="40" value="${esc(name)}" placeholder="First name is fine" autocomplete="given-name">
      <fieldset class="tiles"><legend>Your color</legend>
        ${colorTile("pink", "Pink", "--series-1", 85)}${colorTile("green", "Green", "--series-2", 60)}
      </fieldset>
      <details class="opt"><summary>Want recap texts from Poke? <span>Add your Poke API key</span></summary>
        <label for="poke" class="sr">Poke API key</label>
        <input id="poke" name="poke" autocomplete="off" placeholder="Paste a key from Poke Kitchen → API Keys">
        <p class="hint">Gets you a 10am recap, a 9pm check-in, and the Monday verdict by text.</p>
      </details>
      <button type="submit" class="wide">Get my key</button>
    </form>
    <p class="foot">Joined before and lost your key? Join again with the same name. You'll get a new key and the old one stops working.</p>`,
    "",
    "narrow",
  );
}

const COPY_JS = `<script>
document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  const el = document.getElementById(b.dataset.copy);
  try { await navigator.clipboard.writeText(el.textContent.trim()); b.textContent = "Copied"; }
  catch { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = "Selected"; }
  setTimeout(() => (b.textContent = "Copy"), 1600);
}));
</script>`;

export function joinSuccess(origin: string, name: string, apiKey: string, meToken: string, hasPoke: boolean): Response {
  const mcpUrl = `${origin}/mcp`;
  const copyRow = (id: string, value: string) =>
    `<div class="copy"><code id="${id}">${esc(value)}</code><button type="button" class="pill" data-copy="${id}">Copy</button></div>`;
  return layout(
    "You're in",
    `<header class="onboard">${MARK}<h1 class="title">You're in, ${esc(name)}</h1>
      <p class="lede">Three steps and you're logging.</p></header>
    <ol class="card steps">
      <li><h3>Save your key</h3><p class="hint">It's only shown this once. Keep it in your notes app.</p>${copyRow("key", apiKey)}</li>
      <li><h3>Connect Poke</h3><p class="hint">Open <a href="https://poke.com/integrations/new">poke.com/integrations/new</a>, name it <b>Health Bet</b>, and paste:</p>
        <p class="field">MCP Server URL</p>${copyRow("mcp", mcpUrl)}
        <p class="field">API Key</p><p class="hint">Your key from step 1.</p></li>
      <li><h3>Start texting Poke</h3><p class="hint">Set your goal first, like <em>"set my goal: cut, 1700 cal, 120g protein, 45g fat"</em>. Then text it what you eat, "gn" when you go to bed, and "gm" when you wake up.</p></li>
    </ol>
    ${hasPoke ? "" : `<p class="foot">You skipped reminders, so the app won't text you recaps. Logging by texting Poke still works. To add reminders later, join again with the same name.</p>`}
    <div class="links2">
      <a class="go" href="/me/${esc(meToken)}"><b>My page</b><span>Your meals, macros, weight. Just for you.</span></a>
      <a class="go" href="/"><b>Scoreboard</b><span>${esc(new URL(origin).host)}. Shared with your friend.</span></a>
    </div>
    <p class="foot">Lost these links? Ask Poke "what's my private page?"</p>`,
    COPY_JS,
    "narrow",
  );
}

// ---------- scoreboard ----------

const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

function stat(k: string, v: string, status: string): string {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${status}</div></div>`;
}

/** `full` adds the unscored macros; it's only used on the player's own private page. */
function playerCard(env: Env, p: Player, i: number, s: DayStats, day: string, todayPts: number, full: boolean): string {
  const r = db.rules(env);
  const tiles: string[] = [];
  if (p.calorie_target != null && p.goal_type) {
    const ok = calorieGoalMet(p, s, r);
    const cut = p.goal_type === "cut";
    const gap = Math.abs(p.calorie_target - s.calories);
    let st = '<span class="muted">Nothing logged</span>';
    if (s.foodCount > 0) {
      if (cut && s.calories > p.calorie_target) st = `<span class="bad">${fmt(gap)} over</span>`;
      else if (cut) st = ok ? `<span class="ok">On target</span> · ${fmt(gap)} left` : `${fmt(gap)} left`;
      else st = ok ? `<span class="ok">Hit</span>` : `${fmt(gap)} to go`;
    }
    tiles.push(stat(`Calories · ${cut ? "max" : "min"} ${fmt(p.calorie_target)}`, fmt(s.calories), st));
  }
  if (p.protein_target != null) {
    const ok = proteinGoalMet(p, s);
    tiles.push(stat(`Protein · min ${p.protein_target}g`, `${s.protein}<small>g</small>`, ok ? '<span class="ok">Hit</span>' : `${Math.max(0, p.protein_target - s.protein)}g to go`));
  }
  if (full) {
    const fatSt = p.fat_target == null ? "Not scored" : s.fat >= p.fat_target ? '<span class="ok">Hit</span> · not scored' : `${p.fat_target - s.fat}g low · not scored`;
    tiles.push(stat(p.fat_target != null ? `Fat · min ${p.fat_target}g` : "Fat", `${s.fat}<small>g</small>`, fatSt));
    tiles.push(stat("Carbs", `${s.carbs}<small>g</small>`, "Not scored"));
  }
  const sleep = s.sleepMinutes;
  tiles.push(
    stat(
      `Sleep · ${prettyDuration(r.sleepTargetMinutes).replace(" 00m", "")} goal`,
      sleep != null ? hm(sleep) : "–",
      sleep == null ? "Not logged" : sleep >= r.sleepTargetMinutes ? '<span class="ok">Hit</span>' : `<span class="bad">${prettyDuration(r.sleepTargetMinutes - sleep).replace(" 00m", "")} short</span>`,
    ),
  );
  const target = wakeTarget(day, r);
  const late = s.wakeAt ? wakeMinutes(s.wakeAt, r.tz) - target : 0;
  tiles.push(
    stat(
      `Up by ${prettyClock(target).replace(" AM", "").replace(" PM", "")}`,
      s.wakeAt ? prettyTime(s.wakeAt, env.GAME_TZ).replace(/ (AM|PM)/, (m) => `<small>${m.toLowerCase()}</small>`) : "–",
      !s.wakeAt ? "Not logged" : wakeGoalMet(day, s, r) ? '<span class="ok">On time</span>' : `<span class="bad">${late} min late</span>`,
    ),
  );
  return `<div class="pcard"><div class="head"><h3><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(p.name)}
      <span class="muted" style="font-weight:500">· ${p.goal_type ?? "no goal yet"}</span></h3><span class="t">${todayPts}/4 today</span></div>
    <div class="stats">${tiles.join("")}</div></div>`;
}

/** Watch-face ring: the arc is today's points out of 4, the number is the week total. */
function face(name: string, i: number, weekPts: number, todayPts: number): string {
  const C = 2 * Math.PI * 50;
  const arc = (Math.min(todayPts, 4) / 4) * C;
  return `<div class="face"><svg viewBox="0 0 120 120" role="img" aria-label="${esc(name)}: ${weekPts} points this week, ${todayPts} of 4 today">
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--raise)" stroke-width="10"/>
      ${arc > 0 ? `<circle cx="60" cy="60" r="50" fill="none" stroke="${seriesVar(i)}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>` : ""}
      <text x="60" y="71" text-anchor="middle" fill="var(--ink)" font-family="Archivo, sans-serif" font-weight="800" font-size="36" style="font-stretch:75%">${weekPts}</text>
    </svg><div class="n">${esc(name)}</div><div class="d">${todayPts}/4 today</div></div>`;
}

export async function boardPage(env: Env, now: Date): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const start = weekStart(today);
  const r = db.rules(env);
  const [players, board, punishment] = await Promise.all([
    db.listPlayers(env.DB),
    weekBoard(env, start, today),
    db.getSetting(env.DB, "punishment"),
  ]);
  const stats = await Promise.all(players.map((p) => dayStats(env, p.id, today)));
  const sharedFor = async (day: string) => {
    const meals = await Promise.all(players.map(async (p) => (await db.mealsForDay(env.DB, p.id, day)).filter((m) => m.shared_at)));
    return players.flatMap((p, i) => meals[i].map((m) => mealBlock(m, { owner: p.name, color: seriesVar(i), full: false }))).join("");
  };
  const [sharedHtml, sharedYesterday] = await Promise.all([sharedFor(today), sharedFor(addDays(today, -1))]);

  const todayPts = players.map((p, i) => scoreDay(p, stats[i], r, today).points);
  const hero = board.rows.map((row, i) => face(row.player.name, i, row.points, todayPts[i])).join("");
  let verdict = "";
  if (board.rows.length >= 2) {
    const tied = board.rows.every((row) => row.points === board.rows[0].points);
    verdict = board.loser
      ? `<strong>${esc(board.loser.name)}</strong> is losing right now${tied ? " (tied on points, behind on total sleep)" : ""}.`
      : "Dead even right now.";
  }
  const banner = `<div class="banner">${verdict} ${punishment ? `Loser's punishment: <strong>${esc(punishment)}</strong>` : `<span class="muted">No punishment set yet. Text your agent "set the punishment to ..."</span>`}</div>`;

  const cards = players
    .map((p, i) => playerCard(env, p, i, stats[i], today, todayPts[i], false))
    .join("");

  const dayHeads = board.days.map((d) => `<th class="n" title="${prettyDay(d)}">${prettyDay(d).slice(0, 2)}</th>`).join("");
  const weekRows = board.rows
    .map(
      (row, i) => `<tr><td><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(row.player.name)}</td>
        ${row.perDay.map((v) => `<td class="n${v === 4 ? " p4" : ""}">${v == null ? '<span class="muted">·</span>' : v}</td>`).join("")}<td class="n"><strong>${row.points}</strong></td></tr>`,
    )
    .join("");

  return layout(
    "Health Bet",
    `${nav("board")}
    <div class="date"><span>${prettyDay(today)}</span><span>Week of ${prettyDay(start).slice(4)}</span></div>
    <div class="faces">${hero || '<div class="card">No players yet.</div>'}</div>${banner}
    <h2>Today</h2><div class="players">${cards}</div>
    <h2>This week</h2><div class="card table-wrap"><table class="wk"><thead><tr><th>Player</th>${dayHeads}<th class="n">Total</th></tr></thead><tbody>${weekRows}</tbody></table>
      <p class="rules">1 point each for calories, protein, ${prettyDuration(r.sleepTargetMinutes)}+ sleep, and being up by ${prettyClock(r.wakeWeekday)} (weekends ${prettyClock(r.wakeWeekend)}, ${r.wakeGraceMinutes} min grace). Lowest weekly total loses.</p></div>
    <h2>Shared meals today</h2><div class="card">${sharedHtml || '<p class="muted" style="margin:0">Nobody has shared a meal today. Meals are private until you share one from your page or tell Poke "share my lunch".</p>'}</div>
    ${sharedYesterday ? `<h2>Shared yesterday</h2><div class="card">${sharedYesterday}</div>` : ""}
    <p class="rules">Shared here: points, calorie and protein totals, sleep, wake-up times, and meals you choose to share. Fat, carbs, weight, and unshared meals stay on each player's private page.</p>`,
    `<script>setTimeout(() => location.reload(), 5 * 60 * 1000)</script>`,
  );
}

// ---------- history ----------

export async function historyPage(env: Env, now: Date, rangeDays: number): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const r = db.rules(env);
  const players = await db.listPlayers(env.DB);
  const firstDay = (await db.firstActivityDay(env.DB)) ?? today;

  // Weekly results, newest first, from the first week with any activity.
  const weeks: string[] = [];
  for (let w = weekStart(today); w >= weekStart(firstDay); w = addDays(w, -7)) weeks.push(w);
  const boards = await Promise.all(weeks.map((w) => weekBoard(env, w, w === weekStart(today) ? today : addDays(w, 6))));
  const weekRows = boards
    .map((b) => {
      const live = b.start === weekStart(today);
      const result = b.rows.length < 2 ? "" : b.loser ? `${esc(b.loser.name)} ${live ? "losing" : "lost"}` : "draw";
      return `<tr><td>${prettyDay(b.start)}${live ? ' <span class="muted">(this week)</span>' : ""}</td>
        ${b.rows.map((row) => `<td class="n">${row.points}</td>`).join("")}<td>${result}</td></tr>`;
    })
    .join("");

  const from = addDays(today, -(rangeDays - 1));
  const days = Array.from({ length: rangeDays }, (_, k) => addDays(from, k));
  const sections = await Promise.all(players.map((p, i) => playerHistory(env, p, i, days, today, firstDay, false)));
  const chips = [14, 30, 90]
    .map((n) => `<a href="/history?days=${n}" ${n === rangeDays ? 'aria-current="true"' : ""}>${n} days</a>`)
    .join("");

  const data = { days, labels: days.map(prettyDay), charts: Object.assign({}, ...sections.map((x) => x.charts)) };

  return layout(
    "History",
    `${nav("history")}
    <div class="chips">${chips}</div>
    <h2>Weekly results</h2>
    <div class="card table-wrap"><table><thead><tr><th>Week of</th>${players.map((p, i) => `<th class="n"><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(p.name)}</th>`).join("")}<th>Result</th></tr></thead>
    <tbody>${weekRows}</tbody></table></div>
    ${sections.map((x) => x.html).join("") || '<p class="muted">No players yet.</p>'}`,
    `<script type="application/json" id="chart-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
    <script>${CHART_JS}</script>`,
  );
}

/** One player's hit rates and charts. `full` adds the private charts (fat, weight). */
async function playerHistory(env: Env, p: Player, i: number, days: string[], today: string, firstDay: string, full: boolean) {
  const r = db.rules(env);
  const [stats, weights] = await Promise.all([
    db.statsForRange(env.DB, p.id, days[0], today),
    full ? db.weightsForPlayer(env.DB, p.id) : Promise.resolve([]),
  ]);
  const s = (d: string) => stats.get(d) ?? EMPTY_DAY;
  const logged = (d: string) => s(d).foodCount > 0;
  const wByDay = new Map(weights.map((w) => [w.day, w.lb]));
  const charts: any[] = [
    { title: "Calories", unit: "cal", target: p.calorie_target, targetLabel: p.goal_type === "cut" ? "max" : "min", values: days.map((d) => (logged(d) ? s(d).calories : null)) },
    { title: "Protein", unit: "g", target: p.protein_target, targetLabel: "min", values: days.map((d) => (logged(d) ? s(d).protein : null)) },
    ...(full ? [{ title: "Fat", unit: "g", target: p.fat_target, targetLabel: "min", values: days.map((d) => (logged(d) ? s(d).fat : null)) }] : []),
    { title: "Sleep", unit: "h", target: r.sleepTargetMinutes / 60, targetLabel: "target", values: days.map((d) => (s(d).sleepMinutes == null ? null : Math.round((s(d).sleepMinutes! / 60) * 10) / 10)) },
    {
      title: "Wake-up",
      unit: "time",
      target: null,
      targetLabel: "",
      note: `by ${prettyClock(r.wakeWeekday)} weekdays · ${prettyClock(r.wakeWeekend)} weekends`,
      values: days.map((d) => (s(d).wakeAt ? wakeMinutes(s(d).wakeAt!, r.tz) / 60 : null)),
      zeroBased: false,
    },
    ...(full ? [{ title: "Weight", unit: "lb", target: p.goal_weight_lb, targetLabel: "goal", values: days.map((d) => wByDay.get(d) ?? null), zeroBased: false }] : []),
  ];
  let streak = 0;
  for (let d = addDays(today, -1); d >= firstDay; d = addDays(d, -1)) {
    if (scoreDay(p, s(d), r, d).points === 4) streak++;
    else break;
  }
  // Finished days since this player started tracking.
  const started = days.find((d) => s(d).foodCount > 0 || s(d).sleepMinutes != null);
  const hits = days.filter((d) => started && d >= started && d < today).map((d) => scoreDay(p, s(d), r, d));
  const rate = (k: "calOk" | "proteinOk" | "sleepOk" | "wakeOk") => Math.round((hits.filter((h) => h[k]).length / hits.length) * 100);
  const rates = hits.length ? `Goals hit on ${hits.length} finished day${hits.length > 1 ? "s" : ""}: calories ${rate("calOk")}% · protein ${rate("proteinOk")}% · sleep ${rate("sleepOk")}% · up on time ${rate("wakeOk")}%` : "Hit rates show up after the first full day.";

  const chartDivs = charts
    .map(
      (c, k) => `<div class="card"><h3>${c.title}${c.target != null ? ` <span class="muted">· ${c.targetLabel} ${fmt(c.target)}${c.unit === "cal" ? "" : c.unit}</span>` : c.note ? ` <span class="muted">· ${c.note}</span>` : ""}</h3>
      <div class="chart" tabindex="0" data-chart="${i}-${k}" aria-label="${esc(p.name)} ${c.title} chart. Use left and right arrows to read values."></div></div>`,
    )
    .join("");
  const cell = (c: any, v: number | null) => (v == null ? "–" : c.unit === "time" ? prettyClock(Math.round(v * 60)) : fmt(v));
  const tableRows = days
    .map((d, k) => `<tr><td>${prettyDay(d)}</td>${charts.map((c) => `<td class="n">${cell(c, c.values[k])}</td>`).join("")}</tr>`)
    .reverse()
    .join("");
  const html = `<h2><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(p.name)}</h2>
    <p class="sub">${rates}${streak ? ` · 🔥 ${streak}-day perfect streak` : ""}</p>
    <div class="charts">${chartDivs}</div>
    <details><summary>Show as table</summary><div class="card table-wrap" style="margin-top:8px"><table>
      <thead><tr><th>Day</th>${charts.map((c) => `<th class="n">${c.title}${c.unit === "time" ? "" : ` (${c.unit})`}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div></details>`;
  return { html, charts: Object.fromEntries(charts.map((c, k) => [`${i}-${k}`, { ...c, color: SERIES[i % SERIES.length] }])) };
}

// ---------- scoreboard password (once per phone) ----------

export function lockedPage(next: string, error = ""): Response {
  return layout(
    "Health Bet",
    `<header class="onboard">${MARK}<h1 class="title">Health Bet</h1>
      <p class="lede">Food, sleep, and wake-up.<br>Lowest per week loses.</p></header>
    <form method="post" action="/unlock" class="card form">
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <input type="hidden" name="next" value="${esc(next)}">
      <label for="code">Password</label>
      <input id="code" name="code" type="password" required autocomplete="current-password" placeholder="Same as the join code">
      <button type="submit" class="wide">See the scoreboard</button>
    </form>
    <p class="foot">This phone will remember it. New here? <a href="/join">Join the bet</a>.</p>`,
    "",
    "narrow",
  );
}

// ---------- "My page" sign-in (once per phone) ----------

export function meLoginPage(error = ""): Response {
  return layout(
    "My page",
    `${nav("me")}
    <header class="onboard"><h1 class="title">Your page</h1>
      <p class="lede">Paste your personal key once and this phone will remember you.</p></header>
    <form method="post" action="/me" class="card form">
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <label for="key">Personal key</label>
      <input id="key" name="key" required autocomplete="off" autocapitalize="off" placeholder="Starts with hb_">
      <button type="submit" class="wide">Open my page</button>
    </form>
    <p class="foot">It's the key from when you joined, the same one you pasted into Poke. Lost it? Text Poke "what's my private page?", or join again with the same name.</p>`,
    "",
    "narrow",
  );
}

// ---------- private page ----------

export async function privatePage(env: Env, player: Player, meToken: string, now: Date): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const r = db.rules(env);
  const players = await db.listPlayers(env.DB);
  const i = Math.max(0, players.findIndex((p) => p.id === player.id));
  const others = players.filter((p) => p.id !== player.id).map((p) => p.name).join(" & ") || "the other players";
  const [s, todayMeals, yMeals] = await Promise.all([
    dayStats(env, player.id, today),
    db.mealsForDay(env.DB, player.id, today),
    db.mealsForDay(env.DB, player.id, addDays(today, -1)),
  ]);
  const shareForm = (m: db.MealWithItems) =>
    `<form method="post" action="/me/${esc(meToken)}/share"><input type="hidden" name="meal" value="${m.id}">
      <input type="hidden" name="shared" value="${m.shared_at ? "0" : "1"}">
      <button type="submit">${m.shared_at ? "Unshare" : `Share with ${esc(others)}`}</button></form>`;
  const list = (ms: db.MealWithItems[], empty: string) =>
    ms.length ? ms.map((m) => mealBlock(m, { full: true, shareForm: shareForm(m) })).join("") : `<p class="muted" style="margin:0">${empty}</p>`;
  // "Share all" until every meal that day is shared, then "Unshare all".
  const shareAll = (day: string, ms: db.MealWithItems[]) => {
    if (!ms.length) return "";
    const all = ms.every((m) => m.shared_at);
    return `<form method="post" action="/me/${esc(meToken)}/share" class="share-all"><input type="hidden" name="day" value="${day}">
      <input type="hidden" name="shared" value="${all ? "0" : "1"}"><button type="submit">${all ? "Unshare all" : `Share all with ${esc(others)}`}</button></form>`;
  };
  const dayHead = (title: string, day: string, ms: db.MealWithItems[]) =>
    `<div class="day-head"><h2>${title}</h2>${shareAll(day, ms)}</div>`;

  const days = Array.from({ length: 30 }, (_, k) => addDays(today, k - 29));
  const firstDay = (await db.firstActivityDay(env.DB)) ?? today;
  const hist = await playerHistory(env, player, i, days, today, firstDay, true);
  const data = { days, labels: days.map(prettyDay), charts: hist.charts };

  return layout(
    `${player.name}'s page`,
    `${nav("me")}
    <p class="private-note">🔒 Only you can see this page. ${esc(others)} sees your points, calorie and protein totals, sleep, and wake-up, plus any meal you share. Don't share this link.</p>
    <div class="players">${playerCard(env, player, i, s, today, scoreDay(player, s, r, today).points, true)}</div>
    ${dayHead("Today's food", today, todayMeals)}<div class="card">${list(todayMeals, "Nothing logged yet today. Text Poke what you ate.")}</div>
    ${dayHead("Yesterday", addDays(today, -1), yMeals)}<div class="card">${list(yMeals, "Nothing logged yesterday.")}</div>
    ${hist.html.replace(/<h2>.*?<\/h2>/s, "<h2>Last 30 days</h2>")}`,
    `<script type="application/json" id="chart-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
    <script>${CHART_JS}</script>`,
  );
}

// Line chart with a target reference line, crosshair and tooltip. One series per chart.
const CHART_JS = `
(() => {
  const data = JSON.parse(document.getElementById("chart-data").textContent);
  const NS = "http://www.w3.org/2000/svg";
  const num = (n) => Math.round(n * 10) / 10 >= 1000 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10);
  const clock = (h) => { const m = Math.round(h * 60), hh = Math.floor(m / 60) % 24; return (hh % 12 || 12) + ":" + String(m % 60).padStart(2, "0") + (hh < 12 ? "am" : "pm"); };

  const el = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent && parent.appendChild(e); return e; };
  function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }

  function draw(host, c) {
    host.innerHTML = "";
    const fmt = c.unit === "time" ? clock : num;
    const vals = c.values.filter((v) => v != null);
    if (!vals.length) { const d = document.createElement("div"); d.className = "empty"; d.textContent = "Nothing logged yet"; host.appendChild(d); return; }
    const W = host.clientWidth, H = host.clientHeight, L = 44, R = 12, T = 10, B = 24;
    const all = c.target != null ? vals.concat([c.target]) : vals;
    // Round ticks: 4 intervals of a 1/2/2.5/5 step, from 0 (or near the data, for weight).
    let lo = c.zeroBased === false ? Math.min(...all) : 0, hi = Math.max(...all) * 1.08 || 1;
    if (c.zeroBased === false) { lo -= Math.max(1, (hi - lo) * 0.25); hi += Math.max(1, (hi - lo) * 0.1); }
    const step = niceStep((hi - lo) / 4);
    lo = Math.floor(lo / step) * step; hi = lo + step * Math.ceil((hi - lo) / step);
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
    const n = c.values.length;
    const x = (k) => L + (n === 1 ? (W - L - R) / 2 : (k * (W - L - R)) / (n - 1));
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img" }, host);
    const css = (v) => "var(" + v + ")";
    for (const v of ticks) {
      const yy = y(v);
      el("line", { x1: L, x2: W - R, y1: yy, y2: yy, stroke: css(v === lo ? "--axis" : "--grid"), "stroke-width": 1 }, svg);
      el("text", { x: L - 6, y: yy + 4, "text-anchor": "end", "font-size": 11, fill: css("--muted") }, svg).textContent = fmt(v);
    }
    for (const k of [0, Math.floor((n - 1) / 2), n - 1]) {
      el("text", { x: x(k), y: H - 6, "text-anchor": k === 0 ? "start" : k === n - 1 ? "end" : "middle", "font-size": 11, fill: css("--muted") }, svg).textContent = data.labels[k].slice(4);
    }
    if (c.target != null) {
      const ty = y(c.target);
      el("line", { x1: L, x2: W - R, y1: ty, y2: ty, stroke: css("--ink-2"), "stroke-width": 1, opacity: 0.6 }, svg);
      el("text", { x: L + 4, y: ty - 4, "text-anchor": "start", "font-size": 11, fill: css("--ink-2") }, svg).textContent = c.targetLabel + " " + fmt(c.target);
    }
    // Line segments, broken where days are missing; isolated points get a dot so they're visible.
    let d = "";
    c.values.forEach((v, k) => { if (v == null) return; d += (k > 0 && c.values[k - 1] != null ? "L" : "M") + x(k) + " " + y(v); });
    el("path", { d, fill: "none", stroke: css(c.color), "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    c.values.forEach((v, k) => {
      if (v == null) return;
      const isolated = (k === 0 || c.values[k - 1] == null) && (k === n - 1 || c.values[k + 1] == null);
      const last = c.values.slice(k + 1).every((u) => u == null);
      if (isolated || last) el("circle", { cx: x(k), cy: y(v), r: 4, fill: css(c.color), stroke: css("--surface"), "stroke-width": 2 }, svg);
    });
    const lastK = c.values.map((v, k) => (v == null ? -1 : k)).filter((k) => k >= 0).pop();
    el("text", { x: Math.min(x(lastK), W - R), y: y(c.values[lastK]) - 9, "text-anchor": "end", "font-size": 12, "font-weight": 600, fill: css("--ink") }, svg).textContent = fmt(c.values[lastK]);

    // Hover layer: crosshair snaps to the nearest day.
    const cross = el("line", { y1: T, y2: H - B, stroke: css("--axis"), "stroke-width": 1, visibility: "hidden" }, svg);
    const dot = el("circle", { r: 4, fill: css(c.color), stroke: css("--surface"), "stroke-width": 2, visibility: "hidden" }, svg);
    const tip = document.createElement("div"); tip.className = "tip"; host.appendChild(tip);
    let cur = lastK;
    function show(k) {
      cur = Math.max(0, Math.min(n - 1, k));
      const v = c.values[cur];
      cross.setAttribute("x1", x(cur)); cross.setAttribute("x2", x(cur)); cross.setAttribute("visibility", "visible");
      if (v != null) { dot.setAttribute("cx", x(cur)); dot.setAttribute("cy", y(v)); dot.setAttribute("visibility", "visible"); } else dot.setAttribute("visibility", "hidden");
      tip.replaceChildren();
      const strong = document.createElement("strong"); strong.textContent = v == null ? "not logged" : fmt(v) + (c.unit === "time" ? "" : " " + c.unit);
      const sub = document.createElement("span"); sub.className = "muted"; sub.textContent = data.labels[cur];
      tip.append(strong, sub); tip.style.display = "block";
      const right = x(cur) + 10 + tip.offsetWidth <= W;
      tip.style.left = (right ? x(cur) + 10 : x(cur) - 10 - tip.offsetWidth) + "px"; tip.style.top = T + "px";
    }
    function hide() { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.style.display = "none"; }
    host.onpointermove = (e) => { const r = host.getBoundingClientRect(); show(Math.round(((e.clientX - r.left - L) / (W - L - R)) * (n - 1))); };
    host.onpointerleave = hide;
    host.onfocus = () => show(cur);
    host.onblur = hide;
    host.onkeydown = (e) => { if (e.key === "ArrowLeft") { show(cur - 1); e.preventDefault(); } if (e.key === "ArrowRight") { show(cur + 1); e.preventDefault(); } };
  }
  const render = () => document.querySelectorAll("[data-chart]").forEach((h) => draw(h, data.charts[h.dataset.chart]));
  render();
  let t; addEventListener("resize", () => { clearTimeout(t); t = setTimeout(render, 150); });
})();
`;
