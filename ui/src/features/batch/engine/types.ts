/**
 * Feature 019 (T020; data-model.md §1–§6): shared data-model types for the Batch Converter.
 */

import type { Settings } from '@/rpc/types';

export type BatchDirection = 'fb2ToExport' | 'importToFb2';

/** The five full-book formats supported in both directions (Q2: FBD excluded). */
export type BatchBookFormat = 'epub' | 'mobi' | 'pdf' | 'txt' | 'markdown';

/** Export formats that expose format-specific options (EPUB has none). */
export type BatchConfigurableExportFormat = 'mobi' | 'pdf' | 'txt' | 'markdown';

/**
 * Session-only per-format export option overrides edited inside Batch Converter's
 * batch-only Export settings dialog; never written to global settings.json.
 */
export interface BatchExportSettingsOverrides {
  pdf?: Partial<NonNullable<Settings['pdf']>>;
  txt?: Partial<NonNullable<Settings['txt']>>;
  mobi?: Partial<NonNullable<Settings['mobi']>>;
  markdown?: Partial<NonNullable<Settings['markdown']>>;
}

export const BATCH_BOOK_FORMATS: readonly BatchBookFormat[] = [
  'epub',
  'mobi',
  'pdf',
  'txt',
  'markdown',
] as const;

export type BatchPhase = 'idle' | 'scanning' | 'converting' | 'cancelling' | 'finished';

export type BatchWorkStatus =
  'queued' | 'running' | 'converted' | 'skipped' | 'failed' | 'cancelled';

export type BatchSkipReason = 'targetExists' | 'targetBusy';

export interface BatchJobConfig {
  direction: BatchDirection;
  exportFormat: BatchBookFormat;
  importAll: boolean;
  importFormats: Record<BatchBookFormat, boolean>;
  zipOutput: boolean;
  sourceDir: string;
  includeSubfolders: boolean;
  inPlace: boolean;
  destinationDir: string;
  keepTree: boolean;
  overwrite: boolean;
  parallel: boolean;
  workerCount: number;
}

/**
 * Session-only UI memory (data-model.md §3). Never written to settings.json; `overwrite` is
 * intentionally excluded so reopening the dialog always starts with overwrite unchecked.
 */
export interface BatchSessionMemory {
  direction: BatchDirection;
  exportFormat: BatchBookFormat;
  importAll: boolean;
  importFormats: Record<BatchBookFormat, boolean>;
  sourceDir: string;
  destinationDir: string;
  includeSubfolders: boolean;
  keepTree: boolean;
  inPlace: boolean;
  parallel: boolean;
  workerCount: number;
  zipOverrides: Partial<Record<string, boolean>>;
  exportSettingsOverrides?: BatchExportSettingsOverrides;
}

export interface BatchDiscoveredItem {
  itemId: string;
  sourcePath: string;
  relativeDir: string;
  displayPath: string;
  format: 'fb2' | BatchBookFormat;
  archiveEntry?: string;
  archiveMultiBook: boolean;
  archiveStem?: string;
  archiveFbdEntry?: string;
  sizeBytes: number;
}

export interface BatchScanError {
  sourcePath: string;
  displayPath: string;
  reasonCode: string;
  detail?: string;
}

export interface BatchActiveWorker {
  slot: number;
  itemId: string;
  displayPath: string;
  stage: string;
  done: number;
  total: number;
}

export interface BatchProgressSnapshot {
  phase: BatchPhase;
  scannedCount: number;
  totalCount: number;
  completedCount: number;
  convertedCount: number;
  skippedCount: number;
  failedCount: number;
  cancelledCount: number;
  activeWorkers: BatchActiveWorker[];
}

export interface BatchReportEntry {
  displayPath: string;
  sourcePath: string;
  targetPath?: string;
  reason: string;
}

export interface BatchReportWarningEntry {
  displayPath: string;
  sourcePath: string;
  targetPath: string;
  messages: string[];
}

export interface BatchReport {
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  cancelled: boolean;
  config: BatchJobConfig;
  exportDefaultsSummary?: string;
  counts: {
    total: number;
    converted: number;
    skipped: number;
    failed: number;
    cancelled: number;
  };
  failed: BatchReportEntry[];
  skipped: BatchReportEntry[];
  warnings: BatchReportWarningEntry[];
}
