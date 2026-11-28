/**
 * Feature 019 (T021; data-model.md §2): pure configuration reducer and invariant guards for the
 * Batch Converter dialog.
 */

import { DOCX_DEFAULTS } from '@/features/docx/docxSettingsSchema';
import type { BatchPersistedExportSettings, Settings } from '@/rpc/types';

import {
  BATCH_BOOK_FORMATS,
  type BatchBookFormat,
  type BatchDirection,
  type BatchExportSettingsOverrides,
  type BatchJobConfig,
  type BatchSessionMemory,
} from './types';

const DEFAULT_PDF_SETTINGS: NonNullable<Settings['pdf']> = {
  defaultPageSize: 'a4',
  textFont: 'noto-serif',
  textSize: 'standard',
  margins: 'standard',
  customTextSize: 115,
  customMargin: 22,
  zip: false,
};

const DEFAULT_TXT_SETTINGS: NonNullable<Settings['txt']> = {
  encodingMode: 'utf-8',
  encodings: { en: 'windows-1252', ru: 'windows-1251', uk: 'windows-1251', other: 'utf-8' },
  bom: false,
  zip: false,
};

const DEFAULT_MOBI_SETTINGS: NonNullable<Settings['mobi']> = {
  format: 'joint',
  tocPlacement: 'afterTitle',
  seriesInTitle: 'seriesAndNumber',
  openAt: 'titlePage',
  kf8PopupFootnotes: true,
  zip: false,
};

const DEFAULT_MARKDOWN_SETTINGS: NonNullable<Settings['markdown']> = {
  includePictures: true,
};

const DEFAULT_EXPORT_SECTIONS: Record<string, Record<string, unknown>> = {
  pdf: DEFAULT_PDF_SETTINGS as unknown as Record<string, unknown>,
  txt: DEFAULT_TXT_SETTINGS as unknown as Record<string, unknown>,
  mobi: DEFAULT_MOBI_SETTINGS as unknown as Record<string, unknown>,
  markdown: DEFAULT_MARKDOWN_SETTINGS as unknown as Record<string, unknown>,
  docx: DOCX_DEFAULTS as unknown as Record<string, unknown>,
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepCloneRecord<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (isPlainObject(v)) {
      out[k] = deepCloneRecord(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (isPlainObject(item) ? deepCloneRecord(item) : item));
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Recursively merges `patch` onto `base` without mutating either input, preserving all unknown
 * future keys and nested objects.
 */
export function deepMergeRecord(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = deepCloneRecord(base);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (isPlainObject(v) && isPlainObject(out[k])) {
      out[k] = deepMergeRecord(out[k] as Record<string, unknown>, v);
    } else if (isPlainObject(v)) {
      out[k] = deepCloneRecord(v);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) => (isPlainObject(item) ? deepCloneRecord(item) : item));
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function cloneExportSettingsOverrides(
  overrides?: BatchExportSettingsOverrides | BatchPersistedExportSettings | null,
): BatchExportSettingsOverrides {
  if (!overrides) return {};
  const out: BatchExportSettingsOverrides = {};
  for (const [section, value] of Object.entries(overrides)) {
    if (isPlainObject(value)) {
      out[section] = deepCloneRecord(value);
    }
  }
  return out;
}

/**
 * Builds a complete Batch Converter export-settings snapshot from global Settings (used as the
 * fallback seed when `batch.settings.get` has no stored file yet or RPC is unavailable).
 */
export function extractExportSettingsFromGlobal(
  base: Settings | null,
): BatchPersistedExportSettings {
  const out: BatchPersistedExportSettings = {};
  for (const [section, def] of Object.entries(DEFAULT_EXPORT_SECTIONS)) {
    const raw = (base as Record<string, unknown> | null)?.[section];
    out[section] = isPlainObject(raw) ? deepMergeRecord(def, raw) : deepCloneRecord(def);
  }
  return out;
}

/**
 * Merges a batch export-settings patch onto an existing export-settings copy without mutating
 * either argument, preserving all existing and future parameters across every section.
 */
export function applyBatchExportSettingsPatch(
  current: BatchPersistedExportSettings,
  patch: BatchExportSettingsOverrides,
): BatchPersistedExportSettings {
  const out = cloneExportSettingsOverrides(current) as BatchPersistedExportSettings;
  for (const [section, sectionPatch] of Object.entries(patch)) {
    if (!isPlainObject(sectionPatch)) continue;
    const baseSec = isPlainObject(out[section])
      ? (out[section] as Record<string, unknown>)
      : (DEFAULT_EXPORT_SECTIONS[section] ?? {});
    out[section] = deepMergeRecord(baseSec, sectionPatch);
  }
  return out;
}

/**
 * Merges batch export settings/overrides over global Settings without mutating `base`.
 */
export function mergeBatchExportSettings(
  base: Settings | null,
  overrides?: BatchExportSettingsOverrides | BatchPersistedExportSettings | null,
): Settings | null {
  if (!overrides) return base;
  const entries = Object.entries(overrides).filter(([, value]) => isPlainObject(value));
  if (entries.length === 0) return base;

  const merged = { ...(base ?? ({ schemaVersion: 1 } as Settings)) } as Record<string, unknown>;
  for (const [section, sectionOverrides] of entries) {
    const def = DEFAULT_EXPORT_SECTIONS[section] ?? {};
    const baseSection = isPlainObject(merged[section])
      ? deepMergeRecord(def, merged[section] as Record<string, unknown>)
      : deepCloneRecord(def);
    merged[section] = deepMergeRecord(baseSection, sectionOverrides as Record<string, unknown>);
  }
  return merged as unknown as Settings;
}

export function computeMaxWorkers(cpuCores: number): number {
  const safeCores = Number.isFinite(cpuCores) ? Math.floor(cpuCores) : 1;
  return Math.max(1, safeCores - 1);
}

export function canRunParallel(cpuCores: number): boolean {
  return computeMaxWorkers(cpuCores) >= 2;
}

export function isZipOutputSupported(
  direction: BatchDirection,
  exportFormat: BatchBookFormat,
): boolean {
  return !(direction === 'fb2ToExport' && exportFormat === 'epub');
}

export function defaultZipOutput(
  direction: BatchDirection,
  exportFormat: BatchBookFormat,
  settings: Settings | null,
): boolean {
  if (direction === 'importToFb2') return false;
  switch (exportFormat) {
    case 'epub':
      return false;
    case 'markdown':
      return false;
    case 'pdf':
      return Boolean(settings?.pdf?.zip);
    case 'txt':
      return Boolean(settings?.txt?.zip);
    case 'mobi':
      return Boolean(settings?.mobi?.zip);
    case 'docx':
      return Boolean(settings?.docx?.zip);
  }
}

export function zipOverrideKey(direction: BatchDirection, exportFormat: BatchBookFormat): string {
  return direction === 'importToFb2' ? 'importToFb2' : `fb2ToExport:${exportFormat}`;
}

export function allImportFormatsRecord(value: boolean): Record<BatchBookFormat, boolean> {
  return {
    epub: value,
    mobi: value,
    pdf: value,
    txt: value,
    markdown: value,
    docx: value,
  };
}

const DEFAULT_OCR_LANGUAGES: readonly string[] = ['eng', 'rus'];

function normalizeOcrLanguages(raw: readonly string[] | undefined): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_OCR_LANGUAGES];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const code = item.trim();
    const key = code.toLowerCase();
    if (!code || key === 'osd' || seen.has(key)) continue;
    seen.add(key);
    out.push(code);
  }
  return out;
}

export function isBatchPdfOcrControlsEnabled(config: BatchJobConfig): boolean {
  return config.direction === 'importToFb2' && config.importFormats.pdf;
}

export function isBatchPdfOcrLanguagesEnabled(config: BatchJobConfig): boolean {
  return isBatchPdfOcrControlsEnabled(config) && config.pdfUseOcr;
}

export function normalizeBatchConfig(raw: BatchJobConfig, cpuCores: number): BatchJobConfig {
  const importFormats: Record<BatchBookFormat, boolean> = {
    epub: Boolean(raw.importFormats.epub),
    mobi: Boolean(raw.importFormats.mobi),
    pdf: Boolean(raw.importFormats.pdf),
    txt: Boolean(raw.importFormats.txt),
    markdown: Boolean(raw.importFormats.markdown),
    docx:
      raw.importFormats.docx === undefined
        ? Boolean(raw.importAll)
        : Boolean(raw.importFormats.docx),
  };
  const importAll = BATCH_BOOK_FORMATS.every((fmt) => importFormats[fmt]);
  const zipOutput = isZipOutputSupported(raw.direction, raw.exportFormat)
    ? Boolean(raw.zipOutput)
    : false;
  const includeSubfolders = Boolean(raw.includeSubfolders);
  const inPlace = Boolean(raw.inPlace);
  const keepTree = includeSubfolders && !inPlace ? Boolean(raw.keepTree) : false;

  const maxWorkers = computeMaxWorkers(cpuCores);
  const parallelCapable = maxWorkers >= 2;
  const parallel = parallelCapable ? Boolean(raw.parallel) : false;
  const requestedWorkers = Number.isFinite(raw.workerCount)
    ? Math.floor(raw.workerCount)
    : maxWorkers;
  const workerCount = parallelCapable ? Math.min(maxWorkers, Math.max(2, requestedWorkers)) : 1;

  return {
    direction: raw.direction,
    exportFormat: raw.exportFormat,
    importAll,
    importFormats,
    zipOutput,
    fixBroken: raw.fixBroken !== false,
    sourceDir: raw.sourceDir,
    includeSubfolders,
    inPlace,
    destinationDir: raw.destinationDir,
    keepTree,
    overwrite: Boolean(raw.overwrite),
    parallel,
    workerCount,
    pdfUseOcr: raw.pdfUseOcr !== false,
    ocrAutoDetect: raw.ocrAutoDetect !== false,
    ocrLanguages: normalizeOcrLanguages(raw.ocrLanguages),
  };
}

export function effectiveWorkerCount(config: BatchJobConfig, cpuCores: number): number {
  const maxWorkers = computeMaxWorkers(cpuCores);
  if (!config.parallel || maxWorkers < 2) return 1;
  return Math.min(maxWorkers, Math.max(2, Math.floor(config.workerCount)));
}

export function createInitialBatchConfig(
  cpuCores: number,
  settings: Settings | null,
  memory?: BatchSessionMemory | null,
): BatchJobConfig {
  const maxWorkers = computeMaxWorkers(cpuCores);
  const direction: BatchDirection = memory?.direction ?? 'fb2ToExport';
  const exportFormat: BatchBookFormat = memory?.exportFormat ?? 'epub';
  const key = zipOverrideKey(direction, exportFormat);
  const rememberedZip = memory?.zipOverrides[key];
  const zipOutput =
    rememberedZip !== undefined
      ? rememberedZip
      : defaultZipOutput(direction, exportFormat, settings);

  return normalizeBatchConfig(
    {
      direction,
      exportFormat,
      importAll: memory?.importAll ?? true,
      importFormats: memory?.importFormats
        ? { ...memory.importFormats }
        : allImportFormatsRecord(true),
      zipOutput,
      // Requester (2026-11-23): Fix broken XML in memory is enabled by default.
      fixBroken: memory?.fixBroken ?? true,
      sourceDir: memory?.sourceDir ?? '',
      includeSubfolders: memory?.includeSubfolders ?? true,
      // Requester (2026-11-23): In-place conversion is checked by default.
      inPlace: memory?.inPlace ?? true,
      destinationDir: memory?.destinationDir ?? '',
      keepTree: memory?.keepTree ?? true,
      // Requester (2026-11-23): All batch converter settings persist across restarts; default false.
      overwrite: memory?.overwrite ?? false,
      parallel: memory?.parallel !== undefined ? memory.parallel : maxWorkers >= 2,
      workerCount: memory?.workerCount ?? maxWorkers,
      pdfUseOcr: memory?.pdfUseOcr ?? settings?.imports?.pdf?.useOcr ?? true,
      ocrAutoDetect: memory?.ocrAutoDetect ?? settings?.ocr?.autoDetect ?? true,
      ocrLanguages:
        memory?.ocrLanguages !== undefined
          ? [...memory.ocrLanguages]
          : [...(settings?.ocr?.enabledLanguages ?? DEFAULT_OCR_LANGUAGES)],
    },
    cpuCores,
  );
}

export type BatchConfigAction =
  | { type: 'setDirection'; direction: BatchDirection }
  | { type: 'setExportFormat'; format: BatchBookFormat }
  | { type: 'setImportAll'; checked: boolean }
  | { type: 'setImportFormat'; format: BatchBookFormat; checked: boolean }
  | { type: 'setZipOutput'; checked: boolean }
  | { type: 'setFixBroken'; checked: boolean }
  | { type: 'setSourceDir'; path: string }
  | { type: 'setIncludeSubfolders'; checked: boolean }
  | { type: 'setInPlace'; checked: boolean }
  | { type: 'setDestinationDir'; path: string }
  | { type: 'setKeepTree'; checked: boolean }
  | { type: 'setOverwrite'; checked: boolean }
  | { type: 'setParallel'; checked: boolean }
  | { type: 'setWorkerCount'; count: number }
  | { type: 'setPdfUseOcr'; checked: boolean }
  | { type: 'setOcrAutoDetect'; checked: boolean }
  | { type: 'setOcrLanguages'; languages: string[] }
  | { type: 'syncExportSettings' };

export function reduceBatchConfig(
  state: BatchJobConfig,
  action: BatchConfigAction,
  cpuCores: number,
  settings: Settings | null,
  zipOverrides: Partial<Record<string, boolean>> = {},
): BatchJobConfig {
  const resolveZip = (dir: BatchDirection, fmt: BatchBookFormat): boolean => {
    const key = zipOverrideKey(dir, fmt);
    const manual = zipOverrides[key];
    return manual !== undefined ? manual : defaultZipOutput(dir, fmt, settings);
  };

  let next: BatchJobConfig = state;
  switch (action.type) {
    case 'setDirection':
      next = {
        ...state,
        direction: action.direction,
        zipOutput: resolveZip(action.direction, state.exportFormat),
      };
      break;
    case 'setExportFormat':
      next = {
        ...state,
        exportFormat: action.format,
        zipOutput: resolveZip(state.direction, action.format),
      };
      break;
    case 'setImportAll':
      next = {
        ...state,
        importAll: action.checked,
        importFormats: allImportFormatsRecord(action.checked),
      };
      break;
    case 'setImportFormat': {
      const importFormats = { ...state.importFormats, [action.format]: action.checked };
      next = {
        ...state,
        importFormats,
        importAll: BATCH_BOOK_FORMATS.every((fmt) => importFormats[fmt]),
      };
      break;
    }
    case 'setZipOutput':
      next = { ...state, zipOutput: action.checked };
      break;
    case 'setFixBroken':
      next = { ...state, fixBroken: action.checked };
      break;
    case 'setSourceDir':
      next = { ...state, sourceDir: action.path };
      break;
    case 'setIncludeSubfolders':
      next = {
        ...state,
        includeSubfolders: action.checked,
        keepTree: action.checked ? state.keepTree : false,
      };
      break;
    case 'setInPlace':
      // Unchecking In-place while Include subfolders is on defaults Keep folder tree structure
      // to checked so destination-folder runs preserve tree layout unless explicitly flattened.
      next = {
        ...state,
        inPlace: action.checked,
        keepTree: action.checked ? false : state.includeSubfolders,
      };
      break;
    case 'setDestinationDir':
      next = { ...state, destinationDir: action.path };
      break;
    case 'setKeepTree':
      next = { ...state, keepTree: action.checked };
      break;
    case 'setOverwrite':
      next = { ...state, overwrite: action.checked };
      break;
    case 'setParallel':
      next = { ...state, parallel: action.checked };
      break;
    case 'setWorkerCount':
      next = { ...state, workerCount: action.count };
      break;
    case 'setPdfUseOcr':
      next = { ...state, pdfUseOcr: action.checked };
      break;
    case 'setOcrAutoDetect':
      next = { ...state, ocrAutoDetect: action.checked };
      break;
    case 'setOcrLanguages':
      next = { ...state, ocrLanguages: action.languages };
      break;
    case 'syncExportSettings':
      next = {
        ...state,
        zipOutput: resolveZip(state.direction, state.exportFormat),
      };
      break;
  }
  return normalizeBatchConfig(next, cpuCores);
}

/**
 * Returns an i18n error key when configuration cannot be started, or `null` when valid.
 */
export function validateBatchConfig(
  config: BatchJobConfig,
  installedOcrCodes?: readonly string[] | null,
): string | null {
  if (!config.sourceDir.trim()) {
    return 'batch.validation.missingSource';
  }
  if (!config.inPlace && !config.destinationDir.trim()) {
    return 'batch.validation.missingDestination';
  }
  if (
    config.direction === 'importToFb2' &&
    !BATCH_BOOK_FORMATS.some((fmt) => config.importFormats[fmt])
  ) {
    return 'batch.validation.noImportFormat';
  }
  if (isBatchPdfOcrLanguagesEnabled(config)) {
    const activeCodes = installedOcrCodes
      ? config.ocrLanguages.filter((code) => installedOcrCodes.includes(code))
      : config.ocrLanguages;
    if (activeCodes.length === 0) {
      return 'batch.validation.noOcrLanguage';
    }
  }
  return null;
}

export function selectedImportFormats(config: BatchJobConfig): BatchBookFormat[] {
  return BATCH_BOOK_FORMATS.filter((fmt) => config.importFormats[fmt]);
}
