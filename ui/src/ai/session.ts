/**
 * The working copy session of one AI request (feature 005 T045; data-model §6 - there called
 * `WorkingCopySession`; ai-catalogue §6 steps 2, 4, 5, 14, 15; research R4.1, R4.5, R4.7;
 * FR-060 to FR-064). Named `RequestSession` so that "session" stays apart from the document
 * session (the conversation's scope, FR-025/FR-045) and from the `session.*` settings group.
 *
 * A request works on a `WorkingCopy` over the live document (copy-on-write; nothing of it is
 * shown before the commit, so a request that changes nothing never marks the document modified
 * - FR-043) under the run lock of a `RunSession` of kind `ai` (the lock, the banner's phase, the
 * ticker, the document-replaced watch and the one undo entry are the `RunSession`'s). At its
 * start the session takes the **baseline**: `doc.validate({docId, document: before})` - the live
 * document, never the core's snapshot - reduced to the content-key multiset of its error issues
 * (hook.ts); `schema.unavailable` in that report ends the request as `failed
 * (validationUnavailable)` before anything is sent, since the hook could not tell a new error
 * from an old one. Every change then runs through `applyChange` (hook.ts) with the copy's
 * `checkpoint()` / `rollback()` around it; `commit()` validates the copy a last time under the
 * same rule and publishes it as one undo snapshot named after the instruction; `discard()`
 * drops the copy and restores the document before the request (SC-005: byte for byte, `before`
 * being the live document object itself).
 *
 * Nodes the core returns from `doc.fragmentFromXml` arrive without `nodeId`: `fragmentFromXml`
 * assigns `sc_<N>` ids from the UI's allocator before they enter the copy (review C12).
 */

import type { ModelNodeJson } from '@/editor/fromModel';
import { createNodeIdGenerator } from '@/editor/schema';
import type { Document, ValidationReport } from '@/model/document';
import type { AppStore } from '@/model/store';
import type { UndoCoordinator } from '@/model/undo';
import type { RpcClient } from '@/rpc/client';
import type { FragmentResultNode, ValidationIssue } from '@/rpc/types';
import {
  startRunSession,
  type RunSession,
  type RunSessionOptions,
  type RunSessionOutcome,
} from '@/scripting/runSession';
import { WorkingCopy, type Checkpoint } from '@/scripting/workingCopy';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import type { SelectionSnapshot } from './context';
import {
  ChangeRejection,
  multiset,
  multisetSize,
  newErrors,
  schemaUnavailable,
  StrikeCounter,
  strikeKey,
  type ChangeOutcome,
  type ErrorForModel,
  type IssueMultiset,
} from './hook';
import { stripFence, undoLabel } from './reply';

/** The RPC surface the session uses (the real client, or a fake in tests). */
export type SessionRpc = Pick<RpcClient, 'call' | 'runJob'>;

/**
 * `job.cancel` of a job of the request - an exchange, a validation (a job already finished is
 * left alone by the core); a failure is swallowed.
 */
export function cancelJob(rpc: Pick<RpcClient, 'call'>, jobId: string): void {
  void Promise.resolve(rpc.call('job.cancel', { jobId })).catch(() => {});
}

/**
 * The request's cancel as the steps before its session see it - the Source text check, the
 * baseline (ai-catalogue §6.15): `jobStarted` hands the step's validation job to the owner,
 * which cancels it on the cancel - at once when the cancel came while the call was on its way;
 * `cancelled()` is checked when the step's call returns, since a plain request (2 MiB and
 * less) cannot be stopped: a request cancelled meanwhile ends there, nothing sent.
 */
export interface RequestCancel {
  cancelled(): boolean;
  jobStarted(jobId: string): void;
}

export interface RequestSessionDeps {
  store: AppStore;
  rpc: SessionRpc;
  undo: UndoCoordinator;
  /** The Body controller showing the document (null without one: the store alone is updated). */
  getController: () => BodyEditorController | null;
  /** Interval of the elapsed-time ticks (default 1 s; tests shorten it). */
  tickMs?: number;
  /** The `sc_<N>` allocator (default: a fresh one per session; the loop may share one). */
  nextNodeId?: () => string;
}

export interface StartRequestSessionOptions {
  origin: 'popup' | 'panel';
  kind: 'selection' | 'general';
  /** The user's text as typed (the undo label is derived from it). */
  instruction: string;
  /** The lock's label: `<service name> · <model>`. */
  label: string;
  /** The banner's text at the start (`preparing`). */
  phase?: string;
  /** The selection the request works on (a selection request); null / absent otherwise. */
  selection?: SelectionSnapshot | null;
  onCancel?: () => void;
  onDocumentReplaced?: () => void;
  onTick?: (elapsedMs: number) => void;
  /** The Source view's presenter and undo view (US5; `RunSessionOptions`). */
  present?: RunSessionOptions['present'];
  undoView?: RunSessionOptions['undoView'];
  /** The owner's cancel during the baseline (Escape, Stop, the document replaced). */
  cancel?: RequestCancel;
}

/** Why a session could not start (ai-catalogue §6 steps 1 and 4). */
export type StartRequestSessionFailure =
  /** No document is open. */
  | 'noDocument'
  /** A script run or another request holds the lock. */
  | 'busy'
  /** The baseline report says `schema.unavailable`: the hook cannot guarantee validity. */
  | 'validationUnavailable'
  /**
   * The owner cancelled or ended the run during the baseline (Cancel, Escape, the document
   * replaced or closed): the lock released, nothing sent.
   */
  | 'cancelled';

export type StartRequestSessionResult =
  { ok: true; session: RequestSession } | { ok: false; reason: StartRequestSessionFailure };

/** One change of the request (data-model §6.1 `ChangeRecord`). */
export interface ChangeRecord {
  changeId: string;
  strikeKey: string;
  tool: string;
  target: string;
  checkpoint: Checkpoint;
  /** The attempt's outcome; null while it runs or when it threw. */
  outcome: ChangeOutcome | null;
  status: 'pending' | 'accepted' | 'rejected' | 'rolledBack';
}

/** The result of `commit()` (data-model §6.4; ai-catalogue §6.14). */
export type CommitResult =
  /** The copy was shown and recorded as one undo entry. */
  | { kind: 'committed'; after: Document }
  /** The copy never changed: nothing shown, no undo entry, `modified` untouched. */
  | { kind: 'unchanged' }
  /** The document was replaced meanwhile: nothing published. */
  | { kind: 'lost' }
  /**
   * The request was cancelled before the copy was published - during the last validation too,
   * which a plain request (2 MiB and less) cannot stop: the copy discarded, nothing shown, no
   * undo entry, `modified` untouched (ai-catalogue §6.15, SC-005).
   */
  | { kind: 'cancelled' }
  /** The last validation found a new error (FR-064's safety net): the copy was discarded. */
  | { kind: 'failed'; failure: { kind: 'invalidAtEnd'; errors: ErrorForModel[] } };

/** A parsed fragment with `sc_<N>` ids assigned (review C12). */
export interface ParsedFragment {
  nodes: ModelNodeJson[];
  inline: boolean;
  warnings: ValidationIssue[];
}

/** The summary of one validation (the test hook's `validations: [{durationMs}]`). */
export interface ValidationRecord {
  durationMs: number;
  errorCount: number;
  warningCount: number;
}

/**
 * The Source text of a request made in the Source view (ai-catalogue §8; data-model §4.1
 * `structuredAllowed`, §6.1 `source`; review C11): the text the request works on - an accepted
 * text-path replacement stays TEXT here until the commit -, the text at the start (what the
 * undo step restores, byte for byte), the selection's range in it, whether it was well-formed
 * at the start and whether a text-path change was accepted. `pending` is a splice awaiting the
 * gate (`doc.validate({text})` of the whole text), promoted to `text` when accepted.
 */
export interface SourceTextState {
  text: string;
  textBefore: string;
  from: number;
  to: number;
  wellFormed: boolean;
  changed: boolean;
  pending: { text: string; from: number; to: number } | null;
}

export class RequestSession {
  readonly run: RunSession;
  readonly docId: string;
  /** The live document at the start - the undo entry's `undo` state, restored by `discard()`. */
  readonly before: Document;
  readonly modifiedBefore: boolean;
  readonly copy: WorkingCopy;
  /**
   * Error keys of `before` with their counts (data-model §7.2) - the live model's report; the
   * Source text path of a well-formed text replaces it by the text's own report (`setBaseline`).
   */
  baseline: IssueMultiset;
  readonly baselineReport: ValidationRecord;
  /** The `sc_<N>` allocator every node created in this request draws from (review C12). */
  readonly newNodeIds: () => string;
  readonly changes: ChangeRecord[] = [];
  readonly strikes = new StrikeCounter();
  readonly validations: ValidationRecord[] = [];
  readonly origin: 'popup' | 'panel';
  readonly kind: 'selection' | 'general';
  readonly instruction: string;
  readonly selection: SelectionSnapshot | null;
  /** Accepted changes so far (0 ⇒ nothing to commit). */
  changesInThisRequest = 0;
  /** False in Source text mode and after a text-path change (review C11). */
  structuredAllowed = true;
  /** The Source text the request works on when it took the text path (US5). */
  source: SourceTextState | null = null;
  /** Set at the commit: `copy.changed ? copy.release() : null`. */
  after: Document | null | undefined;
  private readonly deps: RequestSessionDeps;
  private validationJobId: string | null = null;
  /**
   * Set by `cancelValidation()`: the request is ending - a validation job is cancelled at once,
   * nothing is published any more.
   */
  private cancelledValue = false;
  private changeCount = 0;

  /** @internal Use `startRequestSession`. */
  constructor(
    deps: RequestSessionDeps,
    run: RunSession,
    options: StartRequestSessionOptions,
    baselineReport: ValidationReport,
  ) {
    this.deps = deps;
    this.run = run;
    this.docId = run.before.docId;
    this.before = run.before;
    this.modifiedBefore = run.modifiedBefore;
    this.copy = new WorkingCopy(run.before);
    this.baseline = multiset(baselineReport.issues);
    this.baselineReport = summarise(baselineReport);
    this.validations.push(this.baselineReport);
    this.newNodeIds = deps.nextNodeId ?? createNodeIdGenerator('sc_');
    this.origin = options.origin;
    this.kind = options.kind;
    this.instruction = options.instruction;
    this.selection = options.selection ?? null;
  }

  /** The baseline's error count (the context's `preExistingErrors`, FR-062). */
  get preExistingErrors(): number {
    return multisetSize(this.baseline);
  }

  get ended(): boolean {
    return this.run.ended;
  }

  /** The request was cancelled or has ended (`cancelValidation()`): nothing is published. */
  get cancelled(): boolean {
    return this.cancelledValue;
  }

  /** The current operation (the banner's text); the lock in the store follows. */
  setPhase(phase: string | undefined): void {
    this.run.setPhase(phase);
  }

  /** Remembers the copy's state for `rollback()` (data-model §6.2). */
  checkpoint(): Checkpoint {
    return this.copy.checkpoint();
  }

  /** Returns the copy to a checkpoint (FR-061). */
  rollback(checkpoint: Checkpoint): void {
    this.copy.rollback(checkpoint);
  }

  /**
   * Validates the working copy as it stands: `doc.validate({docId, document})` - a job above
   * 2 MiB, cancellable through `cancelValidation()`. The report is recorded in `validations`.
   */
  async validate(): Promise<ValidationReport> {
    const report = await this.deps.rpc.runJob(
      'doc.validate',
      { docId: this.docId, document: this.copy.document },
      { onStart: (jobId) => this.validationStarted(jobId) },
    );
    this.validationJobId = null;
    this.validations.push(summarise(report));
    return report;
  }

  /**
   * The Source text path (US5): `doc.validate({docId, text})` of a whole text - the spliced
   * text of a pending replacement, or the current text for the `validate` tool. Recorded in
   * `validations` like a copy validation; cancellable the same way.
   */
  async validateText(text: string): Promise<ValidationReport> {
    const report = await this.deps.rpc.runJob(
      'doc.validate',
      { docId: this.docId, text },
      { onStart: (jobId) => this.validationStarted(jobId) },
    );
    this.validationJobId = null;
    this.validations.push(summarise(report));
    return report;
  }

  /**
   * Replaces the baseline (data-model §7.2): the Source text path of a text that is well-formed
   * at the start compares against the report of that very text rather than the live model's.
   */
  setBaseline(report: Pick<ValidationReport, 'issues'>): void {
    this.baseline = multiset(report.issues);
  }

  /**
   * The request is cancelled (Cancel, Escape, the document replaced; the end of the request): a
   * running validation job is cancelled - or, while `doc.validate` is on its way, as soon as its
   * id arrives -, so is a validation job started later, and the commit publishes nothing, also
   * when a validation that could not be stopped returns its report. 1090 and the like are
   * swallowed.
   */
  cancelValidation(): void {
    this.cancelledValue = true;
    const jobId = this.validationJobId;
    if (!jobId) return;
    this.validationJobId = null;
    cancelJob(this.deps.rpc, jobId);
  }

  /**
   * A validation job's id has arrived. A cancel that came while `doc.validate` was on its way
   * found no job to cancel: the job is cancelled now, or it would run to its end in the core.
   */
  private validationStarted(jobId: string): void {
    if (this.cancelledValue) cancelJob(this.deps.rpc, jobId);
    else this.validationJobId = jobId;
  }

  /**
   * Parses FB2 XML as the children of `parent` (`doc.fragmentFromXml`, rpc-api §3.2): a
   * leading / trailing code fence and surrounding whitespace are stripped first
   * (ai-catalogue §3.8); the nodes come back without `nodeId` and get `sc_<N>` ids here
   * (review C12). 1001 → `ChangeRejection invalidXml`, 1201 → `fragmentNotAllowed`; any other
   * failure propagates.
   */
  async fragmentFromXml(
    xml: string,
    parent: { nodeId: string } | { element: string },
  ): Promise<ParsedFragment> {
    try {
      const result = await this.deps.rpc.call('doc.fragmentFromXml', {
        docId: this.docId,
        xml: stripFence(xml),
        parent,
      });
      return {
        nodes: this.assignIds(result.nodes),
        inline: result.inline,
        warnings: result.warnings,
      };
    } catch (error) {
      throw ChangeRejection.fromRpcError(error, 'element' in parent ? parent.element : undefined);
    }
  }

  /**
   * Gives every structural node of `nodes` (and of their subtrees) that has no `nodeId` an
   * `sc_<N>` id from the session's allocator, in document order; text nodes are left alone.
   * The input is not mutated.
   */
  assignIds(nodes: readonly FragmentResultNode[] | readonly ModelNodeJson[]): ModelNodeJson[] {
    return (nodes as readonly ModelNodeJson[]).map((node) => this.assignIdsTo(node));
  }

  /** @internal The hook's bookkeeping: a change starts (a checkpoint taken). */
  beginChange(tool: string, target: string, checkpoint: Checkpoint): ChangeRecord {
    this.changeCount += 1;
    const record: ChangeRecord = {
      changeId: `c${this.changeCount}`,
      strikeKey: strikeKey(tool, target),
      tool,
      target,
      checkpoint,
      outcome: null,
      status: 'pending',
    };
    this.changes.push(record);
    return record;
  }

  /** @internal The hook's bookkeeping: the change's outcome (null: it threw and was rolled back). */
  endChange(record: ChangeRecord, outcome: ChangeOutcome | null): void {
    record.outcome = outcome;
    if (!outcome) record.status = 'rolledBack';
    else if (outcome.accepted) {
      record.status = 'accepted';
      this.changesInThisRequest += 1;
    } else record.status = 'rejected';
  }

  /**
   * The commit (ai-catalogue §6.14, FR-064): a last validation of the copy under the multiset
   * rule - an excess key (it cannot happen after per-change validation; guarded anyway) →
   * `failed (invalidAtEnd)` and the copy discarded; else `after = copy.changed ? copy.release()
   * : null`, shown and recorded by the run session as one undo entry labelled after the
   * instruction (`undoLabel`), `modified` set only when something changed (FR-043). A request
   * cancelled before or during the validation → `cancelled`, the copy discarded (§6.15).
   */
  async commit(): Promise<CommitResult> {
    if (this.run.ended) return { kind: 'lost' };
    if (this.cancelledValue) return this.discardCancelled();
    if (!this.copy.changed) {
      this.after = null;
      this.run.commit(null);
      return { kind: 'unchanged' };
    }
    const report = await this.validate();
    // A cancel while the validation ran: below 2 MiB `doc.validate` is a plain request that no
    // `job.cancel` stops, and its report arrives all the same - the copy is not published.
    if (this.cancelledValue) return this.discardCancelled();
    const errors = newErrors(this.baseline, report);
    if (errors.length > 0) {
      this.after = undefined;
      this.run.discard();
      return { kind: 'failed', failure: { kind: 'invalidAtEnd', errors } };
    }
    return this.publish(this.copy.release());
  }

  /**
   * Publishes `after` as the request's result (the Source view's commit of US5 computes it
   * itself - the text path's `doc.fromXml`, the structured path's re-render - and hands it in
   * here): shown and recorded by the run session as one undo entry. Nothing is published once
   * the request was cancelled (`cancelled`, the copy discarded).
   */
  publish(after: Document): CommitResult {
    if (this.run.ended) return { kind: 'lost' };
    if (this.cancelledValue) return this.discardCancelled();
    this.after = after;
    const outcome = this.run.commit(after);
    if (outcome === 'committed') return { kind: 'committed', after };
    if (outcome === 'unchanged') return { kind: 'unchanged' };
    return { kind: 'lost' };
  }

  /**
   * Ends the request without a result (cancelled, failed, rejected, answered, askedBack): a
   * running validation is cancelled, the copy dropped, the document before the request and its
   * `modified` flag restored (defensive: nothing was published) and the lock released.
   */
  discard(): RunSessionOutcome {
    this.cancelValidation();
    this.after = undefined;
    return this.run.discard();
  }

  /**
   * The end of a commit the request's cancel overtook: the copy dropped, the document and
   * `modified` as before the request, no undo entry, the lock released (SC-005).
   */
  discardCancelled(): CommitResult {
    this.discard();
    return { kind: 'cancelled' };
  }

  /* ------------------------------------------------------------ internals */

  private assignIdsTo(node: ModelNodeJson): ModelNodeJson {
    if (node.type === 'text') return node;
    const attrs = { ...(node.attrs ?? {}) };
    if (typeof attrs.nodeId !== 'string' || !attrs.nodeId) attrs.nodeId = this.newNodeIds();
    const out: ModelNodeJson = { ...node, attrs };
    if (node.content) out.content = node.content.map((child) => this.assignIdsTo(child));
    return out;
  }
}

function summarise(report: ValidationReport): ValidationRecord {
  return {
    durationMs: report.durationMs,
    errorCount: report.errorCount,
    warningCount: report.warningCount,
  };
}

/**
 * Starts the session of a request (ai-catalogue §6 steps 2, 4, 5): takes the run lock as a
 * `RunSession` of kind `ai` labelled `<service> · <model>` (busy when a script or another
 * request holds it, `noDocument` without a document), validates the live document for the
 * baseline and builds the working copy over it. `validationUnavailable` releases the lock
 * again: nothing has been sent; so does a cancel during the baseline (`cancelled`) - its
 * validation job is handed to the owner's `cancel`, which stops it.
 */
export async function startRequestSession(
  deps: RequestSessionDeps,
  options: StartRequestSessionOptions,
): Promise<StartRequestSessionResult> {
  const state = deps.store.getState();
  if (!state.document) return { ok: false, reason: 'noDocument' };
  const run = startRunSession(
    {
      store: deps.store,
      undo: deps.undo,
      getController: deps.getController,
      ...(deps.tickMs === undefined ? {} : { tickMs: deps.tickMs }),
    },
    {
      kind: 'ai',
      label: options.label,
      undoLabel: undoLabel(options.instruction),
      ...(options.phase === undefined ? {} : { phase: options.phase }),
      ...(options.onCancel ? { onCancel: options.onCancel } : {}),
      ...(options.onDocumentReplaced ? { onDocumentReplaced: options.onDocumentReplaced } : {}),
      ...(options.onTick ? { onTick: options.onTick } : {}),
      ...(options.present ? { present: options.present } : {}),
      ...(options.undoView ? { undoView: options.undoView } : {}),
    },
  );
  if (!run) return { ok: false, reason: 'busy' };
  const { cancel } = options;
  let report: ValidationReport;
  try {
    report = await deps.rpc.runJob(
      'doc.validate',
      { docId: run.before.docId, document: run.before },
      { onStart: (jobId) => cancel?.jobStarted(jobId) },
    );
  } catch (error) {
    run.discard();
    throw error;
  }
  // The owner may have cancelled or ended the run meanwhile (Cancel, Escape, the document
  // replaced): a plain request (2 MiB and less) returns its report all the same.
  if (run.ended || run.cancelRequested || cancel?.cancelled()) {
    run.discard();
    return { ok: false, reason: 'cancelled' };
  }
  if (schemaUnavailable(report)) {
    run.discard();
    return { ok: false, reason: 'validationUnavailable' };
  }
  return { ok: true, session: new RequestSession(deps, run, options, report) };
}
