/**
 * The validity hook of an AI request (feature 005 T045; ai-catalogue §3.5, §6.10; data-model
 * §0 "IssueKey", §7; research R4.5-R4.6, review C3, C4; FR-060 to FR-064): every change a
 * request makes to its working copy - a change tool of the catalogue, the selection fast path,
 * a nested script run - goes through `applyChange`: a checkpoint of the copy, the change itself,
 * `doc.validate` of the whole copy, the **key diff** against the request's baseline, and either
 * the acceptance or a rollback to the checkpoint with the `rejected` envelope for the model.
 *
 * The key diff (C3): an error issue is identified by its **content key**
 * `${code}|${params.element ?? ''}|${params.message ?? ''}` - no nodeId, no path, no line, so a
 * pre-existing error that moves when a block is inserted before it keeps its key - and a report
 * is compared with the baseline as a **count multiset**: the change is accepted when no key
 * counts more than it did in the baseline. Warnings never count (FR-062). The issues of every
 * key whose count exceeds the baseline's are all reported, in document order (C13).
 *
 * The three-strike counter (C4, FR-063): one counter per key `<tool>:<target>`; every rejected
 * attempt counts - the hook's rejection as much as a pre-check, 1001, 1201 or invalid-argument
 * rejection the change's `apply` reports by throwing a `ChangeRejection`; the counter resets only
 * when a change with that key is accepted; the third strike ends the request as `rejected`.
 *
 * Pure helpers (`issueKey`, `multiset`, `newErrors`, `errorForModel`) serve the baseline, the
 * per-change check, the commit check and the Source text path alike.
 */

import { Fragment, Slice, type Node as PMNode } from 'prosemirror-model';

import { createReport, nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { fb2NameFor, fb2Schema } from '@/editor/schema';
import { replaceSectionsInModel } from '@/editor/virtualization';
import type { ValidationIssue, ValidationReport } from '@/model/document';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import type { SelectionSnapshot } from './context';
import type { RequestSession } from './session';

/** The content key of a validation issue (data-model §0). */
export type IssueKey = string;

/** Error keys with their counts - a report reduced for the key diff. */
export type IssueMultiset = Map<IssueKey, number>;

/** An error as the model reads it (data-model §7.3): the FB2 namespace stripped from the message. */
export interface ErrorForModel {
  code: string;
  element: string;
  path?: string;
  line?: number;
  message: string;
}

/** How many rejected attempts of one key end the request (FR-063). */
export const STRIKE_LIMIT = 3;

/**
 * The error codes of a change tool's rejected attempt (ai-catalogue §1.4): the hook's own
 * `rejected` and the pre-check / parse / argument rejections a change's `apply` throws.
 */
export type ChangeRejectionCode =
  | 'rejected'
  | 'invalidArguments'
  | 'unknownNode'
  | 'invalidNode'
  | 'notAllowed'
  | 'textOnly'
  | 'noSelection'
  | 'selectionRequired'
  | 'invalidXml'
  | 'fragmentNotAllowed';

/** Where an attempt was rejected (data-model §7.3 `stage`). */
export type RejectionStage = 'preCheck' | 'parse' | 'hook';

/**
 * The envelope codes that count one strike for a change tool's key (ai-catalogue §1.4, review
 * C4): every rejected *attempt* of a change. `unavailable`, `runNotConfirmed`, `scriptFailed`,
 * `cancelled`, `internal` (and the non-change codes) are gates or failures and count nothing.
 */
export const STRIKE_CODES: ReadonlySet<string> = new Set<ChangeRejectionCode>([
  'rejected',
  'invalidArguments',
  'unknownNode',
  'invalidNode',
  'notAllowed',
  'textOnly',
  'noSelection',
  'selectionRequired',
  'invalidXml',
  'fragmentNotAllowed',
]);

/** True when an envelope of `code` is a rejected attempt of a change (one strike). */
export function isStrikeCode(code: string): code is ChangeRejectionCode {
  return STRIKE_CODES.has(code);
}

const FB2_NAMESPACE = '{http://www.gribuser.ru/xml/fictionbook/2.0}';

/**
 * The hints of an `invalidXml` envelope (ai-catalogue §3.8; T060): "write U+00A0" when the
 * parser met `&nbsp;` (or any undefined entity), "return the elements that replace the
 * selection, without a document wrapper" when it met an XML declaration or a document-level
 * element; the general well-formedness advice otherwise.
 */
export function invalidXmlHint(detail: string): string {
  const hints: string[] = [];
  if (/nbsp|entity/i.test(detail)) {
    hints.push(
      'write the character U+00A0 itself, never &nbsp; (only the five predefined entities exist)',
    );
  }
  if (/xml declaration|FictionBook|<body|document/i.test(detail)) {
    hints.push(
      'return the elements that replace the selection, without a document wrapper, an XML declaration or namespace declarations',
    );
  }
  if (hints.length === 0) {
    hints.push(
      'return well-formed FB2 XML: close every element, escape &, < and > in text; only the five predefined entities exist',
    );
  }
  return `${hints.join('; ')}; use get_schema for the content model.`;
}

/* ------------------------------------------------------------------------ */
/* Issue keys                                                               */
/* ------------------------------------------------------------------------ */

function param(issue: ValidationIssue, name: string): string {
  const value = issue.params?.[name];
  return value === undefined || value === null ? '' : String(value);
}

/**
 * libxml2 appends the alternatives of the automaton state to some "not expected" messages
 * (`… This element is not expected. Expected is one of ( p, image, … ).`) - a tail that depends
 * on what *precedes* the element, so that the same misplaced element gets another message once
 * a block is inserted before it. The key drops the tail; the message the model and the user
 * read keeps it.
 */
const EXPECTED_TAIL = /\s*Expected is (one of )?\( .*\)\.?\s*$/;

/** The message of an issue as the key reads it: libxml2's text without its position-dependent tail. */
export function keyMessage(message: string): string {
  return message.replace(EXPECTED_TAIL, '');
}

/**
 * The content key of an issue: code, element and message - never a position (review C3), the
 * message without libxml2's "Expected is …" tail (`keyMessage`), which would otherwise make a
 * pre-existing error "new" when a block is inserted before it.
 */
export function issueKey(issue: Pick<ValidationIssue, 'code' | 'params'>): IssueKey {
  const params = issue.params ?? {};
  const element = params.element === undefined ? '' : String(params.element);
  const message = params.message === undefined ? '' : keyMessage(String(params.message));
  return `${issue.code}|${element}|${message}`;
}

/** The error issues of a report (or any issue list) as a count multiset; warnings are skipped. */
export function multiset(issues: readonly ValidationIssue[]): IssueMultiset {
  const counts: IssueMultiset = new Map();
  for (const issue of issues) {
    if (issue.severity !== 'error') continue;
    const key = issueKey(issue);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The number of error issues a multiset holds. */
export function multisetSize(counts: IssueMultiset): number {
  let total = 0;
  for (const count of counts.values()) total += count;
  return total;
}

/** Libxml2's text without the FB2 namespace (the core strips it already; kept defensive). */
export function stripNamespace(message: string): string {
  return message.split(FB2_NAMESPACE).join('');
}

/** An issue in the form the model reads (data-model §7.3 `ErrorForModel`). */
export function errorForModel(issue: ValidationIssue): ErrorForModel {
  const out: ErrorForModel = {
    code: issue.code,
    element: param(issue, 'element'),
    message: messageOf(issue),
  };
  if (issue.path) out.path = issue.path;
  if (typeof issue.line === 'number' && issue.line > 0) out.line = issue.line;
  return out;
}

function messageOf(issue: ValidationIssue): string {
  const message = param(issue, 'message');
  if (message) return stripNamespace(message);
  switch (issue.code) {
    case 'genre.unknown':
      return `Unknown genre code "${param(issue, 'code')}".`;
    case 'schema.unavailable':
      return param(issue, 'reason') || 'The FB2 schema is unavailable.';
    default: {
      const rest = Object.entries(issue.params ?? {})
        .filter(([name]) => name !== 'element')
        .map(([name, value]) => `${name}: ${String(value)}`)
        .join(', ');
      return rest ? `${issue.code} (${rest})` : issue.code;
    }
  }
}

/**
 * The errors of `report` that are new against `baseline` (data-model §7.3 `newErrors`): all
 * issues of every key whose count in the report exceeds the baseline's count, in the report's
 * (document) order. Empty = accepted. Warnings never count.
 */
export function newErrors(
  baseline: IssueMultiset,
  report: Pick<ValidationReport, 'issues'>,
): ErrorForModel[] {
  const current = multiset(report.issues);
  const excess = new Set<IssueKey>();
  for (const [key, count] of current) {
    if (count > (baseline.get(key) ?? 0)) excess.add(key);
  }
  if (excess.size === 0) return [];
  return report.issues
    .filter((issue) => issue.severity === 'error' && excess.has(issueKey(issue)))
    .map(errorForModel);
}

/** True when the report contains `schema.unavailable`: no key diff is possible (data-model §7.2). */
export function schemaUnavailable(report: Pick<ValidationReport, 'issues'>): boolean {
  return report.issues.some((issue) => issue.code === 'schema.unavailable');
}

/* ------------------------------------------------------------------------ */
/* Strikes                                                                  */
/* ------------------------------------------------------------------------ */

/** The strike key of a change (ai-catalogue §3.5): `<tool>:<target>`. */
export function strikeKey(tool: string, target: string): string {
  return `${tool}:${target}`;
}

/**
 * The per-key strike counters of one request (data-model §7.4): a rejected attempt adds one to
 * its key; an accepted change resets its key alone; nothing else touches a counter.
 */
export class StrikeCounter {
  private readonly counts = new Map<string, number>();

  /** The counter of `key` (0 when it never struck). */
  count(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  /** One rejected attempt of `key`: returns the new count. */
  strike(key: string): number {
    const next = this.count(key) + 1;
    this.counts.set(key, next);
    return next;
  }

  /** An accepted change of `key`: its counter alone goes back to 0. */
  reset(key: string): void {
    this.counts.delete(key);
  }

  /** `count(key) >= STRIKE_LIMIT`: the request ends as `rejected`. */
  exhausted(key: string): boolean {
    return this.count(key) >= STRIKE_LIMIT;
  }

  /** The keys that struck at least once, with their counts (tests, activity). */
  entries(): [string, number][] {
    return [...this.counts.entries()];
  }
}

/* ------------------------------------------------------------------------ */
/* Change rejection (pre-check / parse / arguments)                         */
/* ------------------------------------------------------------------------ */

/**
 * Thrown by a change's `apply` when the change is refused before the round trip (a node that
 * does not fit, an unknown node, 1001, 1201, bad arguments): `applyChange` rolls back, counts
 * the strike and answers the envelope with this code (ai-catalogue §6.10.2; review C4).
 */
export class ChangeRejection extends Error {
  readonly code: Exclude<ChangeRejectionCode, 'rejected'>;
  readonly stage: Exclude<RejectionStage, 'hook'>;
  readonly issues: ErrorForModel[];
  readonly hint?: string;
  readonly expected?: unknown;

  constructor(
    code: Exclude<ChangeRejectionCode, 'rejected'>,
    message: string,
    options: {
      stage?: Exclude<RejectionStage, 'hook'>;
      issues?: ErrorForModel[];
      hint?: string;
      expected?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ChangeRejection';
    this.code = code;
    this.stage =
      options.stage ??
      (code === 'invalidXml' || code === 'fragmentNotAllowed' ? 'parse' : 'preCheck');
    this.issues = options.issues ?? [];
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.expected !== undefined) this.expected = options.expected;
  }

  /**
   * The core's refusal of a fragment as a rejection (rpc-api §3.2): 1001 → `invalidXml` with
   * the parser's line, column and message; 1201 → `fragmentNotAllowed` naming the pair. Any
   * other error is returned as it is (the caller treats it as internal).
   */
  static fromRpcError(error: unknown, parentElement?: string): ChangeRejection | unknown {
    if (!(error instanceof RpcError)) return error;
    if (error.code === RpcErrorCode.docParseError) {
      const data = (error.data ?? {}) as { line?: number; column?: number; message?: string };
      const message = data.message ?? error.message;
      const issue: ErrorForModel = { code: 'xml.notWellFormed', element: '', message };
      if (typeof data.line === 'number') issue.line = data.line;
      return new ChangeRejection('invalidXml', `The fragment is not well-formed XML: ${message}`, {
        stage: 'parse',
        issues: [issue],
        hint: invalidXmlHint(message),
      });
    }
    if (error.code === RpcErrorCode.aiFragmentNotAllowed) {
      const data = (error.data ?? {}) as { element?: string; parent?: string };
      const element = data.element ?? '';
      const parent = data.parent ?? parentElement ?? '';
      const message = `Element '${element}' is not allowed inside '${parent}'.`;
      return new ChangeRejection('fragmentNotAllowed', message, {
        stage: 'parse',
        issues: [{ code: 'schema.invalid', element, message }],
        hint: FRAGMENT_HINT,
      });
    }
    return error;
  }
}

const FRAGMENT_HINT =
  'Return the elements that replace the selection, without a document wrapper, an XML ' +
  'declaration or namespace declarations; use get_schema with the parent element for its ' +
  'content model.';

/**
 * A change tool's thrown envelope body (the catalogue's `ToolError`) as a `ChangeRejection`
 * when its code is a strike code - the pre-check, parse and argument refusals of ai-catalogue
 * §6.10.2, with the `ErrorForModel` issues the tool put in the envelope -, or `null` for a
 * gate or failure (`unavailable`, `runNotConfirmed`, `scriptFailed`, `cancelled`, `internal`,
 * …), which the hook rolls back but counts nowhere (review C4).
 */
export function rejectionFromEnvelope(body: {
  code: string;
  message: string;
  hint?: string;
  expected?: unknown;
  issues?: unknown[];
}): ChangeRejection | null {
  if (!isStrikeCode(body.code) || body.code === 'rejected') return null;
  return new ChangeRejection(body.code, body.message, {
    ...(body.hint === undefined ? {} : { hint: body.hint }),
    ...(body.expected === undefined ? {} : { expected: body.expected }),
    issues: Array.isArray(body.issues) ? (body.issues as ErrorForModel[]) : [],
  });
}

/**
 * The issues of the consecutive rejections of one strike key (data-model §7.4; US4 scenario 3):
 * the rejected change records of `key` since its last accepted change, in order - what the
 * panel shows when the third strike ends the request ("the three rejections' issues").
 */
export function strikeIssues(
  session: Pick<RequestSession, 'changes'>,
  key: string,
): ErrorForModel[] {
  const issues: ErrorForModel[] = [];
  for (const record of session.changes) {
    if (record.strikeKey !== key) continue;
    if (record.status === 'accepted') issues.length = 0;
    else if (record.status === 'rejected' && record.outcome && !record.outcome.accepted) {
      issues.push(...record.outcome.issues);
    }
  }
  return issues;
}

/* ------------------------------------------------------------------------ */
/* applyChange                                                              */
/* ------------------------------------------------------------------------ */

/** One change for the hook: what it is called in the strike key, and how it changes the copy. */
export interface ChangeSpec<T = unknown> {
  /** The tool's name (`replace_selection`, `replace_node`, `run_script` ...). */
  tool: string;
  /** The strike target (ai-catalogue §3.5): `selection`, a nodeId, `<where>@<nodeId>`, the script id ... */
  target: string;
  /**
   * Changes `session.copy` (through the copy's writes or a `reset`); may throw a
   * `ChangeRejection` for a pre-check / parse / argument refusal. Its value becomes `result` of
   * an accepted outcome (the tool's success data).
   */
  apply: () => T | Promise<T>;
  /**
   * The Source text path (US5, ai-catalogue §8.1): validates what `apply` produced instead of
   * the copy - `doc.validate({text})` of the spliced text; may throw a `ChangeRejection`
   * (`invalidXml` for a text that is not well-formed), which is a rejected attempt like one
   * thrown by `apply`.
   */
  validate?: () => Promise<ValidationReport>;
  /** The text path: told the decision - the accepted text is kept, a rejected one dropped. */
  settle?: (accepted: boolean) => void;
}

export interface ChangeAccepted<T> {
  accepted: true;
  result: T;
  /** The validation that accepted the change. */
  report: { errorCount: number; warningCount: number; durationMs: number };
  /** The baseline's error count (what the tool's success result reports as pre-existing). */
  preExistingErrors: number;
  /** The report's warnings (never blocking). */
  warnings: number;
}

export interface ChangeRejected {
  accepted: false;
  code: ChangeRejectionCode;
  stage: RejectionStage;
  message: string;
  hint: string;
  expected?: unknown;
  /** All new errors, in document order (hook) or the refusal in the same form (pre-check, parse). */
  issues: ErrorForModel[];
  /** The counter of this change's key after this attempt. */
  strike: { count: number; of: number };
  /** The third strike: the request ends as `rejected` (FR-063). */
  ended: boolean;
  /** The validation that rejected the change (absent for a pre-check / parse rejection). */
  report?: { errorCount: number; warningCount: number; durationMs: number };
}

export type ChangeOutcome<T = unknown> = ChangeAccepted<T> | ChangeRejected;

/** The envelope the model receives for a rejected attempt (ai-catalogue §1.4, §6.10.6). */
export interface RejectedEnvelope {
  error: {
    code: ChangeRejectionCode;
    message: string;
    hint?: string;
    expected?: unknown;
    issues: ErrorForModel[];
    strike: { count: number; of: number };
  };
}

export function rejectedEnvelope(outcome: ChangeRejected): RejectedEnvelope {
  const error: RejectedEnvelope['error'] = {
    code: outcome.code,
    message: outcome.message,
    issues: outcome.issues,
    strike: outcome.strike,
  };
  if (outcome.hint) error.hint = outcome.hint;
  if (outcome.expected !== undefined) error.expected = outcome.expected;
  return { error };
}

const HOOK_HINT =
  'Read the issues, correct the content and try again; use get_schema for the content model.';

/**
 * Runs one change under the hook (ai-catalogue §6.10): `copy.checkpoint()`, `apply()`,
 * `doc.validate` of the copy, the key diff against the baseline; accepted → the counter of
 * the change's key resets, `changesInThisRequest` grows, the change is recorded; rejected (by
 * the hook or by a `ChangeRejection` thrown by `apply`) → `copy.rollback()`, one strike for
 * the key, the `rejected` outcome - `ended` on the third strike, when the caller ends the
 * request and discards the whole copy. Any other exception of `apply` or of the validation
 * (an RPC failure, a bug) rolls back and propagates: the loop treats it as `failed (internal)`.
 */
export async function applyChange<T>(
  session: RequestSession,
  change: ChangeSpec<T>,
): Promise<ChangeOutcome<T>> {
  const key = strikeKey(change.tool, change.target);
  const checkpoint = session.copy.checkpoint();
  const record = session.beginChange(change.tool, change.target, checkpoint);
  const reject = (
    outcome: Omit<ChangeRejected, 'accepted' | 'strike' | 'ended'>,
  ): ChangeRejected => {
    session.copy.rollback(checkpoint);
    change.settle?.(false);
    const count = session.strikes.strike(key);
    const rejected: ChangeRejected = {
      accepted: false,
      ...outcome,
      strike: { count, of: STRIKE_LIMIT },
      ended: count >= STRIKE_LIMIT,
    };
    session.endChange(record, rejected);
    return rejected;
  };
  const rejectionOf = (error: ChangeRejection): ChangeRejected =>
    reject({
      code: error.code,
      stage: error.stage,
      message: error.message,
      hint: error.hint ?? HOOK_HINT,
      ...(error.expected === undefined ? {} : { expected: error.expected }),
      issues: error.issues,
    });

  let result: T;
  try {
    result = await change.apply();
  } catch (error) {
    if (error instanceof ChangeRejection) return rejectionOf(error);
    session.copy.rollback(checkpoint);
    change.settle?.(false);
    session.endChange(record, null);
    throw error;
  }

  let report: ValidationReport;
  try {
    report = change.validate ? await change.validate() : await session.validate();
  } catch (error) {
    if (error instanceof ChangeRejection) return rejectionOf(error);
    session.copy.rollback(checkpoint);
    change.settle?.(false);
    session.endChange(record, null);
    throw error;
  }
  const summary = {
    errorCount: report.errorCount,
    warningCount: report.warningCount,
    durationMs: report.durationMs,
  };
  const issues = newErrors(session.baseline, report);
  if (issues.length > 0) {
    return reject({
      code: 'rejected',
      stage: 'hook',
      message: `The change was rejected by the FB2 2.1 schema check and was not applied: ${issues.length} new error${issues.length === 1 ? '' : 's'}.`,
      hint: HOOK_HINT,
      issues,
      report: summary,
    });
  }
  session.strikes.reset(key);
  change.settle?.(true);
  const accepted: ChangeAccepted<T> = {
    accepted: true,
    result,
    report: summary,
    preExistingErrors: session.preExistingErrors,
    warnings: report.warningCount,
  };
  session.endChange(record, accepted);
  return accepted;
}

/* ------------------------------------------------------------------------ */
/* The selection replacement (ai-catalogue §3.2 replace_selection; §5.1)    */
/* ------------------------------------------------------------------------ */

/** The content of a replacement: FB2 XML or plain text (ai-catalogue §3.2). */
export type ReplacementContent =
  | {
      xml: string;
      /** Inline only: the plain text applied when `xml` does not parse as inline content (§5.1 row i). */
      textFallback?: string;
    }
  | { text: string };

/** What a selection replacement reports (the tool's `structuredContent`, ai-catalogue §3.2). */
export interface SelectionReplacementResult {
  replaced: { characters: number; paragraphs: number };
  /** The inserted nodes (inline text has none) with their ids and FB2 types. */
  inserted: { id: string; type: string }[];
  /** The replacement's range in the editor document - what the commit selects (FR-031). */
  range: { from: number; to: number };
}

/** The strike target of every selection replacement (ai-catalogue §3.5). */
export const SELECTION_TARGET = 'selection';

/** The depth to the first (`'first'`) / last text block below `node`; 0 when there is none. */
function openDepth(node: PMNode, side: 'first' | 'last'): number {
  let depth = 0;
  let current: PMNode | null = node;
  while (current && !current.isTextblock) {
    current = side === 'first' ? current.firstChild : current.lastChild;
    if (!current) return 0;
    depth += 1;
  }
  return current ? depth + 1 : 0;
}

/** Checked ProseMirror nodes of the parsed model nodes (`invalidNode` when one cannot be built). */
function checkedNodes(nodes: readonly ModelNodeJson[], inlineContext: boolean): PMNode[] {
  const out: PMNode[] = [];
  for (const json of nodes) {
    const report = createReport();
    const node = nodeFromModel(json, report, json.type, inlineContext);
    const problem = report.problems[0];
    if (!node || problem) {
      const message = problem
        ? `invalid node at "${problem.path}": ${problem.message}`
        : `cannot build a "${json.type}" node`;
      throw new ChangeRejection('invalidNode', message, {
        issues: [{ code: 'schema.invalid', element: json.type, message }],
        hint: 'Use get_schema for the content model of the parent.',
      });
    }
    out.push(node);
  }
  return out;
}

/** The parse context of the selection's parent: the core knows `n<N>` ids only (review C12). */
function parentRef(parent: {
  nodeId: string;
  element: string;
}): { nodeId: string } | { element: string } {
  return /^n\d+$/.test(parent.nodeId) ? { nodeId: parent.nodeId } : { element: parent.element };
}

/**
 * The change of a selection replacement (ai-catalogue §3.2 `replace_selection` and the §5.1 fast
 * path) for `applyChange`: `inline` - `{text}` becomes text with the marks at the selection start,
 * `{xml}` is parsed with the container as parent and must be inline content (`fragmentNotAllowed`
 * otherwise; with `textFallback` the text is applied instead - §5.1 row i); `blocks` - `{xml}` is
 * parsed with the blocks' parent and must be block content, `{text}` becomes one `p` per
 * non-empty line, and the blocks replace the selection as a slice with the selection's open ends
 * (replace / paste semantics - the first / last block's content joins the unselected part of a
 * partial block, review C6). The working copy takes the result; **nothing is shown** (the
 * live view changes at the commit only). The editor document must still be the one the
 * snapshot was taken from, which holds for the fast path and for a request without earlier
 * changes to the mounted window.
 */
export function selectionReplacement(
  session: RequestSession,
  snapshot: SelectionSnapshot,
  content: ReplacementContent,
  controller: BodyEditorController,
): ChangeSpec<SelectionReplacementResult> {
  return {
    tool: 'replace_selection',
    target: SELECTION_TARGET,
    apply: () => applySelectionReplacement(session, snapshot, content, controller),
  };
}

async function applySelectionReplacement(
  session: RequestSession,
  snapshot: SelectionSnapshot,
  content: ReplacementContent,
  controller: BodyEditorController,
): Promise<SelectionReplacementResult> {
  if (snapshot.form === 'xml' || !snapshot.pm || !snapshot.parent) {
    throw new ChangeRejection('invalidArguments', 'the selection is not a Body selection', {
      hint: 'The Source text path replaces the selected text as XML text.',
    });
  }
  const state = controller.editorState;
  const window = controller.currentWindow;
  if (!state || !window) throw new Error('the Body editor is not available');
  const { from, to, depth } = snapshot.pm;
  const doc = state.doc;
  if (to > doc.content.size) throw new Error('the selection is no longer in the editor document');
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const tr = state.tr;
  const replaced = { characters: snapshot.characters, paragraphs: snapshot.paragraphs };
  const inserted: { id: string; type: string }[] = [];
  // The range the replacement takes: the selection itself, widened to whole blocks at a closed end.
  let start = from;
  let end = to;

  if (snapshot.form === 'inline') {
    let nodes: PMNode[] | null = null;
    if ('xml' in content) {
      try {
        const parsed = await session.fragmentFromXml(content.xml, parentRef(snapshot.parent));
        if (!parsed.inline) {
          throw new ChangeRejection(
            'fragmentNotAllowed',
            'inline content was expected for a selection inside one paragraph',
            {
              stage: 'parse',
              issues: [
                {
                  code: 'schema.invalid',
                  element: parsed.nodes[0]?.type ?? '',
                  message: 'block element inside a text container',
                },
              ],
              hint: 'Reply with the text and inline elements that replace the selected text, without <p>.',
            },
          );
        }
        nodes = checkedNodes(parsed.nodes, true);
      } catch (error) {
        if (!(error instanceof ChangeRejection) || content.textFallback === undefined) throw error;
        nodes = null;
      }
    }
    if (!nodes) {
      const text = 'text' in content ? content.text : (content.textFallback ?? '');
      nodes = text ? [fb2Schema.text(text, $from.marks())] : [];
    }
    if (nodes.length > 0) tr.replaceWith(from, to, nodes);
    else tr.delete(from, to);
    for (const node of nodes) {
      const id = node.attrs.nodeId;
      if (typeof id === 'string' && id) inserted.push({ id, type: fb2NameFor(node.type) });
    }
  } else {
    let model: ModelNodeJson[];
    if ('xml' in content) {
      const parsed = await session.fragmentFromXml(content.xml, parentRef(snapshot.parent));
      if (parsed.inline && parsed.nodes.length > 0) {
        throw new ChangeRejection(
          'fragmentNotAllowed',
          'block elements were expected for a selection of whole blocks',
          {
            stage: 'parse',
            issues: [
              {
                code: 'schema.invalid',
                element: '#text',
                message: `text inside '${snapshot.parent.element}'`,
              },
            ],
            hint: 'Return the elements that replace the selection (<p>…</p>, …), without a document wrapper.',
          },
        );
      }
      model = parsed.nodes;
    } else {
      model = session.assignIds(
        content.text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .map((line) => ({ type: 'p', attrs: {}, content: [{ type: 'text', text: line }] })),
      );
    }
    const nodes = checkedNodes(model, false);
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const slice = new Slice(
      Fragment.from(nodes),
      snapshot.openStart && first ? openDepth(first, 'first') : 0,
      snapshot.openEnd && last ? openDepth(last, 'last') : 0,
    );
    start = snapshot.openStart || $from.depth <= depth ? from : $from.before(depth + 1);
    end = snapshot.openEnd || $to.depth <= depth ? to : $to.after(depth + 1);
    tr.replace(start, end, slice);
    // An open end: ProseMirror puts the unselected tail of the partial last block into the
    // replacement's last block (paste semantics), which would give that block the new node's
    // attributes - the tail keeps its block's identity (`id`, `style`, `nodeId`) instead, so
    // that links to it and references the model holds stay valid (C6: unselected text untouched).
    if (snapshot.openEnd && $to.parent.isTextblock) {
      const $tail = tr.doc.resolve(tr.mapping.map(end, 1));
      if ($tail.parent.isTextblock && $tail.parent.type === $to.parent.type) {
        tr.setNodeMarkup($tail.before(), undefined, $to.parent.attrs);
      }
    }
    const kept = new Set<string>();
    tr.doc.nodesBetween(tr.mapping.map(start, -1), tr.mapping.map(end, 1), (node) => {
      const id = node.attrs.nodeId;
      if (typeof id === 'string' && id) kept.add(id);
      return true;
    });
    for (const node of nodes) {
      const id = node.attrs.nodeId;
      if (typeof id === 'string' && kept.has(id))
        inserted.push({ id, type: fb2NameFor(node.type) });
    }
  }

  const range = { from: tr.mapping.map(start, -1), to: tr.mapping.map(end, 1) };
  if (tr.docChanged) {
    session.copy.reset(replaceSectionsInModel(session.copy.document, window, tr.doc).model);
  }
  return { replaced, inserted, range };
}
