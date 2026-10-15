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
 *  - Pending Source text is parsed back (`doc.fromXml`) before Save/Validate/Exit; malformed
 *    text refuses the save, as the original editor did ("do not save bad xml").
 *  - `doc.watch` is enabled for opened files; `doc.changedOnDisk` asks to reload.
 *  - `doc.caret` get/set implements Restore position (recent.ts).
 */

import {
  currentDocumentName,
  switchView,
  type Command,
  type CommandContext,
  type CommandRegistry,
} from '@/app/commands';
import { describeError, isClientSideError, logUiError } from '@/app/diagnostics';
import { ENCODING_CHOICES, normalizeEncoding } from '@/dialogs/encodings';
import { documentFileTypes } from '@/dialogs/fileTypes';
import { showEncodingDialog, showSaveChangesPrompt } from '@/dialogs/show';
import { confirmSaveWithErrors } from '@/dialogs/validation';
import type { Document, ValidationReport } from '@/model/document';
import { actions, kindFromPath, type AppStore, type FileKind } from '@/model/store';
import i18next from 'i18next';

import { RpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode, type DocParseErrorData, type FileFilter } from '@/rpc/types';
import {
  commitPendingSource,
  isSourceTextDirty,
  resetSourceSession,
  setSourceOnlyText,
  sourceSession,
} from '@/views/source/sourceSession';

import { RecentFilesStore, rememberCaret, restoreCaret } from './recent';

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
 * The encodings of the Save As dialog. The dialog preselects the first one, so the encoding a
 * plain Save would use (`defaultSaveEncoding`) comes first, the others in the original's order.
 */
export function saveAsEncodingChoices(preselected: string): string[] {
  return [preselected, ...ENCODING_CHOICES.filter((encoding) => encoding !== preselected)];
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

/* ------------------------------------------------------------------------ */
/* The feature                                                              */
/* ------------------------------------------------------------------------ */

export interface FileFeatureOptions {
  /** Delay during which `doc.changedOnDisk` after our own save is ignored (ms). */
  selfSaveGraceMs?: number;
}

export class FileFeature {
  readonly recent: RecentFilesStore;
  private lastSaveAt = 0;
  private reloadPromptOpen = false;
  private readonly selfSaveGraceMs: number;

  constructor(registry: CommandRegistry, options: FileFeatureOptions = {}) {
    this.selfSaveGraceMs = options.selfSaveGraceMs ?? 1500;
    this.recent = new RecentFilesStore(registry, (ctx, path) => this.openFromRecent(ctx, path));
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

  /* ------------------------------------------------------------------ close */

  /** Remembers the caret, stops watching and closes the current document in the core. */
  async closeCurrentDocument(ctx: CommandContext): Promise<void> {
    const { store, rpc } = ctx;
    const state = store.getState();
    if (state.docId && rpc) {
      await rememberCaret(ctx, state.docId);
      try {
        await rpc.call('doc.watch', { docId: state.docId, enabled: false });
      } catch {
        // best effort
      }
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

  private loadDocument(ctx: CommandContext, document: Document): void {
    resetSourceSession(ctx.store);
    ctx.undo.clear();
    actions.setDocument(ctx.store, document);
    actions.setStatusMessage(ctx.store, null);
    if (ctx.store.getState().activeView === 'source') {
      // A new document always starts in the Body view unless it is Source-only.
      switchView(ctx, 'body');
    }
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
    if (!(await this.confirmDiscardChanges(ctx))) return false;
    await this.closeCurrentDocument(ctx);
    const document = await ctx.rpc.call('doc.new');
    this.loadDocument(ctx, document);
    return true;
  }

  /* ------------------------------------------------------------------- open */

  async openWithDialog(ctx: CommandContext): Promise<boolean> {
    if (!ctx.rpc) return false;
    if (!(await this.confirmDiscardChanges(ctx))) return false;
    const { paths } = await ctx.rpc.call('dialog.openFile', {
      title: ctx.t('cmd.file.open.tooltip'),
      filters: documentFilters(ctx),
      selectedFilter: 0,
    });
    const path = paths[0];
    if (!path) return false;
    return this.openDocument(ctx, path);
  }

  private async openFromRecent(ctx: CommandContext, path: string): Promise<boolean> {
    if (!(await this.confirmDiscardChanges(ctx))) return false;
    return this.openDocument(ctx, path);
  }

  /**
   * Opens `path` (the current document is closed first). Shows the open-failure or
   * parse-error messages; Source-only mode for malformed files. Returns true when a document
   * (model or raw text) is now open.
   */
  async openDocument(ctx: CommandContext, path: string): Promise<boolean> {
    const { store, rpc } = ctx;
    if (!rpc) return false;
    await this.closeCurrentDocument(ctx);
    try {
      const result = await rpc.runJob(
        'doc.open',
        { path },
        { onProgress: (progress) => actions.setProgress(store, progress) },
      );
      this.loadDocument(ctx, result.document);
      if (result.warnings.length > 0) {
        actions.setStatusMessage(
          store,
          ctx.t('status.openedWithWarnings', { count: result.warnings.length }),
        );
      }
      await this.watch(ctx, result.document.docId, true);
      void this.recent.refresh(rpc);
      void restoreCaret(ctx, result.document.docId);
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
      const parseError = parseErrorData(error);
      if (parseError) return this.openSourceOnly(ctx, path, parseError);
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
      const source = await rpc.call('doc.openSource', { path });
      const error = source.error ?? parseError;
      resetSourceSession(store);
      ctx.undo.clear();
      actions.setDocument(store, sourceOnlyDocument(source.docId, path, source.encoding), {
        sourceOnly: true,
      });
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
      await this.watch(ctx, source.docId, true);
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
    if (options.saveAs || !path) {
      const choice = await rpc.call('dialog.saveFile', {
        title: ctx.t('cmd.file.saveAs.tooltip'),
        filters: documentFilters(ctx),
        selectedFilter: saveAsSelectedType(state.fileKind),
        defaultPath: path,
        encodingChoices: saveAsEncodingChoices(defaultSaveEncoding(store)),
      });
      if (!choice.path) return false;
      path = choice.path;
      encoding = normalizeEncoding(choice.encoding);
      // The platform dialogs return the encoding chosen inside them; answers without one (the
      // queued test dialogs, CEF's fallback dialog) get the original's choice in a window.
      if (!encoding) {
        encoding = await showEncodingDialog(ctx.dialogs, {
          defaultEncoding: defaultSaveEncoding(store),
          path,
        });
        if (!encoding) return false;
      }
    } else {
      encoding = defaultSaveEncoding(store);
    }

    let force = false;
    for (;;) {
      const current = store.getState();
      if (!current.document || !current.docId) return false;
      try {
        const result = await rpc.runJob(
          'doc.save',
          { docId: current.docId, document: current.document, path, encoding, force },
          { onProgress: (progress) => actions.setProgress(store, progress) },
        );
        actions.setProgress(store, null);
        if (result.needsConfirmation) {
          if (!(await confirmSaveWithErrors(ctx.dialogs, ctx.t, result.validation))) return false;
          force = true;
          continue;
        }
        this.lastSaveAt = Date.now();
        const saved: Document = {
          ...current.document,
          path: result.path,
          sourceEncoding: result.encoding,
          fileKind: kindFromPath(result.path),
        };
        store.setState({ document: saved });
        actions.markSaved(store, result.path, saved.fileKind);
        actions.setStatusMessage(
          store,
          result.validation.errorCount === 0
            ? ctx.t('status.savedNoErrors')
            : ctx.t('msg.errorsFound', { count: result.validation.errorCount }),
        );
        if (store.getState().validation) actions.setValidation(store, result.validation);
        await this.watch(ctx, current.docId, true);
        void rememberCaret(ctx, current.docId);
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
    actions.setStatusMessage(
      store,
      report.errorCount === 0
        ? ctx.t('status.noErrors')
        : ctx.t('msg.errorsFound', { count: report.errorCount }),
    );
    return report;
  }

  /* ------------------------------------------------------------------- exit */

  async exitApplication(ctx: CommandContext): Promise<void> {
    if (!(await this.confirmDiscardChanges(ctx))) return;
    const state = ctx.store.getState();
    if (state.docId) await rememberCaret(ctx, state.docId);
    if (ctx.rpc && state.connection === 'connected') {
      await ctx.rpc.call('app.quit', {});
    } else {
      window.close();
    }
  }

  /* ---------------------------------------------------------- notifications */

  /**
   * Subscribes to `doc.changedOnDisk` (reload prompt) and `app.openPaths` (open the forwarded
   * file). Returns the unsubscribe function.
   */
  subscribeNotifications(rpc: RpcClient, getContext: () => CommandContext): () => void {
    const offChanged = rpc.on('doc.changedOnDisk', (payload) => {
      void this.handleChangedOnDisk(getContext(), payload.docId, payload.path);
    });
    const offOpen = rpc.on('app.openPaths', (payload) => {
      const path = payload.paths[0];
      if (!path) return;
      const ctx = getContext();
      void this.confirmDiscardChanges(ctx).then((ok) =>
        ok ? this.openDocument(ctx, path) : false,
      );
    });
    return () => {
      offChanged();
      offOpen();
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
      if (answer === 'yes') await this.openDocument(ctx, path);
    } finally {
      this.reloadPromptOpen = false;
    }
  }

  /** `?new=1` at start-up creates a blank document once the core is connected. */
  async handleStartup(ctx: CommandContext, search: string): Promise<void> {
    const params = new URLSearchParams(search);
    if (params.get('new') === '1' && ctx.rpc && !ctx.store.getState().document) {
      const document = await ctx.rpc.call('doc.new');
      this.loadDocument(ctx, document);
    }
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
