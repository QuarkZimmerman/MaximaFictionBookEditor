/**
 * Feature 005 T045 / T051 (ai-catalogue §3.5, §6.10, §9.2 `hook.test.ts`; data-model §7.3-§7.4;
 * review C3, C4, C12; FR-060 to FR-063) - the validity hook: checkpoint, change, validate, key
 * diff, accept or rollback with the `rejected` envelope; the strike counter per key
 * `<tool>:<target>` - the same key three times ends the request (hook rejections, a 1201 and
 * invalid arguments mixed), another key's rejection or acceptance does not reset it, an
 * accepted change of the key does; a change that throws is rolled back and propagated; and
 * the catalogue's structural change tools behind the real hook: the strike keys
 * `replace_node:<nodeId>`, `insert_node:<where>@<nodeId>`, `remove_node:<nodeId>`,
 * `set_text:<nodeId>`, `replace_all:<query>`, `set_description:description`, pre-check and
 * hook rejections counted alike, read tools never counted. Feature 006 (T172): the tables a
 * change made irregular (`ChangeAccepted.madeIrregular`, the session's set, the warning of
 * `tables.ts` in both forms, the `validate` tool's `irregularTables`).
 */

import { ToolError, type ToolErrorEnvelope } from '@/ai/catalogue';
import { selectionSnapshot } from '@/ai/context';
import {
  applyChange,
  ChangeRejection,
  invalidXmlHint,
  isStrikeCode,
  rejectedEnvelope,
  rejectionFromEnvelope,
  selectionReplacement,
  STRIKE_CODES,
  STRIKE_LIMIT,
  StrikeCounter,
  strikeIssues,
  strikeKey,
  type ChangeOutcome,
  type ChangeRejected,
  type ErrorForModel,
  type SelectionReplacementResult,
} from '@/ai/hook';
import { startRequestSession, type RequestSession } from '@/ai/session';
import {
  irregularEntries,
  irregularTablesOf,
  madeIrregular,
  tableWarningOf,
  withTableWarning,
} from '@/ai/tables';
import { indexDocument } from '@/ai/tools/model';
import type { ModelNodeJson } from '@/editor/fromModel';
import type { Document, ValidationReport } from '@/model/document';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import { setBodySelection } from '@/scripting/api-impl';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeFromXml, harness as catalogueHarness, tableNode } from './catalogueHarness';
import {
  BAD_WORD_MESSAGE,
  book as sessionBook,
  harness,
  paragraph,
  sectionTexts,
  title,
  TITLE_UNEXPECTED,
  validateDocument,
  type FragmentTable,
  type Harness,
} from './sessionUtils';

async function start(h: Harness): Promise<RequestSession> {
  const result = await startRequestSession(h.deps, {
    origin: 'panel',
    kind: 'general',
    instruction: 'Change things',
    label: 'Stand-in · standin-chat',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.session;
}

const node = (value: unknown) => value as ModelNodeJson;

/** Inserts a paragraph after `ref` on the copy (an accepted kind of change). */
function insertAfter(session: RequestSession, ref: string, id: string, text: string) {
  return {
    tool: 'insert_node',
    target: `after@${ref}`,
    apply: () => {
      session.copy.insert('after', ref, node(paragraph(id, text)));
      return { nodes: [{ id }] };
    },
  };
}

/** Inserts a `title` after `ref`: a second late title - the pre-existing kind, one more time. */
function lateTitleAfter(session: RequestSession, ref: string, id: string) {
  return {
    tool: 'insert_node',
    target: `after@${ref}`,
    apply: () => {
      session.copy.insert('after', ref, node(title(id, 'Another late title')));
      return { nodes: [{ id }] };
    },
  };
}

describe('strikeKey / StrikeCounter', () => {
  it('counts per key, resets one key alone', () => {
    expect(strikeKey('replace_selection', 'selection')).toBe('replace_selection:selection');
    expect(strikeKey('insert_node', 'after@n4')).toBe('insert_node:after@n4');
    const counter = new StrikeCounter();
    expect(counter.count('a')).toBe(0);
    expect(counter.strike('a')).toBe(1);
    expect(counter.strike('a')).toBe(2);
    expect(counter.strike('b')).toBe(1);
    expect(counter.exhausted('a')).toBe(false);
    expect(counter.strike('a')).toBe(3);
    expect(counter.exhausted('a')).toBe(true);
    counter.reset('b');
    expect(counter.count('b')).toBe(0);
    expect(counter.count('a')).toBe(3);
    expect(counter.entries()).toEqual([['a', 3]]);
    expect(STRIKE_LIMIT).toBe(3);
  });
});

describe('applyChange', () => {
  it('accepts a valid change: validated after the change, kept in the copy, counted, the key reset', async () => {
    const h = harness();
    const session = await start(h);
    session.strikes.strike('insert_node:after@p1');
    const outcome = await applyChange(session, insertAfter(session, 'p1', 'sc_1', 'Inserted.'));
    expect(outcome).toEqual({
      accepted: true,
      result: { nodes: [{ id: 'sc_1' }] },
      report: { errorCount: 1, warningCount: 0, durationMs: 3 },
      preExistingErrors: 1,
      warnings: 0,
      madeIrregular: [], // feature 006 (FR-053): no table made irregular
    });
    expect(h.validated).toHaveLength(2);
    expect(h.validated[1]).toBe(session.copy.document);
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Inserted.',
      'Second paragraph.',
    ]);
    expect(session.changesInThisRequest).toBe(1);
    expect(session.strikes.count('insert_node:after@p1')).toBe(0);
    expect(session.changes).toHaveLength(1);
    expect(session.changes[0]).toMatchObject({
      changeId: 'c1',
      strikeKey: 'insert_node:after@p1',
      tool: 'insert_node',
      target: 'after@p1',
      status: 'accepted',
    });
    expect(session.changes[0]!.checkpoint.document).toBe(session.before);
    // Nothing reached the editor: the live document is still `before` (FR-043).
    expect(h.store.getState().document).toBe(session.before);
    expect(h.store.getState().modified).toBe(false);
    session.discard();
  });

  it('a pre-existing error that moves (an insertion before it) is not new: accepted', async () => {
    const h = harness();
    const session = await start(h);
    // Section 2 holds the late title after p3; inserting before p3 shifts its line and path.
    const outcome = await applyChange(session, {
      tool: 'insert_node',
      target: 'before@p3',
      apply: () => session.copy.insert('before', 'p3', node(paragraph('sc_1', 'Before.'))),
    });
    expect(outcome.accepted).toBe(true);
    expect(sectionTexts(session.copy.document, 1)).toEqual([
      'Before.',
      'Third paragraph.',
      'title:Late title',
      'Fourth paragraph.',
    ]);
    // The validator saw the error elsewhere, with another line - the count stayed 1.
    const report = h.validated[1]!;
    expect(report).toBe(session.copy.document);
    session.discard();
  });

  it('a second error of the pre-existing kind is new: rejected, rolled back, all issues of the key reported, strike 1 of 3', async () => {
    const h = harness();
    const session = await start(h);
    const checkpointDoc = session.copy.document;
    const outcome = (await applyChange(
      session,
      lateTitleAfter(session, 'p1', 'sc_1'),
    )) as ChangeRejected;
    expect(outcome.accepted).toBe(false);
    expect(outcome.code).toBe('rejected');
    expect(outcome.stage).toBe('hook');
    expect(outcome.strike).toEqual({ count: 1, of: 3 });
    expect(outcome.ended).toBe(false);
    expect(outcome.report).toEqual({ errorCount: 2, warningCount: 0, durationMs: 3 });
    // Both titles of the key, in document order, each with its path and line.
    expect(outcome.issues).toEqual([
      expect.objectContaining({
        code: 'schema.invalid',
        element: 'title',
        path: 'body[1]/section[1]/title[2]',
        message: TITLE_UNEXPECTED,
      }),
      expect.objectContaining({
        code: 'schema.invalid',
        element: 'title',
        path: 'body[1]/section[2]/title[1]',
        message: TITLE_UNEXPECTED,
      }),
    ]);
    expect(outcome.issues[0]!.line).toBeLessThan(outcome.issues[1]!.line!);
    expect(outcome.message).toContain('2 new errors');
    expect(outcome.hint).toContain('get_schema');
    // Rolled back: the copy is the checkpoint's document, unchanged.
    expect(session.copy.document).toBe(checkpointDoc);
    expect(session.copy.changed).toBe(false);
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Second paragraph.',
    ]);
    expect(session.changesInThisRequest).toBe(0);
    expect(session.strikes.count('insert_node:after@p1')).toBe(1);
    expect(session.changes[0]!.status).toBe('rejected');
    // The envelope the model receives.
    expect(rejectedEnvelope(outcome)).toEqual({
      error: {
        code: 'rejected',
        message: outcome.message,
        hint: outcome.hint,
        issues: outcome.issues,
        strike: { count: 1, of: 3 },
      },
    });
    session.discard();
  });

  it('a new error of another kind is rejected with its element; warnings never count', async () => {
    const h = harness();
    const session = await start(h);
    const bad = (await applyChange(
      session,
      insertAfter(session, 'p1', 'sc_1', 'A BAD word.'),
    )) as ChangeRejected;
    expect(bad.accepted).toBe(false);
    expect(bad.issues).toEqual([
      {
        code: 'schema.invalid',
        element: 'p',
        path: 'body[1]/section[1]',
        line: expect.any(Number),
        message: BAD_WORD_MESSAGE,
      },
    ]);
    const warned = await applyChange(session, insertAfter(session, 'p1', 'sc_2', 'please warn me'));
    expect(warned.accepted).toBe(true);
    expect((warned as { warnings: number }).warnings).toBe(1);
    session.discard();
  });

  it('a ChangeRejection thrown by apply (pre-check, 1001, 1201, arguments) rolls back and counts a strike with its code', async () => {
    const h = harness();
    const session = await start(h);
    const validations = h.validated.length;
    const outcome = (await applyChange(session, {
      tool: 'replace_node',
      target: 'p1',
      apply: () => {
        session.copy.insert('after', 'p1', node(paragraph('sc_1', 'half done')));
        throw new ChangeRejection('notAllowed', 'a "title" is not allowed inside "p"', {
          issues: [
            {
              code: 'schema.invalid',
              element: 'title',
              path: 'body[1]/section[1]/p[1]',
              message: 'not allowed',
            },
          ],
          hint: 'use get_schema',
        });
      },
    })) as ChangeRejected;
    expect(outcome).toMatchObject({
      accepted: false,
      code: 'notAllowed',
      stage: 'preCheck',
      message: 'a "title" is not allowed inside "p"',
      hint: 'use get_schema',
      strike: { count: 1, of: 3 },
      ended: false,
    });
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.report).toBeUndefined();
    // No round trip for a change refused before it, and the half-done write is gone.
    expect(h.validated).toHaveLength(validations);
    expect(session.copy.document).toBe(session.before);
    expect(session.strikes.count('replace_node:p1')).toBe(1);

    const args = (await applyChange(session, {
      tool: 'replace_node',
      target: 'p1',
      apply: () => {
        throw new ChangeRejection('invalidArguments', 'content: expected {xml} or {node}', {
          expected: { type: 'object' },
        });
      },
    })) as ChangeRejected;
    expect(args.code).toBe('invalidArguments');
    expect(args.expected).toEqual({ type: 'object' });
    expect(args.strike.count).toBe(2);
    expect(rejectedEnvelope(args).error.expected).toEqual({ type: 'object' });
    session.discard();
  });

  it('three strikes of one key end the request - hook rejection, 1201 and invalid arguments mixed; other keys do not reset it', async () => {
    const h = harness();
    const session = await start(h);
    const key = 'insert_node:after@p1';
    // 1: the hook.
    const first = (await applyChange(
      session,
      lateTitleAfter(session, 'p1', 'sc_1'),
    )) as ChangeRejected;
    expect(first.strike.count).toBe(1);
    // Another key rejected and a third accepted in between: the counter of `key` stays.
    const other = (await applyChange(
      session,
      lateTitleAfter(session, 'p2', 'sc_2'),
    )) as ChangeRejected;
    expect(other.strike).toEqual({ count: 1, of: 3 });
    const accepted = await applyChange(session, insertAfter(session, 'p3', 'sc_3', 'Fine.'));
    expect(accepted.accepted).toBe(true);
    expect(session.strikes.count(key)).toBe(1);
    // 2: a 1201 (the parse) of the same key.
    const second = (await applyChange(session, {
      tool: 'insert_node',
      target: 'after@p1',
      apply: () => {
        throw ChangeRejection.fromRpcError(
          new RpcError(RpcErrorCode.aiFragmentNotAllowed, 'x', {
            element: 'body',
            parent: 'section',
          }),
        );
      },
    })) as ChangeRejected;
    expect(second).toMatchObject({
      code: 'fragmentNotAllowed',
      stage: 'parse',
      strike: { count: 2, of: 3 },
      ended: false,
    });
    // Read tools and set_selection do not go through the hook at all; nothing changes here.
    expect(session.strikes.count(key)).toBe(2);
    // 3: invalid arguments - the third strike ends the request.
    const third = (await applyChange(session, {
      tool: 'insert_node',
      target: 'after@p1',
      apply: () => {
        throw new ChangeRejection('invalidArguments', 'where must be before, after or append');
      },
    })) as ChangeRejected;
    expect(third).toMatchObject({
      code: 'invalidArguments',
      strike: { count: 3, of: 3 },
      ended: true,
    });
    expect(session.strikes.exhausted(key)).toBe(true);
    // The loop then discards the whole copy - the accepted change of another key included.
    expect(session.changesInThisRequest).toBe(1);
    session.discard();
    expect(h.store.getState().document).toBe(session.before);
    expect(h.store.getState().modified).toBe(false);
    expect(h.undo.canUndo).toBe(false);
  });

  it('an accepted change of the key resets its counter; the next rejection starts at 1 again', async () => {
    const h = harness();
    const session = await start(h);
    const key = 'insert_node:after@p1';
    await applyChange(session, lateTitleAfter(session, 'p1', 'sc_1'));
    await applyChange(session, lateTitleAfter(session, 'p1', 'sc_2'));
    expect(session.strikes.count(key)).toBe(2);
    const ok = await applyChange(session, insertAfter(session, 'p1', 'sc_3', 'Good.'));
    expect(ok.accepted).toBe(true);
    expect(session.strikes.count(key)).toBe(0);
    const again = (await applyChange(
      session,
      lateTitleAfter(session, 'p1', 'sc_4'),
    )) as ChangeRejected;
    expect(again.strike).toEqual({ count: 1, of: 3 });
    expect(again.ended).toBe(false);
    // The accepted change stayed while the rejected one was rolled back.
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Good.',
      'Second paragraph.',
    ]);
    session.discard();
  });

  it('an unexpected exception of apply or of the validation rolls back and propagates (no strike)', async () => {
    const h = harness();
    const session = await start(h);
    await expect(
      applyChange(session, {
        tool: 'run_script',
        target: 'assistant/x',
        apply: () => {
          session.copy.insert('after', 'p1', node(paragraph('sc_1', 'from the script')));
          throw new TypeError('script blew up');
        },
      }),
    ).rejects.toThrow('script blew up');
    expect(session.copy.document).toBe(session.before);
    expect(session.strikes.count('run_script:assistant/x')).toBe(0);
    expect(session.changes[0]!.status).toBe('rolledBack');

    h.rpc.responses['doc.validate'] = new RpcError(RpcErrorCode.clientDisconnected, 'disconnected');
    await expect(applyChange(session, insertAfter(session, 'p1', 'sc_2', 'x'))).rejects.toThrow(
      'disconnected',
    );
    expect(session.copy.document).toBe(session.before);
    expect(session.copy.changed).toBe(false);
    expect(session.changes[1]!.status).toBe('rolledBack');
    expect(session.changesInThisRequest).toBe(0);
    session.discard();
  });

  it('a checkpoint brackets a nested run: a result handed back through reset() is one change', async () => {
    const h = harness();
    const session = await start(h);
    // A nested script run starts from `copy.release()` and hands its document back (data-model §6.6).
    const outcome = await applyChange(session, {
      tool: 'run_script',
      target: 'assistant/upper',
      apply: () => {
        const start = session.copy.release();
        const body = start.bodies[0]!;
        const result = {
          ...start,
          bodies: [
            {
              ...body,
              content: body.content.map((child) =>
                child.type === 'section' && child.attrs.nodeId === 's1'
                  ? {
                      ...child,
                      content: [...child.content, paragraph('sc_9', 'Appended by the script.')],
                    }
                  : child,
              ),
            },
            ...start.bodies.slice(1),
          ],
        } as typeof start;
        session.copy.reset(result);
        return { status: 'done', changed: true };
      },
    });
    expect(outcome.accepted).toBe(true);
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Second paragraph.',
      'Appended by the script.',
    ]);
    // And a nested run whose result adds an error is rolled back whole.
    const rejected = (await applyChange(session, {
      tool: 'run_script',
      target: 'assistant/bad',
      apply: () => {
        const start = session.copy.release();
        session.copy.reset({
          ...start,
          bodies: [
            {
              ...start.bodies[0]!,
              content: [
                ...start.bodies[0]!.content,
                {
                  type: 'section',
                  attrs: { nodeId: 'sc_10' },
                  content: [paragraph('sc_11', 'BAD'), title('sc_12', 'late')],
                },
              ],
            } as (typeof start.bodies)[0],
            ...start.bodies.slice(1),
          ],
        });
        return { status: 'done', changed: true };
      },
    })) as ChangeRejected;
    expect(rejected.accepted).toBe(false);
    // Every issue of each exceeded key in document order: the pre-existing late title of
    // section 2 counts among the `title` issues now that the key's count grew to 2.
    expect(rejected.issues.map((i) => i.element)).toEqual(['title', 'p', 'title']);
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First paragraph.',
      'Second paragraph.',
      'Appended by the script.',
    ]);
    expect(session.copy.document.bodies[0]!.content).toHaveLength(3);
    session.discard();
  });
});

describe('selectionReplacement', () => {
  const fragments: FragmentTable = {
    'Он <emphasis>ушёл</emphasis>': {
      inline: true,
      nodes: [
        { type: 'text', text: 'Он ' },
        { type: 'text', text: 'ушёл', marks: [{ type: 'emphasis' }] },
      ],
    },
    '<p>Not inline</p>': {
      inline: false,
      nodes: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'Not inline' }] }],
    },
    '<p>Alpha.</p>\n<p>Beta.</p>': {
      inline: false,
      nodes: [
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'Alpha.' }] },
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'Beta.' }] },
      ],
    },
    '<p>First, fixed.</p>\n<p>Second</p>': {
      inline: false,
      nodes: [
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'First, fixed.' }] },
        { type: 'p', attrs: {}, content: [{ type: 'text', text: 'Second' }] },
      ],
    },
    'loose text': { inline: true, nodes: [{ type: 'text', text: 'loose text' }] },
  };

  async function editor() {
    const h = harness({ controller: true, fragments });
    const controller = getBodyController(h.store);
    const session = await start(h);
    const toXml = (nodes: ModelNodeJson[]) => Promise.resolve(JSON.stringify(nodes));
    const select = async (
      anchor: { nodeId: string; offset: number },
      head: { nodeId: string; offset: number },
    ) => {
      setBodySelection(controller, anchor, head);
      return (await selectionSnapshot(controller.editorState!, controller.currentWindow, toXml))!;
    };
    return { h, controller, session, select };
  }

  it('inline {text}: the text replaces the range with the marks at the selection start; nothing is shown', async () => {
    const { h, controller, session, select } = await editor();
    const snapshot = await select({ nodeId: 'p1', offset: 6 }, { nodeId: 'p1', offset: 15 }); // "paragraph"
    expect(snapshot.form).toBe('inline');
    const outcome = await applyChange(
      session,
      selectionReplacement(session, snapshot, { text: 'sentence' }, controller),
    );
    expect(outcome.accepted).toBe(true);
    expect((outcome as { result: SelectionReplacementResult }).result).toEqual({
      replaced: { characters: 9, paragraphs: 1 },
      inserted: [],
      range: { from: snapshot.pm!.from, to: snapshot.pm!.from + 'sentence'.length },
    });
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First sentence.',
      'Second paragraph.',
    ]);
    // The editor and the store still show the document before the request (FR-043, C10).
    expect(h.store.getState().document).toBe(session.before);
    expect(controller.editorState!.doc.textContent).toContain('First paragraph.');
    session.discard();
  });

  it('inline {xml}: inline content is parsed in the container and applied; block content is refused unless a text fallback is given', async () => {
    const { session, controller, select } = await editor();
    const snapshot = await select({ nodeId: 'p2', offset: 0 }, { nodeId: 'p2', offset: 6 }); // "Second"
    const xml = await applyChange(
      session,
      selectionReplacement(session, snapshot, { xml: 'Он <emphasis>ушёл</emphasis>' }, controller),
    );
    expect(xml.accepted).toBe(true);
    const p2 = (session.copy.place('p2')!.node.content ?? []).map((c) => [
      c.text,
      c.marks?.[0]?.type,
    ]);
    expect(p2).toEqual([
      ['Он ', undefined],
      ['ушёл', 'emphasis'],
      [' paragraph.', undefined],
    ]);
    const refused = (await applyChange(
      session,
      selectionReplacement(session, snapshot, { xml: '<p>Not inline</p>' }, controller),
    )) as ChangeRejected;
    expect(refused).toMatchObject({
      accepted: false,
      code: 'fragmentNotAllowed',
      stage: 'parse',
      strike: { count: 1, of: 3 },
    });
    expect(session.strikes.count('replace_selection:selection')).toBe(1);
    // Row i: the text fallback is applied when the XML does not parse as inline content.
    const fallback = await applyChange(
      session,
      selectionReplacement(
        session,
        snapshot,
        { xml: '<p>Not inline</p>', textFallback: 'Plain' },
        controller,
      ),
    );
    expect(fallback.accepted).toBe(true);
    expect(session.strikes.count('replace_selection:selection')).toBe(0);
    session.discard();
  });

  it('blocks, closed ends: the parsed blocks replace the selected blocks whole, with sc_ ids', async () => {
    const { session, controller, select } = await editor();
    const snapshot = await select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p2', offset: 17 });
    expect(snapshot).toMatchObject({ form: 'blocks', openStart: false, openEnd: false });
    const outcome = await applyChange(
      session,
      selectionReplacement(session, snapshot, { xml: '<p>Alpha.</p>\n<p>Beta.</p>' }, controller),
    );
    expect(outcome.accepted).toBe(true);
    const result = (outcome as { result: SelectionReplacementResult }).result;
    expect(result.inserted).toEqual([
      { id: 'sc_1', type: 'p' },
      { id: 'sc_2', type: 'p' },
    ]);
    expect(sectionTexts(session.copy.document, 0)).toEqual(['title:ONE', 'Alpha.', 'Beta.']);
    expect(session.copy.place('p1')).toBeUndefined();
    expect(session.copy.place('sc_1')).toBeDefined();
    session.discard();
  });

  it('blocks with a partial last block: the last element joins the unselected tail, which stays byte-identical (C6)', async () => {
    const { session, controller, select } = await editor();
    const snapshot = await select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p2', offset: 6 }); // p1 + "Second"
    expect(snapshot).toMatchObject({ form: 'blocks', openStart: false, openEnd: true });
    const outcome = await applyChange(
      session,
      selectionReplacement(
        session,
        snapshot,
        { xml: '<p>First, fixed.</p>\n<p>Second</p>' },
        controller,
      ),
    );
    expect(outcome.accepted).toBe(true);
    expect(sectionTexts(session.copy.document, 0)).toEqual([
      'title:ONE',
      'First, fixed.',
      'Second paragraph.',
    ]);
    // The partially selected paragraph keeps its identity; the first one was replaced whole.
    expect(session.copy.place('p2')).toBeDefined();
    expect(session.copy.place('p1')).toBeUndefined();
    expect((outcome as { result: SelectionReplacementResult }).result.inserted).toEqual([
      { id: 'sc_1', type: 'p' },
    ]);
    session.discard();
  });

  it('blocks {text}: one paragraph per non-empty line; text for whole blocks is refused as a fragment', async () => {
    const { session, controller, select } = await editor();
    const snapshot = await select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p2', offset: 17 });
    const outcome = await applyChange(
      session,
      selectionReplacement(session, snapshot, { text: 'One.\n\n  Two.  \nThree.' }, controller),
    );
    expect(outcome.accepted).toBe(true);
    expect(sectionTexts(session.copy.document, 0)).toEqual(['title:ONE', 'One.', 'Two.', 'Three.']);
    const refused = (await applyChange(
      session,
      selectionReplacement(session, snapshot, { xml: 'loose text' }, controller),
    )) as ChangeRejected;
    expect(refused).toMatchObject({ accepted: false, code: 'fragmentNotAllowed' });
    session.discard();
  });

  it('the Source text path is not a Body replacement', async () => {
    const { session, controller, select } = await editor();
    const snapshot = await select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p1', offset: 5 });
    const outcome = (await applyChange(
      session,
      selectionReplacement(
        session,
        { ...snapshot, form: 'xml', pm: null },
        { xml: '<p>x</p>' },
        controller,
      ),
    )) as ChangeRejected;
    expect(outcome).toMatchObject({ accepted: false, code: 'invalidArguments' });
    session.discard();
  });
});

/* ------------------------------------------------------------------------ */
/* The catalogue's change tools behind the real hook (T051 / T054)           */
/* ------------------------------------------------------------------------ */

/**
 * The adapter the request loop puts between the catalogue and `applyChange` (assistant.ts
 * `changeHook`): the strike key split into tool and target, a `ToolError` of the pre-check /
 * parse / arguments turned into a `ChangeRejection` by `rejectionFromEnvelope` so that it
 * counts (a gate or failure stays what it is: rolled back, no strike), the hook's outcome as
 * the envelope.
 */
function hookAdapter(session: RequestSession, keys: string[]) {
  return async <T extends object>(
    key: string,
    change: () => Promise<T>,
  ): Promise<T | ToolErrorEnvelope> => {
    keys.push(key);
    const colon = key.indexOf(':');
    const tool = key.slice(0, colon);
    const target = key.slice(colon + 1);
    let thrown: ToolError | null = null;
    let outcome: ChangeOutcome<T>;
    try {
      outcome = await applyChange<T>(session, {
        tool,
        target,
        apply: async () => {
          try {
            return await change();
          } catch (error) {
            if (error instanceof ToolError) {
              thrown = error;
              throw rejectionFromEnvelope(error.body) ?? error;
            }
            throw error;
          }
        },
      });
    } catch (error) {
      if (thrown && error === thrown) return (thrown as ToolError).envelope();
      throw error;
    }
    if (outcome.accepted) return outcome.result;
    const refused = thrown as ToolError | null;
    if (refused) return { error: { ...refused.body, strike: outcome.strike } };
    return { error: { ...rejectedEnvelope(outcome).error } };
  };
}

describe('the structural change tools under the hook (strike keys of §3.5)', () => {
  async function bound() {
    const h = harness();
    const session = await start(h);
    const keys: string[] = [];
    const c = await catalogueHarness({
      copy: session.copy,
      applyChange: hookAdapter(session, keys),
      fragmentFromXml: (xml, parent) => {
        try {
          return Promise.resolve(fakeFromXml(xml, parent, session.copy.document));
        } catch (error) {
          return Promise.reject(error);
        }
      },
    });
    return { h, session, keys, call: c.catalogue.call, close: () => c.catalogue.close() };
  }

  it('counts every refused attempt - pre-check and hook alike - per key, resets a key on its acceptance, never counts a read tool', async () => {
    const { h, session, keys, call, close } = await bound();
    try {
      // replace_node, accepted: key replace_node:<nodeId>, counter untouched, one change.
      const replaced = await call('replace_node', {
        node: 'body[1]/section[1]/p[1]',
        content: { xml: '<p>First, fixed.</p>' },
      });
      expect(replaced.isError).toBe(false);
      expect(replaced.result.node).toMatchObject({ id: 'p1', path: 'body[1]/section[1]/p[1]' });
      expect(session.changes.map((c) => [c.strikeKey, c.status])).toEqual([
        ['replace_node:p1', 'accepted'],
      ]);
      expect(session.changesInThisRequest).toBe(1);

      // insert_node after p1: a paragraph the schema check refuses (the hook's rejection) …
      const bad = await call('insert_node', {
        where: 'after',
        node: 'p1',
        content: { xml: '<p>A BAD word.</p>' },
      });
      expect(bad.error).toMatchObject({
        code: 'rejected',
        strike: { count: 1, of: 3 },
        issues: [expect.objectContaining({ element: 'p', message: BAD_WORD_MESSAGE })],
      });
      expect(session.strikes.count('insert_node:after@p1')).toBe(1);
      expect(sectionTexts(session.copy.document, 0)).toEqual([
        'title:ONE',
        'First, fixed.',
        'Second paragraph.',
      ]);
      // … and a title the parent's content expression refuses (the pre-check) - the same key.
      const misplaced = await call('insert_node', {
        where: 'after',
        node: 'p1',
        content: { xml: '<title><p>Late</p></title>' },
      });
      expect(misplaced.error).toMatchObject({ code: 'notAllowed', strike: { count: 2, of: 3 } });
      expect(session.strikes.count('insert_node:after@p1')).toBe(2);
      expect(session.changes[2]).toMatchObject({
        strikeKey: 'insert_node:after@p1',
        status: 'rejected',
      });

      // Other keys: remove_node of the first body, set_text on a section - one strike each,
      // the insert_node counter stays at 2.
      const firstBody = await call('remove_node', { node: 'body[1]' });
      expect(firstBody.error).toMatchObject({ code: 'notAllowed', strike: { count: 1, of: 3 } });
      const textOnly = await call('set_text', { node: 's1', text: 'x' });
      expect(textOnly.error).toMatchObject({ code: 'textOnly', strike: { count: 1, of: 3 } });
      const unknown = await call('set_text', { node: 'n999', text: 'x' });
      expect(unknown.error).toMatchObject({ code: 'unknownNode', strike: { count: 1, of: 3 } });
      expect(session.strikes.count('insert_node:after@p1')).toBe(2);

      // Read tools and set_selection: no change record, no strike.
      const changesBefore = session.changes.length;
      await call('get_outline', {});
      await call('read_part', { node: 's1' });
      await call('find', { text: 'paragraph' });
      await call('get_description', {});
      await call('set_selection', { node: 'p2' });
      expect(session.changes).toHaveLength(changesBefore);
      expect(session.strikes.entries()).toEqual([
        ['insert_node:after@p1', 2],
        ['remove_node:b1', 1],
        ['set_text:s1', 1],
        ['set_text:n999', 1],
      ]);

      // replace_all and set_description, accepted under their own keys.
      const replacedAll = await call('replace_all', { text: 'paragraph', replacement: 'sentence' });
      expect(replacedAll.isError).toBe(false);
      expect(replacedAll.result.count).toBe(3);
      const described = await call('set_description', {
        description: { titleInfo: { bookTitle: 'Renamed' } },
      });
      expect(described.isError).toBe(false);
      expect(described.result.fields).toEqual(['titleInfo.bookTitle']);
      expect(session.copy.document.description.titleInfo.bookTitle).toBe('Renamed');

      // An accepted change of the key resets its counter alone.
      const fine = await call('insert_node', {
        where: 'after',
        node: 'p1',
        content: { xml: '<p>Fine.</p>' },
      });
      expect(fine.isError).toBe(false);
      expect(session.strikes.count('insert_node:after@p1')).toBe(0);
      expect(session.strikes.count('remove_node:b1')).toBe(1);
      expect(session.strikes.count('set_text:s1')).toBe(1);

      // The third strike of one key ends the request (FR-063).
      await call('set_text', { node: 'body[1]/section[1]', text: 'x' });
      const third = await call('set_text', { node: 's1', text: 'x' });
      expect(third.error).toMatchObject({ code: 'textOnly', strike: { count: 3, of: 3 } });
      expect(session.strikes.exhausted('set_text:s1')).toBe(true);

      expect(keys).toEqual([
        'replace_node:p1',
        'insert_node:after@p1',
        'insert_node:after@p1',
        'remove_node:b1',
        'set_text:s1',
        'set_text:n999',
        'replace_all:paragraph',
        'set_description:description',
        'insert_node:after@p1',
        'set_text:s1',
        'set_text:s1',
      ]);
      // Nothing reached the editor: the live document is still `before` (FR-043).
      expect(h.store.getState().document).toBe(session.before);
      expect(h.store.getState().modified).toBe(false);
      expect(sectionTexts(session.copy.document, 0)).toEqual([
        'title:ONE',
        'First, fixed.',
        'Fine.',
        'Second sentence.',
      ]);
    } finally {
      await close();
      session.discard();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* US4 (T059 / T060): the stages, the mixed third strike, the pre-check form */
/* ------------------------------------------------------------------------ */

describe('the stages of a rejection (data-model §7.3; US4)', () => {
  async function bound() {
    const h = harness();
    const session = await start(h);
    const keys: string[] = [];
    const c = await catalogueHarness({
      copy: session.copy,
      applyChange: hookAdapter(session, keys),
      fragmentFromXml: (xml, parent) => {
        try {
          return Promise.resolve(fakeFromXml(xml, parent, session.copy.document));
        } catch (error) {
          return Promise.reject(error);
        }
      },
    });
    return { h, session, keys, call: c.catalogue.call, close: () => c.catalogue.close() };
  }

  it('strike codes: every rejected attempt counts, gates and failures count nothing', () => {
    for (const code of [
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
    ]) {
      expect(isStrikeCode(code), code).toBe(true);
    }
    for (const code of [
      'unavailable',
      'runNotConfirmed',
      'scriptFailed',
      'cancelled',
      'internal',
      'tooLarge',
      'unknownTool',
      'scriptIdBundled',
      'scriptExists',
    ]) {
      expect(isStrikeCode(code), code).toBe(false);
      expect(rejectionFromEnvelope({ code, message: 'x' })).toBeNull();
    }
    expect(STRIKE_CODES.size).toBe(10);
    // The hook's own `rejected` is never re-thrown as a pre-check rejection.
    expect(rejectionFromEnvelope({ code: 'rejected', message: 'x' })).toBeNull();
    const rejection = rejectionFromEnvelope({
      code: 'notAllowed',
      message: 'no',
      hint: 'use get_schema',
      issues: [
        { code: 'schema.invalid', element: 'title', path: 'body[1]/section[1]', message: 'no' },
      ],
    })!;
    expect(rejection).toBeInstanceOf(ChangeRejection);
    expect(rejection).toMatchObject({
      code: 'notAllowed',
      stage: 'preCheck',
      hint: 'use get_schema',
    });
    expect(rejection.issues).toHaveLength(1);
    expect(rejectionFromEnvelope({ code: 'invalidXml', message: 'x' })!.stage).toBe('parse');
    expect(rejectionFromEnvelope({ code: 'fragmentNotAllowed', message: 'x' })!.stage).toBe(
      'parse',
    );
  });

  it('invalidXml hints: U+00A0 for &nbsp;, no document wrapper for a declaration or FictionBook', () => {
    expect(invalidXmlHint("Entity 'nbsp' not defined")).toContain('U+00A0');
    expect(invalidXmlHint('XML declaration allowed only at the start of the document')).toContain(
      'without a document wrapper',
    );
    expect(invalidXmlHint('Opening and ending tag mismatch: emphasis line 1 and p')).toContain(
      'close every element',
    );
    const rejection = ChangeRejection.fromRpcError(
      new RpcError(RpcErrorCode.docParseError, 'x', {
        line: 1,
        column: 11,
        message: "Entity 'nbsp' not defined",
      }),
    ) as ChangeRejection;
    expect(rejection.code).toBe('invalidXml');
    expect(rejection.stage).toBe('parse');
    expect(rejection.hint).toContain('U+00A0');
    expect(rejection.issues).toEqual([
      { code: 'xml.notWellFormed', element: '', line: 1, message: "Entity 'nbsp' not defined" },
    ]);
  });

  it('a pre-check refusal carries the ErrorForModel form: element and path, no line', async () => {
    const { session, call, close } = await bound();
    try {
      // notAllowed: a title appended after the paragraphs of section 1 (contentFits).
      const late = await call('insert_node', {
        where: 'append',
        node: 'body[1]/section[1]',
        content: { xml: '<title><p>Late</p></title>' },
      });
      expect(late.error).toMatchObject({ code: 'notAllowed', strike: { count: 1, of: 3 } });
      const issues = late.error!.issues as ErrorForModel[];
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        code: 'schema.invalid',
        element: 'title',
        path: 'body[1]/section[1]',
      });
      expect(issues[0]!.message).toContain('does not allow');
      expect(issues[0]).not.toHaveProperty('line');
      // invalidNode: a section whose JSON puts a title after a paragraph (createChecked).
      const built = await call('insert_node', {
        where: 'after',
        node: 'body[1]/section[1]',
        content: {
          nodes: [
            {
              type: 'section',
              content: [
                { type: 'p', content: [{ type: 'text', text: 'x' }] },
                { type: 'title', content: [{ type: 'p', content: [{ type: 'text', text: 'T' }] }] },
              ],
            },
          ],
        },
      });
      expect(built.error).toMatchObject({ code: 'invalidNode', strike: { count: 1, of: 3 } });
      const problem = (built.error!.issues as ErrorForModel[])[0]!;
      expect(problem.code).toBe('schema.invalid');
      expect(problem.element).toBe('section');
      expect(problem.path).toBe('body[1]/section');
      expect(problem).not.toHaveProperty('line');
      // The parse stage: a 1001 carries the parser's line, a 1201 the element and its parent.
      const malformed = await call('replace_node', {
        node: 'p1',
        content: { xml: '<p>x&nbsp;y</p>' },
      });
      expect(malformed.error).toMatchObject({
        code: 'invalidXml',
        strike: { count: 1, of: 3 },
        issues: [{ code: 'xml.notWellFormed', element: '', line: 1 }],
      });
      expect(malformed.error!.hint).toContain('U+00A0');
      const unknown = await call('replace_node', {
        node: 'p1',
        content: { xml: '<chapter><p>x</p></chapter>' },
      });
      expect(unknown.error).toMatchObject({
        code: 'fragmentNotAllowed',
        element: 'chapter',
        parent: 'section',
        strike: { count: 2, of: 3 },
        issues: [{ code: 'schema.invalid', element: 'chapter' }],
      });
      // Nothing of the four refusals reached the copy.
      expect(session.copy.document).toBe(session.before);
      expect(session.strikes.entries()).toEqual([
        ['insert_node:append@s1', 1],
        ['insert_node:after@s1', 1],
        ['replace_node:p1', 2],
      ]);
    } finally {
      await close();
      session.discard();
    }
  });

  it("a 1001, a 1201 and a hook rejection of one key end the request on the third; an accepted change of another key and a rejection of another key in between change nothing; the three rejections' issues are collected", async () => {
    const { h, session, keys, call, close } = await bound();
    try {
      const key = 'replace_node:p1';
      // A valid change of another key first (discarded with the request on the third strike).
      const fine = await call('insert_node', {
        where: 'after',
        node: 'p2',
        content: { xml: '<p>Fine.</p>' },
      });
      expect(fine.isError).toBe(false);
      expect(session.changesInThisRequest).toBe(1);
      // 1: the parse stage - malformed XML (1001).
      const first = await call('replace_node', { node: 'p1', content: { xml: '<p>x&nbsp;y</p>' } });
      expect(first.error).toMatchObject({ code: 'invalidXml', strike: { count: 1, of: 3 } });
      // A rejection of another key in between: the counter of `key` stays at 1.
      const other = await call('set_text', { node: 's1', text: 'x' });
      expect(other.error).toMatchObject({ code: 'textOnly', strike: { count: 1, of: 3 } });
      expect(session.strikes.count(key)).toBe(1);
      // 2: the parse stage - a title under p (1201 in the fake parser: not inline content).
      const second = await call('replace_node', {
        node: 'p1',
        content: { xml: '<title><p>T</p></title>' },
      });
      expect(second.error).toMatchObject({ strike: { count: 2, of: 3 } });
      expect(['fragmentNotAllowed', 'notAllowed']).toContain(second.error!.code);
      // 3: the hook - schema-invalid content the validator refuses.
      const third = await call('replace_node', {
        node: 'p1',
        content: { xml: '<p>A BAD word.</p>' },
      });
      expect(third.error).toMatchObject({
        code: 'rejected',
        strike: { count: 3, of: 3 },
        issues: [expect.objectContaining({ element: 'p', message: BAD_WORD_MESSAGE })],
      });
      expect(session.strikes.exhausted(key)).toBe(true);
      expect(keys).toEqual(['insert_node:after@p2', key, 'set_text:s1', key, key]);
      // The three rejections' issues, in order (what the panel shows at the end).
      const collected = strikeIssues(session, key);
      expect(collected.map((issue) => issue.code)).toEqual([
        'xml.notWellFormed',
        'schema.invalid',
        'schema.invalid',
      ]);
      expect(collected[2]!.message).toBe(BAD_WORD_MESSAGE);
      expect(strikeIssues(session, 'set_text:s1')).toHaveLength(1);
      expect(strikeIssues(session, 'insert_node:after@p2')).toEqual([]);
      // The request ends `rejected`: the whole copy is discarded - the accepted insertion too.
      expect(sectionTexts(session.copy.document, 0)).toEqual([
        'title:ONE',
        'First paragraph.',
        'Second paragraph.',
        'Fine.',
      ]);
      session.discard();
      expect(h.store.getState().document).toBe(session.before);
      expect(sectionTexts(h.store.getState().document!, 0)).toEqual([
        'title:ONE',
        'First paragraph.',
        'Second paragraph.',
      ]);
      expect(h.store.getState().modified).toBe(false);
      expect(h.undo.canUndo).toBe(false);
    } finally {
      await close();
      if (!session.ended) session.discard();
    }
  });

  it('an accepted change of the key empties its collected issues; a gate inside a change rolls back without a strike', async () => {
    const { session, call, close } = await bound();
    try {
      await call('replace_node', { node: 'p1', content: { xml: '<p>x&nbsp;y</p>' } });
      expect(strikeIssues(session, 'replace_node:p1')).toHaveLength(1);
      const ok = await call('replace_node', { node: 'p1', content: { xml: '<p>Fixed.</p>' } });
      expect(ok.isError).toBe(false);
      expect(strikeIssues(session, 'replace_node:p1')).toEqual([]);
      expect(session.strikes.count('replace_node:p1')).toBe(0);

      // A gate thrown inside the hook (what `unavailable` / `scriptFailed` do): rolled back,
      // answered as it is, no strike, no change record outcome.
      const before = session.copy.document;
      const outcome = await (session.copy.checkpoint(),
      applyChange(session, {
        tool: 'run_script',
        target: 'assistant/x',
        apply: () => {
          session.copy.insert('after', 'p2', node(paragraph('sc_9', 'half')));
          const error = rejectionFromEnvelope({ code: 'scriptFailed', message: 'threw' });
          expect(error).toBeNull();
          throw new ToolError('scriptFailed', 'threw');
        },
      }).catch((error: unknown) => error));
      expect(outcome).toBeInstanceOf(ToolError);
      expect(session.copy.document).toBe(before);
      expect(session.strikes.count('run_script:assistant/x')).toBe(0);
      expect(session.changes.at(-1)).toMatchObject({
        strikeKey: 'run_script:assistant/x',
        status: 'rolledBack',
      });
    } finally {
      await close();
      session.discard();
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006 (US11, T172): tables made irregular (FR-053; C9, C65, C66)   */
/* ------------------------------------------------------------------------ */

describe('tables made irregular (feature 006 US11; FR-053, FR-062; C9, C65, C66)', () => {
  const R_PATH = 'body[1]/section[1]/table[1]';
  const I_PATH = 'body[1]/section[2]/table[1]';
  const SHORT = { rows: 2, columns: 3, shortRows: 1, row: 2, covered: 2, overlaps: 0, pastEnd: 0 };

  /** The session book with a regular table in section 1 and a short-row table in section 2. */
  function tableBook(): Document {
    const doc = sessionBook({ preExisting: false });
    const sections = (doc.bodies[0] as unknown as { content: ModelNodeJson[] }).content;
    sections
      .find((s) => s.attrs?.nodeId === 's1')!
      .content!.push(
        tableNode('tR', [
          ['a', 'b'],
          ['c', 'd'],
        ]) as unknown as ModelNodeJson,
      );
    sections
      .find((s) => s.attrs?.nodeId === 's2')!
      .content!.push(
        tableNode('tI', [
          ['a', 'b', 'c'],
          ['d', 'e'],
        ]) as unknown as ModelNodeJson,
      );
    return doc;
  }

  /** A change that puts the table `json` in place of the node `id`. */
  function replaced(session: RequestSession, id: string, json: unknown) {
    return {
      tool: 'replace_node',
      target: id,
      apply: () => {
        session.copy.replace(id, json as ModelNodeJson);
        return { node: { id } };
      },
    };
  }

  it('the baseline starts the set; a regular table made ragged is made irregular and joins the set', async () => {
    const h = harness({ document: tableBook() });
    const session = await start(h);
    expect(session.irregularTables.map((entry) => entry.nodeId)).toEqual(['tI']);
    const outcome = await applyChange(
      session,
      replaced(session, 'tR', tableNode('tR', [['a', 'b'], ['c']])),
    );
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) return;
    expect(outcome.madeIrregular.map((entry) => [entry.nodeId, entry.path])).toEqual([
      ['tR', R_PATH],
    ]);
    expect(outcome.madeIrregular[0]!.params).toMatchObject({ shortRows: 1, row: 2, covered: 1 });
    expect(session.irregularTables.map((entry) => entry.nodeId).sort()).toEqual(['tI', 'tR']);
    session.discard();
  });

  it('an already irregular table edited by set_text is not reported; one written anew with a new node id is, in place of an irregular one too; a table made regular leaves the set', async () => {
    const h = harness({ document: tableBook() });
    const session = await start(h);
    const edited = await applyChange(session, {
      tool: 'set_text',
      target: 'tIr1c1',
      apply: () => {
        session.copy.replace('tIr1c1', {
          type: 'td',
          attrs: { nodeId: 'tIr1c1' },
          content: [{ type: 'text', text: 'A' }],
        });
        return {};
      },
    });
    expect(edited.accepted && edited.madeIrregular).toEqual([]);
    const anew = await applyChange(
      session,
      replaced(session, 'tI', tableNode('tNew', [['a', 'b', 'c'], ['d']])),
    );
    expect(anew.accepted && anew.madeIrregular.map((entry) => entry.nodeId)).toEqual(['tNew']);
    const regular = await applyChange(
      session,
      replaced(session, 'tNew', tableNode('tNew', [['a'], ['d']])),
    );
    expect(regular.accepted && regular.madeIrregular).toEqual([]);
    expect(session.irregularTables).toEqual([]);
    session.discard();
  });

  it('a rejected change leaves the set as it was; setBaseline replaces it', async () => {
    const h = harness({ document: tableBook() });
    const session = await start(h);
    const rejected = await applyChange(session, {
      tool: 'replace_node',
      target: 'tR',
      apply: () => {
        session.copy.replace(
          'tR',
          tableNode('tR', [['a', 'b'], ['c']]) as unknown as ModelNodeJson,
        );
        session.copy.insert('after', 'p1', node(paragraph('sc_bad', 'A BAD word.')));
        return {};
      },
    });
    expect(rejected.accepted).toBe(false);
    expect(session.irregularTables.map((entry) => entry.nodeId)).toEqual(['tI']);
    session.setBaseline({
      issues: [
        {
          severity: 'warning',
          code: 'table.irregular',
          params: { ...SHORT },
          line: 40,
          column: 3,
          nodeId: 'scratch7',
          path: R_PATH,
        },
      ],
    });
    expect(session.irregularTables).toEqual([
      { nodeId: 'scratch7', path: R_PATH, line: 40, params: { ...SHORT } },
    ]);
    session.discard();
  });

  it('madeIrregular: the node id in the document form; the path and the params in the text form, a moved path reported; a document-form baseline against text-form reports', () => {
    const before = [{ nodeId: 'n5', path: R_PATH, params: { ...SHORT } }];
    expect(
      madeIrregular(before, [{ nodeId: 'n5', path: I_PATH, params: { ...SHORT } }], 'document'),
    ).toEqual([]);
    expect(
      madeIrregular(before, [{ nodeId: 'n6', path: R_PATH, params: { ...SHORT } }], 'document'),
    ).toHaveLength(1);
    // The text form: a table whose path moved is still reported (vR7:80).
    expect(
      madeIrregular(
        before,
        [{ nodeId: 'x1', path: I_PATH, line: 9, params: { ...SHORT } }],
        'text',
      ),
    ).toHaveLength(1);
    // Source text mode: the document-form baseline matches the text form by path and params.
    expect(
      madeIrregular(
        before,
        [{ nodeId: 'x1', path: R_PATH, line: 9, params: { ...SHORT } }],
        'text',
      ),
    ).toEqual([]);
    for (const member of ['rows', 'columns', 'shortRows', 'overlaps', 'pastEnd'] as const) {
      const params = { ...SHORT, [member]: SHORT[member] + 1 };
      expect(madeIrregular(before, [{ path: R_PATH, params }], 'text'), member).toHaveLength(1);
    }
  });

  it('tableWarningOf: none without an entry; the messages for one and two tables, verbatim; the NodeInfo of the copy in the document form, {path, type} with line in the text form', () => {
    const index = indexDocument(tableBook());
    expect(tableWarningOf([], index, 'document')).toBeNull();
    expect(withTableWarning({ node: { id: 'x' } }, [], index, 'document')).toEqual({
      node: { id: 'x' },
    });
    const one = tableWarningOf(
      [{ nodeId: 'tI', path: I_PATH, line: 7, params: { ...SHORT } }],
      index,
      'document',
    )!;
    expect(one.message).toBe(
      'This change made 1 table irregular: valid FB2, but readers lay out irregular tables unpredictably. If that was not intended, make it regular with edit_table, op "repair".',
    );
    expect(one.tables).toEqual([
      {
        table: { id: 'tI', path: I_PATH, type: 'table', characters: 5 },
        problems: 'row 2 covers 2 of 3 columns',
      },
    ]);
    const two = tableWarningOf(
      [
        { nodeId: 'x1', path: R_PATH, line: 12, params: { ...SHORT } },
        { nodeId: 'x2', path: I_PATH, line: 30, params: { ...SHORT, overlaps: 1 } },
      ],
      index,
      'text',
    )!;
    expect(two.message).toBe(
      'This change made 2 tables irregular: valid FB2, but readers lay out irregular tables unpredictably. If that was not intended, make them regular with edit_table, op "repair".',
    );
    expect(two.tables).toEqual([
      { table: { path: R_PATH, type: 'table' }, line: 12, problems: 'row 2 covers 2 of 3 columns' },
      {
        table: { path: I_PATH, type: 'table' },
        line: 30,
        problems: 'row 2 covers 2 of 3 columns; 1 overlapping span',
      },
    ]);
    expect(
      withTableWarning({ ok: true }, [{ path: R_PATH, params: { ...SHORT } }], index, 'text'),
    ).toMatchObject({
      ok: true,
      tableWarning: { tables: [{ problems: 'row 2 covers 2 of 3 columns' }] },
    });
  });

  it('irregularEntries reads the table.irregular warnings of a report; irregularTablesOf gives one entry per warning in both forms, [] without one; the validate tool always lists them', async () => {
    const doc = tableBook();
    const index = indexDocument(doc);
    const report = validateDocument(doc);
    expect(irregularEntries(report.issues)).toEqual([
      {
        nodeId: 'tI',
        path: I_PATH,
        line: expect.any(Number),
        params: expect.objectContaining(SHORT),
      },
    ]);
    expect(irregularTablesOf(report, 'document', index)).toEqual([
      {
        table: { id: 'tI', path: I_PATH, type: 'table', characters: 5 },
        problems: 'row 2 covers 2 of 3 columns',
      },
    ]);
    expect(irregularTablesOf({ issues: [] }, 'document', index)).toEqual([]);
    const text = {
      issues: [
        {
          severity: 'warning' as const,
          code: 'table.irregular',
          params: { ...SHORT },
          line: 21,
          column: 4,
          nodeId: 'n900',
          path: I_PATH,
        },
      ],
    };
    expect(irregularTablesOf(text, 'text', index)).toEqual([
      { table: { path: I_PATH, type: 'table' }, line: 21, problems: 'row 2 covers 2 of 3 columns' },
    ]);
    for (const [form, answer] of [
      ['document', report],
      ['text', { ...report, issues: text.issues, warningCount: 1 } as ValidationReport],
    ] as const) {
      const c = await catalogueHarness({
        document: doc,
        baseline: () => new Map(),
        validate: () => Promise.resolve(answer),
        validateForm: () => form,
      });
      const out = await c.catalogue.call('validate', {});
      expect(out.result.irregularTables, form).toEqual(irregularTablesOf(answer, form, index));
      await c.catalogue.close();
    }
    const clean = await catalogueHarness({
      document: doc,
      baseline: () => new Map(),
      validate: () =>
        Promise.resolve({ issues: [], errorCount: 0, warningCount: 0, durationMs: 1 }),
    });
    expect((await clean.catalogue.call('validate', {})).result.irregularTables).toEqual([]);
    await clean.catalogue.close();
  });
});
