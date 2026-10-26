/**
 * Feature 005 T045 (data-model §6, §7.2; ai-catalogue §6 steps 2, 4, 5, 14, 15; research R4;
 * FR-043, FR-060 to FR-064) - the working copy session of a request: it takes the run lock as
 * an `ai` session labelled `<service> · <model>`, validates the **live** document for the
 * baseline (a count multiset of error keys; `schema.unavailable` → `validationUnavailable` and
 * the lock released), works on a copy-on-write `WorkingCopy` with checkpoint / rollback, commits
 * as **one** undo snapshot named after the instruction only when the copy changed, discards
 * byte for byte otherwise, and gives the nodes of `doc.fragmentFromXml` `sc_<N>` ids (C12).
 */

import { ChangeRejection } from '@/ai/hook';
import { startRequestSession, type RequestSession } from '@/ai/session';
import type { ModelNodeJson } from '@/editor/fromModel';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import { startRunSession } from '@/scripting/runSession';

import {
  book,
  harness,
  paragraph,
  sectionTexts,
  TITLE_UNEXPECTED,
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

/** A validation job of `holdJobs`: `start` delivers its id, `fail` ends it. */
interface HeldJob {
  start(jobId: string): void;
  fail(error: RpcError): void;
}

/** Makes every later `runJob` of the harness a job whose `{jobId}` waits for the test. */
function holdJobs(h: Harness): HeldJob[] {
  type RunJob = (
    method: string,
    params: unknown,
    options?: { onStart?: (id: string) => void },
  ) => Promise<unknown>;
  const held: HeldJob[] = [];
  (h.rpc.client as unknown as { runJob: RunJob }).runJob = (method, params, options) => {
    h.rpc.calls.push({ method, params });
    return new Promise((_resolve, reject) => {
      held.push({ start: (jobId) => options?.onStart?.(jobId), fail: reject });
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

export type { RequestSession };
