/**
 * The version-check schedule (feature 003 US5, FR-040 to FR-042; data-model §5). Pure
 * functions over the two settings: `other.versionCheck` (how often the editor checks at
 * start-up) and `session.lastVersionCheck` (ISO 8601 UTC time of the last check that got an
 * answer, manual or automatic; absent until one did).
 *
 * Due at start-up: at every start - always; once a day / once a week - no record, or the
 * record 24 hours / 7 days old or older; once a month - no record, or the record one calendar
 * month old or older: the same day and time of day next month, or the last day of that month
 * when it has no such day (January 31 -> February 28, or 29 in a leap year); never - never. A
 * record later than now (the clock was set back) is treated as a check made now: not due, and
 * `nextRecord` gives the value to record in its place.
 */

import type { VersionCheckSchedule } from '@/rpc/types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The recorded time; null when absent, empty or not a readable timestamp. */
function recordedAt(lastIso: string | undefined): Date | null {
  if (!lastIso) return null;
  const time = Date.parse(lastIso);
  return Number.isNaN(time) ? null : new Date(time);
}

/**
 * The same day and time of day one calendar month after `from` (UTC), or the last day of
 * that month when it is shorter and has no such day.
 */
export function oneMonthAfter(from: Date): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth();
  // Day 0 of the month after next is the last day of next month (Date.UTC carries a month
  // of 12 or 13 into the next year).
  const lastDayOfNextMonth = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month + 1,
      Math.min(from.getUTCDate(), lastDayOfNextMonth),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}

/** Whether the scheduled check is due at `now`, given the recorded last check (if any). */
export function isDue(
  schedule: VersionCheckSchedule,
  lastIso: string | undefined,
  now: Date,
): boolean {
  if (schedule === 'everyStart') return true;
  if (schedule === 'never') return false;
  const last = recordedAt(lastIso);
  if (!last) return true; // no check recorded: the first start checks (FR-040)
  const elapsed = now.getTime() - last.getTime();
  if (elapsed < 0) return false; // clock set back: counts as a check made now (FR-042)
  switch (schedule) {
    case 'daily':
      return elapsed >= DAY_MS;
    case 'weekly':
      return elapsed >= 7 * DAY_MS;
    case 'monthly':
      return now.getTime() >= oneMonthAfter(last).getTime();
  }
}

/**
 * The record to hold at start-up before due-ness is decided: `now` when the recorded time lies
 * in the future (the clock was set back - that check counts as made now, FR-042), otherwise
 * the record as it is (absent stays absent).
 */
export function nextRecord(lastIso: string | undefined, now: Date): string | undefined {
  const last = recordedAt(lastIso);
  if (last && last.getTime() > now.getTime()) return now.toISOString();
  return lastIso;
}
