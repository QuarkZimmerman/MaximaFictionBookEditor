/**
 * Source <-> model synchronisation (T050/T081): the live XML text and the rules of
 * data-model.md §4.2 / FR-021 / FR-061.
 *
 * - `loadSourceText()` serialises the current model with `doc.toXml({elideBinaries: true})`
 *   when the Source view is entered (or reuses the pending text of a previous Source session /
 *   the raw text of a Source-only open).
 * - `updateSourceText()` is called by the editor on every change and only flips the
 *   `sourceDirty` / `modified` flags in the store (the text itself stays here).
 * - `commitPendingSource()` parses the text back with `doc.fromXml` before the view is left,
 *   before Save and before Validate. A successful parse replaces the model and re-assigns
 *   nodeIds: the `remap` table of the answer is applied to the remembered Body caret and to the
 *   store selection, and the Body history (which referred to the old model) is dropped. On
 *   `doc.parseError` it shows the original editor's message ("You have opened an invalid XML
 *   document..."), records the error position in the store so the Source view can move the
 *   cursor there, and reports `'error'` so the caller stays put.
 * - `requestViewSwitch()` implements the switching rules: `* -> source` remembers the Body caret
 *   and serialises; `source -> *` requires a successful parse; every switch commits an undo
 *   boundary (`switchView`), and the remapped Body caret is restored when Body comes back.
 * - `registerViewCommands()` replaces the `view.*` commands so leaving Source goes through the
 *   commit.
 *
 * Sessions are kept per store (WeakMap) so unit tests with several stores do not interfere.
 * `sourceSession.ts` re-exports this module for the existing import paths.
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { switchView } from '@/app/commands';
import type { Document, ValidationIssue } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type Caret, type DocParseErrorData, type ViewId } from '@/rpc/types';

/** `doc.fromXml` remap table (rpc-api.md §3.2, core `model::RemapTable::to_json`). */
export interface RemapTable {
  /** old nodeId -> new nodeId for nodes whose structural path survived the re-parse. */
  map: Record<string, string>;
  /** Old ids that vanished (no node at the same path any more). */
  unmappedOld: string[];
  /** New ids without an old counterpart. */
  unmappedNew: string[];
}

/** The full `doc.fromXml` answer (the typed RPC table only declares `document`). */
interface FromXmlResult {
  document: Document;
  warnings?: ValidationIssue[];
  remap?: RemapTable;
}

export interface SourceSession {
  /** Document the text belongs to (a different docId invalidates the session). */
  docId: string | null;
  /** Current editor text, or null when nothing was loaded yet. */
  text: string | null;
  /** The text produced by the core (toXml / openSource); the dirty flag compares with it. */
  baseline: string | null;
  /** The model instance `baseline` was serialised from. */
  model: unknown;
  /** Requested caret (line/column) the editor should apply when it mounts. */
  pendingCaret: { line: number; column: number } | null;
  /** Body caret remembered when the Source view was entered; remapped by every commit. */
  bodyCaret: Caret | null;
  /** Remap table of the last successful commit (old nodeId -> new nodeId). */
  lastRemap: RemapTable | null;
  /** Editor text at the time the validation panel's report was produced (staleness check). */
  validatedText: string | null;
}

const sessions = new WeakMap<AppStore, SourceSession>();
const resetListeners = new WeakMap<AppStore, Set<() => void>>();

function emptySession(): SourceSession {
  return {
    docId: null,
    text: null,
    baseline: null,
    model: null,
    pendingCaret: null,
    bodyCaret: null,
    lastRemap: null,
    validatedText: null,
  };
}

export function sourceSession(store: AppStore): SourceSession {
  let session = sessions.get(store);
  if (!session) {
    session = emptySession();
    sessions.set(store, session);
  }
  return session;
}

/** Forgets the text (document closed/replaced) and tells the editor to drop its state. */
export function resetSourceSession(store: AppStore): void {
  sessions.delete(store);
  for (const listener of [...(resetListeners.get(store) ?? [])]) listener();
}

/** Notifies `listener` whenever the session of `store` is reset (the editor forgets its state). */
export function onSourceSessionReset(store: AppStore, listener: () => void): () => void {
  let set = resetListeners.get(store);
  if (!set) {
    set = new Set();
    resetListeners.set(store, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/**
 * Stores raw text for a Source-only document (malformed file) - the model is unavailable, the
 * text is what the user edits and `doc.fromXml` turns into a model once it is well-formed.
 */
export function setSourceOnlyText(store: AppStore, docId: string, text: string): void {
  const session = sourceSession(store);
  session.docId = docId;
  session.text = text;
  session.baseline = text;
  session.model = null;
  session.pendingCaret = null;
  session.bodyCaret = null;
  session.lastRemap = null;
}

/** True when the editor text differs from what the core produced. */
export function isSourceTextDirty(store: AppStore): boolean {
  const session = sourceSession(store);
  return session.text !== null && session.text !== session.baseline;
}

/** Called by the editor on every change; keeps the store flags in sync. */
export function updateSourceText(store: AppStore, text: string): void {
  const session = sourceSession(store);
  session.text = text;
  const dirty = text !== session.baseline;
  if (store.getState().sourceDirty !== dirty) actions.setSourceDirty(store, dirty);
}

/** Text to show in the Source view: pending/raw text, or a fresh serialisation of the model. */
export async function loadSourceText(ctx: CommandContext): Promise<string> {
  const { store, rpc } = ctx;
  const state = store.getState();
  const session = sourceSession(store);
  if (!state.document || !state.docId) {
    return session.text ?? '';
  }
  if (session.docId === state.docId && session.text !== null) {
    const dirty = session.text !== session.baseline;
    // A model edited in another view since the text was produced must be re-serialised,
    // unless the user has pending Source edits (those win; they are parsed back first).
    if (dirty || state.sourceOnly || session.model === state.document) return session.text;
  }
  if (!rpc) return session.text ?? '';
  const { text } = await rpc.call('doc.toXml', {
    docId: state.docId,
    document: state.document,
    elideBinaries: true,
  });
  session.docId = state.docId;
  session.text = text;
  session.baseline = text;
  session.model = state.document;
  if (store.getState().sourceDirty) actions.setSourceDirty(store, false);
  return text;
}

/** True when the validation panel's report was produced for the current editor text. */
export function isValidationFresh(store: AppStore): boolean {
  const session = sourceSession(store);
  return store.getState().validation !== null && session.validatedText === session.text;
}

/**
 * Remembers which text each validation report belongs to (the Validate command of the file
 * feature publishes reports through `store.validation`). Returns the unsubscribe function.
 */
export function trackValidationFreshness(store: AppStore): () => void {
  return store.subscribe((state, previous) => {
    if (state.validation !== previous.validation) {
      sourceSession(store).validatedText = state.validation ? sourceSession(store).text : null;
    }
  });
}

export type CommitResult = 'clean' | 'committed' | 'error' | 'unavailable';

function parseErrorData(error: unknown): DocParseErrorData | null {
  if (!(error instanceof RpcError) || error.code !== RpcErrorCode.docParseError) return null;
  const data = (error.data ?? {}) as Partial<DocParseErrorData>;
  return {
    line: typeof data.line === 'number' ? data.line : 0,
    column: typeof data.column === 'number' ? data.column : 0,
    message: typeof data.message === 'string' ? data.message : error.message,
  };
}

/** Maps a caret through the remap table; null when its node vanished. */
export function remapCaret(
  caret: Caret | null,
  remap: RemapTable | null | undefined,
): Caret | null {
  if (!caret) return null;
  if (!caret.nodeId || !remap) return caret;
  const mapped = remap.map[caret.nodeId];
  return mapped ? { ...caret, nodeId: mapped } : null;
}

/**
 * Applies the nodeId remap table of a re-parse: the remembered Body caret and the store
 * selection follow their nodes (or are dropped when the node vanished); the Body history
 * referred to the old model and is cleared (its editor is rebuilt from the new model).
 */
export function applyRemap(ctx: CommandContext, remap: RemapTable | null | undefined): void {
  const { store } = ctx;
  const session = sourceSession(store);
  session.lastRemap = remap ?? null;
  session.bodyCaret = remapCaret(session.bodyCaret, remap);
  const state = store.getState();
  if (remap && state.selectionNodeId) {
    const mapped = remap.map[state.selectionNodeId] ?? null;
    if (mapped !== state.selectionNodeId) {
      actions.setSelection(store, mapped ? state.selectionPath : '', mapped);
    }
  }
  ctx.undo.clearView('body');
}

/**
 * Parses pending Source text back into the model. Returns `'clean'` when nothing had to be
 * parsed, `'committed'` after a successful parse, `'error'` when the XML is malformed (message
 * shown unless `silent`, error recorded, caller must stay in Source) and `'unavailable'`
 * without a core.
 */
export async function commitPendingSource(
  ctx: CommandContext,
  options: { silent?: boolean } = {},
): Promise<CommitResult> {
  const { store, rpc } = ctx;
  const state = store.getState();
  const session = sourceSession(store);
  const needsParse = state.sourceOnly || (state.sourceDirty && session.text !== null);
  if (!needsParse || !state.docId) return 'clean';
  if (!rpc) return 'unavailable';
  const text = session.text ?? '';
  try {
    const result = (await rpc.call('doc.fromXml', {
      docId: state.docId,
      text,
    })) as FromXmlResult;
    const { document } = result;
    const textChanged = text !== session.baseline;
    actions.replaceDocumentFromSource(store, document, state.modified || textChanged);
    session.docId = document.docId;
    session.baseline = text;
    session.model = document;
    session.pendingCaret = null;
    applyRemap(ctx, result.remap);
    return 'committed';
  } catch (error) {
    const parseError = parseErrorData(error);
    if (!parseError) throw error;
    actions.setSourceParseError(store, parseError);
    session.pendingCaret = { line: parseError.line, column: parseError.column };
    actions.setStatusMessage(
      store,
      ctx.t('msg.xmlParseError', {
        where: ctx.t('views.source.title'),
        line: parseError.line,
        column: parseError.column,
        message: parseError.message,
      }),
    );
    if (!options.silent) {
      await ctx.dialogs.showMessage({
        text: ctx.t('msg.badXml'),
        caption: ctx.t('msg.xmlParseErrorCaption'),
        icon: 'error',
        testId: 'dialog-bad-xml',
      });
    }
    return 'error';
  }
}

const CARET_RESTORE_ATTEMPTS = 20;
const CARET_RESTORE_DELAY_MS = 25;

/**
 * Moves the caret of a view that may still be mounting (the view component registers its caret
 * provider asynchronously); gives up after a few attempts.
 */
export async function setCaretWhenReady(ctx: CommandContext, caret: Caret): Promise<boolean> {
  const { carets } = ctx;
  if (!carets) return false;
  for (let attempt = 0; attempt < CARET_RESTORE_ATTEMPTS; attempt += 1) {
    if (carets.set(caret)) return true;
    await new Promise((resolve) => setTimeout(resolve, CARET_RESTORE_DELAY_MS));
  }
  return false;
}

/** Leaves the Source view only when its text parses (FR-021). Resolves true when switched. */
export async function requestViewSwitch(ctx: CommandContext, view: ViewId): Promise<boolean> {
  const { store } = ctx;
  const state = store.getState();
  if (state.activeView === view) return true;
  const session = sourceSession(store);
  if (view === 'source' && state.activeView === 'body') {
    // The Body view is still mounted: remember where the user was for the way back.
    session.bodyCaret = ctx.carets?.get('body') ?? session.bodyCaret;
  }
  let committed = false;
  if (view !== 'source' && state.document && (state.sourceOnly || state.sourceDirty)) {
    const result = await commitPendingSource(ctx);
    if (result === 'error') return false;
    committed = result === 'committed';
  }
  switchView(ctx, view);
  if (view === 'body' && committed && session.bodyCaret?.nodeId) {
    // The model was re-created: put the Body caret back on the (remapped) node.
    void setCaretWhenReady(ctx, session.bodyCaret);
  }
  return true;
}

const VIEW_ICONS: Record<ViewId, string> = {
  description: 'id_view_desc',
  body: 'id_view_body',
  source: 'id_view_source',
};

/** Replaces the three `view.*` commands with the parse-before-leaving behaviour. */
export function registerViewCommands(registry: CommandRegistry): void {
  for (const view of ['description', 'body', 'source'] as const) {
    const command: Command = {
      id: `view.${view}`,
      group: 'view',
      labelKey: `menu.view.${view}`,
      tooltipKey: `cmd.view.${view}.tooltip`,
      descriptionKey: `cmd.view.${view}.description`,
      icon: VIEW_ICONS[view],
      checked: (ctx) => ctx.store.getState().activeView === view,
      async run(ctx) {
        await requestViewSwitch(ctx, view);
      },
    };
    registry.replace(command);
  }
}
