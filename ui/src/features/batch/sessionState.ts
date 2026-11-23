/**
 * Feature 019 (T022; data-model.md §3): in-memory fallback mirror of Batch Converter settings
 * (authoritative persistence lives in `<Config>/batch-converter.json` via `batch.settings.*`).
 */

import { cloneExportSettingsOverrides } from './engine/configState';
import type {
  BatchExportSettingsOverrides,
  BatchJobConfig,
  BatchSessionMemory,
} from './engine/types';

let sessionMemory: BatchSessionMemory | null = null;

export function getBatchSessionMemory(): BatchSessionMemory | null {
  if (!sessionMemory) return null;
  return {
    ...sessionMemory,
    importFormats: { ...sessionMemory.importFormats },
    zipOverrides: { ...sessionMemory.zipOverrides },
    exportSettingsOverrides: cloneExportSettingsOverrides(sessionMemory.exportSettingsOverrides),
  };
}

export function saveBatchSessionMemory(
  config: BatchJobConfig,
  zipOverrides: Partial<Record<string, boolean>>,
  exportSettingsOverrides?: BatchExportSettingsOverrides,
): void {
  sessionMemory = {
    direction: config.direction,
    exportFormat: config.exportFormat,
    importAll: config.importAll,
    importFormats: { ...config.importFormats },
    sourceDir: config.sourceDir,
    destinationDir: config.destinationDir,
    includeSubfolders: config.includeSubfolders,
    keepTree: config.keepTree,
    inPlace: config.inPlace,
    fixBroken: config.fixBroken,
    overwrite: config.overwrite,
    parallel: config.parallel,
    workerCount: config.workerCount,
    zipOverrides: { ...zipOverrides },
    exportSettingsOverrides: cloneExportSettingsOverrides(exportSettingsOverrides),
  };
}

export function clearBatchSessionMemory(): void {
  sessionMemory = null;
}
