/**
 * Feature 015 (FR-018..FR-022, SC-005, T039): the dates the Fix button recognises.
 */
import { describe, expect, it } from 'vitest';

import { isXsDate, recogniseDate } from '@/features/description/dateFix';

const ONE: [string, string][] = [
  ['2026-10-30 23:46', '2026-10-30'],
  ['2026-10-30T23:46', '2026-10-30'],
  ['2026-10-30T23:46:00', '2026-10-30'],
  ['2026-10-30T23:46:00+02:00', '2026-10-30'],
  ['2026-10-30T23:46:00.123Z', '2026-10-30'],
  ['2026/10/30', '2026-10-30'],
  ['2026.10.30', '2026-10-30'],
  ['2026-1-5', '2026-01-05'],
  ['30.10.2026', '2026-10-30'],
  ['30/10/2026', '2026-10-30'],
  ['10/30/2026', '2026-10-30'],
  ['30-10-2026', '2026-10-30'],
  ['30.10.2026 23:46', '2026-10-30'],
  ['5.5.2026', '2026-05-05'],
  ['05/05/2026', '2026-05-05'],
  ['30 October 2026', '2026-10-30'],
  ['October 30, 2026', '2026-10-30'],
  ['Oct 30 2026', '2026-10-30'],
  ['30 Oct 2026', '2026-10-30'],
  ['30 Sept. 2026', '2026-09-30'],
  ['30 октября 2026', '2026-10-30'],
  ['30 октября 2026 г.', '2026-10-30'],
  ['1 мая 2026 года', '2026-05-01'],
  ['30 жовтня 2026', '2026-10-30'],
  ['30 жовт. 2026', '2026-10-30'],
  ['1 травня 2026 р.', '2026-05-01'],
  ['29 February 2024', '2024-02-29'],
];

const TWO: [string, [string, string]][] = [
  ['03/04/2026', ['2026-04-03', '2026-03-04']],
  ['03.04.2026', ['2026-04-03', '2026-03-04']],
  ['1-2-2026', ['2026-02-01', '2026-01-02']],
  ['12/11/2026', ['2026-11-12', '2026-12-11']],
  ['7.8.2026 10:00', ['2026-08-07', '2026-07-08']],
];

const NONE = [
  '',
  'abc',
  '2026',
  '2026-10',
  '30.10.26',
  '99.99.9999',
  '2026-02-30',
  '31/04/2026',
  '2026-13-01',
  'about 2026',
  'born 30 October 2026',
  '30 Smarch 2026',
  '29 February 2026',
];

describe('dates Fix recognises (feature 015)', () => {
  it.each(ONE)('%s has one reading: %s', (value, expected) => {
    expect(recogniseDate(value)).toEqual({ kind: 'one', day: expected });
  });

  it.each(TWO)('%s has two readings', (value, days) => {
    expect(recogniseDate(value)).toEqual({ kind: 'two', days });
  });

  it.each(NONE.map((v) => [v]))('"%s" gives no candidate', (value) => {
    expect(recogniseDate(value)).toEqual({ kind: 'none' });
  });

  it('gives nothing to fix for a valid date', () => {
    for (const valid of ['2026-10-30', '2026-10-30Z', '2026-10-30+02:00']) {
      expect(isXsDate(valid)).toBe(true);
      expect(recogniseDate(valid)).toEqual({ kind: 'none' });
    }
  });
});
