/**
 * The FR-015 confirmation of the tables feature (feature 006, T103; FR-015, FR-045, FR-052's host
 * half; C13; I12; data-model §6.4, §10.2): `linkTargetCount` - the links of the book that would
 * lose their target, through the store's document (`countLinksTo`, T039) -, `confirmLinkTargets`
 * - the question, through the dialog host, with the test ids of `dialog-table-link-targets` -
 * and `runWithLinkCheck` - a dry run, the question when a removed id is linked, and on *Yes* the
 * plan made again on the state as it is at the answer, one step; *No* records nothing. Only
 * *Merge cells* asks (C13): *Delete row* over a linked cell never does.
 */

import { act } from '@testing-library/react';

import { CellBlockSelection } from '@/editor/table/selection';
import { planMerge } from '@/editor/table/ops';
import type { MessageBoxOptions, MessageButtonId } from '@/dialogs/types';
import { confirmLinkTargets, linkTargetCount, runWithLinkCheck } from '@/features/tables/confirm';
import { activeTableTarget } from '@/features/tables/target';
import type { AnnotationNode, Document, InlineNode, Mark } from '@/model/document';
import { collectBookIds, countLinksTo } from '@/model/ids';
import { actions, createAppStore } from '@/model/store';

import { fakeDialogs, fakeDocument, makeContext, type FakeDialogs } from './testUtils';
import {
  caretIn,
  posOf,
  removeHarnessHosts,
  select,
  tableDocument,
  tablesHarness,
  type TablesHarness,
} from './tablesHarness';

const link = (href: string): Mark => ({ type: 'link', attrs: { href } });
const text = (value: string, marks?: Mark[]): InlineNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const picture = (nodeId: string, marks?: Mark[]): InlineNode => ({
  type: 'inline-image',
  attrs: { nodeId, href: '#pic' },
  ...(marks ? { marks } : {}),
});
const paragraph = (nodeId: string, content: InlineNode[]) => ({
  type: 'p' as const,
  attrs: { nodeId },
  content,
});
const annotation = (nodeId: string, content: ReturnType<typeof paragraph>[]) =>
  ({ type: 'annotation', attrs: { nodeId }, content }) as AnnotationNode;

/** The harness's book with `t1`'s `r0c1` the target `us5-target` of a link in `p2`. */
function linkedBook(): Document {
  const doc = tableDocument();
  const section = doc.bodies[0]!.content[0] as unknown as { content: unknown[] };
  const table = section.content[1] as {
    content: { content: { attrs: Record<string, unknown> }[] }[];
  };
  table.content[0]!.content[1]!.attrs.id = 'us5-target';
  section.content[2] = paragraph('p2', [text('See '), text('the cell', [link('#us5-target')])]);
  return doc;
}

/** A dialog host whose message boxes wait for the test's answer. */
function deferredDialogs(): FakeDialogs & { answer(button: MessageButtonId): void } {
  const dialogs = fakeDialogs();
  let resolve: ((button: MessageButtonId) => void) | null = null;
  return Object.assign(dialogs, {
    showMessage: (options: MessageBoxOptions) => {
      dialogs.shown.push(options);
      return new Promise<MessageButtonId>((done) => {
        resolve = done;
      });
    },
    answer(button: MessageButtonId) {
      const done = resolve;
      resolve = null;
      done?.(button);
    },
  });
}

/** A block from the cell `from` to the cell `to` of the mounted editor. */
function selectBlock(harness: TablesHarness, from: string, to: string): void {
  const doc = harness.controller.editorState!.doc;
  act(() =>
    select(harness, CellBlockSelection.create(doc, posOf(harness, from), posOf(harness, to))),
  );
}

/** The model attributes of `t1`'s cell `nodeId` in the store's document, or undefined. */
function storeCell(harness: TablesHarness, nodeId: string): Record<string, unknown> | undefined {
  const section = harness.store.getState().document!.bodies[0]!.content[0] as unknown as {
    content: { type: string; content?: { content?: { attrs: Record<string, unknown> }[] }[] }[];
  };
  const table = section.content.find((node) => node.type === 'table')!;
  for (const row of table.content ?? []) {
    for (const cell of row.content ?? []) if (cell.attrs.nodeId === nodeId) return cell.attrs;
  }
  return undefined;
}

afterEach(() => {
  removeHarnessHosts();
});

describe('linkTargetCount', () => {
  it('counts the links of the book to the removed ids: text, a linked picture, a link over text and a picture once, the annotation and the history', () => {
    const store = createAppStore();
    expect(linkTargetCount(store, ['t1'])).toBe(0);
    const doc = fakeDocument();
    const section = doc.bodies[0]!.content[0] as unknown as { content: unknown[] };
    section.content.push(
      paragraph('a', [text('a text link', [link('#t1')])]),
      paragraph('b', [picture('pic1', [link('#t1')])]),
      paragraph('c', [text('over text', [link('#t2')]), picture('pic2', [link('#t2')])]),
    );
    doc.description.titleInfo.annotation = annotation('ann', [
      paragraph('d', [text('in the annotation', [link('#t3')])]),
    ]);
    doc.description.documentInfo.history = annotation('hist', [
      paragraph('e', [text('in the history', [link('#t3')])]),
    ]);
    actions.setDocument(store, doc);
    expect(linkTargetCount(store, ['t1'])).toBe(2);
    expect(linkTargetCount(store, ['t2'])).toBe(1);
    expect(linkTargetCount(store, ['t3'])).toBe(2);
    expect(linkTargetCount(store, ['t1', 't2', 't3'])).toBe(5);
    expect(linkTargetCount(store, ['nobody'])).toBe(0);
    expect(linkTargetCount(store, [])).toBe(0);
    // The same count as the model's helper on the store's document.
    expect(linkTargetCount(store, ['t1', 't3'])).toBe(countLinksTo(doc, ['t1', 't3']));
  });
});

describe('confirmLinkTargets', () => {
  it('asks nothing for 0 links', async () => {
    const ctx = await makeContext();
    expect(await confirmLinkTargets(ctx, 0)).toBe(true);
    expect(ctx.dialogs.shown).toEqual([]);
  });

  it('asks once with the yes/no question named by the count, No the default; true only for Yes', async () => {
    const ctx = await makeContext({ dialogs: fakeDialogs(['yes', 'no', 'cancel']) });
    expect(await confirmLinkTargets(ctx, 1)).toBe(true);
    expect(ctx.dialogs.shown).toHaveLength(1);
    expect(ctx.dialogs.shown[0]).toEqual({
      text: ctx.t('tables.msg.linkTargets', { count: 1 }),
      caption: ctx.t('tables.msg.linkTargetsCaption'),
      buttons: 'yesNo',
      icon: 'question',
      defaultButton: 'no',
      testId: 'dialog-table-link-targets',
    });
    expect(ctx.dialogs.shown[0]!.text).toBe(
      '1 link of the book points to a cell that this merge removes, and will lose its target. Merge anyway?',
    );
    expect(ctx.dialogs.shown[0]!.caption).toBe('Merge cells');
    expect(await confirmLinkTargets(ctx, 2)).toBe(false);
    expect(ctx.dialogs.shown).toHaveLength(2);
    expect(ctx.dialogs.shown[1]!.text).toBe(
      '2 links of the book point to cells that this merge removes, and will lose their targets. Merge anyway?',
    );
    // Any answer but Yes declines.
    expect(await confirmLinkTargets(ctx, 3)).toBe(false);
  });
});

describe('runWithLinkCheck', () => {
  it('a block whose removed cell a paragraph links to asks; No changes nothing and records no undo entry (FR-045)', async () => {
    const harness = await tablesHarness(linkedBook());
    const dialogs = fakeDialogs(['no']);
    const ctx = { ...harness.ctx, dialogs };
    selectBlock(harness, 't1-0-0', 't1-1-1');
    const doc = harness.controller.editorState!.doc;
    const document = harness.store.getState().document;
    const entries = harness.services.undo.entries().length;
    let answer: boolean | undefined;
    await act(async () => {
      answer = await runWithLinkCheck(ctx, activeTableTarget(harness.store)!, planMerge);
    });
    expect(answer).toBe(false);
    expect(dialogs.shown).toHaveLength(1);
    expect(dialogs.shown[0]!.testId).toBe('dialog-table-link-targets');
    expect(dialogs.shown[0]!.text).toBe(harness.ctx.t('tables.msg.linkTargets', { count: 1 }));
    expect(harness.controller.editorState!.doc).toBe(doc);
    expect(harness.store.getState().document).toBe(document);
    expect(harness.services.undo.entries().length).toBe(entries);
  });

  it('Yes merges as one undo-coordinator entry and leaves the link dangling', async () => {
    const harness = await tablesHarness(linkedBook());
    const dialogs = fakeDialogs(['yes']);
    const ctx = { ...harness.ctx, dialogs };
    selectBlock(harness, 't1-0-0', 't1-1-1');
    const entries = harness.services.undo.entries().length;
    let answer: boolean | undefined;
    await act(async () => {
      answer = await runWithLinkCheck(ctx, activeTableTarget(harness.store)!, planMerge);
    });
    expect(answer).toBe(true);
    expect(dialogs.shown).toHaveLength(1);
    expect(harness.services.undo.entries().length).toBe(entries + 1);
    const keeper = harness.controller.editorState!.doc.nodeAt(posOf(harness, 't1-0-0'))!;
    expect(keeper.attrs.colspan).toBe(2);
    expect(keeper.attrs.rowspan).toBe(2);
    expect(keeper.textContent).toBe('r0c0 r0c1 r1c0 r1c1');
    expect(storeCell(harness, 't1-0-1')).toBeUndefined();
    const document = harness.store.getState().document!;
    expect(collectBookIds(document).has('us5-target')).toBe(false);
    expect(countLinksTo(document, ['us5-target'])).toBe(1);
  });

  it('Yes makes the plan again on the state as it is at the answer', async () => {
    const harness = await tablesHarness(linkedBook());
    const dialogs = deferredDialogs();
    const ctx = { ...harness.ctx, dialogs };
    selectBlock(harness, 't1-0-0', 't1-1-1');
    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = runWithLinkCheck(ctx, activeTableTarget(harness.store)!, planMerge);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(dialogs.shown).toHaveLength(1);
    // Meanwhile the book changes before the table: a character put into p1 (a step of its own).
    act(() => {
      const state = harness.controller.editorState!;
      harness.controller.apply(state.tr.insertText('!', posOf(harness, 'p1') + 1));
    });
    expect(harness.controller.editorState!.selection).toBeInstanceOf(CellBlockSelection);
    let answer: boolean | undefined;
    await act(async () => {
      dialogs.answer('yes');
      answer = await pending;
    });
    expect(answer).toBe(true);
    const state = harness.controller.editorState!;
    expect(state.doc.nodeAt(posOf(harness, 'p1'))!.textContent).toBe('!Before');
    const keeper = state.doc.nodeAt(posOf(harness, 't1-0-0'))!;
    expect(keeper.attrs.colspan).toBe(2);
    expect(keeper.attrs.rowspan).toBe(2);
    expect(keeper.textContent).toBe('r0c0 r0c1 r1c0 r1c1');
    // The caret at the start of the merged cell.
    expect(state.selection.empty).toBe(true);
    expect(state.selection.$head.parent).toBe(keeper);
    expect(state.selection.$head.parentOffset).toBe(0);
  });

  it('a merge without a linked id asks nothing; a refusal asks nothing and dispatches nothing', async () => {
    const harness = await tablesHarness(linkedBook());
    const dialogs = fakeDialogs();
    const ctx = { ...harness.ctx, dialogs };
    const entries = harness.services.undo.entries().length;
    selectBlock(harness, 't1-1-1', 't1-2-2');
    let answer: boolean | undefined;
    await act(async () => {
      answer = await runWithLinkCheck(ctx, activeTableTarget(harness.store)!, planMerge);
    });
    expect(answer).toBe(true);
    expect(dialogs.shown).toEqual([]);
    expect(harness.services.undo.entries().length).toBe(entries + 1);
    // A caret: needs-block - no question, no dispatch, no entry.
    act(() => caretIn(harness, 't1-0-1', 1));
    const doc = harness.controller.editorState!.doc;
    await act(async () => {
      answer = await runWithLinkCheck(ctx, activeTableTarget(harness.store)!, planMerge);
    });
    expect(answer).toBe(false);
    expect(dialogs.shown).toEqual([]);
    expect(harness.controller.editorState!.doc).toBe(doc);
    expect(harness.services.undo.entries().length).toBe(entries + 1);
  });

  it('C13: Delete row over the linked cell never asks', async () => {
    const harness = await tablesHarness(linkedBook());
    const dialogs = fakeDialogs();
    const ctx = { ...harness.ctx, dialogs };
    act(() => caretIn(harness, 't1-0-1', 1));
    await act(async () => {
      expect(await harness.services.commands.execute('table.deleteRow', ctx)).toBe(true);
    });
    expect(dialogs.shown).toEqual([]);
    expect(storeCell(harness, 't1-0-1')).toBeUndefined();
    expect(countLinksTo(harness.store.getState().document!, ['us5-target'])).toBe(1);
  });

  it('table.mergeCells through the registry awaits the question, then merges on Yes', async () => {
    const harness = await tablesHarness(linkedBook());
    const dialogs = deferredDialogs();
    const ctx = { ...harness.ctx, dialogs };
    selectBlock(harness, 't1-0-0', 't1-1-1');
    const entries = harness.services.undo.entries().length;
    let settled = false;
    let done: Promise<boolean> | undefined;
    act(() => {
      done = harness.services.commands.execute('table.mergeCells', ctx).then((ran) => {
        settled = true;
        return ran;
      });
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(dialogs.shown).toHaveLength(1);
    expect(settled).toBe(false);
    expect(harness.services.undo.entries().length).toBe(entries);
    let ran: boolean | undefined;
    await act(async () => {
      dialogs.answer('yes');
      ran = await done;
    });
    expect(ran).toBe(true);
    expect(settled).toBe(true);
    expect(harness.services.undo.entries().length).toBe(entries + 1);
    const keeper = harness.controller.editorState!.doc.nodeAt(posOf(harness, 't1-0-0'))!;
    expect(keeper.attrs.colspan).toBe(2);
    expect(keeper.attrs.rowspan).toBe(2);
  });
});
