import { describe, expect, it } from "vitest";
import { goalLine, statusLines, wakeLine } from "../src/game";
import type { Env, Player } from "../src/db";

const env = {
  GAME_TZ: "America/Los_Angeles", SLEEP_TARGET_HOURS: "7", CUT_FLOOR_CALORIES: "1200",
  WAKE_WEEKDAY: "08:30", WAKE_WEEKEND: "10:30", WAKE_GRACE_MINUTES: "10",
} as Env;
const dara: Player = {
  id: 1, name: "Dara", poke_api_key: null, goal_type: "cut", calorie_target: 1700, protein_target: 120,
  fat_target: 45, goal_weight_lb: 120, pending_bed_at: null,
};
const stats = (calories: number) => ({ calories, protein: 50, fat: 20, carbs: 100, foodCount: 2, sleepMinutes: null, wakeAt: null });

describe("statusLines", () => {
  it("doesn't mark a cut day under the floor as failed while it's still going", () => {
    expect(statusLines(env, dara, stats(458), "2026-09-30")[0]).toBe("🔥 458 / ≤1,700 cal (1,242 left)");
  });
  it("does in the final recap", () => {
    expect(statusLines(env, dara, stats(900), "2026-09-30", { final: true })[0]).toBe("🔥 900 / ≤1,700 cal ❌ (under the 1,200 floor)");
  });
  it("hides fat and carbs from other players", () => {
    const lines = statusLines(env, dara, stats(1500), "2026-09-30", { shared: true }).join("\n");
    expect(lines).not.toMatch(/fat|carbs/);
    expect(goalLine(dara, true)).not.toMatch(/fat/);
    expect(goalLine(dara)).toMatch(/fat at least 45g/);
  });
  it("flags low fat", () => {
    expect(statusLines(env, dara, stats(1500), "2026-09-30")[2]).toContain("20g / 45g fat (low)");
  });
});

describe("wakeLine", () => {
  it("shows on time, late, and missing", () => {
    expect(wakeLine(env, "2026-09-30", "2026-09-30T15:22:00Z")).toBe("⏰ up at 8:22 AM ✅");
    expect(wakeLine(env, "2026-09-30", "2026-09-30T16:05:00Z")).toBe("⏰ up at 9:05 AM ❌ (35 min late; up by 8:30 AM, 10 min grace)");
    expect(wakeLine(env, "2026-10-03", null)).toBe("⏰ no wake-up logged (up by 10:30 AM, 10 min grace)");
  });
});
