/**
 * Feature 019 (T023; data-model.md §4): pure output path and compound-extension resolver
 * implementing the normative Output Path Resolution Table across POSIX and Windows paths.
 */

import type { MobiFormat, Settings } from '@/rpc/types';

import type { BatchDiscoveredItem, BatchJobConfig } from './types';

function detectSeparator(path: string): '/' | '\\' {
  if (path.includes('\\') && !path.includes('/')) return '\\';
  if (/^[A-Za-z]:\\/.test(path)) return '\\';
  return '/';
}

function stripTrailingSeparators(path: string): string {
  if (/^[A-Za-z]:[\\/]?$/.test(path)) return path.slice(0, 2) + detectSeparator(path);
  if (path === '/' || path === '\\') return path;
  return path.replace(/[\\/]+$/, '');
}

export function pathBasename(path: string): string {
  const clean = stripTrailingSeparators(path);
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  return idx >= 0 ? clean.slice(idx + 1) : clean;
}

export function pathDirname(path: string): string {
  const clean = stripTrailingSeparators(path);
  const idx = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
  if (idx < 0) return '';
  if (idx === 0) return clean[0]!;
  if (idx === 2 && /^[A-Za-z]:/.test(clean)) return clean.slice(0, 3);
  return clean.slice(0, idx);
}

export function joinPath(base: string, ...parts: string[]): string {
  const sep = detectSeparator(base);
  let result = stripTrailingSeparators(base);
  for (const raw of parts) {
    if (!raw) continue;
    const segments = raw
      .replace(/[\\/]+/g, '/')
      .split('/')
      .filter((s) => s.length > 0 && s !== '.');
    for (const seg of segments) {
      if (!result) {
        result = seg;
      } else if (result.endsWith('/') || result.endsWith('\\')) {
        result += seg;
      } else {
        result += sep + seg;
      }
    }
  }
  return result;
}

/**
 * Strips compound book archive extensions (`.fb2.zip`, `.md.zip`, `.markdown.zip`) first,
 * otherwise strips the final `.ext`.
 */
export function stripBookStem(filename: string): string {
  const lower = filename.toLowerCase();
  for (const suffix of ['.fb2.zip', '.md.zip', '.markdown.zip']) {
    if (lower.endsWith(suffix) && filename.length > suffix.length) {
      return filename.slice(0, filename.length - suffix.length);
    }
  }
  const dot = filename.lastIndexOf('.');
  if (dot > 0) {
    return filename.slice(0, dot);
  }
  return filename;
}

/** Returns the target file extension (including leading dot) per data-model.md §4 step 3. */
export function resolveTargetExtension(
  config: Pick<BatchJobConfig, 'direction' | 'exportFormat' | 'zipOutput'>,
  mobiFormat: MobiFormat = 'joint',
): string {
  if (config.direction === 'importToFb2') {
    return config.zipOutput ? '.fb2.zip' : '.fb2';
  }
  switch (config.exportFormat) {
    case 'epub':
      return '.epub';
    case 'mobi':
      if (config.zipOutput) return '.zip';
      return mobiFormat === 'kf8' ? '.azw3' : '.mobi';
    case 'pdf':
      return config.zipOutput ? '.zip' : '.pdf';
    case 'txt':
      return config.zipOutput ? '.zip' : '.txt';
    case 'markdown':
      return config.zipOutput ? '.md.zip' : '.md';
  }
}

export interface ResolvedBatchTarget {
  targetPath: string;
  /** Output base name without extension (e.g. used as `<stem>.fb2` inside `.fb2.zip`). */
  outputStem: string;
  extension: string;
}

/**
 * Computes the deterministic target file path for `item` under `config` and `settings`.
 */
export function resolveBatchTargetPath(
  item: BatchDiscoveredItem,
  config: BatchJobConfig,
  settings: Settings | null,
): ResolvedBatchTarget {
  const mobiFormat: MobiFormat = settings?.mobi?.format ?? 'joint';
  const extension = resolveTargetExtension(config, mobiFormat);

  let baseFolder: string;
  if (config.inPlace) {
    baseFolder = pathDirname(item.sourcePath);
  } else if (config.keepTree && item.relativeDir) {
    baseFolder = joinPath(config.destinationDir, item.relativeDir);
  } else {
    baseFolder = stripTrailingSeparators(config.destinationDir);
  }

  let outputDir = baseFolder;
  let outputStem: string;

  if (item.archiveEntry) {
    const archiveStem = item.archiveStem || stripBookStem(pathBasename(item.sourcePath));
    if (!item.archiveMultiBook) {
      outputStem = archiveStem;
    } else {
      const normalizedEntry = item.archiveEntry.replace(/\\/g, '/');
      const slash = normalizedEntry.lastIndexOf('/');
      const entryDir = slash >= 0 ? normalizedEntry.slice(0, slash) : '';
      const entryBase = slash >= 0 ? normalizedEntry.slice(slash + 1) : normalizedEntry;
      outputDir =
        config.keepTree && !config.inPlace && entryDir
          ? joinPath(baseFolder, archiveStem, entryDir)
          : joinPath(baseFolder, archiveStem);
      outputStem = stripBookStem(entryBase);
    }
  } else {
    outputStem = stripBookStem(pathBasename(item.sourcePath));
  }

  return {
    targetPath: joinPath(outputDir, outputStem + extension),
    outputStem,
    extension,
  };
}
