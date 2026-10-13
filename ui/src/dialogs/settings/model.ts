/**
 * Settings dialog model (T128/T129): the field <-> settings mapping shared by the pages, the
 * option lists of the combo boxes, range validation (`bodyFontSize` 6-96, `jpegQuality`
 * 1-100, colours `#rrggbb`), the exclusion-word rule of resource-formats.md §4 and the
 * formatting of the effective genre-list sources. Pure functions: no React, no RPC.
 */

import type { TFunction } from 'i18next';

import { DEFAULT_THEME_SETTING, isThemeSetting } from '@/app/theme';
import { ENCODING_CHOICES } from '@/dialogs/encodings';
import { isCssColor } from '@/features/settings/apply';
import type { Settings, ThemeSetting, UiLanguageSetting } from '@/rpc/types';

export { ENCODING_CHOICES };

/* ------------------------------------------------------------------------ */
/* Option lists                                                             */
/* ------------------------------------------------------------------------ */

export const LANGUAGE_OPTIONS: readonly { value: UiLanguageSetting; labelKey: string }[] = [
  { value: 'system', labelKey: 'dialog.settings.view.languageSystem' },
  { value: 'en', labelKey: 'dialog.settings.view.languageEn' },
  { value: 'ru', labelKey: 'dialog.settings.view.languageRu' },
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

/** Non-breaking space display characters (the original offered °, □, ▫, ◦ and a plain space). */
export const NBSP_DISPLAY_CHOICES: readonly { value: string; labelKey: string }[] = [
  { value: '\u00B0', labelKey: 'dialog.settings.other.nbspChars.degree' },
  { value: '\u25A1', labelKey: 'dialog.settings.other.nbspChars.square' },
  { value: '\u25AB', labelKey: 'dialog.settings.other.nbspChars.smallSquare' },
  { value: '\u25E6', labelKey: 'dialog.settings.other.nbspChars.bullet' },
  { value: '\u00A0', labelKey: 'dialog.settings.other.nbspChars.space' },
];

export const IMAGE_FORMATS = ['jpeg', 'png'] as const;

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
  return errors;
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
