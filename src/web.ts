// Server-rendered pages: join, scoreboard, history. No framework; charts are drawn by a
// small inline script from JSON embedded in the page.
import * as db from "./db";
import type { Env, Player } from "./db";
import { dayStats, isPublic, mealTotals, weekBoard } from "./game";
import { EMPTY_DAY, calorieGoalMet, proteinGoalMet, scoreDay, wakeGoalMet, wakeMinutes, wakeTarget, type DayStats } from "./scoring";
import { addDays, gameDay, prettyClock, prettyDay, prettyDuration, prettyTime, weekStart } from "./time";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// Player colors: categorical slots 1 and 2, validated against the dark surface.
const SERIES = ["--series-1", "--series-2"];
const seriesVar = (i: number) => `var(${SERIES[i % SERIES.length]})`;

const CSS = `
/* Always dark, by choice: same look on every phone. */
:root {
  color-scheme: dark;
  --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
  --series-1: #3987e5; --series-2: #d95926;
  --good: #0ca30c; --critical: #e66767;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--page); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 20px 16px 48px; }
a { color: inherit; }
h1 { font-size: 22px; margin: 0; }
h2 { font-size: 16px; margin: 28px 0 10px; }
h3 { font-size: 15px; margin: 0; }
nav { display: flex; gap: 16px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; margin-bottom: 16px; }
nav .links a { color: var(--ink-2); text-decoration: none; margin-left: 14px; }
nav .links a[aria-current] { color: var(--ink); font-weight: 600; text-decoration: underline; text-underline-offset: 4px; }
.card { background: var(--surface); border: 1px solid var(--ring); border-radius: 12px; padding: 16px; }
.muted { color: var(--muted); }
.sub { color: var(--ink-2); }
.hero { display: flex; gap: 12px; flex-wrap: wrap; }
.hero .card { flex: 1 1 200px; }
.hero .pts { font-size: 48px; font-weight: 650; line-height: 1.1; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }
.banner { margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: var(--surface); border: 1px solid var(--ring); }
.players { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.meter { margin: 12px 0 0; }
.meter .row { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
.meter .row .v { font-variant-numeric: tabular-nums; }
.track { position: relative; height: 8px; border-radius: 4px; margin-top: 4px; overflow: hidden; }
.track::before { content: ""; position: absolute; inset: 0; background: var(--c); opacity: 0.16; }
.fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: var(--c); }
.ok { color: var(--good); font-weight: 600; }
.bad { color: var(--critical); font-weight: 600; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--grid); font-size: 14px; white-space: nowrap; }
@media (max-width: 480px) { th, td { padding: 6px 4px; } .wk th.n, .wk td.n { padding: 6px 3px; } }
th { color: var(--ink-2); font-weight: 600; }
td.n, th.n { text-align: right; }
.table-wrap { overflow-x: auto; }
.meal { padding: 12px 0; border-bottom: 1px solid var(--grid); }
.meal:last-child { border-bottom: 0; }
.meal ul { margin: 6px 0 0; padding-left: 18px; color: var(--ink-2); font-size: 14px; }
.chips a { display: inline-block; padding: 4px 12px; border: 1px solid var(--ring); border-radius: 999px; text-decoration: none; color: var(--ink-2); margin-right: 6px; }
.chips a[aria-current] { color: var(--ink); border-color: var(--ink); }
.charts { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.chart { position: relative; height: 190px; outline: none; }
.chart:focus-visible { box-shadow: 0 0 0 2px var(--ink); border-radius: 6px; }
.chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
.chart .empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--muted); font-size: 14px; }
.tip { position: absolute; pointer-events: none; background: var(--surface); border: 1px solid var(--ring); border-radius: 8px;
  padding: 6px 10px; font-size: 13px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); white-space: nowrap; display: none; z-index: 2; }
.tip strong { display: block; font-size: 15px; }
details { margin-top: 10px; }
summary { cursor: pointer; color: var(--ink-2); font-size: 14px; }
form label { display: block; margin: 14px 0 4px; font-weight: 600; }
input { width: 100%; padding: 10px 12px; font: inherit; border-radius: 8px; border: 1px solid var(--axis); background: var(--surface); color: var(--ink); }
button { margin-top: 18px; padding: 10px 18px; font: inherit; font-weight: 600; border-radius: 8px; border: 0; background: var(--ink); color: var(--surface); cursor: pointer; }
code, .key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.key { display: block; padding: 10px 12px; border-radius: 8px; background: var(--page); border: 1px solid var(--ring); word-break: break-all; user-select: all; }
ol li { margin-bottom: 8px; }
.error { color: var(--critical); font-weight: 600; }
`;

function layout(title: string, body: string, script = ""): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>${CSS}</style></head>
<body><main>${body}</main>${script}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function nav(token: string, current: "board" | "history"): string {
  return `<nav><h1>Health Bet</h1><div class="links">
    <a href="/b/${esc(token)}" ${current === "board" ? 'aria-current="page"' : ""}>Scoreboard</a>
    <a href="/b/${esc(token)}/history" ${current === "history" ? 'aria-current="page"' : ""}>History</a></div></nav>`;
}

// ---------- join ----------

export function joinPage(error = "", name = ""): Response {
  return layout(
    "Join the bet",
    `<h1>Join the bet</h1>
    <p class="sub">Get your personal key for connecting Poke. If you've joined before, use the same name to get a new key (the old one stops working).</p>
    <form method="post" class="card">
      ${error ? `<p class="error">${esc(error)}</p>` : ""}
      <label for="code">Join code</label><input id="code" name="code" required autocomplete="off">
      <label for="name">Your name</label><input id="name" name="name" required maxlength="40" value="${esc(name)}">
      <label for="poke">Poke API key <span class="muted">(optional, for recaps by text)</span></label>
      <input id="poke" name="poke" autocomplete="off" placeholder="From Poke's Kitchen → API keys">
      <button type="submit">Get my key</button>
    </form>`,
  );
}

export function joinSuccess(origin: string, name: string, apiKey: string, boardToken: string, hasPoke: boolean): Response {
  const mcpUrl = `${origin}/mcp`;
  return layout(
    "You're in",
    `<h1>You're in, ${esc(name)} 🎉</h1>
    <p class="sub">Save your key now. It's only shown once.</p>
    <div class="card">
      <h3>Your API key</h3><p><span class="key">${esc(apiKey)}</span></p>
      <h3>Connect Poke</h3>
      <ol>
        <li>Open <a href="https://poke.com/integrations/new">poke.com/integrations/new</a>.</li>
        <li>Name: <code>Health Bet</code></li>
        <li>MCP Server URL: <span class="key">${esc(mcpUrl)}</span></li>
        <li>API Key: paste your key from above.</li>
        <li>Text Poke something like <em>"set my goal: cut, 1700 cal, 120g protein, 45g fat"</em>, then log your first meal.</li>
      </ol>
      ${hasPoke ? "" : `<p class="muted">You didn't add a Poke API key, so you won't get the 10am recap and 9pm check-in by text. Come back here with the same name to add one.</p>`}
      <h3>Scoreboard</h3>
      <p>Bookmark this private link and share it only with your friend: <a href="/b/${esc(boardToken)}">${esc(origin)}/b/${esc(boardToken)}</a></p>
    </div>`,
  );
}

// ---------- scoreboard ----------

function meter(label: string, value: string, frac: number, color: string, status: string): string {
  const pct = Math.max(0, Math.min(1, frac)) * 100;
  return `<div class="meter"><div class="row"><span>${label}</span><span class="v">${value} ${status}</span></div>
    <div class="track" style="--c:${color}" role="img" aria-label="${esc(label)} ${esc(value)}"><div class="fill" style="width:${pct.toFixed(1)}%"></div></div></div>`;
}

function playerCard(env: Env, p: Player, i: number, s: DayStats, day: string, todayPts: number, lastNight: number | null): string {
  const r = db.rules(env);
  const color = seriesVar(i);
  const parts: string[] = [];
  if (p.calorie_target != null && p.goal_type) {
    const ok = calorieGoalMet(p, s, r);
    const over = p.goal_type === "cut" && s.calories > p.calorie_target;
    const status =
      s.foodCount === 0 ? "" : ok ? `<span class="ok">✓</span>` : over ? `<span class="bad">▲ ${fmt(s.calories - p.calorie_target)} over</span>` : "";
    const sign = p.goal_type === "cut" ? "≤" : "≥";
    parts.push(meter("Calories", `${fmt(s.calories)} / ${sign}${fmt(p.calorie_target)}`, s.calories / p.calorie_target, over ? "var(--critical)" : color, status));
  }
  if (p.protein_target != null) {
    const ok = proteinGoalMet(p, s);
    parts.push(meter("Protein", `${s.protein}g / ${p.protein_target}g`, s.protein / p.protein_target, color, ok ? `<span class="ok">✓</span>` : ""));
  }
  if (p.fat_target != null) {
    parts.push(meter(`Fat <span class="muted">(not scored)</span>`, `${s.fat}g / ${p.fat_target}g`, s.fat / p.fat_target, color, s.fat >= p.fat_target ? `<span class="ok">✓</span>` : ""));
  } else {
    parts.push(`<div class="meter"><div class="row"><span>Fat <span class="muted">(not scored)</span></span><span class="v">${s.fat}g</span></div></div>`);
  }
  parts.push(`<div class="meter"><div class="row"><span>Carbs <span class="muted">(not scored)</span></span><span class="v">${s.carbs}g</span></div></div>`);
  const sleepOk = lastNight != null && lastNight >= r.sleepTargetMinutes;
  parts.push(
    lastNight != null
      ? meter("Sleep last night", `${prettyDuration(lastNight)} / ${prettyDuration(r.sleepTargetMinutes)}`, lastNight / r.sleepTargetMinutes, color, sleepOk ? `<span class="ok">✓</span>` : "")
      : `<div class="meter"><div class="row"><span>Sleep last night</span><span class="v muted">not logged</span></div></div>`,
  );
  const by = `by ${prettyClock(wakeTarget(day, r))}`;
  const wake = s.wakeAt
    ? `${prettyTime(s.wakeAt, env.GAME_TZ)} ${wakeGoalMet(day, s, r) ? `<span class="ok">✓</span>` : `<span class="bad">${wakeMinutes(s.wakeAt, r.tz) - wakeTarget(day, r)} min late</span>`}`
    : `<span class="muted">not logged</span>`;
  parts.push(`<div class="meter"><div class="row"><span>Up ${by}</span><span class="v">${wake}</span></div></div>`);
  const goal = p.goal_type ? `${p.goal_type}` : "no goal yet";
  return `<div class="card"><div class="row" style="display:flex;justify-content:space-between;align-items:baseline">
      <h3><span class="swatch" style="background:${color}"></span>${esc(p.name)} <span class="muted">· ${goal}</span></h3>
      <span class="sub">${todayPts}/4 today</span></div>${parts.join("")}</div>`;
}

export async function boardPage(env: Env, token: string, now: Date): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const start = weekStart(today);
  const r = db.rules(env);
  const [players, board, punishment] = await Promise.all([
    db.listPlayers(env.DB),
    weekBoard(env, start, today),
    db.getSetting(env.DB, "punishment"),
  ]);
  const stats = await Promise.all(players.map((p) => dayStats(env, p.id, today)));
  const meals = await Promise.all(players.map((p) => db.mealsForDay(env.DB, p.id, today)));

  const hero = board.rows
    .map(
      (row, i) => `<div class="card"><div class="sub"><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(row.player.name)}</div>
        <div class="pts">${row.points}</div><div class="muted">points this week · ${prettyDuration(row.sleepMinutes)} sleep</div></div>`,
    )
    .join("");
  let verdict = "";
  if (board.rows.length >= 2) {
    verdict = board.loser ? `<strong>${esc(board.loser.name)}</strong> is losing right now.` : "Dead even right now.";
  }
  const banner = `<div class="banner">${verdict} ${punishment ? `Loser's punishment: <strong>${esc(punishment)}</strong>` : `<span class="muted">No punishment set yet. Text your agent "set the punishment to ..."</span>`}</div>`;

  const cards = players
    .map((p, i) => playerCard(env, p, i, stats[i], today, scoreDay(p, stats[i], r, today).points, stats[i].sleepMinutes))
    .join("");

  const dayHeads = board.days.map((d) => `<th class="n" title="${prettyDay(d)}">${prettyDay(d).slice(0, 2)}</th>`).join("");
  const weekRows = board.rows
    .map(
      (row, i) => `<tr><td><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(row.player.name)}</td>
        ${row.perDay.map((v) => `<td class="n">${v == null ? '<span class="muted">·</span>' : v}</td>`).join("")}<td class="n"><strong>${row.points}</strong></td></tr>`,
    )
    .join("");

  const feed = players
    .flatMap((p, i) => meals[i].filter((m) => isPublic(env, m, now)).map((m) => ({ p, i, m })))
    .sort((a, b) => (b.m.posted_at ?? b.m.updated_at).localeCompare(a.m.posted_at ?? a.m.updated_at))
    .map(({ p, i, m }) => {
      const t = mealTotals(m);
      return `<div class="meal"><div><span class="swatch" style="background:${seriesVar(i)}"></span><strong>${esc(p.name)}</strong>
        ${m.name ? `· ${esc(m.name)}` : ""} <span class="muted">· ${prettyTime(m.posted_at ?? m.updated_at, env.GAME_TZ)}</span></div>
        <div class="sub" style="font-variant-numeric:tabular-nums">${fmt(t.calories)} cal · ${t.protein}g protein · ${t.fat}g fat · ${t.carbs}g carbs</div>
        <ul>${m.items.map((it) => `<li>${esc(it.description)} <span class="muted">(${it.calories} cal, ${it.protein_g}g P)</span></li>`).join("")}</ul></div>`;
    });
  const pending = players
    .map((p, i) => ({ p, n: meals[i].filter((m) => !isPublic(env, m, now)).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${esc(x.p.name)} has ${x.n} meal${x.n > 1 ? "s" : ""} still being edited.`)
    .join(" ");

  return layout(
    "Scoreboard",
    `${nav(token, "board")}
    <p class="sub">Week of ${prettyDay(start)} · ${prettyDay(today)}</p>
    <div class="hero">${hero || '<div class="card">No players yet.</div>'}</div>${banner}
    <h2>Today</h2><div class="players">${cards}</div>
    <h2>This week</h2><div class="card table-wrap"><table class="wk"><thead><tr><th>Player</th>${dayHeads}<th class="n">Total</th></tr></thead><tbody>${weekRows}</tbody></table>
      <p class="muted" style="margin:8px 0 0;font-size:13px">1 point each for calories, protein, ${prettyDuration(r.sleepTargetMinutes)}+ sleep, and being up by ${prettyClock(r.wakeWeekday)} (weekends ${prettyClock(r.wakeWeekend)}, ${r.wakeGraceMinutes} min grace). Lowest weekly total loses.</p></div>
    <h2>Meals today</h2><div class="card">${feed.join("") || `<p class="muted" style="margin:0">No posted meals yet. Meals post ${env.POST_DELAY_MINUTES} minutes after their last edit.</p>`}
      ${pending ? `<p class="muted" style="margin:8px 0 0">${pending}</p>` : ""}</div>`,
    `<script>setTimeout(() => location.reload(), 5 * 60 * 1000)</script>`,
  );
}

// ---------- history ----------

export async function historyPage(env: Env, token: string, now: Date, rangeDays: number): Promise<Response> {
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

  // Daily series for charts.
  const from = addDays(today, -(rangeDays - 1));
  const days = Array.from({ length: rangeDays }, (_, k) => addDays(from, k));
  const perPlayer = await Promise.all(
    players.map(async (p, i) => {
      const [stats, weights] = await Promise.all([db.statsForRange(env.DB, p.id, from, today), db.weightsForPlayer(env.DB, p.id)]);
      const s = (d: string) => stats.get(d) ?? EMPTY_DAY;
      const logged = (d: string) => s(d).foodCount > 0;
      const wByDay = new Map(weights.map((w) => [w.day, w.lb]));
      const charts = [
        { title: "Calories", unit: "cal", target: p.calorie_target, targetLabel: p.goal_type === "cut" ? "max" : "min", values: days.map((d) => (logged(d) ? s(d).calories : null)) },
        { title: "Protein", unit: "g", target: p.protein_target, targetLabel: "min", values: days.map((d) => (logged(d) ? s(d).protein : null)) },
        { title: "Fat", unit: "g", target: p.fat_target, targetLabel: "min", values: days.map((d) => (logged(d) ? s(d).fat : null)) },
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
        { title: "Weight", unit: "lb", target: p.goal_weight_lb, targetLabel: "goal", values: days.map((d) => wByDay.get(d) ?? null), zeroBased: false },
      ];
      const streak = (() => {
        let n = 0;
        for (let d = addDays(today, -1); d >= firstDay; d = addDays(d, -1)) {
          if (scoreDay(p, s(d), r, d).points === 4) n++;
          else break;
        }
        return n;
      })();
      // Finished days since this player started tracking.
      const started = days.find((d) => s(d).foodCount > 0 || s(d).sleepMinutes != null);
      const hits = days.filter((d) => started && d >= started && d < today).map((d) => scoreDay(p, s(d), r, d));
      const rate = (k: "calOk" | "proteinOk" | "sleepOk" | "wakeOk") => Math.round((hits.filter((h) => h[k]).length / hits.length) * 100);
      const rates = hits.length ? { n: hits.length, cal: rate("calOk"), protein: rate("proteinOk"), sleep: rate("sleepOk"), wake: rate("wakeOk") } : null;
      return { p, i, charts, streak, rates };
    }),
  );

  const chips = [14, 30, 90]
    .map((n) => `<a href="/b/${esc(token)}/history?days=${n}" ${n === rangeDays ? 'aria-current="true"' : ""}>${n} days</a>`)
    .join("");

  const sections = perPlayer
    .map(({ p, i, charts, streak, rates }) => {
      const chartDivs = charts
        .map(
          (c: any, k) => `<div class="card"><h3>${c.title}${c.target != null ? ` <span class="muted">· ${c.targetLabel} ${fmt(c.target)}${c.unit === "cal" ? "" : c.unit}</span>` : c.note ? ` <span class="muted">· ${c.note}</span>` : ""}</h3>
          <div class="chart" tabindex="0" data-chart="${i}-${k}" aria-label="${esc(p.name)} ${c.title} chart. Use left and right arrows to read values."></div></div>`,
        )
        .join("");
      const tableRows = days
        .map((d, k) => `<tr><td>${prettyDay(d)}</td>${charts.map((c) => `<td class="n">${c.values[k] == null ? "–" : c.unit === "time" ? prettyClock(Math.round(c.values[k]! * 60)) : fmt(c.values[k]!)}</td>`).join("")}</tr>`)
        .reverse()
        .join("");
      return `<h2><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(p.name)}</h2>
        <p class="sub">${rates ? `Goals hit on ${rates.n} finished day${rates.n > 1 ? "s" : ""}: calories ${rates.cal}% · protein ${rates.protein}% · sleep ${rates.sleep}% · up on time ${rates.wake}%` : "Hit rates show up after the first full day."}${streak ? ` · 🔥 ${streak}-day perfect streak` : ""}</p>
        <div class="charts">${chartDivs}</div>
        <details><summary>Show as table</summary><div class="card table-wrap" style="margin-top:8px"><table>
          <thead><tr><th>Day</th>${charts.map((c) => `<th class="n">${c.title}${c.unit === "time" ? "" : ` (${c.unit})`}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div></details>`;
    })
    .join("");

  const data = {
    days,
    labels: days.map(prettyDay),
    charts: Object.fromEntries(perPlayer.flatMap(({ i, charts }) => charts.map((c, k) => [`${i}-${k}`, { ...c, color: SERIES[i % SERIES.length] }]))),
  };

  return layout(
    "History",
    `${nav(token, "history")}
    <div class="chips">${chips}</div>
    <h2>Weekly results</h2>
    <div class="card table-wrap"><table><thead><tr><th>Week of</th>${players.map((p, i) => `<th class="n"><span class="swatch" style="background:${seriesVar(i)}"></span>${esc(p.name)}</th>`).join("")}<th>Result</th></tr></thead>
    <tbody>${weekRows}</tbody></table></div>
    ${sections || '<p class="muted">No players yet.</p>'}`,
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
