/**
 * Feature 005 T045 (ai-catalogue §3.5, §6.10, §9.2 `hook.test.ts`; data-model §7.3-§7.4;
 * review C3, C4, C12; FR-060 to FR-063) - the validity hook: checkpoint, change, validate, key
 * diff, accept or rollback with the `rejected` envelope; the strike counter per key
 * `<tool>:<target>` - the same key three times ends the request (hook rejections, a 1201 and
 * invalid arguments mixed), another key's rejection or acceptance does not reset it, an
 * accepted change of the key does; a change that throws is rolled back and propagated.
 */

import { selectionSnapshot } from '@/ai/context';
import {
  applyChange,
  ChangeRejection,
  rejectedEnvelope,
  selectionReplacement,
  STRIKE_LIMIT,
  StrikeCounter,
  strikeKey,
  type ChangeRejected,
  type SelectionReplacementResult,
} from '@/ai/hook';
import { startRequestSession, type RequestSession } from '@/ai/session';
import type { ModelNodeJson } from '@/editor/fromModel';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import { setBodySelection } from '@/scripting/api-impl';
import { getBodyController } from '@/views/body/bodyEditor';

import {
  BAD_WORD_MESSAGE,
  harness,
  paragraph,
  sectionTexts,
  title,
  TITLE_UNEXPECTED,
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
