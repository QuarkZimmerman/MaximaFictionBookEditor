/**
 * File menu flows (T052): New, Open..., Save, Save As..., Validate, Exit, plus the Recent Files
 * list (T054), the external-change prompt and the `app.openPaths` / start-up handling.
 *
 * Contract usage (rpc-api.md §3.2):
 *  - `doc.open({path})` and `doc.save(...)` may answer with `{jobId}`; both go through
 *    `rpc.runJob()` so `job.progress` feeds the status bar and the final result arrives from
 *    `job.done`.
 *  - `doc.open` failing with `doc.parseError` (1001) shows the error with line/column, then
 *    `doc.openSource({path})` opens the raw text in Source-only mode (FR-021).
 *  - `doc.save({docId, document, path, encoding, force?})` - `encoding` is always sent
 *    explicitly: the Save As choice, or `keepEncoding ? sourceEncoding : defaultEncoding` for a
 *    plain Save; `{needsConfirmation, validation}` triggers the "Validation failed ..." prompt
 *    and a retry with `force: true`; `doc.ioError` (1002) shows "Cannot save ..." and leaves the
 *    document modified (the original file is intact: the core writes atomically).
 *  - `dialog.saveFile` gets the document's own file as `defaultPath`, or - for a never-saved
 *    document - the bare name composed from its description ("Last name First name - Book
 *    title", `proposedName.ts`; feature 004 FR-050 to FR-053), which the dialog places in the
 *    folder it remembers. The encoding chosen in the dialog applies to the content alone.
 *  - Pending Source text is parsed back (`doc.fromXml`) before Save/Validate/Exit; malformed
 *    text refuses the save, as the original editor did ("do not save bad xml").
 *  - `doc.watch` is enabled for opened files; `doc.changedOnDisk` asks to reload.
 *  - `doc.position` get/set implements Restore position (recent.ts; feature 004 US8): every
 *    route by which a document with a file leaves the editor - New, Open, Recent Files, a
 *    forwarded file, the changed-on-disk reload, every save, Exit, the window's close request
 *    and the restart (`leaveDocument`) - remembers the Body caret by its place in document
 *    order; every opening route restores it without switching the view.
 *  - `system.activateKeyboardLayout` is called once per document opened (`documentOpened`;
 *    feature 004 US11, FR-091) when "Switch keyboard layout when a document is opened" is on
 *    and a layout is chosen - at the two sinks of every opening route, `loadDocument` and
 *    `openSourceOnly`, so the start-up document, File > New, Open, Recent Files, a forwarded
 *    file, the restart's reopen, the changed-on-disk reload and a malformed file in the Source
 *    view each make exactly one request (SC-011); fire-and-forget, the result never shown.
 *  - Exit and the shell's window-close request (`app.closeRequested`, feature 003 FR-013) share
 *    one quit flow: while a script runs it first asks whether to cancel the run (Yes cancels it
 *    and waits for the document to be restored, No keeps the editor open), then the usual save
 *    prompt, then `app.quit`. While a script runs New, Open, Recent, Reload, Save and Save As
 *    are unavailable (the registry's default `duringScriptRun` policy); only Exit is allowed.
 */

import { isModalJobRunning } from '@/app/modalJob';
import { closePreview, currentPreview } from '@/features/preview/previewState';
import {
  currentDocumentName,
  switchView,
  type Command,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import { describeError, isClientSideError, logUiError } from '@/app/diagnostics';
import { ENCODING_CHOICES, normalizeEncoding } from '@/dialogs/encodings';
import type { StructuralPosition } from '@/editor/structuralPath';
import { documentFileTypes, openFileTypes } from '@/dialogs/fileTypes';
import type { Dialogs } from '@/dialogs/types';
import {
  showArchiveBookChooser,
  showEncodingDialog,
  showOpenElsewhereDialog,
  showSaveChangesPrompt,
  showSaveOptionsDialog,
} from '@/dialogs/show';
import { confirmSaveWithErrors } from '@/dialogs/validation';
import { getScriptsFeature } from '@/features/scripts';
import { flushSessionSave } from '@/features/settings/apply';
import type { Document, DocumentSource, ValidationReport } from '@/model/document';
import { actions, isRunLocked, kindFromPath, type AppStore, type FileKind } from '@/model/store';
import i18next, { type TFunction } from 'i18next';

import { RpcError, type RpcClient } from '@/rpc/client';
import { loadedDocument } from '@/rpc/loaded';
import {
  RpcErrorCode,
  type DocParseErrorData,
  type FileFilter,
  type LoadReport,
  type OpenRequest,
  type Settings,
} from '@/rpc/types';
import { cancelActiveRun } from '@/scripting/runSession';
import {
  commitPendingSource,
  isSourceTextDirty,
  resetSourceSession,
  setSourceOnlyText,
  sourceSession,
} from '@/views/source/sourceSession';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';

import { proposedFileName } from './proposedName';
import { keepsBackup, savedMessage } from './saveOutcome';
import {
  completeSaveTarget,
  proposedSavePath,
  rememberZipChoice,
  zipStartState,
} from './saveNames';
import { RecentFilesStore, rememberPosition, restorePosition } from './recent';

export { ENCODING_CHOICES };

/* ------------------------------------------------------------------------ */
/* Helpers                                                                  */
/* ------------------------------------------------------------------------ */

const isConnected = (ctx: CommandContext): boolean =>
  ctx.rpc !== null && ctx.store.getState().connection === 'connected';

const hasDocument = (ctx: CommandContext): boolean => ctx.store.getState().document !== null;

const connectedWithDocument = (ctx: CommandContext): boolean =>
  isConnected(ctx) && hasDocument(ctx);

function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function errorReason(error: unknown): string {
  if (error instanceof RpcError) {
    const data = error.data as { reason?: unknown } | undefined;
    if (data && typeof data.reason === 'string' && data.reason) return data.reason;
    // Stable RPC error names (`doc.ioError`, `dialog.unavailable`, ...) have catalogue entries.
    const key = `error.${error.message}`;
    if (i18next.exists(key)) return i18next.t(key, { ...(error.data as object) });
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function parseErrorData(error: unknown): DocParseErrorData | null {
  if (!(error instanceof RpcError) || error.code !== RpcErrorCode.docParseError) return null;
  const data = (error.data ?? {}) as Partial<DocParseErrorData>;
  return {
    line: typeof data.line === 'number' ? data.line : 0,
    column: typeof data.column === 'number' ? data.column : 0,
    message: typeof data.message === 'string' ? data.message : error.message,
  };
}

/** Open and Save As types: FictionBook files, FictionBook descriptors, All files (FR-010). */
export function documentFilters(ctx: Pick<CommandContext, 't'>): FileFilter[] {
  return documentFileTypes(ctx.t);
}

/**
 * The type Save As selects: the document's kind - FictionBook descriptors for a `.fbd` file, All
 * files for an `.xml` file, FictionBook files otherwise (Open always selects FictionBook files).
 */
export function saveAsSelectedType(kind: FileKind | null): number {
  if (kind === 'fbd') return 1;
  if (kind === 'xml') return 2;
  return 0;
}

/**
 * The bare file name Save As proposes for a never-saved document (feature 004, FR-050, FR-052;
 * research R6.1): "Last name First name - Book title" in the book's own letters, sanitised,
 * the interface language's "Untitled" when the description has neither, with the first
 * extension of the type selected when the dialog opens (`fb2` for All files). It names no
 * folder: every platform's dialog places it in the folder last used by Open or Save As.
 */
export function saveAsProposedName(
  ctx: Pick<CommandContext, 't'>,
  document: Document,
  selectedFilter: number,
): string {
  const extension = documentFileTypes(ctx.t)[selectedFilter]?.extensions[0];
  return proposedFileName(
    document.description,
    ctx.t('app.untitled'),
    extension && extension !== '*' ? extension : 'fb2',
  );
}

/** Encoding for a plain Save: "Keep encoding" ? the file's encoding : the default encoding. */
export function defaultSaveEncoding(store: AppStore): string {
  const state = store.getState();
  const settings = state.settings?.other;
  const source = normalizeEncoding(state.document?.sourceEncoding);
  if (settings?.keepEncoding && source) return source;
  return normalizeEncoding(settings?.defaultEncoding) ?? 'utf-8';
}

/** Empty description used for the Source-only placeholder document. */
/**
 * The message of an archive refusal (feature 009, FR-020, FR-021, rpc-api §1), or null when
 * `error` is not one.
 */
export function archiveErrorMessage(t: TFunction, error: unknown, path: string): string | null {
  if (!(error instanceof RpcError)) return null;
  const data = (error.data ?? {}) as { entry?: string; reason?: string };
  switch (error.code) {
    case RpcErrorCode.archiveUnsupported:
      return t('archive.msg.unsupported', { path });
    case RpcErrorCode.archiveNoBook:
      return t('archive.msg.noBook', { path });
    case RpcErrorCode.archiveEntryMissing:
      return t('archive.msg.missing', { path, entry: data.entry ?? '' });
    case RpcErrorCode.archiveEntryUnreadable: {
      if (data.reason === 'multiVolume') return t('archive.msg.multiVolume', { path });
      if (!data.entry) return t('archive.msg.archiveDamaged', { path });
      const reason = ['encrypted', 'method', 'tooLarge'].includes(data.reason ?? '')
        ? data.reason!
        : 'damaged';
      return t(`archive.msg.${reason}`, { path, entry: data.entry });
    }
    default:
      return null;
  }
}

/** Whether the archive a book came from holds only that book (D31: proposed for replacing). */
async function archiveHeldOnly(rpc: RpcClient, source: DocumentSource): Promise<boolean> {
  const inspected = await rpc
    .call('files.inspect', { path: source.archive, entryName: source.entry })
    .catch(() => null);
  return inspected?.kind === 'zip' && inspected.otherEntries === 0;
}

export function sourceOnlyDocument(docId: string, path: string, encoding: string): Document {
  return {
    modelVersion: 1,
    docId,
    path,
    fileKind: kindFromPath(path),
    sourceEncoding: encoding,
    schemaHint: 'unknown',
    stylesheets: [],
    description: {
      titleInfo: {
        genres: [],
        authors: [],
        bookTitle: '',
        coverpage: [],
        lang: '',
        translators: [],
        sequences: [],
      },
      documentInfo: {
        authors: [],
        date: { text: '' },
        srcUrls: [],
        id: '',
        version: '',
        publishers: [],
      },
      customInfo: [],
      outputs: [],
    },
    bodies: [],
    binaries: [],
    extras: [],
  };
}

/**
 * Longest wait for a cancelled script run to restore the document before the quit flow goes
 * on (the host restores it at once; FR-015 allows 2 s).
 */
export const CANCEL_RUN_WAIT_MS = 5000;

/** Resolves once the run lock is released (or after `timeoutMs`). */
function waitForScriptRunEnd(store: AppStore, timeoutMs = CANCEL_RUN_WAIT_MS): Promise<void> {
  if (!isRunLocked(store.getState())) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const unsubscribe = store.subscribe((state) => {
      if (!isRunLocked(state)) finish();
    });
    if (!isRunLocked(store.getState())) finish();
  });
}

/**
 * The hand-off when the open document leaves the editor (feature 004 FR-100; research R5.6):
 * its Body position is remembered (`doc.position`, a document with a file only), the file is
 * no longer watched and a pending session save is written. Shared by closing (New, Open,
 * Recent Files, a forwarded file, the reload), Exit, the window's close request and the
 * restart after a language change; nothing happens without a document.
 */
export async function leaveDocument(ctx: CommandContext): Promise<void> {
  const { store, rpc } = ctx;
  const state = store.getState();
  if (state.docId && rpc) {
    await rememberPosition(ctx, state.docId);
    try {
      await rpc.call('doc.watch', { docId: state.docId, enabled: false });
    } catch {
      // best effort
    }
  }
  await flushSessionSave(store);
}

/** The Body caret of the open document as a position to carry over a reload (null without one). */
function currentBodyPosition(ctx: CommandContext): StructuralPosition | null {
  if (!hasBodyController(ctx.store) || ctx.store.getState().sourceOnly) return null;
  return getBodyController(ctx.store).getPosition();
}

/** Longest wait of the keyboard layout hook for the settings of a start-up open. */
export const SETTINGS_WAIT_MS = 5000;

/**
 * The `other` settings: the store's at once, or - before `settings.get` answered at start-up,
 * when the file named on the command line is already opening - the first that arrive; null
 * when none come within `timeoutMs` (an older core without settings).
 */
function otherSettingsWhenKnown(
  store: AppStore,
  timeoutMs = SETTINGS_WAIT_MS,
): Promise<Settings['other'] | null> {
  const known = store.getState().settings;
  if (known) return Promise.resolve(known.other);
  return new Promise((resolve) => {
    let done = false;
    const finish = (other: Settings['other'] | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(other);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const unsubscribe = store.subscribe((state) => {
      if (state.settings) finish(state.settings.other);
    });
    const arrived = store.getState().settings;
    if (arrived) finish(arrived.other);
  });
}

/* ------------------------------------------------------------------------ */
/* The feature                                                              */
/* ------------------------------------------------------------------------ */

export interface FileFeatureOptions {
  /** Delay during which `doc.changedOnDisk` after our own save is ignored (ms). */
  selfSaveGraceMs?: number;
}

export interface QuitOptions {
  /**
   * The shell asked for the close (`app.closeRequested`): `app.quit` is called with
   * `force: true`, telling the shell the UI has finished its prompts (rpc-api.md §3.1).
   */
  force?: boolean;
}

export class FileFeature {
  readonly recent: RecentFilesStore;
  private lastSaveAt = 0;
  private reloadPromptOpen = false;
  /** A native file dialog of this copy is open (feature 008: the copy is busy). */
  private nativeDialogOpen = 0;
  /** The last state reported through app.copyState (feature 008). */
  private reportedCopyState = '';
  /** The opening question is on screen: the copy is busy for other requests (D6). */
  private openQuestionOpen = false;
  /** Request ids already handled: a relayed request is acted on once. */
  private readonly handledRequests = new Set<string>();
  private readonly selfSaveGraceMs: number;
  /** The open of the file named at start-up (`app.openPaths` before the start-up check). */
  private startupOpen: Promise<boolean> | null = null;
  private startupChecked = false;
  /** Bumped by File > New, Open and Recent Files: the start-up document is no longer wanted. */
  private userRequests = 0;
  /** A window-close request is being answered (its prompts are up). */
  private closeRequestPending = false;
  /**
   * The in-session Body caret handed over the changed-on-disk reload (feature 004 FR-101):
   * the reload keeps the caret where it was whatever the setting, so the next `openDocument`
   * restores it instead of asking the core for the record.
   */
  private pendingPosition: StructuralPosition | null = null;

  constructor(registry: CommandRegistry, options: FileFeatureOptions = {}) {
    this.selfSaveGraceMs = options.selfSaveGraceMs ?? 1500;
    this.recent = new RecentFilesStore(registry, (ctx, path, entry) =>
      this.openFromRecent(ctx, path, entry),
    );
    for (const command of this.createCommands()) registry.replace(command);
  }

  /* ---------------------------------------------------------------- prompts */

  /** "Save changes to <name>?" - true when the caller may proceed (saved or discarded). */
  async confirmDiscardChanges(ctx: CommandContext): Promise<boolean> {
    const state = ctx.store.getState();
    if (!state.document || (!state.modified && !isSourceTextDirty(ctx.store))) return true;
    const answer = await showSaveChangesPrompt(ctx.dialogs, currentDocumentName(ctx));
    if (answer === 'cancel') return false;
    if (answer === 'yes') return this.saveDocument(ctx, {});
    return true;
  }

  /**
   * Exit or window close while a script runs (feature 003 FR-013): "A script is running.
   * Cancel it and exit?" - Yes cancels the run through its run session (the script host's, or
   * the AI request's - whoever holds the lock; the question then names the AI request, feature
   * 005 FR-093) and waits until the document is restored (true), No keeps the run going
   * (false). True at once when no run holds the lock.
   */
  async confirmCancelRunningScript(ctx: CommandContext): Promise<boolean> {
    const lock = ctx.store.getState().runLock;
    if (!lock) return true;
    const answer = await ctx.dialogs.showMessage({
      text:
        lock.kind === 'ai' ? ctx.t('ai.stopConfirm.exitText') : ctx.t('msg.cancelRunningScript'),
      caption: lock.kind === 'ai' ? ctx.t('ai.stopConfirm.title') : ctx.t('app.name'),
      buttons: 'yesNo',
      icon: 'question',
      testId: 'cancel-run-prompt',
    });
    if (answer !== 'yes') return false;
    cancelActiveRun(ctx.store);
    const host = getScriptsFeature(ctx.store)?.host;
    if (host?.isRunning) host.cancel();
    await waitForScriptRunEnd(ctx.store);
    return true;
  }

  /* ------------------------------------------------------------------ close */

  /** Remembers the position, stops watching and closes the current document in the core. */
  /** Feature 010 (US8): the Markdown file each imported document came from, by docId. */
  private readonly importOrigins = new Map<string, string>();

  /**
   * Feature 010 (US8, D36): shows the document the Markdown import made - modified, tied to no
   * file. The window's book is closed only now that the new one exists; Save As proposes the
   * Markdown file's name with `.fb2` in its folder (FR-094).
   */
  async loadImported(
    ctx: CommandContext,
    document: Document & LoadReport,
    markdownPath: string,
  ): Promise<void> {
    await this.closeCurrentDocument(ctx);
    this.loadDocument(ctx, document);
    this.importOrigins.set(document.docId, markdownPath);
    actions.setModified(ctx.store, true);
  }

  private importedSaveName(docId: string | null): string | null {
    const origin = docId ? this.importOrigins.get(docId) : undefined;
    return origin ? `${origin.replace(/\.(md|markdown)$/i, '')}.fb2` : null;
  }

  async closeCurrentDocument(ctx: CommandContext): Promise<void> {
    const { store, rpc } = ctx;
    const state = store.getState();
    if (state.docId && rpc) {
      await leaveDocument(ctx);
      try {
        await rpc.call('doc.close', { docId: state.docId });
      } catch {
        // the core may already have dropped it
      }
    }
    resetSourceSession(store);
    ctx.undo.clear();
    actions.closeDocument(store);
    actions.setStatusMessage(store, null);
  }

  /**
   * Shows a document the core loaded. The details it filled in on load (`filledIn`) do not
   * mark it modified, as in the original; they are written at the next save. A template
   * document (File > New, the start-up document) also becomes the untouched baseline of the
   * description import (feature 004 US4, FR-033); Open sets none.
   */
  private loadDocument(
    ctx: CommandContext,
    document: Document & LoadReport,
    options: { template?: boolean } = {},
  ): void {
    resetSourceSession(ctx.store);
    ctx.undo.clear();
    const loaded = loadedDocument(document);
    actions.setDocument(ctx.store, loaded);
    if (options.template) actions.setNewDocumentBaseline(ctx.store, loaded.description);
    actions.setStatusMessage(ctx.store, null);
    if (ctx.store.getState().activeView === 'source') {
      // A new document always starts in the Body view unless it is Source-only.
      switchView(ctx, 'body');
    }
    this.documentOpened(ctx);
  }

  /**
   * A document was opened by any route (feature 004 US11, FR-091): with "Switch keyboard
   * layout when a document is opened" on and a layout chosen, asks the shell once to activate
   * it for the editor's window - fire-and-forget, the result never shown (a layout the system
   * no longer lists is not an error, a refused switch is logged by the core, an older core
   * answers -32601). The setting is read from the store; the first open of a start-up (the
   * file named on the command line arrives before `settings.get` answered) waits for the
   * settings to arrive and gives up quietly when they do not.
   */
  private documentOpened(ctx: CommandContext): void {
    const rpc = ctx.rpc;
    if (!rpc) return;
    void otherSettingsWhenKnown(ctx.store)
      .then((other) => {
        if (!other || !other.switchKeyboardLayout || !other.keyboardLayoutId) return undefined;
        return rpc.call('system.activateKeyboardLayout', { id: other.keyboardLayoutId });
      })
      .catch(() => {
        // never reported: the layout is a convenience, the document is open either way
      });
  }

  private async watch(ctx: CommandContext, docId: string, enabled: boolean): Promise<void> {
    try {
      await ctx.rpc?.call('doc.watch', { docId, enabled });
    } catch {
      // the watcher is optional (older core); external changes just go unnoticed
    }
  }

  /* -------------------------------------------------------------------- new */

  async newDocument(ctx: CommandContext): Promise<boolean> {
    if (!ctx.rpc) return false;
    this.userRequests += 1;
    if (!(await this.confirmDiscardChanges(ctx))) return false;
    await this.closeCurrentDocument(ctx);
    await this.createFromTemplate(ctx);
    return true;
  }

  /**
   * A new document from the effective template; a user template that was rejected is named.
   * `wanted` is asked again once the core answered (the start-up document gives way to a
   * document the user asked for meanwhile).
   */
  private async createFromTemplate(
    ctx: CommandContext,
    wanted: () => boolean = () => true,
  ): Promise<void> {
    if (!ctx.rpc) return;
    const document = await ctx.rpc.call('doc.new');
    if (!wanted()) {
      await ctx.rpc.call('doc.close', { docId: document.docId }).catch(() => {});
      return;
    }
    this.loadDocument(ctx, document, { template: true });
    const issue = document.templateIssue;
    if (issue) {
      await ctx.dialogs.showMessage({
        text: ctx.t('msg.templateIssue', {
          path: issue.path,
          reason: ctx.t(`msg.templateReason.${issue.reason}`),
        }),
        caption: ctx.t('app.name'),
        icon: 'warning',
        testId: 'dialog-template-issue',
      });
    }
  }

  /* ------------------------------------------------------------------- open */

  async openWithDialog(ctx: CommandContext): Promise<boolean> {
    if (!ctx.rpc) return false;
    this.userRequests += 1;
    if (!(await this.confirmDiscardChanges(ctx))) return false;
    this.nativeDialogOpen += 1;
    let paths: string[];
    try {
      ({ paths } = await ctx.rpc.call('dialog.openFile', {
        title: ctx.t('cmd.file.open.tooltip'),
        filters: openFileTypes(ctx.t),
        selectedFilter: 0,
        // Feature 011 (D32): only Open and Save As keep the folder they were left in.
        role: 'document',
      }));
    } finally {
      this.nativeDialogOpen -= 1;
    }
    const path = paths[0];
    if (!path) return false;
    if (await this.showHeldBook(ctx, path)) return true;
    return this.openDocument(ctx, path);
  }

  private async openFromRecent(
    ctx: CommandContext,
    path: string,
    entry?: string,
  ): Promise<boolean> {
    this.userRequests += 1;
    if (await this.showHeldBook(ctx, path, entry)) return true;
    if (!(await this.confirmDiscardChanges(ctx))) return false;
    return this.openDocument(ctx, path, entry);
  }

  /**
   * Feature 008 (FR-017): a book that is already open is never opened a second time. In this
   * copy nothing reopens; when another copy holds it, that copy comes to the front. True when
   * the book is shown that way.
   */
  private async showHeldBook(ctx: CommandContext, path: string, entry?: string): Promise<boolean> {
    const state = ctx.store.getState();
    // A book from a ZIP archive is the same book only for the same entry (feature 009, D11).
    if (state.path === path && state.document?.source?.entry === entry) {
      window.focus();
      return true;
    }
    if (!ctx.rpc) return false;
    try {
      const { slot } = await ctx.rpc.call('app.bookHolder', entry ? { path, entry } : { path });
      if (slot === null) return false;
      await ctx.rpc.call('app.activateCopy', { slot, path });
      return true;
    } catch {
      return false; // no copies (developer runs): open here as before
    }
  }

  /**
   * Feature 009 (D10, D32): the questions before a Save As writes - a completed name pointing
   * at an existing file (the system's dialog only checked the name as typed), and an archive
   * to replace that holds other files. No cancels the save.
   */
  private async confirmSaveTarget(
    ctx: CommandContext,
    chosen: string,
    target: { path: string; entryName?: string },
  ): Promise<boolean> {
    const rpc = ctx.rpc;
    if (!rpc) return false;
    const inspected = await rpc
      .call(
        'files.inspect',
        target.entryName
          ? { path: target.path, entryName: target.entryName }
          : { path: target.path },
      )
      .catch(() => null);
    if (target.path !== chosen && inspected?.exists) {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('dialog.saveFile.replaceCompleted', { path: target.path }),
        caption: ctx.t('app.name'),
        buttons: 'yesNo',
        icon: 'warning',
        testId: 'dialog-replace-completed',
      });
      if (answer !== 'yes') return false;
    }
    if (target.entryName && inspected?.kind === 'zip' && (inspected.otherEntries ?? 0) > 0) {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('dialog.saveFile.archiveOthers', {
          path: target.path,
          count: inspected.otherEntries,
        }),
        caption: ctx.t('app.name'),
        buttons: 'yesNo',
        icon: 'warning',
        testId: 'dialog-archive-others',
      });
      if (answer !== 'yes') return false;
    }
    return true;
  }

  /**
   * Feature 009 (D7): the book of a ZIP archive to open - undefined when `path` is not an
   * archive of books (a plain file opens as before), null when the user cancelled the chooser.
   */
  private async chooseArchiveBook(
    ctx: CommandContext,
    path: string,
  ): Promise<string | null | undefined> {
    const rpc = ctx.rpc;
    if (!rpc) return undefined;
    const inspected = await rpc.call('files.inspect', { path }).catch(() => null);
    if (!inspected || inspected.kind !== 'zip') return undefined;
    if (inspected.onlyBook !== undefined) return inspected.onlyBook;
    if ((inspected.books ?? 0) < 2) return undefined;
    const answer = await rpc.runJob('doc.open', { path });
    if (!('needsChoice' in answer)) {
      // Opened after all (the archive changed meanwhile): let the normal route reopen it.
      await rpc.call('doc.close', { docId: answer.document.docId }).catch(() => undefined);
      return undefined;
    }
    return showArchiveBookChooser(ctx.dialogs, answer.needsChoice, fileName(path));
  }

  /** Feature 008 (FR-011, clarify Q2): only what blocks the window makes this copy busy. */
  private copyBusy(ctx: CommandContext): boolean {
    return (
      this.openQuestionOpen ||
      ctx.dialogs.isModalOpen === true ||
      this.nativeDialogOpen > 0 ||
      isRunLocked(ctx.store.getState())
    );
  }

  /** Feature 008 (D2): a new document nothing was done to since it was made. */
  private copyUntouched(ctx: CommandContext): boolean {
    const state = ctx.store.getState();
    return state.path === null && !state.modified;
  }

  /** Reports this copy's state for its copy record (app.copyState), when it changed. */
  private reportCopyState(ctx: CommandContext): void {
    if (!ctx.rpc) return;
    const state = ctx.store.getState();
    const next = {
      state: this.copyBusy(ctx) ? ('busy' as const) : ('ready' as const),
      untouched: this.copyUntouched(ctx),
      path: state.path ?? '',
    };
    const key = JSON.stringify(next);
    if (key === this.reportedCopyState) return;
    this.reportedCopyState = key;
    void ctx.rpc.call('app.copyState', next).catch(() => undefined);
  }

  /**
   * Feature 008 (rpc-api.md §1): a book request relayed from another start. Acknowledged at
   * once (the shell's 5 s timer); then, per book in order: already open here - focus; this copy
   * busy - a new copy; an untouched document - open here; else the remembered choice or the
   * question (default New window).
   */
  async handleOpenRequest(ctx: CommandContext, request: OpenRequest): Promise<void> {
    const { rpc } = ctx;
    if (!rpc) return;
    if (this.handledRequests.has(request.requestId)) return;
    this.handledRequests.add(request.requestId);
    void rpc.call('app.openRequestAck', { requestId: request.requestId }).catch(() => undefined);
    window.focus();
    if (request.kind === 'activate') return;
    for (const path of request.paths) {
      // Each book is its own request (FR-012): once a question is on screen the copy is busy,
      // so the books after it go to new copies (D6) instead of waiting for the answer.
      const handled = this.handleOneBook(ctx, path);
      if (!this.openQuestionOpen) await handled;
    }
  }

  private async handleOneBook(ctx: CommandContext, path: string): Promise<void> {
    const { rpc } = ctx;
    if (!rpc || ctx.store.getState().path === path) return;
    if (this.copyBusy(ctx)) {
      await rpc.call('app.openInNewCopy', { paths: [path] }).catch(() => undefined);
      return;
    }
    if (this.copyUntouched(ctx)) {
      await this.openDocument(ctx, path);
      return;
    }
    let choice = ctx.store.getState().settings?.other.openFromOutside ?? 'ask';
    if (choice === 'ask') {
      this.openQuestionOpen = true;
      this.reportCopyState(ctx);
      let answer: Awaited<ReturnType<typeof showOpenElsewhereDialog>> | undefined;
      try {
        answer = await showOpenElsewhereDialog(ctx.dialogs, fileName(path));
      } finally {
        this.openQuestionOpen = false;
        this.reportCopyState(ctx);
      }
      if (!answer || answer.choice === 'cancel') return;
      choice = answer.choice;
      if (answer.remember) {
        await rpc
          .call('settings.set', { patch: { other: { openFromOutside: choice } } })
          .catch(() => undefined);
      }
    }
    if (choice === 'newWindow') {
      await rpc.call('app.openInNewCopy', { paths: [path] }).catch(() => undefined);
    } else if (await this.confirmDiscardChanges(ctx)) {
      await this.openDocument(ctx, path);
    }
  }

  /**
   * Opens `path` (the current document is closed first). Shows the open-failure or
   * parse-error messages; Source-only mode for malformed files. Returns true when a document
   * (model or raw text) is now open.
   */
  async openDocument(ctx: CommandContext, path: string, entry?: string): Promise<boolean> {
    const { store, rpc } = ctx;
    if (!rpc) return false;
    // Feature 009: a ZIP archive of several books asks which one before the window's book is
    // closed, so Cancel leaves it as it was (D7); one of a single book is opened by its entry,
    // so the one-window rule sees the book itself (D11, FR-015).
    if (entry === undefined && /\.zip$/i.test(path)) {
      const chosen = await this.chooseArchiveBook(ctx, path);
      if (chosen === null) return false;
      if (chosen !== undefined) {
        if (await this.showHeldBook(ctx, path, chosen)) return true;
        entry = chosen;
      }
    }
    const pending = this.pendingPosition;
    this.pendingPosition = null;
    // Feature 010 (US10, D36): the new file is read before the window's book is closed, so a
    // file that cannot be opened leaves that book - its unsaved changes and its undo history -
    // exactly as it was, whatever the way of opening (Open, Recent files, a drop, a relayed book,
    // the reload).
    try {
      let result = await rpc.runJob('doc.open', entry ? { path, entry } : { path }, {
        onProgress: (progress) => actions.setProgress(store, progress),
      });
      if ('needsChoice' in result) {
        // An archive without the .zip name: asked while the window's book is still open.
        const chosen = await showArchiveBookChooser(
          ctx.dialogs,
          result.needsChoice,
          fileName(path),
        );
        if (chosen === null) return false;
        entry = chosen;
        result = await rpc.runJob(
          'doc.open',
          { path, entry },
          { onProgress: (progress) => actions.setProgress(store, progress) },
        );
        if ('needsChoice' in result) return false;
      }
      await this.closeCurrentDocument(ctx);
      this.loadDocument(ctx, result.document);
      if (result.warnings.length > 0) {
        actions.setStatusMessage(
          store,
          ctx.t('status.openedWithWarnings', { count: result.warnings.length }),
        );
      }
      // An archive is not watched: the editor never saves into it (D9, DP-10).
      await this.watch(ctx, result.document.docId, !result.document.source);
      void this.recent.refresh(rpc);
      // Every opening route ends here (Open, Recent Files, the command line, a forwarded file,
      // the `?open=` restart, the reload): the remembered place - or the reload's own caret -
      // is restored in the Body controller without a view switch (FR-101).
      void restorePosition(ctx, result.document.docId, pending);
      return true;
    } catch (error) {
      // Not a FictionBook file at all (binary, plain text, other XML): refused outright.
      // Source-only mode below is reserved for malformed files that still carry the tag.
      if (error instanceof RpcError && error.code === RpcErrorCode.docNotFictionBook) {
        await ctx.dialogs.showMessage({
          text: ctx.t('msg.notFictionBook', { path }),
          caption: ctx.t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-not-fictionbook',
        });
        void this.recent.refresh(rpc);
        return false;
      }
      const archiveMessage = archiveErrorMessage(ctx.t, error, path);
      if (archiveMessage) {
        await ctx.dialogs.showMessage({
          text: archiveMessage,
          caption: ctx.t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-archive-error',
        });
        void this.recent.refresh(rpc);
        // A remembered book no longer in its archive: the chooser offers the others (FR-014).
        if (
          error instanceof RpcError &&
          error.code === RpcErrorCode.archiveEntryMissing &&
          Number((error.data as { books?: number } | undefined)?.books ?? 0) > 0
        ) {
          return this.openDocument(ctx, path);
        }
        return false;
      }
      const parseError = parseErrorData(error);
      if (parseError) return this.openSourceOnly(ctx, path, parseError, entry);
      // Core-side failures (I/O, parse) are logged by the core; log the client-side ones.
      if (isClientSideError(error)) {
        void logUiError(rpc, {
          code: 'file.openFailed',
          ...describeError(error),
          context: { path },
        });
      }
      await ctx.dialogs.showMessage({
        text: ctx.t('msg.openFailed', { path, reason: errorReason(error) }),
        caption: ctx.t('dialog.error.caption'),
        icon: 'error',
        testId: 'dialog-open-failed',
      });
      void this.recent.refresh(rpc);
      return false;
    } finally {
      actions.setProgress(store, null);
    }
  }

  /** Malformed XML: report line/column, then open the raw text in Source-only mode. */
  private async openSourceOnly(
    ctx: CommandContext,
    path: string,
    parseError: DocParseErrorData,
    entry?: string,
  ): Promise<boolean> {
    const { store, rpc } = ctx;
    if (!rpc) return false;
    await ctx.dialogs.showMessage({
      text: ctx.t('msg.xmlParseError', {
        where: fileName(path),
        line: parseError.line,
        column: parseError.column,
        message: parseError.message,
      }),
      caption: ctx.t('msg.xmlParseErrorCaption'),
      icon: 'error',
      testId: 'dialog-parse-error',
    });
    try {
      const source = await rpc.call('doc.openSource', entry ? { path, entry } : { path });
      if ('needsChoice' in source) return false;
      const error = source.error ?? parseError;
      // A malformed file still opens, in the Source view: only now is the window's book closed.
      await this.closeCurrentDocument(ctx);
      resetSourceSession(store);
      ctx.undo.clear();
      const document = sourceOnlyDocument(source.docId, path, source.encoding);
      actions.setDocument(
        store,
        source.source ? { ...document, source: source.source } : document,
        { sourceOnly: true },
      );
      setSourceOnlyText(store, source.docId, source.text);
      sourceSession(store).pendingCaret = { line: error.line, column: error.column };
      actions.setSourceParseError(store, error);
      actions.setStatusMessage(
        store,
        ctx.t('msg.xmlParseError', {
          where: fileName(path),
          line: error.line,
          column: error.column,
          message: error.message,
        }),
      );
      this.documentOpened(ctx); // a malformed file in the Source view is a document opened
      await this.watch(ctx, source.docId, !source.source);
      void this.recent.refresh(rpc);
      return true;
    } catch (error) {
      await ctx.dialogs.showMessage({
        text: ctx.t('msg.openFailed', { path, reason: errorReason(error) }),
        caption: ctx.t('dialog.error.caption'),
        icon: 'error',
        testId: 'dialog-open-failed',
      });
      return false;
    }
  }

  /* ------------------------------------------------------------------- save */

  /** Save / Save As. Returns true when the file was written. */
  /** The book's validation as Save judges it (no panel, no message), or null without a core. */
  private async validationBeforeSave(ctx: CommandContext): Promise<ValidationReport | null> {
    const { store, rpc } = ctx;
    const state = store.getState();
    if (!rpc || !state.document || !state.docId) return null;
    const session = sourceSession(store);
    const useText = (state.sourceOnly || state.sourceDirty) && session.text !== null;
    const report = await rpc.runJob(
      'doc.validate',
      useText
        ? { docId: state.docId, text: session.text ?? '' }
        : { docId: state.docId, document: state.document },
      { onProgress: (progress) => actions.setProgress(store, progress) },
    );
    actions.setProgress(store, null);
    return report;
  }

  async saveDocument(ctx: CommandContext, options: { saveAs?: boolean }): Promise<boolean> {
    const { store, rpc } = ctx;
    if (!rpc) return false;
    // Pending Source text first: malformed XML is never saved.
    const commit = await commitPendingSource(ctx);
    if (commit === 'error') return false;
    const state = store.getState();
    if (!state.document || !state.docId) return false;

    let path = state.path ?? undefined;
    let encoding: string | null;
    let force = false;
    // Feature 009: a book from a ZIP archive is never saved back into it - every way of saving
    // shows the Save As dialog (D8, D30, FR-017), whose checkbox writes a new ZIP archive.
    const source = state.document.source;
    let archive: { entryName: string } | undefined;
    let zipChecked: boolean | null = null;
    if (options.saveAs || !path || source) {
      // The validation question comes before the dialog (the requester at the smoke test of
      // 0.0.7-rc.5): who does not want an invalid book saved stops here, choosing no file.
      const report = await this.validationBeforeSave(ctx);
      if (report && report.errorCount > 0) {
        if (!(await confirmSaveWithErrors(ctx.dialogs, ctx.t, report))) return false;
        force = true;
      }
      const selectedFilter = saveAsSelectedType(state.fileKind);
      const startChecked = zipStartState(source !== undefined);
      // The document's own file, or - never saved - the bare name composed from its
      // description, which the dialog places in the folder it remembers (FR-050, FR-053).
      const current =
        path ??
        this.importedSaveName(state.docId) ??
        saveAsProposedName(ctx, state.document, selectedFilter);
      const defaultPath =
        source || startChecked
          ? proposedSavePath({
              current,
              source,
              archiveHeldOnlyThisBook: source ? await archiveHeldOnly(rpc, source) : false,
              checked: startChecked,
            })
          : current;
      const choice = await rpc.call('dialog.saveFile', {
        title: ctx.t('cmd.file.saveAs.tooltip'),
        role: 'document',
        filters: documentFilters(ctx),
        selectedFilter,
        defaultPath,
        encodingChoices: [...ENCODING_CHOICES],
        selectedEncoding: defaultSaveEncoding(store),
        encodingLabel: ctx.t('dialog.saveFile.encoding'),
        zipChoice: { label: ctx.t('dialog.saveFile.zip'), checked: startChecked },
      });
      if (!choice.path) return false;
      encoding = normalizeEncoding(choice.encoding);
      let zip = choice.zip;
      // A dialog without the checkbox: the editor's own window asks when the box matters (a
      // book from an archive, or a box that starts ticked); otherwise it stays unticked.
      if (zip === undefined && (source !== undefined || startChecked)) {
        const answer = await showSaveOptionsDialog(ctx.dialogs, {
          defaultEncoding: encoding ?? defaultSaveEncoding(store),
          path: choice.path,
          zip: startChecked,
        });
        if (!answer) return false;
        encoding = answer.encoding;
        zip = answer.zip;
      }
      zip = zip ?? false;
      // The platform dialogs return the encoding chosen inside them; answers without one (the
      // queued test dialogs, CEF's fallback dialog) get the original's choice in a window.
      if (!encoding) {
        encoding = await showEncodingDialog(ctx.dialogs, {
          defaultEncoding: defaultSaveEncoding(store),
          path: choice.path,
        });
        if (!encoding) return false;
      }
      const target = completeSaveTarget(choice.path, zip, {
        descriptor: state.fileKind === 'fbd',
        sourceEntry: source?.entry,
      });
      if (!(await this.confirmSaveTarget(ctx, choice.path, target))) return false;
      path = target.path;
      archive = target.entryName ? { entryName: target.entryName } : undefined;
      zipChecked = zip;
    } else {
      encoding = defaultSaveEncoding(store);
    }

    for (;;) {
      const current = store.getState();
      if (!current.document || !current.docId) return false;
      try {
        const result = await rpc.runJob(
          'doc.save',
          {
            docId: current.docId,
            document: current.document,
            path,
            encoding,
            force,
            backup: keepsBackup(store),
            ...(archive ? { archive } : {}),
          },
          { onProgress: (progress) => actions.setProgress(store, progress) },
        );
        actions.setProgress(store, null);
        if (result.needsConfirmation) {
          if (!(await confirmSaveWithErrors(ctx.dialogs, ctx.t, result.validation))) return false;
          force = true;
          continue;
        }
        this.lastSaveAt = Date.now();
        // The file holds the document as it was when the save began. A key typed while the core
        // wrote it moved the store's model on: that edit stays, and the book stays modified
        // (feature 007, US2: no key loses the user's work). Another document opened meanwhile
        // is left alone.
        const after = store.getState();
        if (after.docId !== current.docId || !after.document) return true;
        const editedMeanwhile = after.document !== current.document;
        if (zipChecked !== null) rememberZipChoice(zipChecked);
        // Once saved, the book is tied to the file just written (DP-5 remark): no archive
        // after a plain save, the new archive after a ZIP save (D30).
        const saved: Document = {
          ...after.document,
          path: result.path,
          sourceEncoding: result.encoding,
          fileKind: kindFromPath(result.source?.entry ?? result.path),
        };
        if (result.source) saved.source = result.source;
        else delete saved.source;
        store.setState({ document: saved });
        actions.markSaved(store, result.path, saved.fileKind);
        if (editedMeanwhile) store.setState({ modified: true, sourceDirty: after.sourceDirty });
        actions.setStatusMessage(store, savedMessage(ctx.t, result));
        if (store.getState().validation) actions.setValidation(store, result.validation);
        // Save's validation checked what was saved: the validity pane's, unless edited since.
        if (result.validation && !editedMeanwhile) {
          actions.setLastCheck(store, result.validation.errorCount);
        }
        // A plain file is watched again; an archive is not (D9, FR-028).
        await this.watch(ctx, current.docId, !result.source);
        // Every save remembers the position, under the saved path (FR-100).
        void rememberPosition(ctx, current.docId);
        void this.recent.refresh(rpc);
        return true;
      } catch (error) {
        actions.setProgress(store, null);
        // doc.ioError and friends are logged by the core (rpc.doc.ioError with docId/path);
        // a timeout or lost connection is a client-side failure logged here.
        if (isClientSideError(error)) {
          void logUiError(rpc, {
            code: 'file.saveFailed',
            ...describeError(error),
            context: { docId: current.docId, path },
          });
        }
        await ctx.dialogs.showMessage({
          text: ctx.t('msg.saveFailed', { path: path ?? '', reason: errorReason(error) }),
          caption: ctx.t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-save-failed',
        });
        return false; // the document stays modified; the file on disk is untouched
      }
    }
  }

  /* --------------------------------------------------------------- validate */

  async validateDocument(ctx: CommandContext): Promise<ValidationReport | null> {
    const { store, rpc } = ctx;
    const state = store.getState();
    if (!rpc || !state.document || !state.docId) return null;
    const session = sourceSession(store);
    const useText = (state.sourceOnly || state.sourceDirty) && session.text !== null;
    const report = await rpc.runJob(
      'doc.validate',
      useText
        ? { docId: state.docId, text: session.text ?? '' }
        : { docId: state.docId, document: state.document },
      { onProgress: (progress) => actions.setProgress(store, progress) },
    );
    actions.setProgress(store, null);
    actions.setValidation(store, report);
    // Feature 009 (FR-055): the validity pane shows this result until the content changes.
    actions.setLastCheck(store, report.errorCount);
    actions.setStatusMessage(
      store,
      report.errorCount === 0
        ? ctx.t('status.noErrors')
        : ctx.t('msg.errorsFound', { count: report.errorCount }),
    );
    return report;
  }

  /* ------------------------------------------------------------------- exit */

  /**
   * The quit flow of File > Exit and of the window's close request: the cancel-run prompt
   * while a script runs, the save prompt, then `app.quit`. Either prompt's refusal keeps the
   * editor open and the run going. A session save still waiting for its delay (the tree pane
   * width of a drag just before the exit, feature 004 FR-003) is written before the quit.
   */
  async exitApplication(ctx: CommandContext, options: QuitOptions = {}): Promise<void> {
    if (!(await this.confirmCancelRunningScript(ctx))) return;
    if (!(await this.confirmDiscardChanges(ctx))) return;
    const state = ctx.store.getState();
    await leaveDocument(ctx);
    if (ctx.rpc && state.connection === 'connected') {
      await ctx.rpc.call('app.quit', options.force ? { force: true } : {});
    } else {
      window.close();
    }
  }

  /**
   * `app.closeRequested` (rpc-api.md §3.1, feature 003): the shell deferred the close of its
   * window - title-bar close, system shutdown - and waits for the UI to run its quit flow,
   * which ends in `app.quit({force: true})`; a refused prompt leaves the window open. One
   * request at a time: a second one while the prompts are up is ignored, and a request that
   * arrives while another dialog is open (a prompt of New/Open, Settings, a native file
   * dialog) is ignored too, as a native window refuses to close behind its modal dialog - the
   * user finishes that dialog and closes again. A running modal job (feature 011) is treated the
   * same way: the window stays until the job ends or is cancelled.
   */
  async handleCloseRequested(ctx: CommandContext): Promise<void> {
    if (this.closeRequestPending) return;
    const dialogs = ctx.dialogs as Dialogs & { service?: { isModalOpen: boolean } };
    // Feature 011 (DP-11): a modal job (the Markdown export, Preview preparing) refuses the close.
    if (dialogs.service?.isModalOpen || ctx.rpc?.fileDialogOpen || isModalJobRunning()) return;
    // Feature 011 (rc.3 smoke test): the window's close button closes an open Preview, as Esc does;
    // the window itself stays (its prompts would open behind Preview).
    if (currentPreview() !== null) {
      closePreview();
      return;
    }
    this.closeRequestPending = true;
    try {
      await this.exitApplication(ctx, { force: true });
    } finally {
      this.closeRequestPending = false;
    }
  }

  /* ---------------------------------------------------------- notifications */

  /**
   * Subscribes to `doc.changedOnDisk` (reload prompt), `app.openPaths` (open the forwarded
   * file) and `app.closeRequested` (the window-close quit flow). Returns the unsubscribe
   * function.
   */
  subscribeNotifications(rpc: RpcClient, getContext: () => CommandContext): () => void {
    const offChanged = rpc.on('doc.changedOnDisk', (payload) => {
      void this.handleChangedOnDisk(getContext(), payload.docId, payload.path);
    });
    const offOpen = rpc.on('app.openPaths', (payload) => {
      const path = payload.paths[0];
      if (!path) return;
      const ctx = getContext();
      const opening = this.showHeldBook(ctx, path).then(async (shown) =>
        shown ? true : (await this.confirmDiscardChanges(ctx)) && this.openDocument(ctx, path),
      );
      if (!this.startupChecked) this.startupOpen = opening;
    });
    const offRequest = rpc.on('app.openRequest', (payload) => {
      void this.handleOpenRequest(getContext(), payload);
    });
    const offActivated = rpc.on('app.activated', () => {
      window.focus();
    });
    const report = () => this.reportCopyState(getContext());
    const offStore = getContext().store.subscribe(report);
    const offDialogs = getContext().dialogs.subscribe?.(report) ?? (() => undefined);
    report();
    const offClose = rpc.on('app.closeRequested', () => {
      void this.handleCloseRequested(getContext());
    });
    return () => {
      offChanged();
      offOpen();
      offRequest();
      offActivated();
      offStore();
      offDialogs();
      offClose();
    };
  }

  async handleChangedOnDisk(ctx: CommandContext, docId: string, path: string): Promise<void> {
    const state = ctx.store.getState();
    if (state.docId !== docId || this.reloadPromptOpen) return;
    if (Date.now() - this.lastSaveAt < this.selfSaveGraceMs) return; // our own save
    this.reloadPromptOpen = true;
    try {
      const answer = await ctx.dialogs.showMessage({
        text: ctx.t('msg.fileChanged', { name: fileName(path) }),
        caption: ctx.t('msg.fileChangedCaption'),
        buttons: 'yesNo',
        icon: 'question',
        testId: 'dialog-file-changed',
      });
      if (answer === 'yes') {
        // The reload keeps the active view and the in-session caret (001 FR-006, 004 FR-101):
        // the Body caret as it is now travels to the reopened document directly.
        this.pendingPosition = currentBodyPosition(ctx);
        await this.openDocument(ctx, path);
      }
    } finally {
      this.reloadPromptOpen = false;
    }
  }

  /**
   * Start-up, once the core is connected (feature 002 FR-001, FR-003): as in the original, a
   * new document from the template unless the file named at start-up opened (a malformed one
   * opens in the Source view); a file that does not exist, cannot be read or is not FictionBook
   * is reported first. `--new` (`?new=1`) asks for the same. `?open=<path>` (feature 003 US3:
   * the browser-mode restart reopening its document) is opened first, before any other
   * start-up work; when it fails the usual path follows.
   */
  async handleStartup(ctx: CommandContext, openPath: string | null = null): Promise<void> {
    if (!ctx.rpc) return;
    const requests = this.userRequests;
    const wanted = () => this.userRequests === requests && !ctx.store.getState().document;
    if (openPath && (await this.openDocument(ctx, openPath))) {
      this.startupChecked = true;
      this.startupOpen = null;
      return;
    }
    // The core sends the start-up files as soon as the connection opens, before any answer:
    // after one round trip their open has begun.
    try {
      await ctx.rpc.call('app.info');
    } catch {
      // an older core: no start-up files to wait for
    }
    this.startupChecked = true;
    const opened = this.startupOpen ? await this.startupOpen : false;
    this.startupOpen = null;
    if (opened || !wanted()) return;
    await this.createFromTemplate(ctx, wanted);
  }

  /* --------------------------------------------------------------- commands */

  private createCommands(): Command[] {
    const keys = (id: string, labelKey: string) => ({
      labelKey,
      tooltipKey: `cmd.${id}.tooltip`,
      descriptionKey: `cmd.${id}.description`,
    });
    return [
      {
        id: 'file.new',
        group: 'file',
        ...keys('file.new', 'menu.file.new'),
        icon: 'id_file_new',
        enabled: isConnected,
        run: async (ctx) => {
          await this.newDocument(ctx);
        },
      },
      {
        id: 'file.open',
        group: 'file',
        ...keys('file.open', 'menu.file.open'),
        icon: 'id_file_open',
        enabled: isConnected,
        run: async (ctx) => {
          await this.openWithDialog(ctx);
        },
      },
      {
        id: 'file.save',
        group: 'file',
        ...keys('file.save', 'menu.file.save'),
        icon: 'id_file_save',
        enabled: connectedWithDocument,
        run: async (ctx) => {
          await this.saveDocument(ctx, {});
        },
      },
      {
        id: 'file.saveAs',
        group: 'file',
        ...keys('file.saveAs', 'menu.file.saveAs'),
        enabled: connectedWithDocument,
        run: async (ctx) => {
          await this.saveDocument(ctx, { saveAs: true });
        },
      },
      {
        id: 'file.validate',
        group: 'file',
        ...keys('file.validate', 'menu.file.validate'),
        icon: 'id_file_validate',
        enabled: connectedWithDocument,
        run: async (ctx) => {
          await this.validateDocument(ctx);
        },
      },
      {
        id: 'file.exit',
        group: 'file',
        ...keys('file.exit', 'menu.file.exit'),
        // The quiet lock (FR-011) keeps Exit available; the flow asks about the run first.
        duringScriptRun: 'allowed',
        run: async (ctx) => {
          await this.exitApplication(ctx);
        },
      },
    ];
  }
}

/** Installs the File flows into a registry (replacing the foundation's minimal stubs). */
export function registerFileCommands(
  registry: CommandRegistry,
  options?: FileFeatureOptions,
): FileFeature {
  return new FileFeature(registry, options);
}
