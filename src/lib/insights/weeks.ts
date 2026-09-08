// ISO week arithmetic for the backfill.
//
// A "week" is Monday..Sunday inclusive, expressed as two YYYY-MM-DD dates and
// sent to Plausible as `period=custom&date=<start>,<end>`.
//
// Caveat worth knowing: Plausible interprets those dates in the *site's*
// configured timezone, not UTC. We store exactly the range we asked for, so
// the data is self-consistent, but don't label these as UTC weeks in the UI.

import type { WeekRange } from "./types";

export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `d`. */
export function weekStartOf(d: Date): Date {
  const out = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const shift = (out.getUTCDay() + 6) % 7;
  out.setUTCDate(out.getUTCDate() - shift);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export function weekRangeFrom(monday: Date): WeekRange {
  return {
    weekStart: toDateString(monday),
    weekEnd: toDateString(addDays(monday, 6)),
  };
}

/**
 * The `count` most recent weeks, newest first, including the current
 * (incomplete) one.
 *
 * Newest-first matters: recent data is the most useful, so a run that gets cut
 * short still leaves something worth looking at.
 */
export function recentWeeks(count: number, now: Date = new Date()): WeekRange[] {
  const current = weekStartOf(now);
  const out: WeekRange[] = [];
  for (let i = 0; i < Math.max(1, count); i += 1) {
    out.push(weekRangeFrom(addDays(current, -7 * i)));
  }
  return out;
}

export function currentWeekStart(now: Date = new Date()): string {
  return toDateString(weekStartOf(now));
}

/** A week is complete once its Sunday is in the past. */
export function isCompleteWeek(week: WeekRange, now: Date = new Date()): boolean {
  return week.weekEnd < toDateString(weekStartOf(now));
}
