/**
 * The version-check schedule (feature 003 US5, FR-040 to FR-042, data-model §5): when a check
 * is due at start-up for each of the five schedules, with no record, at the exact boundaries
 * (24 hours, 7 days, the same day next month - or the last day of that month when it has no
 * such day) and with a record later than now (clock set back), which counts as a check made
 * now: not due, and `nextRecord` clamps it to now.
 */

import { isDue, nextRecord, oneMonthAfter } from '@/features/help/schedule';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function ago(ms: number, from: Date = NOW): string {
  return new Date(from.getTime() - ms).toISOString();
}

describe('version-check schedule: isDue', () => {
  it('"at every start" is always due, with or without a record', () => {
    expect(isDue('everyStart', undefined, NOW)).toBe(true);
    expect(isDue('everyStart', ago(1000), NOW)).toBe(true);
    expect(isDue('everyStart', ago(-DAY), NOW)).toBe(true);
  });

  it('"never" is never due, not even without a record', () => {
    expect(isDue('never', undefined, NOW)).toBe(false);
    expect(isDue('never', ago(400 * DAY), NOW)).toBe(false);
  });

  it('without a record the first start checks (daily, weekly, monthly)', () => {
    expect(isDue('daily', undefined, NOW)).toBe(true);
    expect(isDue('weekly', undefined, NOW)).toBe(true);
    expect(isDue('monthly', undefined, NOW)).toBe(true);
    // An empty or unreadable record counts as none.
    expect(isDue('monthly', '', NOW)).toBe(true);
    expect(isDue('weekly', 'not a date', NOW)).toBe(true);
  });

  it('"once a day": due from 24 hours after the record, not a second before', () => {
    expect(isDue('daily', ago(DAY - 1000), NOW)).toBe(false);
    expect(isDue('daily', ago(DAY), NOW)).toBe(true);
    expect(isDue('daily', ago(DAY + 1000), NOW)).toBe(true);
    expect(isDue('daily', ago(2 * HOUR), NOW)).toBe(false);
  });

  it('"once a week": due from 7 days after the record', () => {
    expect(isDue('weekly', ago(2 * DAY), NOW)).toBe(false);
    expect(isDue('weekly', ago(7 * DAY - 1000), NOW)).toBe(false);
    expect(isDue('weekly', ago(7 * DAY), NOW)).toBe(true);
    expect(isDue('weekly', ago(8 * DAY), NOW)).toBe(true);
  });

  it('"once a month": due from the same day and time next month', () => {
    const last = '2026-09-17T12:00:00.000Z';
    expect(isDue('monthly', last, new Date('2026-10-17T11:59:59.000Z'))).toBe(false);
    expect(isDue('monthly', last, new Date('2026-10-17T12:00:00.000Z'))).toBe(true);
    expect(isDue('monthly', last, new Date('2026-11-01T00:00:00.000Z'))).toBe(true);
    // 29 days later in a 30-day month: not yet a calendar month.
    expect(isDue('monthly', last, new Date('2026-10-16T12:00:00.000Z'))).toBe(false);
    // Across the year end.
    expect(isDue('monthly', '2026-12-05T08:00:00.000Z', new Date('2027-01-05T07:59:59.000Z'))).toBe(
      false,
    );
    expect(isDue('monthly', '2026-12-05T08:00:00.000Z', new Date('2027-01-05T08:00:00.000Z'))).toBe(
      true,
    );
  });

  it('"once a month" from the 31st: the shorter next month ends the wait on its last day', () => {
    // January 31 -> February 28 (2026 is not a leap year), not March 3.
    expect(isDue('monthly', '2026-01-31T10:00:00.000Z', new Date('2026-02-28T09:59:59.000Z'))).toBe(
      false,
    );
    expect(isDue('monthly', '2026-01-31T10:00:00.000Z', new Date('2026-02-28T10:00:00.000Z'))).toBe(
      true,
    );
    // ... and February 29 in a leap year.
    expect(isDue('monthly', '2028-01-31T10:00:00.000Z', new Date('2028-02-28T10:00:00.000Z'))).toBe(
      false,
    );
    expect(isDue('monthly', '2028-01-31T10:00:00.000Z', new Date('2028-02-29T10:00:00.000Z'))).toBe(
      true,
    );
    // March 31 -> April 30; May 31 -> June 30.
    expect(isDue('monthly', '2026-03-31T00:00:00.000Z', new Date('2026-04-30T00:00:00.000Z'))).toBe(
      true,
    );
    expect(isDue('monthly', '2026-03-31T00:00:00.000Z', new Date('2026-04-29T23:59:59.000Z'))).toBe(
      false,
    );
    expect(isDue('monthly', '2026-05-31T00:00:00.000Z', new Date('2026-06-30T00:00:00.000Z'))).toBe(
      true,
    );
  });

  it('a record later than now (clock set back) is treated as a check made now: not due', () => {
    for (const schedule of ['daily', 'weekly', 'monthly'] as const) {
      expect(isDue(schedule, ago(-1000), NOW)).toBe(false);
      expect(isDue(schedule, ago(-400 * DAY), NOW)).toBe(false);
    }
    // ... whereas "at every start" checks regardless.
    expect(isDue('everyStart', ago(-400 * DAY), NOW)).toBe(true);
  });
});

describe('version-check schedule: oneMonthAfter', () => {
  it('keeps the day and the time of day when the next month has that day', () => {
    expect(oneMonthAfter(new Date('2026-10-17T12:34:56.789Z')).toISOString()).toBe(
      '2026-11-17T12:34:56.789Z',
    );
    expect(oneMonthAfter(new Date('2026-12-17T00:00:00.000Z')).toISOString()).toBe(
      '2027-01-17T00:00:00.000Z',
    );
  });

  it('falls back to the last day of a shorter next month', () => {
    expect(oneMonthAfter(new Date('2026-01-31T10:00:00.000Z')).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(oneMonthAfter(new Date('2028-01-31T10:00:00.000Z')).toISOString()).toBe(
      '2028-02-29T10:00:00.000Z',
    );
    expect(oneMonthAfter(new Date('2026-01-30T10:00:00.000Z')).toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(oneMonthAfter(new Date('2026-08-31T10:00:00.000Z')).toISOString()).toBe(
      '2026-09-30T10:00:00.000Z',
    );
  });
});

describe('version-check schedule: nextRecord', () => {
  it('clamps a record later than now to now', () => {
    expect(nextRecord(ago(-1000), NOW)).toBe(NOW.toISOString());
    expect(nextRecord(ago(-400 * DAY), NOW)).toBe(NOW.toISOString());
  });

  it('leaves a past record, an absent one and an unreadable one as they are', () => {
    const past = ago(3 * DAY);
    expect(nextRecord(past, NOW)).toBe(past);
    expect(nextRecord(NOW.toISOString(), NOW)).toBe(NOW.toISOString());
    expect(nextRecord(undefined, NOW)).toBeUndefined();
    expect(nextRecord('not a date', NOW)).toBe('not a date');
  });

  it('after the clamp the schedules are not due, the record being "now"', () => {
    const clamped = nextRecord(ago(-10 * DAY), NOW);
    expect(isDue('daily', clamped, NOW)).toBe(false);
    expect(isDue('weekly', clamped, NOW)).toBe(false);
    expect(isDue('monthly', clamped, NOW)).toBe(false);
  });
});
