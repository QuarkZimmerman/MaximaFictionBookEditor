/**
 * Feature 005 T045 (data-model §6, §7.2; ai-catalogue §6 steps 2, 4, 5, 14, 15; research R4;
 * FR-043, FR-060 to FR-064) - the working copy session of a request: it takes the run lock as
 * an `ai` session labelled `<service> · <model>`, validates the **live** document for the
 * baseline (a count multiset of error keys; `schema.unavailable` → `validationUnavailable` and
 * the lock released), works on a copy-on-write `WorkingCopy` with checkpoint / rollback, commits
 * as **one** undo snapshot named after the instruction only when the copy changed, discards
 * byte for byte otherwise, and gives the nodes of `doc.fragmentFromXml` `sc_<N>` ids (C12).
 * Feature 006 T174 (I26, C7; ai-catalogue Δ§3 "Ids of new nodes"): those ids stay unique in the
 * book - across requests in a row and across the script runs nested in a request.
 */

import { startAssistant, startRequest, stopAssistant } from '@/ai/assistant';
import { ChangeRejection } from '@/ai/hook';
import { startRequestSession, type RequestSession } from '@/ai/session';
import { createCommandRegistry } from '@/app/commands';
import type { ModelNodeJson } from '@/editor/fromModel';
import { initI18n } from '@/i18n';
import type { Document } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type AiOutcome } from '@/rpc/types';
import { installScriptsFeature } from '@/scripting/catalog';
import { cancelActiveRun, startRunSession } from '@/scripting/runSession';
import type { HostMessage, InitMessage, ScriptInfo, WorkerMessage } from '@/scripting/types';

import { fakeDialogs, fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

import {
  book,
  harness,
  paragraph,
  sectionTexts,
  TITLE_UNEXPECTED,
  validateDocument,
  type FragmentTable,
  type Harness,
} from './sessionUtils';

async function start(
  h: Harness,
  overrides: Partial<Parameters<typeof startRequestSession>[1]> = {},
) {
  const result = await startRequestSession(h.deps, {
    origin: 'popup',
    kind: 'selection',
    instruction: 'Fix typos',
    label: 'Stand-in · standin-chat',
    phase: 'preparing',
    ...overrides,
  });
  if (!result.ok) throw new Error(`session did not start: ${result.reason}`);
  return result.session;
}

/**
 * A validation of `holdJobs`: `start` delivers its job id (a book above 2 MiB), `fail` ends it
 * with an error, `answer` with the report of the document it was sent (never started: the plain
 * request of a smaller book, which no `job.cancel` stops).
 */
interface HeldJob {
  start(jobId: string): void;
  fail(error: RpcError): void;
  answer(): void;
}

/** Makes every later `runJob` of the harness a validation that waits for the test. */
function holdJobs(h: Harness): HeldJob[] {
  type RunJob = (
    method: string,
    params: unknown,
    options?: { onStart?: (id: string) => void },
  ) => Promise<unknown>;
  const held: HeldJob[] = [];
  (h.rpc.client as unknown as { runJob: RunJob }).runJob = (method, params, options) => {
    h.rpc.calls.push({ method, params });
    return new Promise((resolve, reject) => {
      held.push({
        start: (jobId) => options?.onStart?.(jobId),
        fail: reject,
        answer: () => resolve(validateDocument((params as { document: Document }).document)),
      });
    });
  };
  return held;
}

const cancelled = (jobId: string) => new RpcError(RpcErrorCode.cancelled, 'cancelled', { jobId });

describe('startRequestSession', () => {
  it('takes the ai lock, validates the live document for the baseline and builds the copy over it', async () => {
    const h = harness();
    const before = h.store.getState().document!;
    const session = await start(h);
    expect(h.store.getState().runLock).toMatchObject({
      kind: 'ai',
      label: 'Stand-in · standin-chat',
      phase: 'preparing',
    });
    expect(session.docId).toBe('doc-1');
    expect(session.before).toBe(before);
    expect(session.modifiedBefore).toBe(false);
    expect(session.copy.document).toBe(before);
    expect(session.copy.changed).toBe(false);
    // The baseline came from the live document itself (never the core's snapshot).
    expect(h.validated).toEqual([before]);
    expect(h.rpc.calls.filter((c) => c.method === 'doc.validate')).toMatchObject([
      { params: { docId: 'doc-1', document: before } },
    ]);
    // One pre-existing error (the late title of section 2) as a count multiset.
    expect([...session.baseline.entries()]).toEqual([
      [`schema.invalid|title|${TITLE_UNEXPECTED}`, 1],
    ]);
    expect(session.preExistingErrors).toBe(1);
    expect(session.baselineReport).toEqual({ durationMs: 3, errorCount: 1, warningCount: 0 });
    expect(session.validations).toEqual([session.baselineReport]);
    expect(session.changesInThisRequest).toBe(0);
    expect(session.changes).toEqual([]);
    expect(session.structuredAllowed).toBe(true);
    expect(session.origin).toBe('popup');
    expect(session.kind).toBe('selection');
    expect(session.instruction).toBe('Fix typos');
    expect(session.selection).toBeNull();
    expect(session.run.undoLabel).toBe('Fix typos');
    session.setPhase('waiting for the answer');
    expect(h.store.getState().runLock?.phase).toBe('waiting for the answer');
    session.discard();
    expect(h.store.getState().runLock).toBeNull();
  });

  it('refuses without a document and while a script run holds the lock', async () => {
    const h = harness();
    const scriptRun = startRunSession(h.deps, { kind: 'script', label: 'Upper case' })!;
    expect(
      await startRequestSession(h.deps, {
        origin: 'panel',
        kind: 'general',
        instruction: 'x',
        label: 'l',
      }),
    ).toEqual({
      ok: false,
      reason: 'busy',
    });
    scriptRun.discard();
    actions.closeDocument(h.store);
    expect(
      await startRequestSession(h.deps, {
        origin: 'panel',
        kind: 'general',
        instruction: 'x',
        label: 'l',
      }),
    ).toEqual({
      ok: false,
      reason: 'noDocument',
    });
    expect(h.validated).toEqual([]);
  });

  it('ends with validationUnavailable when the baseline report says schema.unavailable, releasing the lock', async () => {
    const h = harness({ document: book({ bookTitle: 'NO SCHEMA' }) });
    const result = await startRequestSession(h.deps, {
      origin: 'popup',
      kind: 'selection',
      instruction: 'x',
      label: 'l',
    });
    expect(result).toEqual({ ok: false, reason: 'validationUnavailable' });
    expect(h.store.getState().runLock).toBeNull();
    expect(h.store.getState().modified).toBe(false);
    expect(h.undo.canUndo).toBe(false);
  });

  it('releases the lock and propagates when the baseline validation fails', async () => {
    const h = harness();
    h.rpc.responses['doc.validate'] = new RpcError(RpcErrorCode.clientDisconnected, 'disconnected');
    await expect(
      startRequestSession(h.deps, {
        origin: 'popup',
        kind: 'selection',
        instruction: 'x',
        label: 'l',
      }),
    ).rejects.toThrow('disconnected');
    expect(h.store.getState().runLock).toBeNull();
  });

  it('hands the baseline job to the owner, and ends cancelled when the owner cancelled while the baseline ran, the lock released (ai-catalogue §6.15)', async () => {
    const h = harness();
    const held = holdJobs(h);
    const jobs: string[] = [];
    let ownerCancelled = false;
    const result = startRequestSession(h.deps, {
      origin: 'popup',
      kind: 'selection',
      instruction: 'x',
      label: 'l',
      cancel: { cancelled: () => ownerCancelled, jobStarted: (jobId) => jobs.push(jobId) },
    });
    expect(h.store.getState().runLock).toMatchObject({ kind: 'ai' });
    // A book above 2 MiB: the baseline's job goes to the owner, whose cancel stops it.
    held[0]!.start('job-20');
    expect(jobs).toEqual(['job-20']);
    // The owner cancels before the report is back; a report no `job.cancel` stopped (the plain
    // request of a smaller book, a job that finished first) arrives all the same - the request
    // ends here, nothing sent.
    ownerCancelled = true;
    held[0]!.answer();
    expect(await result).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.store.getState().runLock).toBeNull();
    expect(h.undo.canUndo).toBe(false);
    expect(h.store.getState().modified).toBe(false);
  });

  it('ends cancelled when the banner Cancel came while the baseline ran', async () => {
    const h = harness();
    const held = holdJobs(h);
    const onCancel = vi.fn();
    const result = startRequestSession(h.deps, {
      origin: 'panel',
      kind: 'general',
      instruction: 'x',
      label: 'l',
      onCancel,
    });
    cancelActiveRun(h.store);
    expect(onCancel).toHaveBeenCalledTimes(1);
    held[0]!.answer();
    expect(await result).toEqual({ ok: false, reason: 'cancelled' });
    expect(h.store.getState().runLock).toBeNull();
  });
});

describe('RequestSession', () => {
  it('checkpoint / rollback restore the copy: document, index and flags', async () => {
    const h = harness();
    const session = await start(h);
    const cp = session.checkpoint();
    session.copy.insert('after', 'p1', paragraph('sc_1', 'Inserted.') as unknown as ModelNodeJson);
    expect(session.copy.changed).toBe(true);
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Inserted.',
      'Second paragraph.',
    ]);
    expect(sectionTexts(session.before, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Second paragraph.',
    ]);
    session.rollback(cp);
    expect(session.copy.document).toBe(session.before);
    expect(session.copy.changed).toBe(false);
    expect(session.copy.place('sc_1')).toBeUndefined();
    session.discard();
  });

  it('validate() sends the copy as it stands and records the report', async () => {
    const h = harness();
    const session = await start(h);
    session.copy.insert('after', 'p1', paragraph('sc_1', 'BAD word.') as unknown as ModelNodeJson);
    const report = await session.validate();
    expect(report.errorCount).toBe(2);
    expect(h.validated[1]).toBe(session.copy.document);
    expect(session.validations).toHaveLength(2);
    expect(session.validations[1]).toEqual({ durationMs: 3, errorCount: 2, warningCount: 0 });
    session.discard();
  });

  it('commit() of an unchanged copy publishes nothing: no undo entry, modified untouched', async () => {
    const h = harness();
    const before = h.store.getState().document!;
    const session = await start(h);
    expect(await session.commit()).toEqual({ kind: 'unchanged' });
    expect(session.after).toBeNull();
    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().modified).toBe(false);
    expect(h.undo.canUndo).toBe(false);
    expect(h.store.getState().runLock).toBeNull();
    // No second validation for a copy that never changed.
    expect(h.validated).toHaveLength(1);
  });

  it('commit() of a changed copy validates it last, shows it and records one undo entry named after the instruction', async () => {
    const h = harness();
    const before = h.store.getState().document!;
    const instruction =
      'Fix the typos\n   and the punctuation of these two paragraphs, but change nothing else at all';
    const session = await start(h, { instruction });
    session.copy.insert('after', 'p1', paragraph('sc_1', 'Inserted.') as unknown as ModelNodeJson);
    const result = await session.commit();
    expect(result.kind).toBe('committed');
    const after = (result as { after: typeof before }).after;
    expect(session.after).toBe(after);
    expect(h.validated).toHaveLength(2);
    expect(h.validated[1]).toBe(after);
    expect(h.store.getState().document).toBe(after);
    expect(h.store.getState().modified).toBe(true);
    expect(h.store.getState().runLock).toBeNull();
    expect(sectionTexts(after, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Inserted.',
      'Second paragraph.',
    ]);
    expect(h.undo.undoDepth).toBe(1);
    expect(h.undo.peekUndo()?.label).toBe(
      'Fix the typos and the punctuation of these two paragraphs,…',
    );
    expect(h.undo.peekUndo()!.label.length).toBeLessThanOrEqual(60);
    h.undo.undo();
    expect(h.store.getState().document).toBe(before);
    h.undo.redo();
    expect(h.store.getState().document).toBe(after);
  });

  it('commit() refuses a copy whose last validation shows a new error: failed (invalidAtEnd), the document as before', async () => {
    const h = harness();
    const before = h.store.getState().document!;
    const session = await start(h);
    // A change made past the hook (never through applyChange): the safety net of FR-064.
    session.copy.insert(
      'after',
      'p1',
      paragraph('sc_1', 'A BAD word.') as unknown as ModelNodeJson,
    );
    const result = await session.commit();
    expect(result.kind).toBe('failed');
    expect((result as { failure: { kind: string; errors: unknown[] } }).failure.kind).toBe(
      'invalidAtEnd',
    );
    expect((result as { failure: { errors: { element: string }[] } }).failure.errors).toMatchObject(
      [{ element: 'p' }],
    );
    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().modified).toBe(false);
    expect(h.undo.canUndo).toBe(false);
    expect(h.store.getState().runLock).toBeNull();
    expect(session.after).toBeUndefined();
  });

  it('commit() after a cancel that came while its validation was a plain request (2 MiB and less) publishes nothing: cancelled, the document, modified and the undo history as before (ai-catalogue §6.15, SC-005)', async () => {
    const h = harness();
    const before = h.store.getState().document!;
    const session = await start(h);
    session.copy.insert('after', 'p1', paragraph('sc_1', 'Inserted.') as unknown as ModelNodeJson);
    const held = holdJobs(h);
    const result = session.commit();
    expect(held).toHaveLength(1);
    // Escape while `doc.validate` runs: no job id, nothing a `job.cancel` could stop - the
    // report arrives all the same.
    session.cancelValidation();
    held[0]!.answer();
    expect(await result).toEqual({ kind: 'cancelled' });
    expect(session.cancelled).toBe(true);
    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().modified).toBe(false);
    expect(h.undo.canUndo).toBe(false);
    expect(h.store.getState().runLock).toBeNull();
    expect(session.ended).toBe(true);
    expect(session.after).toBeUndefined();
    expect(h.rpc.calls.filter((c) => c.method === 'job.cancel')).toEqual([]);
  });

  it('publish() and commit() after a cancel publish nothing: cancelled, the copy discarded', async () => {
    const h = harness();
    const before = h.store.getState().document!;
    const published = await start(h);
    published.copy.insert('after', 'p1', paragraph('sc_1', 'x') as unknown as ModelNodeJson);
    published.cancelValidation();
    // The Source view's commit hands its result in after its own steps.
    expect(published.publish(published.copy.release())).toEqual({ kind: 'cancelled' });
    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().runLock).toBeNull();
    const committed = await start(h);
    committed.copy.insert('after', 'p1', paragraph('sc_1', 'x') as unknown as ModelNodeJson);
    committed.cancelValidation();
    expect(await committed.commit()).toEqual({ kind: 'cancelled' });
    // No validation for a request that is over.
    expect(h.validated).toHaveLength(2);
    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().modified).toBe(false);
    expect(h.undo.canUndo).toBe(false);
    expect(h.store.getState().runLock).toBeNull();
  });

  it('discard() drops the copy and restores the document before the request and its modified flag', async () => {
    const h = harness();
    actions.setModified(h.store, true);
    const before = h.store.getState().document!;
    const session = await start(h);
    session.copy.insert('after', 'p1', paragraph('sc_1', 'Inserted.') as unknown as ModelNodeJson);
    expect(session.discard()).toBe('discarded');
    expect(h.store.getState().document).toBe(before);
    expect(h.store.getState().modified).toBe(true);
    expect(h.undo.canUndo).toBe(false);
    expect(h.store.getState().runLock).toBeNull();
    expect(session.ended).toBe(true);
    // A second end keeps the first outcome; a commit after the end publishes nothing.
    expect(await session.commit()).toEqual({ kind: 'lost' });
    expect(h.store.getState().document).toBe(before);
  });

  it('discard() cancels a running validation job', async () => {
    const h = harness();
    const session = await start(h);
    let release: ((report: unknown) => void) | null = null;
    h.rpc.responses['doc.validate'] = () => new Promise((resolve) => (release = resolve));
    type RunJob = (
      method: unknown,
      params: unknown,
      options?: { onStart?: (id: string) => void },
    ) => Promise<unknown>;
    const fake = h.rpc.client as unknown as { runJob: RunJob };
    const original = fake.runJob;
    fake.runJob = (method, params, options) => {
      options?.onStart?.('job-7');
      return original(method, params, options);
    };
    session.copy.insert('after', 'p1', paragraph('sc_1', 'x') as unknown as ModelNodeJson);
    const pending = session.validate();
    session.discard();
    expect(h.rpc.calls.filter((c) => c.method === 'job.cancel')).toEqual([
      { method: 'job.cancel', params: { jobId: 'job-7' } },
    ]);
    release!({ issues: [], errorCount: 0, warningCount: 0, durationMs: 1 });
    await pending;
    expect(h.store.getState().runLock).toBeNull();
  });

  it('a cancel before doc.validate answered its job id cancels the job as soon as the id arrives, and every later validation job of the request (ai-catalogue §6.15)', async () => {
    const h = harness();
    const session = await start(h);
    const held = holdJobs(h);
    const cancels = () => h.rpc.calls.filter((c) => c.method === 'job.cancel');
    session.copy.insert('after', 'p1', paragraph('sc_1', 'x') as unknown as ModelNodeJson);
    // Cancel during `validating` while `doc.validate` is on its way: no job id to cancel yet.
    const copy = session.validate();
    session.cancelValidation();
    expect(cancels()).toEqual([]);
    // The id arrives: the job is cancelled at once - else it would end with a report the
    // request goes on with (the commit's validation publishing the copy).
    held[0]!.start('job-8');
    expect(cancels()).toEqual([{ method: 'job.cancel', params: { jobId: 'job-8' } }]);
    held[0]!.fail(cancelled('job-8'));
    await expect(copy).rejects.toMatchObject({ code: RpcErrorCode.cancelled });
    // The request is ending: a validation job started after the cancel goes the same way.
    const text = session.validateText('<FictionBook/>');
    held[1]!.start('job-9');
    expect(cancels()).toEqual([
      { method: 'job.cancel', params: { jobId: 'job-8' } },
      { method: 'job.cancel', params: { jobId: 'job-9' } },
    ]);
    held[1]!.fail(cancelled('job-9'));
    await expect(text).rejects.toMatchObject({ code: RpcErrorCode.cancelled });
    session.discard();
    expect(cancels()).toHaveLength(2);
    expect(session.validations).toHaveLength(1);
  });

  it('discard() before doc.validate answered its job id cancels the job as soon as the id arrives', async () => {
    const h = harness();
    const session = await start(h);
    const held = holdJobs(h);
    const pending = session.validateText('<FictionBook/>');
    session.discard();
    expect(h.store.getState().runLock).toBeNull();
    held[0]!.start('job-10');
    expect(h.rpc.calls.filter((c) => c.method === 'job.cancel')).toEqual([
      { method: 'job.cancel', params: { jobId: 'job-10' } },
    ]);
    held[0]!.fail(cancelled('job-10'));
    await expect(pending).rejects.toMatchObject({ code: RpcErrorCode.cancelled });
  });

  it('reports the run as lost when the document is replaced meanwhile', async () => {
    const h = harness();
    const replaced = vi.fn();
    const session = await start(h, { onDocumentReplaced: replaced });
    const other = book({ bookTitle: 'Other' });
    actions.setDocument(h.store, { ...other, docId: 'doc-2' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(replaced).toHaveBeenCalledTimes(1);
    session.copy.insert('after', 'p1', paragraph('sc_1', 'x') as unknown as ModelNodeJson);
    expect(await session.commit()).toEqual({ kind: 'lost' });
    expect(h.store.getState().document?.docId).toBe('doc-2');
    expect(h.undo.canUndo).toBe(false);
  });
});

describe('RequestSession.fragmentFromXml', () => {
  const fragments = {
    '<p>One</p>\n<p>Two <emphasis>three</emphasis></p>': {
      inline: false,
      nodes: [
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'One' }] },
        {
          type: 'p',
          attrs: {},
          content: [
            { type: 'text', text: 'Two ' },
            { type: 'text', text: 'three', marks: [{ type: 'emphasis' }] },
          ],
        },
      ],
    },
    '<poem><stanza><v>a</v><v>b</v></stanza></poem>': {
      inline: false,
      nodes: [
        {
          type: 'poem',
          attrs: {},
          content: [
            {
              type: 'stanza',
              attrs: {},
              content: [
                { type: 'v', attrs: {}, content: [{ type: 'text', text: 'a' }] },
                { type: 'v', attrs: {}, content: [{ type: 'text', text: 'b' }] },
              ],
            },
          ],
        },
      ],
    },
    'Hello <image l:href="#i"/> there': {
      inline: true,
      nodes: [
        { type: 'text', text: 'Hello ' },
        { type: 'inline-image', attrs: { href: '#i' } },
        { type: 'text', text: ' there' },
      ],
    },
    '<p>&nbsp;</p>': new RpcError(RpcErrorCode.docParseError, 'Document parse error', {
      line: 1,
      column: 4,
      message: "Entity 'nbsp' not defined",
    }),
    '<section><p>x</p></section>': new RpcError(RpcErrorCode.aiFragmentNotAllowed, 'not allowed', {
      element: 'section',
      parent: 'p',
    }),
    '<p>io</p>': new RpcError(RpcErrorCode.docIoError, 'io', { path: '/x', reason: 'boom' }),
  } as const;

  async function started() {
    const h = harness({ fragments: fragments as unknown as FragmentTable });
    return { h, session: await start(h) };
  }

  it('assigns sc_<N> ids to every structural node, pre-order, text nodes untouched; the input is not mutated', async () => {
    const { h, session } = await started();
    const xml = '<p>One</p>\n<p>Two <emphasis>three</emphasis></p>';
    const result = await session.fragmentFromXml(xml, { nodeId: 's1' });
    expect(result.inline).toBe(false);
    expect(result.nodes.map((n) => n.attrs?.nodeId)).toEqual(['sc_1', 'sc_2']);
    expect(result.nodes[1]!.content![1]).toEqual({
      type: 'text',
      text: 'three',
      marks: [{ type: 'emphasis' }],
    });
    expect(fragments[xml].nodes[0]!.attrs).toEqual({});
    const nested = await session.fragmentFromXml('<poem><stanza><v>a</v><v>b</v></stanza></poem>', {
      element: 'section',
    });
    expect(nested.nodes[0]!.attrs!.nodeId).toBe('sc_3');
    expect(nested.nodes[0]!.content![0]!.attrs!.nodeId).toBe('sc_4');
    expect(nested.nodes[0]!.content![0]!.content!.map((v) => v.attrs?.nodeId)).toEqual([
      'sc_5',
      'sc_6',
    ]);
    const inline = await session.fragmentFromXml('Hello <image l:href="#i"/> there', {
      nodeId: 'p1',
    });
    expect(inline.inline).toBe(true);
    expect(inline.nodes.map((n) => n.attrs?.nodeId)).toEqual([undefined, 'sc_7', undefined]);
    expect(h.rpc.calls.filter((c) => c.method === 'doc.fragmentFromXml')[0]).toMatchObject({
      params: { docId: 'doc-1', xml, parent: { nodeId: 's1' } },
    });
    session.discard();
  });

  it('strips a code fence and surrounding whitespace before the parse (ai-catalogue §3.8)', async () => {
    const { h, session } = await started();
    await session.fragmentFromXml(
      '```xml\n<p>One</p>\n<p>Two <emphasis>three</emphasis></p>\n```\n',
      { nodeId: 's1' },
    );
    expect(h.rpc.calls.filter((c) => c.method === 'doc.fragmentFromXml')[0]!.params).toMatchObject({
      xml: '<p>One</p>\n<p>Two <emphasis>three</emphasis></p>',
    });
    session.discard();
  });

  it('turns 1001 into invalidXml and 1201 into fragmentNotAllowed (rejections that count a strike); other errors propagate', async () => {
    const { session } = await started();
    const notWellFormed = await session
      .fragmentFromXml('<p>&nbsp;</p>', { nodeId: 's1' })
      .catch((e) => e);
    expect(notWellFormed).toBeInstanceOf(ChangeRejection);
    expect(notWellFormed).toMatchObject({
      code: 'invalidXml',
      stage: 'parse',
      issues: [
        { code: 'xml.notWellFormed', element: '', line: 1, message: "Entity 'nbsp' not defined" },
      ],
    });
    expect((notWellFormed as ChangeRejection).hint).toContain('U+00A0');
    const notAllowed = await session
      .fragmentFromXml('<section><p>x</p></section>', { nodeId: 'p1' })
      .catch((e) => e);
    expect(notAllowed).toMatchObject({
      code: 'fragmentNotAllowed',
      stage: 'parse',
      issues: [
        {
          code: 'schema.invalid',
          element: 'section',
          message: "Element 'section' is not allowed inside 'p'.",
        },
      ],
    });
    await expect(session.fragmentFromXml('<p>io</p>', { nodeId: 's1' })).rejects.toBeInstanceOf(
      RpcError,
    );
    session.discard();
  });

  it('assignIds() alone serves JSON content the model sends (review C12)', async () => {
    const { session } = await started();
    const nodes = session.assignIds([
      { type: 'p', attrs: { id: 'keep' }, content: [{ type: 'text', text: 'x' }] },
      { type: 'empty-line', attrs: { nodeId: 'given' } },
    ]);
    expect(nodes[0]!.attrs).toEqual({ id: 'keep', nodeId: 'sc_1' });
    expect(nodes[1]!.attrs).toEqual({ nodeId: 'given' });
    session.discard();
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006 T174: one seeded sc_ allocator (I26, C7; vR7:140)             */
/* ------------------------------------------------------------------------ */

/** Every node id of `document` - its bodies and description roots - in document order. */
function nodeIdsOf(document: Document): string[] {
  const ids: string[] = [];
  const visit = (node: ModelNodeJson) => {
    const id = node.attrs?.nodeId;
    if (typeof id === 'string') ids.push(id);
    for (const child of node.content ?? []) visit(child);
  };
  const { titleInfo, srcTitleInfo, documentInfo } = document.description;
  const roots = [titleInfo.annotation, srcTitleInfo?.annotation, documentInfo.history];
  for (const root of [...document.bodies, ...roots]) {
    if (root) visit(root as unknown as ModelNodeJson);
  }
  return ids;
}

/** The text of every node of `document` with an `sc_<N>` id, by id. */
function scriptNodeTexts(document: Document): Record<string, string> {
  const texts: Record<string, string> = {};
  const visit = (node: ModelNodeJson) => {
    const id = node.attrs?.nodeId;
    if (typeof id === 'string' && id.startsWith('sc_')) {
      texts[id] = (node.content ?? []).map((child) => child.text ?? '').join('');
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of document.bodies) visit(body as unknown as ModelNodeJson);
  return texts;
}

/** The script of the nested runs (`AppendWorker`), as the scripts feature lists it. */
const APPEND_SCRIPT: ScriptInfo = {
  manifestVersion: 1,
  id: 'test.append',
  name: { en: 'Append a paragraph' },
  kind: 'menu',
  entry: 'index.js',
  needsSelection: false,
  undoLabel: { en: 'Append a paragraph' },
  group: '04_Model',
  dir: '/tmp/scripts/04_Model/01_Append',
  folder: '01_Append',
  source: 'bundled',
  entryUrl: '/scripts/test.append/index.js',
  warnings: [],
};

/**
 * Stands in for the sandbox worker of a nested run: when the host says `run`, the "script"
 * appends a paragraph holding `text` to section `s2` through `mfbe.doc.insertNode` - a node the
 * run's own allocator names - and ends.
 */
class AppendWorker {
  onerror: ((event: ErrorEvent) => void) | null = null;

  constructor(private readonly text: string) {}

  postMessage(message: unknown, transfer?: Transferable[]): void {
    const init = message as InitMessage;
    if (init.type !== 'init') return;
    const port = (transfer?.[0] as MessagePort | undefined) ?? init.port;
    const send = (reply: WorkerMessage) => port.postMessage(reply);
    port.onmessage = (event: MessageEvent<HostMessage>) => {
      const host = event.data;
      if (host.type === 'run') {
        const node = { type: 'p', attrs: {}, content: [{ type: 'text', text: this.text }] };
        send({ type: 'call', id: 1, method: 'doc.insertNode', args: ['append', 's2', node] });
      } else if (host.type === 'result') {
        send({ type: 'done' });
      } else if (host.type === 'error') {
        send({ type: 'fail', error: { name: 'Error', message: host.message } });
      }
    };
    setTimeout(() => send({ type: 'ready' }), 0);
  }

  terminate(): void {}
}

/** One answer of the model (`ai.complete`): a text, or tool calls. */
function answer(finishReason: string, message: Record<string, unknown>): AiOutcome {
  const choice = { finish_reason: finishReason, message: { role: 'assistant', ...message } };
  return { ok: true, status: 200, elapsedMs: 1, body: { choices: [choice] } };
}

function toolCall(id: string, name: string, args: Record<string, unknown>): AiOutcome {
  return answer('tool_calls', {
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  });
}

/** `insert_node` of one paragraph after `node`, as Document JSON: the request names it. */
function insertParagraph(id: string, node: string, text: string): AiOutcome {
  const paragraphJson = { type: 'p', content: [{ type: 'text', text }] };
  return toolCall(id, 'insert_node', { where: 'after', node, content: { nodes: [paragraphJson] } });
}

const runAppendScript = (id: string) => toolCall(id, 'run_script', { id: APPEND_SCRIPT.id });

const done = () => answer('stop', { content: 'Done.' });

/**
 * The assistant on (the custom target) over `book({preExisting: false})`, whose model answers
 * `answers` in turn, with the scripts feature listing `APPEND_SCRIPT`: each nested run appends
 * "Script <n>", n counting the runs.
 */
async function requestHarness(answers: AiOutcome[]) {
  const rpc = fakeRpc({
    'doc.validate': (params: unknown) =>
      validateDocument((params as { document: Document }).document),
    'ai.complete': () => answers.shift(),
    'scripts.source': {
      entryUrl: APPEND_SCRIPT.entryUrl,
      entry: APPEND_SCRIPT.entry,
      dir: APPEND_SCRIPT.dir,
      files: [APPEND_SCRIPT.entry],
    },
    'log.error': {},
    'job.cancel': {},
    'schema.text': { text: '' },
  });
  const ctx = await makeContext({ rpc: rpc.client, dialogs: fakeDialogs() });
  const settings = defaultSettings();
  settings.ai.mode = 'custom';
  settings.ai.custom = { address: 'http://127.0.0.1:8787/v1', key: '', model: 'm1' };
  actions.setSettings(ctx.store, settings);
  actions.setConnection(ctx.store, 'connected');
  actions.setDocument(ctx.store, book({ preExisting: false }));
  let runs = 0;
  const feature = installScriptsFeature({
    store: ctx.store,
    commands: createCommandRegistry(),
    hotkeys: ctx.hotkeys,
    undo: ctx.undo,
    createWorker: () => new AppendWorker(`Script ${++runs}`) as unknown as Worker,
  });
  feature.applyList({
    groups: [
      {
        id: APPEND_SCRIPT.group,
        order: 4,
        names: { en: 'Model' },
        dir: '/tmp/scripts/04_Model',
        scripts: [APPEND_SCRIPT],
      },
    ],
    issues: [],
    folders: {},
  });
  startAssistant(ctx.store);
  const request = (instruction: string) =>
    startRequest(ctx, { origin: 'panel', instruction, selection: null });
  return { ctx, rpc, request };
}

describe('feature 006: one seeded sc_ allocator for requests and script runs (I26, C7; ai-catalogue Δ§3 "Ids of new nodes")', () => {
  const fragments = {
    '<p>One</p>\n<p>Two</p>': {
      inline: false,
      nodes: [
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'One' }] },
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'Two' }] },
      ],
    },
    '<cite><p>Three</p></cite>': {
      inline: false,
      nodes: [
        {
          type: 'cite',
          attrs: {},
          content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'Three' }] }],
        },
      ],
    },
  } as const;

  it('two sessions in a row each create nodes, and every node id of the document is unique', async () => {
    const h = harness({ fragments: fragments as unknown as FragmentTable });
    const first = await start(h);
    const one = await first.fragmentFromXml('<p>One</p>\n<p>Two</p>', { nodeId: 's1' });
    for (const node of one.nodes) first.copy.insert('append', 's1', node);
    expect((await first.commit()).kind).toBe('committed');
    // The next session starts on the document the first one committed.
    const second = await start(h);
    const two = await second.fragmentFromXml('<cite><p>Three</p></cite>', { nodeId: 's1' });
    for (const node of two.nodes) second.copy.insert('append', 's1', node);
    expect((await second.commit()).kind).toBe('committed');
    const ids = nodeIdsOf(h.store.getState().document!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => id.startsWith('sc_'))).toEqual(['sc_1', 'sc_2', 'sc_3', 'sc_4']);
  });

  describe('in one request, with a nested run_script', () => {
    let store: AppStore | null = null;

    beforeAll(async () => {
      await initI18n({ language: 'en' });
    });

    afterEach(() => {
      if (store) stopAssistant(store);
      store = null;
    });

    it('insert_node, then a node-creating nested run_script, in one request - and so again in the next request: every node id of the document is unique (vR7:140)', async () => {
      const { ctx, request } = await requestHarness([
        insertParagraph('call_1', 'p1', 'Assistant 1'),
        runAppendScript('call_2'),
        done(),
        insertParagraph('call_3', 'p2', 'Assistant 2'),
        runAppendScript('call_4'),
        done(),
      ]);
      store = ctx.store;
      expect((await request('Add a paragraph, then run the script')).kind).toBe('committed');
      // The nested run starts from the request's working copy, which holds the request's node.
      expect(scriptNodeTexts(ctx.store.getState().document!)).toEqual({
        sc_1: 'Assistant 1',
        sc_2: 'Script 1',
      });
      // The next request starts past the ids the first one left in the book.
      expect((await request('Once more')).kind).toBe('committed');
      const document = ctx.store.getState().document!;
      const ids = nodeIdsOf(document);
      expect(new Set(ids).size).toBe(ids.length);
      expect(scriptNodeTexts(document)).toEqual({
        sc_1: 'Assistant 1',
        sc_2: 'Script 1',
        sc_3: 'Assistant 2',
        sc_4: 'Script 2',
      });
    });

    it('a node-creating nested run_script, then insert_node, in one request: the request continues past the ids of the nested run, and every node id of the document is unique', async () => {
      const { ctx, request } = await requestHarness([
        runAppendScript('call_1'),
        insertParagraph('call_2', 'p1', 'Assistant 1'),
        done(),
      ]);
      store = ctx.store;
      expect((await request('Run the script, then add a paragraph')).kind).toBe('committed');
      const document = ctx.store.getState().document!;
      const ids = nodeIdsOf(document);
      expect(new Set(ids).size).toBe(ids.length);
      expect(scriptNodeTexts(document)).toEqual({ sc_1: 'Script 1', sc_2: 'Assistant 1' });
    });
  });
});

export type { RequestSession };
