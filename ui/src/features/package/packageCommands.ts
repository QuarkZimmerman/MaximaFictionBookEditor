/**
 * FBD ZIP Package mode lifecycle commands and FileFeature bridge (feature 022, T021).
 *
 * Owns `file.newPackage`, adding/removing/switching payload files, Save/Save As `.zip`, unsaved
 * package prompts, and clean transitions between FB2 and Package editing modes.
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { fileType } from '@/dialogs/fileTypes';
import type { FileFeature } from '@/features/file/fileCommands';
import { importDescription } from '@/features/transfer/importDescription';
import type { Document } from '@/model/document';
import { actions, emptyConversation, isRunLocked, type AppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';
import {
  RpcErrorCode,
  type FileFilter,
  type PackageEntryDto,
  type PackageRejectedFileDto,
} from '@/rpc/types';
import { getSourceEditor } from '@/views/source/sourceEditor';
import { resetSourceSession } from '@/views/source/sourceSession';

import { pickAndSetPackageCover, removePackageCover } from './packageCoverSync';

import {
  activePackageEntry,
  createEmptyPackageUiState,
  createOpenedPackageUiState,
  entryFromDto,
  proposedPackageSavePath,
  shouldConfirmRemoveEntry,
  syncActiveEntryDocument,
  type FbdPackageUiEntry,
  type FbdPackageUiState,
} from './packageSessionModel';

const BOOK_EXTENSIONS = [
  'epub',
  'mobi',
  'azw',
  'azw3',
  'prc',
  'pdf',
  'txt',
  'doc',
  'docx',
  'rtf',
  'djvu',
  'md',
  'odt',
  'html',
  'htm',
  'chm',
] as const;

function packageFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function addPayloadFilters(ctx: CommandContext): FileFilter[] {
  return [
    { name: ctx.t('package.dialogs.bookFormats'), extensions: [...BOOK_EXTENSIONS] },
    fileType(ctx.t('fileDialogs.types.all'), ['*']),
  ];
}

function saveZipFilters(ctx: CommandContext): FileFilter[] {
  return [{ name: ctx.t('package.dialogs.zipPackages'), extensions: ['zip'] }];
}

function formatRejectedFiles(
  ctx: CommandContext,
  rejected: readonly PackageRejectedFileDto[],
): string {
  const lines = rejected.map((item) => {
    const name = item.fileName || packageFileName(item.path);
    return ctx.t(`package.errors.${item.reason}`, {
      name,
      conflictWith: item.conflictWith ?? '',
    });
  });
  return [ctx.t('package.errors.rejectedHeader'), '', ...lines].join('\n');
}

function formatSaveFailureReason(ctx: CommandContext, error: unknown): string {
  if (error instanceof RpcError) {
    const data = (error.data ?? {}) as Record<string, unknown>;
    const reason = typeof data.reason === 'string' ? data.reason : '';
    const entry = typeof data.entry === 'string' ? data.entry : '';
    if (reason === 'emptyPackage') return ctx.t('package.errors.emptyPackageSave');
    if (reason === 'sourceMissing') return ctx.t('package.errors.sourceMissing', { entry });
    if (reason === 'sourceUnreadable') return ctx.t('package.errors.sourceUnreadable', { entry });
    if (reason === 'ioError') return error.message || ctx.t('package.errors.ioError');
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatOpenFailureReason(ctx: CommandContext, error: unknown): string {
  if (error instanceof RpcError) {
    const data = (error.data ?? {}) as Record<string, unknown>;
    const reason = typeof data.reason === 'string' ? data.reason : '';
    switch (reason) {
      case 'notZip':
      case 'damaged':
      case 'encrypted':
      case 'multiVolume':
      case 'noFbd':
      case 'noPayload':
        return ctx.t(`package.errors.${reason}`);
      case 'duplicateStem':
        return ctx.t('package.errors.archiveDuplicateStem');
      case 'fbdParseError':
        return ctx.t('package.errors.fbdParseError', {
          entry: String(data.entry ?? ''),
          line: Number(data.line ?? 0),
          column: Number(data.column ?? 0),
          detail: String(data.detail ?? error.message),
        });
      case 'fbdNotFictionBook':
        return ctx.t('package.errors.fbdNotFictionBook', {
          entry: String(data.entry ?? ''),
        });
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Flushes the currently active UI document (and idle AI conversation) back into `packageState`. */
function flushActiveEntry(store: AppStore): FbdPackageUiState | null {
  const state = store.getState();
  let pkg = state.packageState;
  if (!pkg || !pkg.activeEntryId) return pkg;
  if (state.document && state.document.docId === activePackageEntry(pkg)?.docId) {
    pkg = syncActiveEntryDocument(pkg, state.document, false);
  }
  const activeIdx = pkg.entries.findIndex((e) => e.entryId === pkg!.activeEntryId);
  if (activeIdx >= 0) {
    const cur = pkg.entries[activeIdx]!;
    if (cur.aiConversation !== state.ai.conversation) {
      const entries = pkg.entries.slice();
      entries[activeIdx] = { ...cur, aiConversation: state.ai.conversation };
      pkg = { ...pkg, entries };
    }
  }
  return pkg;
}

/** Swaps the store's active document/AI context to `entry` (or empty package state if `null`). */
function activateEntryInStore(
  ctx: CommandContext,
  pkg: FbdPackageUiState,
  entry: FbdPackageUiEntry | null,
): void {
  const { store, undo } = ctx;
  resetSourceSession(store);
  undo.clear();
  const nextPkg: FbdPackageUiState = {
    ...pkg,
    activeEntryId: entry ? entry.entryId : null,
  };
  const prevView = store.getState().activeView;
  const keepView = prevView === 'source' ? 'source' : 'description';
  store.setState({
    startup: 'ready',
    editorMode: 'package',
    packageState: nextPkg,
    docId: entry ? entry.docId : null,
    document: entry ? entry.document : null,
    path: nextPkg.zipPath,
    modified: nextPkg.modified,
    sourceOnly: false,
    sourceParseError: null,
    validation: null,
    activeView: keepView,
    ai: {
      ...store.getState().ai,
      conversation: entry?.aiConversation ?? emptyConversation(),
    },
  });
}

export class PackageFeature {
  private readonly files: FileFeature;

  constructor(files: FileFeature) {
    this.files = files;
  }

  register(registry: CommandRegistry): void {
    const commands: Command[] = [
      {
        id: 'file.newPackage',
        group: 'file',
        labelKey: 'menu.file.newPackage',
        tooltipKey: 'cmd.file.newPackage.tooltip',
        descriptionKey: 'cmd.file.newPackage.description',
        icon: 'id_file_new_package',
        enabled: (ctx) => ctx.store.getState().connection === 'connected',
        run: async (ctx) => {
          await this.newPackage(ctx);
        },
      },
    ];
    for (const command of commands) registry.replace(command);
  }

  /** Creates a new empty FBD ZIP package (prompting first if current FB2 or package has unsaved edits). */
  async newPackage(ctx: CommandContext): Promise<boolean> {
    const rpc = ctx.rpc;
    if (!rpc) return false;
    if (!(await this.files.confirmDiscardChanges(ctx))) return false;
    return this.enterEmptyPackage(ctx);
  }

  /** Starts an empty package without prompting (used at startup when `startupMode === 'package'`). */
  async startEmptyPackage(ctx: CommandContext): Promise<boolean> {
    if (!ctx.rpc) return false;
    return this.enterEmptyPackage(ctx);
  }

  private async enterEmptyPackage(ctx: CommandContext): Promise<boolean> {
    const rpc = ctx.rpc;
    if (!rpc) return false;
    const prev = ctx.store.getState();
    const fb2TreeWasVisible =
      prev.editorMode === 'package'
        ? (prev.packageState?.fb2TreeWasVisible ?? true)
        : prev.treeVisible;

    await this.closeActiveSessionBeforePackageSwitch(ctx);

    const created = await rpc.call('package.create', {});
    const pkg = createEmptyPackageUiState(created.packageId, fb2TreeWasVisible);
    ctx.store.setState({
      startup: 'ready',
      editorMode: 'package',
      packageState: pkg,
      treeVisible: true,
      activeView: 'description',
      docId: null,
      document: null,
      path: null,
      modified: false,
      sourceOnly: false,
      sourceParseError: null,
      validation: null,
      statusMessage: null,
      ai: {
        ...ctx.store.getState().ai,
        conversation: emptyConversation(),
      },
    });
    return true;
  }

  /** Opens an existing `.zip` FBD package (called via unified `File -> Open`, Recent Files, or CLI). */
  async openPackage(ctx: CommandContext, path: string): Promise<boolean> {
    const rpc = ctx.rpc;
    if (!rpc) return false;
    const prev = ctx.store.getState();
    const fb2TreeWasVisible =
      prev.editorMode === 'package'
        ? (prev.packageState?.fb2TreeWasVisible ?? true)
        : prev.treeVisible;

    let opened: {
      packageId: string;
      path: string;
      entries: PackageEntryDto[];
      preservedEntryCount: number;
    };
    try {
      opened = await rpc.runJob(
        'package.open',
        { path },
        { onProgress: (progress) => actions.setProgress(ctx.store, progress) },
      );
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.cancelled) {
        return false;
      }
      await ctx.dialogs.showMessage({
        text: ctx.t('package.errors.openFailed', {
          path,
          reason: formatOpenFailureReason(ctx, error),
        }),
        caption: ctx.t('dialog.error.caption'),
        icon: 'error',
        testId: 'package-open-failed',
      });
      return false;
    } finally {
      actions.setProgress(ctx.store, null);
    }

    await this.closeActiveSessionBeforePackageSwitch(ctx);

    const pkg = createOpenedPackageUiState(
      opened.packageId,
      opened.path,
      opened.entries,
      fb2TreeWasVisible,
    );
    const first = pkg.entries[0] ?? null;
    ctx.store.setState({
      treeVisible: true,
      activeView: 'description',
    });
    activateEntryInStore(ctx, pkg, first);

    const droppedAny = opened.entries.some((e) => e.droppedExtraImages > 0);
    actions.setStatusMessage(
      ctx.store,
      droppedAny
        ? ctx.t('package.status.droppedExtraImages')
        : ctx.t('package.status.opened', {
            path: packageFileName(opened.path),
            count: opened.entries.length,
          }),
    );
    void this.files.recent.refresh(rpc);
    return true;
  }

  private async closeActiveSessionBeforePackageSwitch(ctx: CommandContext): Promise<void> {
    const state = ctx.store.getState();
    if (state.editorMode === 'package' && state.packageState) {
      const oldId = state.packageState.packageId;
      await ctx.rpc?.call('package.close', { packageId: oldId }).catch(() => undefined);
      resetSourceSession(ctx.store);
      ctx.undo.clear();
    } else if (state.docId) {
      await this.files.closeCurrentDocument(ctx);
    }
  }

  /** Prompts Save / Don't Save / Cancel when leaving a modified package. */
  async confirmDiscardPackage(ctx: CommandContext): Promise<boolean> {
    const pkg = flushActiveEntry(ctx.store);
    if (!pkg || !pkg.modified) return true;
    const name = pkg.zipPath ? packageFileName(pkg.zipPath) : ctx.t('package.untitled');
    const answer = await ctx.dialogs.showMessage({
      text: ctx.t('package.dialogs.saveChanges', { name }),
      caption: ctx.t('app.name'),
      buttons: 'yesNoCancel',
      icon: 'question',
      testId: 'dialog-package-save-changes',
    });
    if (answer === 'cancel') return false;
    if (answer === 'yes') return this.savePackage(ctx, false);
    return true;
  }

  /** Closes the active package and restores FB2 workspace state (`treeVisible`, `editorMode`). */
  async closePackageToFb2(ctx: CommandContext): Promise<void> {
    const state = ctx.store.getState();
    const pkg = state.packageState;
    if (pkg && ctx.rpc) {
      await ctx.rpc.call('package.close', { packageId: pkg.packageId }).catch(() => undefined);
    }
    resetSourceSession(ctx.store);
    ctx.undo.clear();
    ctx.store.setState({
      editorMode: 'fb2',
      packageState: null,
      treeVisible: pkg ? pkg.fb2TreeWasVisible : state.treeVisible,
      activeView: 'body',
      docId: null,
      document: null,
      path: null,
      modified: false,
      sourceOnly: false,
      sourceParseError: null,
      validation: null,
      statusMessage: null,
      ai: {
        ...ctx.store.getState().ai,
        conversation: emptyConversation(),
      },
    });
  }

  /** Opens the multi-file book picker and adds selected files to the active package. */
  async addFilesWithDialog(ctx: CommandContext): Promise<void> {
    const rpc = ctx.rpc;
    const state = ctx.store.getState();
    if (!rpc || state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) {
      return;
    }
    const { paths } = await rpc.call('dialog.openFile', {
      title: ctx.t('package.dialogs.addTitle'),
      filters: addPayloadFilters(ctx),
      selectedFilter: 0,
      multiple: true,
    });
    if (!paths || paths.length === 0) return;
    await this.addFiles(ctx, paths);
  }

  /** Attaches one or more file paths to the active package and reports any rejected files. */
  async addFiles(ctx: CommandContext, paths: readonly string[]): Promise<void> {
    const rpc = ctx.rpc;
    const state = ctx.store.getState();
    if (!rpc || state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) {
      return;
    }
    const pkg = flushActiveEntry(ctx.store);
    if (!pkg) return;

    const result = await rpc.call('package.addFiles', {
      packageId: pkg.packageId,
      paths: [...paths],
    });

    if (result.added.length > 0) {
      const addedEntries = result.added.map(entryFromDto);
      const nextEntries = [...pkg.entries, ...addedEntries];
      const nextPkg: FbdPackageUiState = {
        ...pkg,
        entries: nextEntries,
        modified: true,
      };
      if (!pkg.activeEntryId) {
        activateEntryInStore(ctx, nextPkg, addedEntries[0]!);
      } else {
        ctx.store.setState({
          packageState: nextPkg,
          modified: true,
        });
      }
      actions.setStatusMessage(
        ctx.store,
        ctx.t('package.status.added', { count: result.added.length }),
      );
    }

    if (result.rejected.length > 0) {
      await ctx.dialogs.showMessage({
        text: formatRejectedFiles(ctx, result.rejected),
        caption: ctx.t('dialog.error.caption'),
        icon: 'warning',
        testId: 'package-add-rejected',
      });
    }
  }

  /** Switches active entry in Package mode without prompting (blocked while AI/script runs). */
  selectEntry(ctx: CommandContext, entryId: string): void {
    const state = ctx.store.getState();
    if (state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) return;
    if (state.packageState.activeEntryId === entryId) return;
    const pkg = flushActiveEntry(ctx.store);
    if (!pkg) return;
    const target = pkg.entries.find((e) => e.entryId === entryId);
    if (!target) return;
    activateEntryInStore(ctx, pkg, target);
  }

  /** Selects `entryId` and runs *Import description from FictionBook file...* against it. */
  async importDescriptionForEntry(ctx: CommandContext, entryId: string): Promise<boolean> {
    const state = ctx.store.getState();
    if (state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) return false;
    this.selectEntry(ctx, entryId);
    return importDescription(ctx);
  }

  /** Selects `entryId` and opens the cover image chooser to add or replace its single cover. */
  async pickCoverForEntry(ctx: CommandContext, entryId: string): Promise<void> {
    const state = ctx.store.getState();
    if (state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) return;
    this.selectEntry(ctx, entryId);
    const added = await pickAndSetPackageCover(ctx);
    if (added && ctx.store.getState().activeView === 'source') {
      void getSourceEditor(ctx.store)?.load(ctx);
    }
  }

  /** Selects `entryId` and clears its cover reference and binary cleanly. */
  async clearCoverForEntry(ctx: CommandContext, entryId: string): Promise<void> {
    const rpc = ctx.rpc;
    const state = ctx.store.getState();
    if (!rpc || state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) return;
    this.selectEntry(ctx, entryId);
    const doc = ctx.store.getState().document;
    if (!doc) return;
    await removePackageCover(rpc, ctx.store, doc.docId);
    if (ctx.store.getState().activeView === 'source') {
      void getSourceEditor(ctx.store)?.load(ctx);
    }
  }

  /** Removes a payload entry from the active package (with FR-010 confirmation when warranted). */
  async removeEntry(ctx: CommandContext, entryId: string): Promise<void> {
    const rpc = ctx.rpc;
    const state = ctx.store.getState();
    if (!rpc || state.editorMode !== 'package' || !state.packageState || isRunLocked(state)) {
      return;
    }
    const pkg = flushActiveEntry(ctx.store);
    if (!pkg) return;
    const idx = pkg.entries.findIndex((e) => e.entryId === entryId);
    if (idx < 0) return;
    const entry = pkg.entries[idx]!;

    if (shouldConfirmRemoveEntry(entry)) {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('package.dialogs.removeConfirm', { fileName: entry.fileName }),
        caption: ctx.t('app.name'),
        buttons: 'yesNo',
        icon: 'question',
        defaultButton: 'no',
        testId: 'dialog-package-remove-entry',
      });
      if (answer !== 'yes') return;
    }

    await rpc.call('package.removeEntry', {
      packageId: pkg.packageId,
      entryId,
    });

    const remaining = pkg.entries.filter((e) => e.entryId !== entryId);
    const modified = pkg.zipPath !== null || remaining.length > 0;
    const nextPkg: FbdPackageUiState = {
      ...pkg,
      entries: remaining,
      modified,
    };

    if (pkg.activeEntryId === entryId) {
      const nextActive = remaining[Math.min(idx, remaining.length - 1)] ?? null;
      activateEntryInStore(ctx, nextPkg, nextActive);
    } else {
      ctx.store.setState({
        packageState: nextPkg,
        modified,
      });
    }
    actions.setStatusMessage(
      ctx.store,
      ctx.t('package.status.removed', { fileName: entry.fileName }),
    );
  }

  /** Saves the active package to its `.zip` path (first Save or `saveAs` opens the Save As dialog). */
  async savePackage(ctx: CommandContext, saveAs: boolean): Promise<boolean> {
    const rpc = ctx.rpc;
    const state = ctx.store.getState();
    if (!rpc || state.editorMode !== 'package' || !state.packageState) return false;
    const pkg = flushActiveEntry(ctx.store);
    if (!pkg) return false;

    if (pkg.entries.length === 0) {
      await ctx.dialogs.showMessage({
        text: ctx.t('package.errors.emptyPackageSave'),
        caption: ctx.t('dialog.error.caption'),
        icon: 'warning',
        testId: 'package-save-empty',
      });
      return false;
    }

    let targetPath: string;
    if (!saveAs && pkg.zipPath) {
      targetPath = pkg.zipPath;
    } else {
      const defaultPath = proposedPackageSavePath(pkg, ctx.t('package.defaultMultiFileZipName'));
      const chosen = await rpc.call('dialog.saveFile', {
        title: ctx.t('package.dialogs.saveTitle'),
        filters: saveZipFilters(ctx),
        defaultPath,
        selectedFilter: 0,
        role: 'document',
      });
      if (!chosen.path) return false;
      targetPath = /\.zip$/i.test(chosen.path) ? chosen.path : `${chosen.path}.zip`;
    }

    const entryPayload = pkg.entries.map((e) => ({
      entryId: e.entryId,
      document: e.document,
    }));

    const runSave = async (force: boolean) =>
      rpc.runJob(
        'package.save',
        {
          packageId: pkg.packageId,
          path: targetPath,
          entries: entryPayload,
          force,
        },
        { onProgress: (progress) => actions.setProgress(ctx.store, progress) },
      );

    try {
      let result = await runSave(false);
      if (result.needsConfirmation) {
        const answer = await ctx.dialogs.showMessage({
          text: ctx.t('package.dialogs.saveValidationFailed', {
            count: result.totalErrorCount,
          }),
          caption: ctx.t('app.name'),
          buttons: 'yesNo',
          icon: 'warning',
          defaultButton: 'no',
          testId: 'dialog-package-save-validation',
        });
        if (answer !== 'yes') {
          const activeValidation =
            result.entryValidations.find((v) => v.entryId === pkg.activeEntryId) ??
            result.entryValidations.find((v) => v.errorCount > 0);
          if (activeValidation) {
            actions.setValidation(ctx.store, activeValidation.validation);
          }
          return false;
        }
        result = await runSave(true);
      }

      const updatedEntries: FbdPackageUiEntry[] = pkg.entries.map((entry) => {
        let doc: Document = entry.document;
        const newBins = result.updatedBinaries?.[entry.entryId];
        const newHref = result.updatedCoverHrefs?.[entry.entryId];
        if (newBins || newHref) {
          doc = {
            ...doc,
            ...(newBins ? { binaries: newBins } : {}),
            ...(newHref
              ? {
                  description: {
                    ...doc.description,
                    titleInfo: {
                      ...doc.description.titleInfo,
                      coverpage: [{ href: newHref }],
                    },
                  },
                }
              : {}),
          };
        }
        return {
          ...entry,
          originatedFromZip: true,
          hadFbd: true,
          descriptionModified: false,
          document: doc,
        };
      });

      const savedPkg: FbdPackageUiState = {
        ...pkg,
        zipPath: result.path,
        entries: updatedEntries,
        modified: false,
      };
      const active = activePackageEntry(savedPkg);
      ctx.store.setState({
        packageState: savedPkg,
        path: result.path,
        modified: false,
        document: active ? active.document : null,
      });

      const name = packageFileName(result.path);
      actions.setStatusMessage(
        ctx.store,
        result.totalErrorCount > 0
          ? ctx.t('package.status.savedWithErrors', {
              path: name,
              count: result.totalErrorCount,
            })
          : ctx.t('package.status.saved', { path: name }),
      );
      void this.files.recent.refresh(rpc);
      return true;
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.cancelled) {
        return false;
      }
      await ctx.dialogs.showMessage({
        text: ctx.t('package.errors.saveFailed', {
          path: targetPath,
          reason: formatSaveFailureReason(ctx, error),
        }),
        caption: ctx.t('dialog.error.caption'),
        icon: 'error',
        testId: 'package-save-failed',
      });
      return false;
    } finally {
      actions.setProgress(ctx.store, null);
    }
  }
}

export function registerPackageCommands(
  registry: CommandRegistry,
  files: FileFeature,
): PackageFeature {
  const feature = new PackageFeature(files);
  feature.register(registry);
  files.setPackageBridge({
    confirmDiscardPackage: (ctx) => feature.confirmDiscardPackage(ctx),
    closePackageToFb2: (ctx) => feature.closePackageToFb2(ctx),
    savePackage: (ctx, saveAs) => feature.savePackage(ctx, saveAs),
    openPackage: (ctx, path) => feature.openPackage(ctx, path),
    startEmptyPackage: (ctx) => feature.startEmptyPackage(ctx),
  });
  return feature;
}
