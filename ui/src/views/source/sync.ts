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
 *   boundary (`switchView`), and the remapped Body caret is restored when Body comes back; no
 *   switch while a script runs.
 * - Body <-> Source mapping (feature 004 US7, FR-070 to FR-073; research R2): a direct switch
 *   carries the caret or selection. `body -> source` records the Body selection as two model
 *   points (`pendingPoints`); once the Source text is loaded (`doc.toXml({positions: true})`
 *   when the model changed, else the text and `serial` of the last serialisation or parse)
 *   the editor's `load()` asks `doc.mapPositions({toSource})` and selects the answer
 *   (`mapBodySelectionToSource`). `source -> body` reads the Source selection, commits pending
 *   edits with `doc.fromXml({positions: true})` so the offsets refer to the very text parsed,
 *   asks `doc.mapPositions({toModel})` and selects the points in the Body editor; a point
 *   without a Body place (`null`, the src-title-info annotation) goes to the document's start
 *   (`structuralPath.documentStart`). A detour through the Description view maps nothing; a
 *   core answering no `serial` (or 1005 for a stale one) leaves the 0.0.3 behaviour; the
 *   test hook `__mfbeTest.sourceMapping` (`sourceMappingState`) switches the mapping off for
 *   the FR-073 measurement and records the last step.
 * - `registerViewCommands()` replaces the `view.*` commands so leaving Source goes through the
 *   commit.
 *
 * Sessions are kept per store (WeakMap) so unit tests with several stores do not interfere.
 * `sourceSession.ts` re-exports this module for the existing import paths.
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { switchView } from '@/app/commands';
import { FIXED_BLOCK_IDS } from '@/editor/schema';
import { documentStart } from '@/editor/structuralPath';
import type { Document, ValidationIssue } from '@/model/document';
import { actions, isRunLocked, type AppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';
import {
  RpcErrorCode,
  type Caret,
  type DocParseErrorData,
  type ModelPoint,
  type ViewId,
} from '@/rpc/types';
import {
  getBodyController,
  hasBodyController,
  selectionPoints,
  type SelectionPoints,
} from '@/views/body/bodyEditor';

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
  /** The position map's serial when the parse recorded one (feature 004 US7). */
  serial?: number;
}

/** A Source selection as UTF-16 offsets into the editor text (CodeMirror's unit). */
export interface SourceOffsets {
  anchor: number;
  head: number;
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
  /**
   * Serial of the core's position map of `baseline` (feature 004 US7): set by the toXml /
   * fromXml call that produced the text with `positions: true`; null when none was recorded
   * (mapping disabled, an older core) - then no position is mapped.
   */
  serial: number | null;
  /**
   * The Body selection of a direct Body -> Source switch, mapped and selected by the editor
   * once the text is loaded (`mapBodySelectionToSource`); null for any other switch.
   */
  pendingPoints: SelectionPoints | null;
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
    serial: null,
    pendingPoints: null,
  };
}

/* ------------------------------------------------------------------------ */
/* Body <-> Source mapping state (feature 004 US7)                           */
/* ------------------------------------------------------------------------ */

/** What the last mapping step did (`__mfbeTest.sourceMapping.last`, test hooks only). */
export interface SourceMappingStep {
  direction: 'toSource' | 'toModel';
  /** Wall time of the UI's own step: the request and the answer (ms). */
  ms: number;
  /** The core's `durationMs` of the `doc.mapPositions` call; null when the call failed. */
  coreMs: number | null;
  serial: number;
  from: unknown;
  to: unknown;
  error?: string;
}

/**
 * The mapping switch and the record of the last step. `enabled` is only reachable through the
 * test hook (`__mfbeTest.sourceMapping`, active with test hooks): with it off the switches
 * neither record positions nor map them, which isolates the mapping step for FR-073.
 */
export const sourceMappingState: { enabled: boolean; last: SourceMappingStep | null } = {
  enabled: true,
  last: null,
};

export function sourceMappingEnabled(): boolean {
  return sourceMappingState.enabled;
}

/** Readers of the Source editor's selection, registered by the controller (per store). */
const sourceSelectionReaders = new WeakMap<AppStore, () => SourceOffsets | null>();

export function registerSourceSelectionReader(
  store: AppStore,
  reader: () => SourceOffsets | null,
): void {
  sourceSelectionReaders.set(store, reader);
}

function sourceSelectionOffsets(store: AppStore): SourceOffsets | null {
  return sourceSelectionReaders.get(store)?.() ?? null;
}

/**
 * The Body selection as model points for the core: the fixed ids of the annotation and
 * history blocks (`desc:annotation`, `desc:history`) become the model's node ids, which the
 * core's map knows; a block without a model node stays unknown (the Source keeps its place).
 */
function bodySelectionPoints(store: AppStore): SelectionPoints | null {
  if (!hasBodyController(store)) return null;
  const state = getBodyController(store).editorState;
  const points = state ? selectionPoints(state) : null;
  if (!points) return null;
  const description = store.getState().document?.description;
  const translate = (point: ModelPoint): ModelPoint => {
    const model =
      point.nodeId === FIXED_BLOCK_IDS.annotation
        ? description?.titleInfo.annotation
        : point.nodeId === FIXED_BLOCK_IDS.history
          ? description?.documentInfo.history
          : undefined;
    const id = model?.attrs.nodeId;
    return typeof id === 'string' && id ? { nodeId: id, offset: 0 } : point;
  };
  return { anchor: translate(points.anchor), head: translate(points.head) };
}

function recordStep(step: SourceMappingStep): void {
  sourceMappingState.last = step;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Maps the Body selection of a direct switch (`session.pendingPoints`) to Source offsets
 * against the text the editor just loaded; consumes the points. Null when there is nothing to
 * map, the mapping is skipped (an explicit navigation target, a parse error), no serial names
 * the text, both ends are unknown to the core or the call failed (1005, an older core): the
 * Source view then keeps its own position (FR-070).
 */
export async function mapBodySelectionToSource(
  ctx: CommandContext,
  options: { skip?: boolean } = {},
): Promise<SourceOffsets | null> {
  const { store, rpc } = ctx;
  const session = sourceSession(store);
  const points = session.pendingPoints;
  session.pendingPoints = null;
  const state = store.getState();
  if (!points || options.skip || !rpc || session.serial === null || !state.docId) return null;
  if (session.docId !== state.docId) return null;
  const serial = session.serial;
  const started = performance.now();
  try {
    const result = await rpc.call('doc.mapPositions', {
      docId: state.docId,
      serial,
      toSource: [points.anchor, points.head],
    });
    const [anchor = null, head = null] = result.toSource;
    recordStep({
      direction: 'toSource',
      ms: performance.now() - started,
      coreMs: result.durationMs,
      serial,
      from: points,
      to: { anchor, head },
    });
    if (anchor === null && head === null) return null;
    return { anchor: anchor ?? head!, head: head ?? anchor! };
  } catch (error) {
    recordStep({
      direction: 'toSource',
      ms: performance.now() - started,
      coreMs: null,
      serial,
      from: points,
      to: null,
      error: errorText(error),
    });
    return null;
  }
}

/** The two ends of a mapped Source selection as the core answered them (null: no Body place). */
interface MappedPoints {
  anchor: ModelPoint | null;
  head: ModelPoint | null;
}

async function mapSourceSelectionToBody(
  ctx: CommandContext,
  docId: string,
  serial: number,
  offsets: SourceOffsets,
): Promise<MappedPoints | null> {
  const { rpc } = ctx;
  if (!rpc) return null;
  const started = performance.now();
  try {
    const result = await rpc.call('doc.mapPositions', {
      docId,
      serial,
      toModel: [offsets.anchor, offsets.head],
    });
    const [anchor = null, head = null] = result.toModel;
    recordStep({
      direction: 'toModel',
      ms: performance.now() - started,
      coreMs: result.durationMs,
      serial,
      from: offsets,
      to: { anchor, head },
    });
    return { anchor, head };
  } catch (error) {
    recordStep({
      direction: 'toModel',
      ms: performance.now() - started,
      coreMs: null,
      serial,
      from: offsets,
      to: null,
      error: errorText(error),
    });
    return null;
  }
}

/**
 * Selects the mapped points in the Body editor: an end without a Body place (`null`) and a
 * point the editor cannot place (the src-title-info annotation, a node outside the editor
 * document) go to the document's start - the first body's first text block, or the annotation
 * block when the document has no body (FR-071); the model ids of the annotation and history
 * nodes become the blocks' fixed ids.
 */
function applyBodySelection(ctx: CommandContext, mapped: MappedPoints): void {
  const { store } = ctx;
  const model = store.getState().document;
  if (!model || !hasBodyController(store)) return;
  const controller = getBodyController(store);
  const start = (): ModelPoint => {
    const resolved = documentStart(model);
    return { nodeId: resolved.nodeId, offset: resolved.offset };
  };
  const translate = (point: ModelPoint): ModelPoint => {
    const { annotation } = model.description.titleInfo;
    const { history } = model.description.documentInfo;
    if (annotation?.attrs.nodeId === point.nodeId) {
      return { nodeId: FIXED_BLOCK_IDS.annotation, offset: 0 };
    }
    if (history?.attrs.nodeId === point.nodeId)
      return { nodeId: FIXED_BLOCK_IDS.history, offset: 0 };
    return point;
  };
  const head = mapped.head ? translate(mapped.head) : start();
  const anchor = mapped.anchor ? translate(mapped.anchor) : start();
  if (controller.setSelectionPoints(anchor, head)) return;
  const fallback = start();
  if (!controller.setSelectionPoints(fallback, fallback)) {
    void setCaretWhenReady(ctx, { view: 'body', nodeId: fallback.nodeId, offset: fallback.offset });
  }
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
  session.serial = null;
  session.pendingPoints = null;
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
  // Feature 004 US7: the serialisation records the position map of its text (a core without
  // the map answers no serial and nothing is mapped).
  const positions = sourceMappingEnabled();
  const result = await rpc.call('doc.toXml', {
    docId: state.docId,
    document: state.document,
    elideBinaries: true,
    ...(positions ? { positions: true } : {}),
  });
  const { text } = result;
  session.docId = state.docId;
  session.text = text;
  session.baseline = text;
  session.model = state.document;
  session.serial = positions && typeof result.serial === 'number' ? result.serial : null;
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
  // The editor's own text (`updateSourceText` after every change; the raw text of a Source-only
  // document only until its first edit, and such a text does not parse before one): the
  // offsets of a mapped selection refer to this very string (feature 004 US7, research R2.3).
  const text = session.text ?? '';
  const positions = sourceMappingEnabled();
  try {
    const result = (await rpc.call('doc.fromXml', {
      docId: state.docId,
      text,
      ...(positions ? { positions: true } : {}),
    })) as FromXmlResult;
    const { document } = result;
    const textChanged = text !== session.baseline;
    actions.replaceDocumentFromSource(store, document, state.modified || textChanged);
    session.docId = document.docId;
    session.baseline = text;
    session.model = document;
    session.pendingCaret = null;
    session.serial = positions && typeof result.serial === 'number' ? result.serial : null;
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
  // A running script keeps the Body view (its changes are shown there; the other views would
  // show the document as it was); an AI request keeps the view it started in (FR-051).
  if (isRunLocked(state)) return false;
  const session = sourceSession(store);
  // Feature 004 US7: only a direct switch between the two views carries a position; a detour
  // through the Description view leaves each view at its own (FR-070).
  session.pendingPoints = null;
  const mapping = sourceMappingEnabled();
  if (view === 'source' && state.activeView === 'body') {
    // The Body view is still mounted: remember where the user was for the way back.
    session.bodyCaret = ctx.carets?.get('body') ?? session.bodyCaret;
    if (mapping) session.pendingPoints = bodySelectionPoints(store);
  }
  // Source -> Body: the Source selection before the commit replaces the editor text's model.
  const sourceOffsets =
    view === 'body' && state.activeView === 'source' && mapping
      ? sourceSelectionOffsets(store)
      : null;
  let committed = false;
  if (view !== 'source' && state.document && (state.sourceOnly || state.sourceDirty)) {
    const result = await commitPendingSource(ctx);
    if (result === 'error') return false;
    committed = result === 'committed';
  }
  // The offsets refer to the text just parsed (or to the unchanged text of the last
  // serialisation or parse), which the session's serial names.
  const mapped =
    sourceOffsets && state.docId && session.serial !== null
      ? await mapSourceSelectionToBody(ctx, state.docId, session.serial, sourceOffsets)
      : null;
  switchView(ctx, view);
  if (view === 'body') {
    if (mapped) {
      applyBodySelection(ctx, mapped);
    } else if (committed && session.bodyCaret?.nodeId) {
      // No mapping (an older core, a stale serial): the model was re-created, put the Body
      // caret back on the (remapped) node as release 0.0.3 did.
      void setCaretWhenReady(ctx, session.bodyCaret);
    }
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
