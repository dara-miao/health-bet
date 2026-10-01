import { describe, expect, it } from "vitest";
import { scoreDay, weekLoser, type DayStats, type Goal, type Rules } from "../src/scoring";

const rules: Rules = { sleepTargetMinutes: 420, cutFloorCalories: 1200 };
const cutter: Goal = { goal_type: "cut", calorie_target: 1700, protein_target: 120 };
const bulker: Goal = { goal_type: "bulk", calorie_target: 3200, protein_target: 150 };
const day = (calories: number, protein: number, sleepMinutes: number | null, foodCount = 3): DayStats => ({
  calories, protein, fat: 0, carbs: 0, sleepMinutes, foodCount,
});

describe("scoreDay", () => {
  it("cut wins calories by staying under, bulk by going over", () => {
    expect(scoreDay(cutter, day(1650, 125, 430), rules)).toEqual({ calOk: true, proteinOk: true, sleepOk: true, points: 3 });
    expect(scoreDay(bulker, day(3300, 140, 400), rules)).toEqual({ calOk: true, proteinOk: false, sleepOk: false, points: 1 });
  });
  it("the target itself counts as hitting it", () => {
    expect(scoreDay(cutter, day(1700, 120, 420), rules).points).toBe(3);
    expect(scoreDay(bulker, day(3200, 150, 420), rules).points).toBe(3);
  });
  it("Dara's Sep 30 scores 1 of 3 at 1,700 / 120g", () => {
    expect(scoreDay(cutter, day(2085, 125, 360), rules)).toEqual({ calOk: false, proteinOk: true, sleepOk: false, points: 1 });
  });
  it("a cut day under the floor never earns the calorie point", () => {
    expect(scoreDay(cutter, day(1100, 120, null), rules).calOk).toBe(false);
    expect(scoreDay(cutter, day(1200, 120, null), rules).calOk).toBe(true);
  });
  it("logging nothing is not a free cut win", () => {
    expect(scoreDay(cutter, day(0, 0, 450, 0), rules)).toEqual({ calOk: false, proteinOk: false, sleepOk: true, points: 1 });
  });
  it("sleep is a target, so both players can earn it", () => {
    expect(scoreDay(cutter, day(0, 0, 420, 0), rules).sleepOk).toBe(true);
    expect(scoreDay(bulker, day(0, 0, 500, 0), rules).sleepOk).toBe(true);
    expect(scoreDay(bulker, day(0, 0, 419, 0), rules).sleepOk).toBe(false);
    expect(scoreDay(bulker, day(0, 0, null, 0), rules).sleepOk).toBe(false);
  });
  it("no goal set means no food points", () => {
    const none: Goal = { goal_type: null, calorie_target: null, protein_target: null };
    expect(scoreDay(none, day(1000, 200, null), rules).points).toBe(0);
  });
});

describe("weekLoser", () => {
  it("lowest points loses", () => {
    expect(weekLoser([{ points: 12, sleepMinutes: 0 }, { points: 9, sleepMinutes: 9999 }])).toBe(1);
  });
  it("breaks ties on total sleep", () => {
    expect(weekLoser([{ points: 10, sleepMinutes: 3000 }, { points: 10, sleepMinutes: 3100 }])).toBe(0);
  });
  it("full tie is a draw", () => {
    expect(weekLoser([{ points: 10, sleepMinutes: 3000 }, { points: 10, sleepMinutes: 3000 }])).toBeNull();
  });
});
