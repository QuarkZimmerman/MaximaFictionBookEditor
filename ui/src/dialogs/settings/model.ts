/**
 * Settings dialog model (T128/T129): the field <-> settings mapping shared by the pages, the
 * option lists of the combo boxes, range validation (`bodyFontSize` 6-96, `jpegQuality`
 * 1-100, colours `#rrggbb`), the exclusion-word rule of resource-formats.md §4, the
 * formatting of the effective genre-list sources and of the dictionary report (feature 003
 * US4: origin labels, rejection reasons), the keyboard layout choice of the "Open file" group
 * (feature 004 US11). Pure functions: no React, no RPC.
 */

import type { TFunction } from 'i18next';

import { hostOf, isLocalAddress, isPlainHttp } from '@/ai/address';
import { DEFAULT_THEME_SETTING, isThemeSetting } from '@/app/theme';
import { ENCODING_CHOICES } from '@/dialogs/encodings';
import { isCssColor } from '@/features/settings/apply';
import type {
  AiServiceEntry,
  AiServicesResult,
  AiTestResult,
  KeyboardLayoutList,
  Settings,
  SpellDictionaryFolder,
  SpellRejectedDictionary,
  ThemeSetting,
  UiLanguageSetting,
  VersionCheckSchedule,
} from '@/rpc/types';

export { ENCODING_CHOICES };

/* ------------------------------------------------------------------------ */
/* Option lists                                                             */
/* ------------------------------------------------------------------------ */

/**
 * Interface language (`view.uiLanguage`): follow the system, or one of `SUPPORTED_LANGUAGES`
 * (ui/src/i18n/switch.ts) in that order; the completeness test checks that every supported
 * language has its `dialog.settings.view.language<Lang>` label.
 */
export const LANGUAGE_OPTIONS: readonly { value: UiLanguageSetting; labelKey: string }[] = [
  { value: 'system', labelKey: 'dialog.settings.view.languageSystem' },
  { value: 'en', labelKey: 'dialog.settings.view.languageEn' },
  { value: 'ru', labelKey: 'dialog.settings.view.languageRu' },
  { value: 'uk', labelKey: 'dialog.settings.view.languageUk' },
];

/** Interface theme (`view.theme`): follow the OS, or force light / dark. */
export const THEME_OPTIONS: readonly { value: ThemeSetting; labelKey: string }[] = [
  { value: 'system', labelKey: 'dialog.settings.view.themeSystem' },
  { value: 'light', labelKey: 'dialog.settings.view.themeLight' },
  { value: 'dark', labelKey: 'dialog.settings.view.themeDark' },
];

export const DEFAULT_THEME = DEFAULT_THEME_SETTING;

/** The theme of a draft (tolerates settings of a core without `view.theme`). */
export function themeOf(view: Partial<Settings['view']> | undefined): ThemeSetting {
  const theme = view?.theme;
  return isThemeSetting(theme) ? theme : DEFAULT_THEME;
}

/** Common families offered by the font pickers (the inputs accept any name). */
export const BODY_FONT_SUGGESTIONS: readonly string[] = [
  'Georgia',
  'Times New Roman',
  'Noto Serif',
  'DejaVu Serif',
  'Liberation Serif',
  'PT Serif',
  'Literata',
  'Arial',
  'Verdana',
  'Tahoma',
  'Segoe UI',
  'Noto Sans',
  'DejaVu Sans',
  'Liberation Sans',
  'PT Sans',
];

export const SOURCE_FONT_SUGGESTIONS: readonly string[] = [
  'Consolas',
  'Cascadia Mono',
  'Courier New',
  'Noto Sans Mono',
  'DejaVu Sans Mono',
  'Liberation Mono',
  'Menlo',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
];

/** Non-breaking space display characters: the original's □, ▫, ◦ and the plain space (default). */
export const NBSP_DISPLAY_CHOICES: readonly { value: string; labelKey: string }[] = [
  { value: '\u25A1', labelKey: 'dialog.settings.other.nbspChars.square' },
  { value: '\u25AB', labelKey: 'dialog.settings.other.nbspChars.smallSquare' },
  { value: '\u25E6', labelKey: 'dialog.settings.other.nbspChars.bullet' },
  { value: '\u00A0', labelKey: 'dialog.settings.other.nbspChars.space' },
];

export const IMAGE_FORMATS = ['jpeg', 'png'] as const;

/**
 * Version-check schedule (`other.versionCheck`, feature 003 US5, FR-040): exactly these five
 * choices, in this order; `monthly` is the default.
 */
export const VERSION_CHECK_OPTIONS: readonly { value: VersionCheckSchedule; labelKey: string }[] = [
  { value: 'everyStart', labelKey: 'dialog.settings.other.versionCheckChoices.everyStart' },
  { value: 'daily', labelKey: 'dialog.settings.other.versionCheckChoices.daily' },
  { value: 'weekly', labelKey: 'dialog.settings.other.versionCheckChoices.weekly' },
  { value: 'monthly', labelKey: 'dialog.settings.other.versionCheckChoices.monthly' },
  { value: 'never', labelKey: 'dialog.settings.other.versionCheckChoices.never' },
];

/* ------------------------------------------------------------------------ */
/* Keyboard layout (Settings > Other > Open file; feature 004 US11)         */
/* ------------------------------------------------------------------------ */

export interface KeyboardLayoutOption {
  id: string;
  name: string;
  /** The stored choice is not in the system's current list ("<name> (not installed)"). */
  notInstalled: boolean;
}

/**
 * The `<select>` of the "Switch keyboard layout" option (data-model §11.2): the system's layouts
 * by name, then - when the stored id is not among them - the stored choice marked as not
 * installed, so it stays visible until another layout is picked (FR-091); the shown entry is
 * the stored one, else the current layout when the system reports it, else the first; `ready`
 * says whether the controls are usable (the list arrived and the system supports the switch).
 * While the list is loading or the system offers no switch (`supported: false`, whatever the
 * reason) only the stored choice is shown, under its stored name.
 */
export interface KeyboardLayoutChoice {
  options: KeyboardLayoutOption[];
  shownId: string;
  ready: boolean;
}

export function keyboardLayoutChoice(
  list: KeyboardLayoutList | null,
  storedId: string,
  storedName: string,
): KeyboardLayoutChoice {
  const stored = (notInstalled: boolean): KeyboardLayoutOption => ({
    id: storedId,
    name: storedName || storedId,
    notInstalled,
  });
  if (!list || !list.supported) {
    return { options: storedId ? [stored(false)] : [], shownId: storedId, ready: false };
  }
  const options: KeyboardLayoutOption[] = list.layouts.map((layout) => ({
    id: layout.id,
    name: layout.name || layout.id,
    notInstalled: false,
  }));
  const listed = (id: string | undefined) =>
    id !== undefined && id !== '' && options.some((option) => option.id === id);
  if (storedId && !listed(storedId)) options.push(stored(true));
  const shownId = storedId || (listed(list.current) ? list.current! : (options[0]?.id ?? ''));
  return { options, shownId, ready: true };
}

/* ------------------------------------------------------------------------ */
/* Ranges and validation                                                    */
/* ------------------------------------------------------------------------ */

export const BODY_FONT_SIZE_RANGE = { min: 6, max: 96 } as const;
export const JPEG_QUALITY_RANGE = { min: 1, max: 100 } as const;

export function isIntegerInRange(value: unknown, range: { min: number; max: number }): boolean {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
  );
}

/** Parses a numeric field; NaN for empty or non-numeric text (kept so the error can show). */
export function parseIntegerField(text: string): number {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export interface SettingsValidationError {
  /** Dotted settings path, e.g. `other.jpegQuality`. */
  field: string;
  /** Localised message. */
  message: string;
}

/** Validates the editable fields of a draft; an empty list means the draft can be applied. */
export function validateSettings(draft: Settings, t: TFunction): SettingsValidationError[] {
  const errors: SettingsValidationError[] = [];
  if (!isIntegerInRange(draft.view.bodyFontSize, BODY_FONT_SIZE_RANGE)) {
    errors.push({
      field: 'view.bodyFontSize',
      message: t('dialog.settings.rangeError', {
        field: stripLabel(t('dialog.settings.view.fontSize')),
        ...BODY_FONT_SIZE_RANGE,
      }),
    });
  }
  if (!isIntegerInRange(draft.other.jpegQuality, JPEG_QUALITY_RANGE)) {
    errors.push({
      field: 'other.jpegQuality',
      message: t('dialog.settings.rangeError', {
        field: stripLabel(t('dialog.settings.other.jpegQuality')),
        ...JPEG_QUALITY_RANGE,
      }),
    });
  }
  if (!isCssColor(draft.view.bodyTextColor)) {
    errors.push({
      field: 'view.bodyTextColor',
      message: t('dialog.settings.colorError', {
        field: stripLabel(t('dialog.settings.view.textColor')),
      }),
    });
  }
  if (!isCssColor(draft.view.bodyBackground)) {
    errors.push({
      field: 'view.bodyBackground',
      message: t('dialog.settings.colorError', {
        field: stripLabel(t('dialog.settings.view.background')),
      }),
    });
  }
  // The AI assistant's own service (feature 005 FR-003; data-model §2.7): the address must be
  // an http(s) URL with a host and the model must be named - checked only when that option is
  // chosen; a plain address is a warning on the page (`serviceAddressProblem`), not an error.
  if (draft.ai?.mode === 'custom') {
    const problem = serviceAddressProblem(draft.ai.custom?.address ?? '');
    if (problem === 'empty' || problem === 'invalid') {
      errors.push({
        field: 'ai.custom.address',
        message: t('dialog.settings.ai.custom.addressError'),
      });
    }
    if (!(draft.ai.custom?.model ?? '').trim()) {
      errors.push({ field: 'ai.custom.model', message: t('dialog.settings.ai.custom.modelError') });
    }
  }
  return errors;
}

/* ------------------------------------------------------------------------ */
/* AI assistant (feature 005, Settings > AI assistant)                       */
/* ------------------------------------------------------------------------ */

/**
 * What is wrong with a service address (rpc-api Definitions "Address"; FR-003): `empty`,
 * `invalid` (not an absolute http(s) URL with a host, or with a query, a fragment, user
 * information, white space or control characters, or over 2048 characters), `plainHosted` (a
 * plain `http` address that is not on this computer - saved with a warning, FR-003), or null.
 */
export type ServiceAddressProblem = 'empty' | 'invalid' | 'plainHosted';

export function serviceAddressProblem(address: string): ServiceAddressProblem | null {
  const text = address.trim();
  if (!text) return 'empty';
  // eslint-disable-next-line no-control-regex
  if (text.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(text)) return 'invalid';
  if (!/^https?:\/\//i.test(text)) return 'invalid';
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'invalid';
  }
  if (!url.hostname || url.username || url.password || url.search || url.hash) return 'invalid';
  if (text.includes('?') || text.includes('#') || hostOf(text).includes('@')) return 'invalid';
  return isPlainHttp(text) && !isLocalAddress(text) ? 'plainHosted' : null;
}

/**
 * The free option's `<select>` (data-model §2.4; FR-002): the effective list in its order, the
 * saved id when it is listed, else the first entry with `fallback` set (the saved setting is
 * not rewritten - the page says so and the user may pick another); an empty list gives no
 * entry at all.
 */
export interface AiServiceChoice {
  options: AiServiceEntry[];
  entry: AiServiceEntry | null;
  shownId: string;
  /** The saved id is not in the list: the first entry stands in for it. */
  fallback: boolean;
}

export function aiServiceChoice(
  services: Pick<AiServicesResult, 'services'> | null,
  freeServiceId: string,
): AiServiceChoice {
  const options = services?.services ?? [];
  const saved = options.find((option) => option.id === freeServiceId) ?? null;
  const entry = saved ?? options[0] ?? null;
  return {
    options,
    entry,
    shownId: entry?.id ?? '',
    fallback: saved === null && entry !== null && freeServiceId !== '',
  };
}

/** The entry's limits note in the interface language (`en` when the language has none). */
export function limitsNoteOf(entry: Pick<AiServiceEntry, 'limits'>, language: string): string {
  const primary = language.toLowerCase().split(/[-_]/)[0] ?? 'en';
  const limits = entry.limits as Partial<Record<string, string>>;
  return (limits[primary] || limits.en || '').trim();
}

/** The text of one list-file issue: the localised reason with its field (FR-013). */
export function listIssueReason(issue: { reason: string; field?: string }, t: TFunction): string {
  return t(`ai.listIssue.${issue.reason}`, {
    field: issue.field ?? '',
    defaultValue: issue.reason,
  });
}

/** The longest service message shown on the page (research R8.13: plain text, capped). */
const SERVICE_MESSAGE_LIMIT = 2000;

/** HTML reduced to its text with a regex, white space collapsed (never inserted as markup). */
export function plainServiceText(text: string): string {
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SERVICE_MESSAGE_LIMIT);
}

/**
 * The service's own words in an answer body (ai-service-protocol §4, the extraction order the
 * page needs: `error.message`, a string `error`, `message`, `detail`), or null.
 */
export function serviceMessageOf(body: unknown): string | null {
  if (typeof body === 'string') return plainServiceText(body) || null;
  if (typeof body !== 'object' || body === null) return null;
  const record = body as { error?: unknown; message?: unknown; detail?: unknown };
  const error = record.error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return plainServiceText(message);
  }
  if (typeof error === 'string' && error.trim()) return plainServiceText(error);
  if (typeof record.message === 'string' && record.message.trim()) {
    return plainServiceText(record.message);
  }
  if (typeof record.detail === 'string' && record.detail.trim()) {
    return plainServiceText(record.detail);
  }
  return null;
}

/**
 * The text of a failed *Test connection* (FR-005, FR-009): the service's words for an `http`
 * answer and for a 200 without choices, the localised text of the transport kind with the
 * transport's message otherwise.
 */
export function testFailureText(result: AiTestResult, t: TFunction): string {
  if (result.ok) {
    return (
      serviceMessageOf(result.body) ??
      t('ai.failure.withMessage', {
        text: t('ai.failure.format'),
        message: plainServiceText(JSON.stringify(result.body ?? null)).slice(0, 300),
      })
    );
  }
  if (result.kind === 'http') {
    const words =
      serviceMessageOf(result.body) ?? (result.text ? plainServiceText(result.text) : null);
    const status = result.status ?? 0;
    return words ? `${words} (HTTP ${status})` : `${t('ai.failure.service')} (HTTP ${status})`;
  }
  const text = t(`ai.failure.${result.kind}`);
  return result.message ? t('ai.failure.withMessage', { text, message: result.message }) : text;
}

/** "Font size:" -> "Font size" (labels carry a trailing colon in the original dialogs). */
export function stripLabel(label: string): string {
  return label.replace(/[:：]\s*$/, '').replace(/&(?!&)/g, '');
}

/* ------------------------------------------------------------------------ */
/* Source font ("Family, size")                                             */
/* ------------------------------------------------------------------------ */

/** Composes the `view.sourceFont` setting from its two controls ("Consolas, 12"). */
export function composeSourceFont(family: string, size: number | null): string {
  const name = family.trim();
  if (!name && size === null) return '';
  if (!name) return `${size}`;
  return size === null ? name : `${name}, ${size}`;
}

/* ------------------------------------------------------------------------ */
/* Exclusion words (resource-formats.md §4)                                 */
/* ------------------------------------------------------------------------ */

export type ExclusionWordProblem =
  'empty' | 'invalidCharacter' | 'hyphenPosition' | 'multipleHyphens';

/** Letters (with combining marks) plus a single internal `-`; null when the word is acceptable. */
export function exclusionWordProblem(word: string): ExclusionWordProblem | null {
  if (word.length === 0) return 'empty';
  const chars = [...word];
  let hyphens = 0;
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (ch === '-') {
      if (i === 0 || i === chars.length - 1) return 'hyphenPosition';
      hyphens += 1;
      if (hyphens > 1) return 'multipleHyphens';
      continue;
    }
    if (!/^[\p{L}\p{M}]$/u.test(ch)) return 'invalidCharacter';
  }
  return null;
}

export function isValidExclusionWord(word: string): boolean {
  return exclusionWordProblem(word) === null;
}

/* ------------------------------------------------------------------------ */
/* Genre sources (Settings > Other > Genres folder)                          */
/* ------------------------------------------------------------------------ */

export interface GenreSourceInfo {
  source: string; // 'standard' | 'bundled:<file>' | 'user:<file>'
  path: string;
  layer?: string;
  entries: number;
}

export interface GenresInfo {
  effectiveSources: GenreSourceInfo[];
  issues: { file: string; line?: number; reason: string }[];
}

/** Reads the parts of `resources.genres()` the Other page shows (tolerates older cores). */
export function genresInfoFrom(raw: unknown): GenresInfo {
  const record = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    effectiveSources?: unknown;
    issues?: unknown;
  };
  const sources: GenreSourceInfo[] = [];
  if (Array.isArray(record.effectiveSources)) {
    for (const item of record.effectiveSources) {
      if (typeof item !== 'object' || item === null) continue;
      const s = item as Partial<GenreSourceInfo>;
      sources.push({
        source: typeof s.source === 'string' ? s.source : '',
        path: typeof s.path === 'string' ? s.path : '',
        layer: typeof s.layer === 'string' ? s.layer : undefined,
        entries: typeof s.entries === 'number' ? s.entries : 0,
      });
    }
  }
  const issues: GenresInfo['issues'] = [];
  if (Array.isArray(record.issues)) {
    for (const item of record.issues) {
      if (typeof item !== 'object' || item === null) continue;
      const i = item as { file?: unknown; line?: unknown; reason?: unknown };
      issues.push({
        file: typeof i.file === 'string' ? i.file : '',
        line: typeof i.line === 'number' ? i.line : undefined,
        reason: typeof i.reason === 'string' ? i.reason : '',
      });
    }
  }
  return { effectiveSources: sources, issues };
}

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/** "standard list (186) · 10-fbe-legacy.genres.tsv from the bundled layer (7) · ..." */
export function describeGenreSources(sources: GenreSourceInfo[], t: TFunction): string {
  const parts = sources.map((source) => {
    if (source.source === 'standard') {
      return t('dialog.settings.other.genreSourceStandard', { count: source.entries });
    }
    const colon = source.source.indexOf(':');
    const layer = source.layer ?? (colon > 0 ? source.source.slice(0, colon) : source.source);
    const file = fileName(source.path || (colon > 0 ? source.source.slice(colon + 1) : ''));
    return t('dialog.settings.other.genreSourceLayer', { layer, file, count: source.entries });
  });
  return parts.join(' \u00B7 ');
}

/* ------------------------------------------------------------------------ */
/* Dictionary report (feature 003 US4)                                      */
/* ------------------------------------------------------------------------ */

const DICTIONARY_SOURCES = ['bundled', 'settings', 'user', 'portable'] as const;
type DictionarySource = (typeof DICTIONARY_SOURCES)[number];

function isDictionarySource(value: string | undefined): value is DictionarySource {
  return (DICTIONARY_SOURCES as readonly string[]).includes(value ?? '');
}

/**
 * The origin of a dictionary as shown next to its tag (`source` of the report; data-model §2):
 * "built in" (`bundled`), "chosen folder" (`settings`), "user folder", "portable folder".
 */
export function dictionaryOriginLabel(source: string, t: TFunction): string {
  return isDictionarySource(source) ? t(`dialog.about.dictionarySource.${source}`) : source;
}

/** The reason a file of a dictionaries folder is not used, with the detail where it says more. */
export function dictionaryRejectionText(
  rejected: Pick<SpellRejectedDictionary, 'reason' | 'detail'>,
  t: TFunction,
): string {
  switch (rejected.reason) {
    case 'shadowed':
      return isDictionarySource(rejected.detail)
        ? t(`spell.rejected.shadowedBy.${rejected.detail}`)
        : t('spell.rejected.shadowed');
    case 'unsupportedEncoding':
      return rejected.detail
        ? `${t('spell.rejected.unsupportedEncoding')} (${rejected.detail})`
        : t('spell.rejected.unsupportedEncoding');
    case 'unreadable':
      return t('spell.rejected.unreadable');
    case 'partnerMissing':
      return t('spell.rejected.partnerMissing');
    default:
      return rejected.reason;
  }
}

/**
 * The problem with the chosen dictionaries folder of the saved settings, when it cannot be
 * used (the default folder is used then): missing or unreadable; null when there is none.
 */
export function dictionariesFolderProblem(
  folders: readonly SpellDictionaryFolder[],
  t: TFunction,
): string | null {
  const chosen = folders.find((folder) => folder.layer === 'settings');
  if (!chosen || chosen.path === '') return null;
  if (!chosen.exists) {
    return t('dialog.settings.view.dictionariesFolderMissing', { path: chosen.path });
  }
  if (!chosen.readable) {
    return t('dialog.settings.view.dictionariesFolderUnreadable', { path: chosen.path });
  }
  return null;
}
