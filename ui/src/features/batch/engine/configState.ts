/**
 * Feature 019 (T021; data-model.md §2): pure configuration reducer and invariant guards for the
 * Batch Converter dialog.
 */

import type { Settings } from '@/rpc/types';

import {
  BATCH_BOOK_FORMATS,
  type BatchBookFormat,
  type BatchDirection,
  type BatchJobConfig,
  type BatchSessionMemory,
} from './types';

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
  };
}

export function normalizeBatchConfig(raw: BatchJobConfig, cpuCores: number): BatchJobConfig {
  const importFormats: Record<BatchBookFormat, boolean> = {
    epub: Boolean(raw.importFormats.epub),
    mobi: Boolean(raw.importFormats.mobi),
    pdf: Boolean(raw.importFormats.pdf),
    txt: Boolean(raw.importFormats.txt),
    markdown: Boolean(raw.importFormats.markdown),
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
  const workerCount = parallelCapable
    ? Math.min(maxWorkers, Math.max(2, requestedWorkers))
    : 1;

  return {
    direction: raw.direction,
    exportFormat: raw.exportFormat,
    importAll,
    importFormats,
    zipOutput,
    sourceDir: raw.sourceDir,
    includeSubfolders,
    inPlace,
    destinationDir: raw.destinationDir,
    keepTree,
    overwrite: Boolean(raw.overwrite),
    parallel,
    workerCount,
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
      sourceDir: memory?.sourceDir ?? '',
      includeSubfolders: memory?.includeSubfolders ?? true,
      inPlace: memory?.inPlace ?? false,
      destinationDir: memory?.destinationDir ?? '',
      keepTree: memory?.keepTree ?? true,
      // FR-003 / FR-012: Overwrite always starts unchecked when the dialog opens.
      overwrite: false,
      parallel: memory !== undefined && memory !== null ? memory.parallel : maxWorkers >= 2,
      workerCount: memory?.workerCount ?? maxWorkers,
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
  | { type: 'setSourceDir'; path: string }
  | { type: 'setIncludeSubfolders'; checked: boolean }
  | { type: 'setInPlace'; checked: boolean }
  | { type: 'setDestinationDir'; path: string }
  | { type: 'setKeepTree'; checked: boolean }
  | { type: 'setOverwrite'; checked: boolean }
  | { type: 'setParallel'; checked: boolean }
  | { type: 'setWorkerCount'; count: number }
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
      next = {
        ...state,
        inPlace: action.checked,
        keepTree: action.checked ? false : state.keepTree,
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
export function validateBatchConfig(config: BatchJobConfig): string | null {
  if (!config.sourceDir.trim()) {
    return 'batch.validation.sourceRequired';
  }
  if (!config.inPlace && !config.destinationDir.trim()) {
    return 'batch.validation.destinationRequired';
  }
  if (
    config.direction === 'importToFb2' &&
    !BATCH_BOOK_FORMATS.some((fmt) => config.importFormats[fmt])
  ) {
    return 'batch.validation.noImportFormats';
  }
  return null;
}

export function selectedImportFormats(config: BatchJobConfig): BatchBookFormat[] {
  return BATCH_BOOK_FORMATS.filter((fmt) => config.importFormats[fmt]);
}
