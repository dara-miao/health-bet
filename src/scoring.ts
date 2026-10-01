// Pure scoring rules, kept separate so they're easy to read and test.
//
// Each day, each player can earn up to 3 points:
//   +1 calories: cut  -> at or under calorie_target (but not under the cut floor)
//                bulk -> at or over calorie_target
//   +1 protein:  at or over protein_target
//   +1 sleep:    slept at least the sleep target that night
// Food points need at least one logged entry that day, so not logging isn't a free "cut" win.
// Fat and carbs are tracked and shown but don't score.
// Lowest weekly total loses; ties are broken by total sleep, then it's a draw.

export type GoalType = "cut" | "bulk";

export interface Goal {
  goal_type: GoalType | null;
  calorie_target: number | null;
  protein_target: number | null;
}

export interface Rules {
  sleepTargetMinutes: number;
  cutFloorCalories: number;
}

export interface DayStats {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  foodCount: number;
  sleepMinutes: number | null;
}

export const EMPTY_DAY: DayStats = { calories: 0, protein: 0, fat: 0, carbs: 0, foodCount: 0, sleepMinutes: null };

export interface DayScore {
  calOk: boolean;
  proteinOk: boolean;
  sleepOk: boolean;
  points: number;
}

export function calorieGoalMet(goal: Goal, stats: DayStats, rules: Rules): boolean {
  if (stats.foodCount === 0 || goal.goal_type == null || goal.calorie_target == null) return false;
  return goal.goal_type === "cut"
    ? stats.calories <= goal.calorie_target && stats.calories >= rules.cutFloorCalories
    : stats.calories >= goal.calorie_target;
}

export function proteinGoalMet(goal: Goal, stats: DayStats): boolean {
  if (stats.foodCount === 0 || goal.protein_target == null) return false;
  return stats.protein >= goal.protein_target;
}

export function sleepGoalMet(stats: DayStats, rules: Rules): boolean {
  return stats.sleepMinutes != null && stats.sleepMinutes >= rules.sleepTargetMinutes;
}

export function scoreDay(goal: Goal, stats: DayStats, rules: Rules): DayScore {
  const calOk = calorieGoalMet(goal, stats, rules);
  const proteinOk = proteinGoalMet(goal, stats);
  const sleepOk = sleepGoalMet(stats, rules);
  return { calOk, proteinOk, sleepOk, points: +calOk + +proteinOk + +sleepOk };
}

export interface WeekTotals {
  points: number;
  sleepMinutes: number;
}

/** Index of the loser, or null for a draw (or fewer than two players). */
export function weekLoser(totals: WeekTotals[]): number | null {
  if (totals.length < 2) return null;
  const order = totals
    .map((t, i) => ({ ...t, i }))
    .sort((a, b) => a.points - b.points || a.sleepMinutes - b.sleepMinutes);
  const [last, next] = order;
  if (last.points === next.points && last.sleepMinutes === next.sleepMinutes) return null;
  return last.i;
}
