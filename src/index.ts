import * as db from "./db";
import type { Env } from "./db";
import { betStart, dayRecap, eveningNudge, weekVerdict } from "./game";
import { handleMcp } from "./mcp";
import { sendToPoke } from "./poke";
import { addDays, gameDay, localParts, weekStart } from "./time";
import { ICON_PNG_180, ICON_PNG_512, ICON_PNG_64, ICON_SVG, MANIFEST } from "./icons";
import { boardPage, historyPage, joinPage, joinSuccess, lockedPage, meLoginPage, privatePage } from "./web";

const RECAP_HOUR = 10; // daily recap (and Monday's weekly verdict) goes out at 10am
const NUDGE_HOUR = 21; // evening check-in at 9pm

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/mcp") return handleMcp(request, env);

    const cached = (body: BodyInit, type: string) =>
      new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
    const png = (b64: string) => cached(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), "image/png");
    if (path === "/favicon.svg") return cached(ICON_SVG, "image/svg+xml");
    if (path === "/favicon.ico") return png(ICON_PNG_64);
    if (path === "/apple-touch-icon.png" || path === "/apple-touch-icon-precomposed.png") return png(ICON_PNG_180);
    if (path === "/icon-512.png") return png(ICON_PNG_512);
    if (path === "/manifest.webmanifest") return cached(MANIFEST, "application/manifest+json");

    if (path === "/join") {
      if (request.method === "POST") return handleJoin(request, env);
      // A failed join redirects here with a one-time flash cookie, so a refresh clears the error.
      const flash = readCookie(request, FLASH);
      const res = flash ? joinPage(flash.error, flash.name) : joinPage();
      if (flash) res.headers.append("set-cookie", clearCookie(FLASH));
      return res;
    }

    if (path === "/join/done") {
      // The new key is shown once; refreshing doesn't re-submit the form or rotate the key.
      const done = readCookie(request, DONE);
      if (!done) return Response.redirect(`${url.origin}/join`, 303);
      const res = joinSuccess(url.origin, done.name, done.apiKey, done.meToken, done.hasPoke);
      res.headers.append("set-cookie", clearCookie(DONE));
      res.headers.append("set-cookie", rememberCookie(done.meToken));
      return res;
    }

    if (path === "/unlock" && request.method === "POST") {
      const form = await request.formData();
      const next = String(form.get("next") ?? "/") === "/history" ? "/history" : "/";
      const code = await joinCode(env);
      if (!code || String(form.get("code") ?? "").trim() !== code) {
        return redirect(next, setCookie(FLASH, { error: "That's not the password." }, 60, "/"));
      }
      return redirect(next, `${GATE}=${await gateValue(code)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
    }

    if (path === "/" || path === "/history") {
      // Password-protected: the join code, remembered on this phone for a year.
      if (!(await unlocked(request, env))) {
        const flash = readCookie(request, FLASH);
        const res = lockedPage(path, flash?.error ?? "");
        if (flash) res.headers.append("set-cookie", clearCookie(FLASH, "/"));
        return res;
      }
      if (path === "/") return boardPage(env, new Date());
      const days = [14, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
      return historyPage(env, new Date(), days);
    }
    // Old secret scoreboard links still work.
    const old = path.match(/^\/b\/[\w-]+(\/history)?$/);
    if (old) return Response.redirect(`${url.origin}${old[1] ? "/history" : "/"}`, 301);

    if (path === "/me") {
      // "My page": straight to this phone's page if we know it, otherwise sign in once with the personal key.
      if (request.method === "POST") {
        const key = String((await request.formData()).get("key") ?? "").trim();
        const player = key ? await db.playerByKey(env.DB, key) : null;
        if (!player) return redirect("/me", setCookie(FLASH, { error: "That key doesn't match anyone. Check it and try again." }, 60, "/me"));
        const token = await db.privateToken(env.DB, player.id);
        return redirect(`/me/${token}`, rememberCookie(token));
      }
      const token = await rememberedMe(request, env);
      if (token) return Response.redirect(`${url.origin}/me/${token}`, 303);
      const flash = readCookie(request, FLASH);
      const res = meLoginPage(flash?.error ?? "");
      if (flash) res.headers.append("set-cookie", clearCookie(FLASH, "/me"));
      return res;
    }

    const me = path.match(/^\/me\/([\w-]+)(\/share)?$/);
    if (me) {
      const player = await db.playerByPrivateToken(env.DB, me[1]);
      if (!player) return new Response("Not found", { status: 404 });
      if (me[2] && request.method === "POST") {
        const form = await request.formData();
        const shared = form.get("shared") === "1";
        const day = String(form.get("day") ?? "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) await db.setDayShared(env.DB, player.id, day, shared, new Date().toISOString());
        else await db.setMealShared(env.DB, player.id, Number(form.get("meal")), shared, new Date().toISOString());
        return new Response(null, { status: 303, headers: { location: `/me/${me[1]}` } });
      }
      const page = await privatePage(env, player, me[1], new Date());
      // Remember this phone's private page so "My page" goes straight there.
      page.headers.append("set-cookie", rememberCookie(me[1]));
      return page;
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSchedule(env, new Date()));
  },
};

function randomToken(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ME = "hb_me";

/** The private page this browser opened before, if it still belongs to a player. */
async function rememberedMe(request: Request, env: Env): Promise<string | undefined> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)hb_me=([\w-]+)/)?.[1];
  if (!token) return undefined;
  return (await db.playerByPrivateToken(env.DB, token)) ? token : undefined;
}

const GATE = "hb_in";

/** The JOIN_CODE secret wins; otherwise the code saved in the database's settings. */
async function joinCode(env: Env): Promise<string | undefined> {
  return env.JOIN_CODE?.trim() || (await db.getSetting(env.DB, "join_code"))?.trim() || undefined;
}

/** What the "unlocked" cookie holds. Changing the join code locks every phone out again. */
async function gateValue(code: string): Promise<string> {
  return db.sha256(`health-bet-gate:${code}`);
}

async function unlocked(request: Request, env: Env): Promise<boolean> {
  if (await rememberedMe(request, env)) return true; // a phone that opened its own page is a player's phone
  const code = await joinCode(env);
  const got = request.headers.get("cookie")?.match(/(?:^|;\s*)hb_in=([0-9a-f]+)/)?.[1];
  return Boolean(code && got && got === (await gateValue(code)));
}

const FLASH = "hb_join_error";
const DONE = "hb_join_done";

function setCookie(name: string, value: unknown, maxAge: number, path = "/join"): string {
  const v = btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  return `${name}=${v}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name: string, path = "/join"): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function rememberCookie(token: string): string {
  return `${ME}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): any {
  const raw = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch {
    return null;
  }
}

function redirect(location: string, cookie: string): Response {
  return new Response(null, { status: 303, headers: { location, "set-cookie": cookie } });
}

async function handleJoin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  const poke = String(form.get("poke") ?? "").trim() || null;
  const color = form.get("color") === "green" ? "green" : form.get("color") === "pink" ? "pink" : null;
  const fail = (error: string) => redirect("/join", setCookie(FLASH, { error, name }, 60));
  const expected = await joinCode(env);
  if (!expected) return fail("This app doesn't have a join code set up yet.");
  if (code !== expected) return fail("That join code isn't right.");
  if (!name) return fail("Enter your name.");

  const apiKey = `hb_${randomToken(24)}`;
  const meToken = randomToken(18);
  await db.joinPlayer(env.DB, name, await db.sha256(apiKey), meToken, poke, color);

  const player = (await db.listPlayers(env.DB)).find((p) => p.name.toLowerCase() === name.toLowerCase())!;
  return redirect("/join/done", setCookie(DONE, { name: player.name, apiKey, meToken, hasPoke: Boolean(player.poke_api_key) }, 600));
}

// ---------- scheduled messages through Poke ----------

async function notifyAll(env: Env, text: string) {
  for (const p of await db.listPlayers(env.DB)) {
    if (p.poke_api_key) await sendToPoke(env, p.poke_api_key, text).catch((err) => console.error("poke send failed", p.name, err));
  }
}

export async function runSchedule(env: Env, now: Date) {
  const { hour, weekday } = localParts(now, env.GAME_TZ);
  const today = gameDay(now, env.GAME_TZ);

  if (hour === RECAP_HOUR) {
    const yesterday = addDays(today, -1);
    const start = (await betStart(env)) ?? "";
    if (yesterday >= start && (await db.firstTime(env.DB, `recap:${yesterday}`))) await notifyAll(env, await dayRecap(env, yesterday));
    // Monday morning: the week that just ended is the one containing yesterday (Sunday).
    if (weekday === 1) {
      const lastWeek = weekStart(yesterday);
      if (yesterday >= start && (await db.firstTime(env.DB, `verdict:${lastWeek}`))) await notifyAll(env, await weekVerdict(env, lastWeek));
    }
  }

  if (hour === NUDGE_HOUR && (await db.firstTime(env.DB, `nudge:${today}`))) {
    for (const p of await db.listPlayers(env.DB)) {
      if (!p.poke_api_key || !p.goal_type) continue;
      await sendToPoke(env, p.poke_api_key, await eveningNudge(env, p, today)).catch((err) =>
        console.error("poke send failed", p.name, err),
      );
    }
  }
}
