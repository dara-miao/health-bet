// A minimal MCP server (Streamable HTTP transport, JSON responses, stateless).
// Each player's agent (e.g. Poke) connects with its own API key as a Bearer token,
// so every tool call already knows who is logging.
import * as db from "./db";
import type { Env, FoodItem, Player } from "./db";
import { UserError, goToBed, goalLine, logNight, mealTotals, statusReport, totalsLine, wakeUp } from "./game";
import { addDays, formatOffset, gameDay, parseTime, utcOffsetMinutes } from "./time";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `This is the scorekeeper for a health bet between friends (food and sleep). The person messaging you is a player; log what they tell you.

Each day a player earns 1 point for their calorie goal (cut: stay at or under; bulk: reach at least), 1 for their protein goal, 1 for sleeping at least the sleep target, and 1 for getting up by the wake-up time (get_status shows it). Fat and carbs are tracked and shown but not scored. Lowest weekly total (Mon to Sun) loses and does the punishment.

Privacy: other players see only points, calorie and protein totals, sleep, and wake-up times. Meals, fat, carbs and weight are private unless the player shares a specific meal. Never reveal another player's private details.

- When they mention food they ate (or send a photo), estimate it and call log_food right away. Don't ask permission first.
- "gn" / "going to bed" means sleep_start. "gm" / "just woke up" means sleep_end. The wake-up time counts for a point, so log it right away; if they say they got up earlier ("up since 8"), pass that time.
- Call get_status before answering questions about progress, and before editing or deleting so you have the right ids.
- Reply like a text message: short, plain text, with their running totals vs goals after each log.`;

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "Short label with the amount, e.g. '1 cup nonfat Greek yogurt'" },
    calories: { type: "number" },
    protein_g: { type: "number" },
    fat_g: { type: "number" },
    carbs_g: { type: "number" },
  },
  required: ["description", "calories", "protein_g", "fat_g", "carbs_g"],
};

function tools() {
  return [
  {
    name: "log_food",
    description: `Log food the player ate, with your estimates of calories and macros for each item.
Estimating: use typical US portions unless they give amounts, and official nutrition facts for named chains and packaged products. Don't lowball: count cooking oil, butter, sauces, and dressings. Split a meal into its separate foods so each can be corrected later. If something is vague, log your best guess and say what you assumed.
Meals: leave meal_id null to start a new meal. Pass an existing meal_id (from get_status) when they're adding to something they just logged ("also had guac with that"). Meals are private: other players see only daily calorie and protein totals, unless the player asks to share a meal (share_meal).`,
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: ITEM_SCHEMA, minItems: 1 },
        meal_id: { type: ["integer", "null"], description: "Add to this existing meal instead of starting a new one." },
        meal_name: { type: ["string", "null"], description: "Optional label, e.g. 'Breakfast' or 'Chipotle bowl'." },
        day: { type: ["string", "null"], description: "YYYY-MM-DD to backdate (e.g. 'yesterday I forgot...'). Null for today." },
      },
      required: ["items"],
    },
  },
  {
    name: "edit_food",
    description: "Replace one logged food item with corrected values (e.g. 'actually it was 3 eggs'). Get the item id from get_status.",
    inputSchema: {
      type: "object",
      properties: { item_id: { type: "integer" }, ...ITEM_SCHEMA.properties },
      required: ["item_id", ...ITEM_SCHEMA.required],
    },
  },
  {
    name: "delete_food",
    description: "Delete logged food items by id (from get_status).",
    inputSchema: {
      type: "object",
      properties: { item_ids: { type: "array", items: { type: "integer" }, minItems: 1 } },
      required: ["item_ids"],
    },
  },
  {
    name: "share_meal",
    description:
      "Share the player's meals with the other players (they'll see the foods, calories and protein on the scoreboard), or unshare them. Only when the player asks: 'share my dinner with Mal' (one meal_id) or 'share all my meals today' (all_day).",
    inputSchema: {
      type: "object",
      properties: {
        meal_id: { type: ["integer", "null"], description: "One meal. Null when using all_day." },
        all_day: { type: ["string", "null"], description: "YYYY-MM-DD to share every meal from that day (today's date from get_status for 'all my meals')." },
        shared: { type: "boolean", description: "false to unshare" },
      },
      required: ["shared"],
    },
  },
  {
    name: "sleep_start",
    description: "They're going to sleep. Leave 'at' null for now.",
    inputSchema: {
      type: "object",
      properties: { at: { type: ["string", "null"], description: "ISO 8601 time if not now." } },
    },
  },
  {
    name: "sleep_end",
    description: "They just woke up; records the night since sleep_start and their wake-up time (worth a point if on time). Leave 'at' null for now.",
    inputSchema: {
      type: "object",
      properties: { at: { type: ["string", "null"], description: "ISO 8601 time if not now." } },
    },
  },
  {
    name: "log_sleep",
    description: "Record a whole night after the fact, e.g. 'slept 1am to 7am'. Use the date/offset from get_status.",
    inputSchema: {
      type: "object",
      properties: {
        bed_at: { type: "string", description: "ISO 8601" },
        wake_at: { type: "string", description: "ISO 8601" },
      },
      required: ["bed_at", "wake_at"],
    },
  },
  {
    name: "get_status",
    description:
      "The current time, the player's goals and totals for today, today's and yesterday's meals with ids, everyone's progress, this week's points, and the punishment.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_goal",
    description: "Set the player's daily goal. Only when they ask to change it.",
    inputSchema: {
      type: "object",
      properties: {
        goal_type: { type: "string", enum: ["cut", "bulk"] },
        calorie_target: { type: "integer", description: "cut: the max; bulk: the min" },
        protein_target: { type: "integer", description: "minimum grams" },
        fat_target: { type: ["integer", "null"], description: "minimum grams, shown but not scored" },
      },
      required: ["goal_type", "calorie_target", "protein_target"],
    },
  },
  {
    name: "log_weight",
    description: "Record a weigh-in in pounds. Optionally set a goal weight.",
    inputSchema: {
      type: "object",
      properties: {
        lb: { type: "number" },
        goal_weight_lb: { type: ["number", "null"], description: "Only if they mention a new goal weight." },
      },
      required: ["lb"],
    },
  },
  {
    name: "set_punishment",
    description: "Set what this week's loser has to do. Shared by everyone.",
    inputSchema: { type: "object", properties: { punishment: { type: "string" } }, required: ["punishment"] },
  },
];
}

type Args = Record<string, any>;

const ToolError = UserError;

function time(env: Env, iso: unknown, now: Date): Date {
  if (iso == null || iso === "") return now;
  const t = typeof iso === "string" ? parseTime(iso, env.GAME_TZ) : null;
  if (!t) throw new ToolError(`Couldn't read the time "${iso}". Use ISO 8601, e.g. 2026-10-01T23:30-07:00.`);
  return t;
}

function items(raw: unknown): FoodItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolError("items must be a non-empty list.");
  return raw.map((it) => {
    const nums = ["calories", "protein_g", "fat_g", "carbs_g"].map((k) => Number(it?.[k]));
    if (typeof it?.description !== "string" || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 10000)) {
      throw new ToolError("Each item needs a description and non-negative calories, protein_g, fat_g, carbs_g.");
    }
    const [calories, protein_g, fat_g, carbs_g] = nums;
    return { description: it.description.slice(0, 200), calories, protein_g, fat_g, carbs_g };
  });
}

async function callTool(env: Env, player: Player, name: string, args: Args, now: Date, origin: string): Promise<string> {
  const today = gameDay(now, env.GAME_TZ);
  switch (name) {
    case "get_status":
      return statusReport(env, player, now, formatOffset(utcOffsetMinutes(now, env.GAME_TZ)), `${origin}/me/${await db.privateToken(env.DB, player.id)}`);

    case "log_food": {
      const food = items(args.items);
      let mealId: number;
      let day: string;
      if (args.meal_id != null) {
        const meal = await db.getMeal(env.DB, player.id, Number(args.meal_id));
        if (!meal) throw new ToolError(`No meal ${args.meal_id} for ${player.name}. Call get_status for ids.`);
        mealId = meal.id;
        day = meal.day;
      } else {
        day = args.day ?? today;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < addDays(today, -7)) {
          throw new ToolError("day must be YYYY-MM-DD, today or within the past week.");
        }
        // Agents often send the UTC date, which runs ahead of the game day at night. Never refuse a meal for that.
        if (day > today) day = today;
        mealId = await db.createMeal(env.DB, player.id, day, args.meal_name ?? null);
      }
      const added = await db.addFood(env.DB, player.id, mealId, day, food);
      const t = mealTotals({ items: added } as any);
      return [
        `Logged to meal ${mealId} (${day}):`,
        ...added.map((e) => `  item ${e.id}: ${e.description}: ${e.calories} cal, ${e.protein_g}g P, ${e.fat_g}g F, ${e.carbs_g}g C`),
        `  Added: ${t.calories} cal, ${t.protein}g protein, ${t.fat}g fat, ${t.carbs}g carbs`,
        await totalsLine(env, player, day),
      ].join("\n");
    }

    case "edit_food": {
      const [item] = items([args]);
      const updated = await db.updateFood(env.DB, player.id, Number(args.item_id), item);
      if (!updated) throw new ToolError(`No item ${args.item_id} for ${player.name}. Call get_status for ids.`);
      return `Updated item ${updated.id}: ${updated.description}: ${updated.calories} cal, ${updated.protein_g}g P, ${updated.fat_g}g F, ${updated.carbs_g}g C\n${await totalsLine(env, player, updated.day)}`;
    }

    case "delete_food": {
      const ids = Array.isArray(args.item_ids) ? args.item_ids.map(Number) : [];
      const removed = await db.deleteFood(env.DB, player.id, ids);
      if (removed.length === 0) throw new ToolError("None of those items exist. Call get_status for ids.");
      const days = [...new Set(removed.map((e) => e.day))];
      const totals = await Promise.all(days.map((d) => totalsLine(env, player, d)));
      return `Deleted: ${removed.map((e) => e.description).join("; ")}\n${totals.join("\n")}`;
    }

    case "share_meal": {
      const shared = args.shared !== false;
      if (args.all_day) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(args.all_day)) throw new ToolError("all_day must be YYYY-MM-DD.");
        const n = await db.setDayShared(env.DB, player.id, args.all_day, shared, now.toISOString());
        if (n === 0) throw new ToolError(`${player.name} has no meals logged on ${args.all_day}.`);
        return `${n} meal${n > 1 ? "s" : ""} from ${args.all_day} ${shared ? "shared on the scoreboard" : "made private again"}.`;
      }
      if (args.meal_id == null) throw new ToolError("Pass meal_id for one meal, or all_day for a whole day.");
      if (!(await db.setMealShared(env.DB, player.id, Number(args.meal_id), shared, now.toISOString()))) {
        throw new ToolError(`No meal ${args.meal_id} for ${player.name}. Call get_status for ids.`);
      }
      return shared ? `Meal ${args.meal_id} is now shared on the scoreboard.` : `Meal ${args.meal_id} is private again.`;
    }

    case "sleep_start":
      return goToBed(env, player, time(env, args.at, now));

    case "sleep_end":
      return wakeUp(env, player, time(env, args.at, now));

    case "log_sleep": {
      const result = await logNight(env, player, time(env, args.bed_at, now), time(env, args.wake_at, now));
      if (player.pending_bed_at) await db.setPendingBed(env.DB, player.id, null);
      return result;
    }

    case "set_goal": {
      const goal = {
        goal_type: args.goal_type,
        calorie_target: Math.round(Number(args.calorie_target)),
        protein_target: Math.round(Number(args.protein_target)),
        fat_target: args.fat_target == null ? player.fat_target : Math.round(Number(args.fat_target)),
      };
      if (!["cut", "bulk"].includes(goal.goal_type) || !(goal.calorie_target > 0) || !(goal.protein_target > 0)) {
        throw new ToolError("goal_type must be cut or bulk, with positive calorie and protein targets.");
      }
      await db.setGoal(env.DB, player.id, goal);
      return `Goal set: ${goalLine((await db.getPlayer(env.DB, player.id))!)}.`;
    }

    case "log_weight": {
      const lb = Number(args.lb);
      if (!(lb > 50 && lb < 700)) throw new ToolError("lb should be a weight in pounds.");
      await db.saveWeight(env.DB, player.id, today, lb);
      if (args.goal_weight_lb != null) await db.setGoalWeight(env.DB, player.id, Number(args.goal_weight_lb));
      const goal = args.goal_weight_lb ?? player.goal_weight_lb;
      let note = "";
      if (goal != null && player.goal_type === "cut" && lb <= goal) {
        note = ` That's at or under the ${goal} lb goal. Time to switch to a maintenance target (ask them, then set_goal).`;
      }
      return `Logged ${lb} lb for ${today}.${goal != null ? ` Goal: ${goal} lb.` : ""}${note}`;
    }

    case "set_punishment": {
      const text = String(args.punishment ?? "").trim().slice(0, 300);
      if (!text) throw new ToolError("punishment can't be empty.");
      await db.setSetting(env.DB, "punishment", text);
      return `Punishment for this week's loser: ${text}`;
    }

    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

async function handleRpc(env: Env, player: Player, req: RpcRequest, origin: string): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: req.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code, message } });

  if (req.id === undefined) return null; // notification, e.g. notifications/initialized
  switch (req.method) {
    case "initialize": {
      const asked = req.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "health-bet", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: tools() });
    case "tools/call": {
      const { name, arguments: args } = req.params ?? {};
      try {
        // Re-read the player so goals and pending bedtime are current.
        const fresh = (await db.getPlayer(env.DB, player.id))!;
        const text = await callTool(env, fresh, name, args ?? {}, new Date(), origin);
        return reply({ content: [{ type: "text", text }] });
      } catch (err) {
        if (err instanceof UserError) {
          return reply({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
        }
        console.error("tool failed", name, err);
        return reply({ content: [{ type: "text", text: "Error: something broke on the server. Nothing was saved; try again." }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`);
  }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("This MCP server only supports POST (Streamable HTTP, JSON responses).", {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  const key = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const player = key ? await db.playerByKey(env.DB, key) : null;
  if (!player) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or unknown API key. Get one from the join page." } },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }

  let body: RpcRequest | RpcRequest[];
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const list: RpcRequest[] = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(list.map((r) => handleRpc(env, player, r, new URL(request.url).origin)))).filter(Boolean);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0]);
}
