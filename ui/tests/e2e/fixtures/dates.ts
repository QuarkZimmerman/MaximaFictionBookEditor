/**
 * The long date text the core writes (feature 003 US6, data-model §6), computed on the test
 * side so the journeys can assert the Today button and the load-time fill-in.
 *
 * The core's POSIX formatter follows the LC_TIME locale of its environment (LC_ALL, then
 * LC_TIME, then LANG - the lookup of `setlocale(LC_TIME, "")`): the month name of that locale
 * (glibc's genitive for Russian and Ukrainian), day and year unpadded, the month first only
 * where the locale's short date puts it first (en_US). `C`/`POSIX`/`C.UTF-8` or a locale the
 * machine lacks means "no regional settings": the interface language's form from the core's own
 * en/ru/uk tables. Windows and macOS format through the user's regional settings, which the
 * environment does not carry; the journeys that depend on the environment run on Linux only.
 */

export const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Genitive month names - glibc's `%B` for ru_RU and the core's fallback table alike. */
export const RU_MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

/** Genitive month names - glibc's `%B` for uk_UA and the core's fallback table alike. */
export const UK_MONTHS_GENITIVE = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
];

/** `YYYY-MM-DD` of a local date (the date value field). */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The interface language's long form - the core's fallback (en for anything but ru/uk). */
export function fallbackLongDate(date: Date, uiLanguage: string): string {
  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();
  if (uiLanguage === 'ru') return `${day} ${RU_MONTHS_GENITIVE[month]} ${year}`;
  if (uiLanguage === 'uk') return `${day} ${UK_MONTHS_GENITIVE[month]} ${year}`;
  return `${EN_MONTHS[month]} ${day}, ${year}`;
}

/** True when `locale` names no regional settings (`C`, `POSIX`, `C.UTF-8`, empty). */
export function isPlainLocale(locale: string): boolean {
  const language = locale.split(/[_.@]/)[0]!;
  return language === '' || language === 'C' || language === 'POSIX';
}

/**
 * The text the core's POSIX formatter writes for `date` under the LC_TIME locale `locale`
 * ("ru_RU.UTF-8", "en_US.UTF-8", "C"...), with `uiLanguage` deciding the fallback form.
 * Languages other than en/ru/uk are approximated through Intl (day first, ICU month name).
 */
export function longDateText(date: Date, locale: string, uiLanguage: string): string {
  if (isPlainLocale(locale)) return fallbackLongDate(date, uiLanguage);
  const [language, rest] = locale.split('_', 2) as [string, string | undefined];
  const region = rest?.split(/[.@]/)[0] ?? '';
  const day = date.getDate();
  const year = date.getFullYear();
  switch (language.toLowerCase()) {
    case 'ru':
      return `${day} ${RU_MONTHS_GENITIVE[date.getMonth()]} ${year}`;
    case 'uk':
      return `${day} ${UK_MONTHS_GENITIVE[date.getMonth()]} ${year}`;
    case 'en':
      return region.toUpperCase() === 'US'
        ? `${EN_MONTHS[date.getMonth()]} ${day}, ${year}`
        : `${day} ${EN_MONTHS[date.getMonth()]} ${year}`;
    default: {
      const tag = region ? `${language}-${region}` : language;
      const month = new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long' })
        .formatToParts(date)
        .find((part) => part.type === 'month')?.value;
      return `${day} ${month ?? EN_MONTHS[date.getMonth()]} ${year}`;
    }
  }
}

/** The LC_TIME locale of the runner's environment as the core's formatter reads it. */
export function environmentLocale(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of ['LC_ALL', 'LC_TIME', 'LANG']) {
    const value = env[name];
    if (value) return value;
  }
  return 'C';
}

/**
 * The system language of the runner's environment as the core's `platform::system_language()`
 * reads it (LC_ALL, LC_MESSAGES, LANG; `C`/`POSIX` skipped; "en" when nothing says): the
 * fallback language of a core whose `view.uiLanguage` setting is `system`.
 */
export function environmentLanguage(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name];
    if (!value || value === 'C' || value === 'POSIX') continue;
    const code = value.split(/[_.@-]/)[0]!.toLowerCase();
    if (code.length === 2 || code.length === 3) return code;
  }
  return 'en';
}

/**
 * The document date the core fills in today on this machine (text and value) with the default
 * `system` interface language setting - what `us2-template` expects of a new document.
 */
export function todaysDocumentDate(now = new Date()): { text: string; value: string } {
  if (process.platform !== 'linux') {
    // Windows and macOS: the user's regional settings, approximated by the runner's default
    // locale (Node's ICU writes the same forms: "17 октября 2026 г.", "October 17, 2026").
    return {
      text: new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(now),
      value: isoDate(now),
    };
  }
  return {
    text: longDateText(now, environmentLocale(), environmentLanguage()),
    value: isoDate(now),
  };
}
