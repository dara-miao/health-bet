import { describe, expect, it } from "vitest";
import { isPublic, statusLines } from "../src/game";
import type { Env, Player } from "../src/db";

const env = { GAME_TZ: "America/Los_Angeles", SLEEP_TARGET_HOURS: "7", CUT_FLOOR_CALORIES: "1200", POST_DELAY_MINUTES: "30" } as Env;
const dara: Player = {
  id: 1, name: "Dara", poke_api_key: null, goal_type: "cut", calorie_target: 1700, protein_target: 120,
  fat_target: 45, goal_weight_lb: 120, pending_bed_at: null,
};
const stats = (calories: number) => ({ calories, protein: 50, fat: 20, carbs: 100, foodCount: 2, sleepMinutes: null });

describe("isPublic", () => {
  const now = new Date("2026-09-30T20:00:00Z");
  it("stays private until 30 minutes after the last edit", () => {
    expect(isPublic(env, { posted_at: null, updated_at: "2026-09-30T19:31:00Z" }, now)).toBe(false);
    expect(isPublic(env, { posted_at: null, updated_at: "2026-09-30T19:30:00Z" }, now)).toBe(true);
  });
  it("posts right away once posted_at is set", () => {
    expect(isPublic(env, { posted_at: "2026-09-30T19:59:00Z", updated_at: "2026-09-30T19:59:00Z" }, now)).toBe(true);
  });
});

describe("statusLines", () => {
  it("doesn't mark a cut day under the floor as failed while it's still going", () => {
    expect(statusLines(env, dara, stats(458))[0]).toBe("🔥 458 / ≤1,700 cal (1,242 left)");
  });
  it("does in the final recap", () => {
    expect(statusLines(env, dara, stats(900), true)[0]).toBe("🔥 900 / ≤1,700 cal ❌ (under the 1,200 floor)");
  });
  it("flags low fat", () => {
    expect(statusLines(env, dara, stats(1500))[2]).toContain("20g / 45g fat (low)");
  });
});
