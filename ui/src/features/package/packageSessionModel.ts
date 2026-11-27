/**
 * FBD ZIP Package mode UI session state model (feature 022, data-model.md §3).
 *
 * Pure data structures and state helpers owned by `features/package/` so `model/store.ts` stays a
 * thin seam (`editorMode`, `toolbarNewAction`, `packageState`).
 */

import type { Document } from '@/model/document';
import type { AssistantConversation } from '@/model/store';
import type { PackageEntryDto } from '@/rpc/types';

export type EditorMode = 'fb2' | 'package';

/** One managed non-FB2 book file inside the active package with its own FBD model and idle AI chat. */
export interface FbdPackageUiEntry {
  entryId: string;
  docId: string;
  fileName: string;
  stem: string;
  extension: string;
  size: number;
  originatedFromZip: boolean;
  hadFbd: boolean;
  descriptionModified: boolean;
  document: Document;
  /** Separate in-memory AI conversation for this file (FR-021; never written to disk). */
  aiConversation: AssistantConversation | null;
}

/** Active FBD ZIP package state held in `AppState.packageState` while `editorMode === 'package'`. */
export interface FbdPackageUiState {
  packageId: string;
  zipPath: string | null;
  entries: FbdPackageUiEntry[];
  activeEntryId: string | null;
  modified: boolean;
  /** Snapshot of FB2 `store.treeVisible` taken on entering Package mode, restored on exit. */
  fb2TreeWasVisible: boolean;
}

export function entryFromDto(dto: PackageEntryDto): FbdPackageUiEntry {
  return {
    entryId: dto.entryId,
    docId: dto.docId,
    fileName: dto.fileName,
    stem: dto.stem,
    extension: dto.extension,
    size: dto.size,
    originatedFromZip: dto.originatedFromZip,
    hadFbd: dto.hadFbd,
    descriptionModified: false,
    document: dto.document,
    aiConversation: null,
  };
}

export function createEmptyPackageUiState(
  packageId: string,
  fb2TreeWasVisible: boolean,
): FbdPackageUiState {
  return {
    packageId,
    zipPath: null,
    entries: [],
    activeEntryId: null,
    modified: false,
    fb2TreeWasVisible,
  };
}

export function createOpenedPackageUiState(
  packageId: string,
  zipPath: string,
  dtos: readonly PackageEntryDto[],
  fb2TreeWasVisible: boolean,
): FbdPackageUiState {
  const entries = dtos.map(entryFromDto);
  return {
    packageId,
    zipPath,
    entries,
    activeEntryId: entries[0]?.entryId ?? null,
    modified: false,
    fb2TreeWasVisible,
  };
}

export function activePackageEntry(state: FbdPackageUiState | null): FbdPackageUiEntry | null {
  if (!state || !state.activeEntryId) return null;
  return state.entries.find((e) => e.entryId === state.activeEntryId) ?? null;
}

/** True if the entry's FBD description carries meaningful metadata or a cover image. */
export function hasNonEmptyDescription(doc: Document): boolean {
  const ti = doc.description.titleInfo;
  if (ti.bookTitle.trim().length > 0) return true;
  if (ti.genres.length > 0) return true;
  if (ti.coverpage.length > 0) return true;
  if (doc.binaries.length > 0) return true;
  if (ti.sequences.some((s) => s.name.trim().length > 0)) return true;
  if (
    ti.authors.some(
      (p) =>
        (p.firstName?.trim() ?? '') !== '' ||
        (p.middleName?.trim() ?? '') !== '' ||
        (p.lastName?.trim() ?? '') !== '' ||
        (p.nickname?.trim() ?? '') !== '',
    )
  ) {
    return true;
  }
  if (
    ti.translators.some(
      (p) =>
        (p.firstName?.trim() ?? '') !== '' ||
        (p.lastName?.trim() ?? '') !== '' ||
        (p.nickname?.trim() ?? '') !== '',
    )
  ) {
    return true;
  }
  if (ti.annotation && ti.annotation.content.length > 0) {
    const hasText = JSON.stringify(ti.annotation.content).includes('"text"');
    if (hasText) return true;
  }
  if (doc.description.customInfo.some((c) => c.text.trim().length > 0)) return true;
  const pi = doc.description.publishInfo;
  if (
    pi &&
    ((pi.bookName?.trim() ?? '') !== '' ||
      (pi.publisher?.trim() ?? '') !== '' ||
      (pi.isbn?.trim() ?? '') !== '' ||
      (pi.year?.trim() ?? '') !== '')
  ) {
    return true;
  }
  return false;
}

/**
 * FR-010 Remove confirmation rule: prompt Yes/No when the entry originated from the opened ZIP,
 * has been edited in this session, or holds non-empty metadata; remove immediately when newly
 * added with an untouched empty description.
 */
export function shouldConfirmRemoveEntry(entry: FbdPackageUiEntry): boolean {
  return (
    entry.originatedFromZip || entry.descriptionModified || hasNonEmptyDescription(entry.document)
  );
}

/**
 * FR-022 proposed Save As file name:
 * - Already saved/opened package -> its existing `zipPath`
 * - Unsaved 1-file package -> `<stem>.zip`
 * - Unsaved multi-file package -> `<defaultMultiName>.zip` (localized, e.g. `package.zip`)
 */
export function proposedPackageSavePath(pkg: FbdPackageUiState, defaultMultiName: string): string {
  if (pkg.zipPath) return pkg.zipPath;
  if (pkg.entries.length === 1 && pkg.entries[0]!.stem.trim().length > 0) {
    return `${pkg.entries[0]!.stem}.zip`;
  }
  const base = defaultMultiName.trim() || 'package';
  return `${base}.zip`;
}

/** Updates the active entry's document snapshot and marks the package modified. */
export function syncActiveEntryDocument(
  pkg: FbdPackageUiState,
  document: Document,
  markModified = true,
): FbdPackageUiState {
  if (!pkg.activeEntryId) return pkg;
  const idx = pkg.entries.findIndex((e) => e.entryId === pkg.activeEntryId);
  if (idx < 0) return pkg;
  const current = pkg.entries[idx]!;
  if (
    current.document === document &&
    (!markModified || (pkg.modified && current.descriptionModified))
  ) {
    return pkg;
  }
  const entries = pkg.entries.slice();
  entries[idx] = {
    ...current,
    document,
    descriptionModified: current.descriptionModified || markModified,
  };
  return {
    ...pkg,
    entries,
    modified: pkg.modified || markModified,
  };
}

/** Human-readable file size for the Package Files sidebar. */
export function formatPackageFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
