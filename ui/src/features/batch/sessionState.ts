/**
 * Feature 019 (T022; data-model.md §3): session-only in-memory persistence of non-destructive
 * Batch Converter choices. Cleared on editor restart; never writes to settings.json or storage,
 * and intentionally never retains `overwrite`.
 */

import type { BatchJobConfig, BatchSessionMemory } from './engine/types';

let sessionMemory: BatchSessionMemory | null = null;

export function getBatchSessionMemory(): BatchSessionMemory | null {
  if (!sessionMemory) return null;
  return {
    ...sessionMemory,
    importFormats: { ...sessionMemory.importFormats },
    zipOverrides: { ...sessionMemory.zipOverrides },
  };
}

export function saveBatchSessionMemory(
  config: BatchJobConfig,
  zipOverrides: Partial<Record<string, boolean>>,
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
    parallel: config.parallel,
    workerCount: config.workerCount,
    zipOverrides: { ...zipOverrides },
  };
}

export function clearBatchSessionMemory(): void {
  sessionMemory = null;
}
