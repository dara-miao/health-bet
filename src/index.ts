import * as db from "./db";
import type { Env } from "./db";
import { dayRecap, eveningNudge, weekVerdict } from "./game";
import { handleMcp } from "./mcp";
import { sendToPoke } from "./poke";
import { addDays, gameDay, localParts, weekStart } from "./time";
import { boardPage, historyPage, joinPage, joinSuccess, privatePage } from "./web";

const RECAP_HOUR = 10; // daily recap (and Monday's weekly verdict) goes out at 10am
const NUDGE_HOUR = 21; // evening check-in at 9pm

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/mcp") return handleMcp(request, env);

    if (path === "/join") {
      if (request.method === "POST") return handleJoin(request, env, url.origin);
      return joinPage();
    }

    const board = path.match(/^\/b\/([\w-]+)(\/history)?$/);
    if (board) {
      const token = await db.getSetting(env.DB, "board_token");
      if (!token || board[1] !== token) return new Response("Not found", { status: 404 });
      if (board[2]) {
        const days = [14, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30;
        return historyPage(env, token, new Date(), days);
      }
      return boardPage(env, token, new Date());
    }

    const me = path.match(/^\/me\/([\w-]+)(\/share)?$/);
    if (me) {
      const player = await db.playerByPrivateToken(env.DB, me[1]);
      if (!player) return new Response("Not found", { status: 404 });
      if (me[2] && request.method === "POST") {
        const form = await request.formData();
        await db.setMealShared(env.DB, player.id, Number(form.get("meal")), form.get("shared") === "1", new Date().toISOString());
        return new Response(null, { status: 303, headers: { location: `/me/${me[1]}` } });
      }
      return privatePage(env, player, me[1], (await db.getSetting(env.DB, "board_token")) ?? "", new Date());
    }

    if (path === "/") return Response.redirect(`${url.origin}/join`, 302);
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

async function handleJoin(request: Request, env: Env, origin: string): Promise<Response> {
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const name = String(form.get("name") ?? "").trim().slice(0, 40);
  const poke = String(form.get("poke") ?? "").trim() || null;
  if (!env.JOIN_CODE || code !== env.JOIN_CODE) return joinPage("That join code isn't right.", name);
  if (!name) return joinPage("Enter your name.", name);

  const apiKey = `hb_${randomToken(24)}`;
  const meToken = randomToken(18);
  await db.joinPlayer(env.DB, name, await db.sha256(apiKey), meToken, poke);

  let boardToken = await db.getSetting(env.DB, "board_token");
  if (!boardToken) {
    boardToken = randomToken(18);
    await db.setSetting(env.DB, "board_token", boardToken);
  }
  const player = (await db.listPlayers(env.DB)).find((p) => p.name.toLowerCase() === name.toLowerCase())!;
  return joinSuccess(origin, player.name, apiKey, boardToken, meToken, Boolean(player.poke_api_key));
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
    if (await db.firstTime(env.DB, `recap:${yesterday}`)) await notifyAll(env, await dayRecap(env, yesterday));
    // Monday morning: the week that just ended is the one containing yesterday (Sunday).
    if (weekday === 1) {
      const lastWeek = weekStart(yesterday);
      if (await db.firstTime(env.DB, `verdict:${lastWeek}`)) await notifyAll(env, await weekVerdict(env, lastWeek));
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
