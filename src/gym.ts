// Gym consistency: a GitHub-style grid and a weekly streak. Not part of the score.
import { addDays, weekStart } from "./time";

export type WorkoutKind = "gym" | "sport" | "run";
export const WORKOUT_KINDS: WorkoutKind[] = ["gym", "sport", "run"];

export interface Workout {
  day: string;
  kind: WorkoutKind;
  note: string | null;
}

/** Workouts in the Monday-to-Sunday week containing `day`. */
export function weekCount(days: Set<string>, day: string): number {
  const start = weekStart(day);
  let n = 0;
  for (let i = 0; i < 7; i++) if (days.has(addDays(start, i))) n++;
  return n;
}

/**
 * Consecutive weeks that hit the target, ending with the current week if it's already hit,
 * otherwise with last week (the current week is still in progress, so it can't break a streak).
 * Weeks before the week of `from` don't count.
 */
export function weekStreak(days: Set<string>, target: number | null, from: string, today: string): number {
  if (!target) return 0;
  const first = weekStart(from);
  let week = weekStart(today);
  if (weekCount(days, week) < target) week = addDays(week, -7);
  let streak = 0;
  while (week >= first && weekCount(days, week) >= target) {
    streak++;
    week = addDays(week, -7);
  }
  return streak;
}
