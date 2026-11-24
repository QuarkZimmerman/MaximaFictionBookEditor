/**
 * Feature 019 (T020; data-model.md §1–§6): shared data-model types for the Batch Converter.
 */

import type { BatchPersistedExportSettings, Settings } from '@/rpc/types';

export type BatchDirection = 'fb2ToExport' | 'importToFb2';

/** The five full-book formats supported in both directions (Q2: FBD excluded). */
export type BatchBookFormat = 'epub' | 'mobi' | 'pdf' | 'txt' | 'markdown';

/** Export formats that expose format-specific options (EPUB has none). */
export type BatchConfigurableExportFormat = 'mobi' | 'pdf' | 'txt' | 'markdown';

/**
 * Per-format export option overrides edited inside Batch Converter's batch-only Export settings
 * dialog; persisted in `<Config>/batch-converter.json` and never written to global settings.json.
 */
export interface BatchExportSettingsOverrides {
  pdf?: Partial<NonNullable<Settings['pdf']>>;
  txt?: Partial<NonNullable<Settings['txt']>>;
  mobi?: Partial<NonNullable<Settings['mobi']>>;
  markdown?: Partial<NonNullable<Settings['markdown']>>;
  [section: string]: Record<string, unknown> | undefined;
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
  fixBroken: boolean;
  sourceDir: string;
  includeSubfolders: boolean;
  inPlace: boolean;
  destinationDir: string;
  keepTree: boolean;
  overwrite: boolean;
  parallel: boolean;
  workerCount: number;
  pdfUseOcr: boolean;
  ocrAutoDetect: boolean;
  ocrLanguages: string[];
}

/**
 * Persistent UI memory (loaded from `<Config>/batch-converter.json` via `batch.settings.get` and
 * mirrored in memory as fallback when RPC is absent).
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
  fixBroken?: boolean;
  overwrite?: boolean;
  parallel?: boolean;
  workerCount?: number;
  pdfUseOcr?: boolean;
  ocrAutoDetect?: boolean;
  ocrLanguages?: string[];
  zipOverrides: Partial<Record<string, boolean>>;
  exportSettingsOverrides?: BatchExportSettingsOverrides;
  exportSettings?: BatchPersistedExportSettings;
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
  fixedCount: number;
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

export interface BatchOcrReportEntry {
  displayPath: string;
  sourcePath: string;
  targetPath: string;
  ocrPages: number;
  ocrImageBlocks: number;
  languages: string[];
  reason: string;
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
    fixed: number;
    ocr?: number;
    skipped: number;
    failed: number;
    cancelled: number;
  };
  fixed: BatchReportEntry[];
  failed: BatchReportEntry[];
  skipped: BatchReportEntry[];
  ocr?: BatchOcrReportEntry[];
  warnings: BatchReportWarningEntry[];
}
