/**
 * Feature 015 (User Story 5, FR-018..FR-022, research R9): recognises a date value that is not in
 * the year-month-day form FictionBook requires but holds a real calendar day in a common notation,
 * for the description's Fix button. It answers no candidate (junk, incomplete - a year alone, a
 * year and a month, a two-digit year - or impossible days), one candidate day, or two when the day
 * and the month can be read both ways (both 12 or below and different): Fix then lets the user
 * choose and never picks a reading by itself (Q2 = D). A valid value gives no candidate: there is
 * nothing to fix.
 */

export type DateCandidates =
  { kind: 'none' } | { kind: 'one'; day: string } | { kind: 'two'; days: [string, string] };

const NONE: DateCandidates = { kind: 'none' };

/** Month names and abbreviations of English, Russian and Ukrainian (nominative and genitive). */
const MONTHS: readonly (readonly string[])[] = [
  ['january', 'jan', 'январь', 'января', 'янв', 'січень', 'січня', 'січ'],
  ['february', 'feb', 'февраль', 'февраля', 'фев', 'февр', 'лютий', 'лютого', 'лют'],
  ['march', 'mar', 'март', 'марта', 'мар', 'березень', 'березня', 'бер'],
  ['april', 'apr', 'апрель', 'апреля', 'апр', 'квітень', 'квітня', 'квіт'],
  ['may', 'май', 'мая', 'травень', 'травня', 'трав'],
  ['june', 'jun', 'июнь', 'июня', 'июн', 'червень', 'червня', 'черв'],
  ['july', 'jul', 'июль', 'июля', 'июл', 'липень', 'липня', 'лип'],
  ['august', 'aug', 'август', 'августа', 'авг', 'серпень', 'серпня', 'серп'],
  ['september', 'sep', 'sept', 'сентябрь', 'сентября', 'сен', 'сент', 'вересень', 'вересня', 'вер'],
  ['october', 'oct', 'октябрь', 'октября', 'окт', 'жовтень', 'жовтня', 'жовт'],
  ['november', 'nov', 'ноябрь', 'ноября', 'ноя', 'нояб', 'листопад', 'листопада', 'лист'],
  ['december', 'dec', 'декабрь', 'декабря', 'дек', 'грудень', 'грудня', 'груд'],
];

function monthOf(name: string): number | null {
  const key = name.toLowerCase().replace(/\.$/, '');
  const index = MONTHS.findIndex((names) => names.includes(key));
  return index < 0 ? null : index + 1;
}

function day(year: number, month: number, date: number): string | null {
  if (month < 1 || month > 12 || date < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (date > last) return null;
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(date, 2)}`;
}

/** True for a valid `xs:date` (an optional time zone included). */
export function isXsDate(value: string): boolean {
  const m = /^(\d{4,})-(\d{2})-(\d{2})(Z|[+-]\d{2}:\d{2})?$/.exec(value.trim());
  return m !== null && day(Number(m[1]), Number(m[2]), Number(m[3])) !== null;
}

const TIME = String.raw`(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?`;
const YEAR_FIRST = new RegExp(String.raw`^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})${TIME}$`);
const YEAR_LAST = new RegExp(String.raw`^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})${TIME}$`);
const DAY_NAME_YEAR = /^(\d{1,2})\.?\s+(\p{L}+\.?),?\s+(\d{4})(?:\s*(?:г\.?|года|р\.?|року))?$/u;
const NAME_DAY_YEAR = /^(\p{L}+\.?)\s+(\d{1,2}),?\s+(\d{4})$/u;

export function recogniseDate(raw: string): DateCandidates {
  const value = raw.trim();
  if (value === '' || isXsDate(value)) return NONE;
  let m = YEAR_FIRST.exec(value);
  if (m) {
    const one = day(Number(m[1]), Number(m[3]), Number(m[4]));
    return one ? { kind: 'one', day: one } : NONE;
  }
  m = YEAR_LAST.exec(value);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[3]);
    const year = Number(m[4]);
    const dayFirst = day(year, b, a);
    const monthFirst = day(year, a, b);
    if (a <= 12 && b <= 12 && a !== b && dayFirst && monthFirst) {
      return { kind: 'two', days: [dayFirst, monthFirst] };
    }
    const one = dayFirst ?? monthFirst;
    return one ? { kind: 'one', day: one } : NONE;
  }
  m = DAY_NAME_YEAR.exec(value);
  if (m) {
    const month = monthOf(m[2]!);
    const one = month ? day(Number(m[3]), month, Number(m[1])) : null;
    return one ? { kind: 'one', day: one } : NONE;
  }
  m = NAME_DAY_YEAR.exec(value);
  if (m) {
    const month = monthOf(m[1]!);
    const one = month ? day(Number(m[3]), month, Number(m[2])) : null;
    return one ? { kind: 'one', day: one } : NONE;
  }
  return NONE;
}
