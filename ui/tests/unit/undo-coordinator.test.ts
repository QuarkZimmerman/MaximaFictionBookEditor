import type { AnnotationNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { ArrayHistoryAdapter, UndoCoordinator, type UndoView } from '@/model/undo';
import { DescriptionController, DESCRIPTION_UNDO_VIEW } from '@/views/description/binding';

import { fakeDocument } from './features/testUtils';

/** A view whose history replays changes into a log and reports steps to the coordinator. */
function makeView(coordinator: UndoCoordinator, view: UndoView, log: string[]) {
  const adapter = new ArrayHistoryAdapter<string>((change, direction) => {
    log.push(`${direction}:${view}:${change}`);
  });
  coordinator.registerView(view, adapter);
  return {
    adapter,
    edit(change: string, label = change) {
      // The real editors apply the change to their own document first, then the history
      // plugin pushes a step, then the coordinator is told about it.
      adapter.push(change);
      coordinator.record(view, label);
    },
  };
}

describe('UndoCoordinator', () => {
  it('undoes and redoes single entries in reverse chronological order across views', () => {
    const activated: UndoView[] = [];
    const log: string[] = [];
    const undo = new UndoCoordinator({ activateView: (view) => activated.push(view) });
    const body = makeView(undo, 'body', log);
    const desc = makeView(undo, 'description', log);

    undo.boundary('body');
    body.edit('b1');
    undo.boundary('description');
    desc.edit('d1');
    undo.boundary('body');
    body.edit('b2');

    expect(undo.canUndo).toBe(true);
    expect(undo.canRedo).toBe(false);
    expect(undo.peekUndo()).toEqual({ view: 'body', label: 'b2', groupId: 0 });

    expect(undo.undo()).toBe(true);
    expect(log).toEqual(['undo:body:b2']);
    expect(activated).toEqual([]); // already the active view

    expect(undo.undo()).toBe(true);
    expect(log.at(-1)).toBe('undo:description:d1');
    expect(activated).toEqual(['description']); // owning view activated

    expect(undo.undo()).toBe(true);
    expect(log.at(-1)).toBe('undo:body:b1');
    expect(activated).toEqual(['description', 'body']);
    expect(undo.canUndo).toBe(false);
    expect(undo.undo()).toBe(false);

    expect(undo.redo()).toBe(true);
    expect(log.at(-1)).toBe('redo:body:b1');
    expect(undo.redo()).toBe(true);
    expect(log.at(-1)).toBe('redo:description:d1');
    expect(undo.redo()).toBe(true);
    expect(log.at(-1)).toBe('redo:body:b2');
    expect(undo.canRedo).toBe(false);
    expect(undo.redo()).toBe(false);
    expect(activated).toEqual(['description', 'body', 'description', 'body']);
  });

  it('makes a batch group one undo entry, even across views', () => {
    const log: string[] = [];
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', log);
    const desc = makeView(undo, 'description', log);

    body.edit('before');
    const groupId = undo.beginGroup('Replace All');
    expect(undo.isGrouping).toBe(true);
    body.edit('r1');
    body.edit('r2');
    desc.edit('r3');
    expect(undo.endGroup()).toBe(true);
    expect(undo.isGrouping).toBe(false);
    body.edit('after');

    expect(undo.entries().map((e) => e.groupId)).toEqual([0, groupId, groupId, groupId, 0]);
    expect(undo.entries().map((e) => e.label)).toEqual([
      'before',
      'Replace All',
      'Replace All',
      'Replace All',
      'after',
    ]);

    undo.undo(); // "after"
    log.length = 0;
    expect(undo.undo()).toBe(true); // the whole group
    expect(log).toEqual(['undo:description:r3', 'undo:body:r2', 'undo:body:r1']);
    expect(undo.peekUndo()?.label).toBe('before');

    log.length = 0;
    expect(undo.redo()).toBe(true); // the whole group, in original order
    expect(log).toEqual(['redo:body:r1', 'redo:body:r2', 'redo:description:r3']);
    expect(undo.peekRedo()?.label).toBe('after');
    expect(undo.undoDepth).toBe(4);
  });

  it('supports nested groups (outermost wins) and the group() helper', async () => {
    const log: string[] = [];
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', log);

    await undo.group('Script run', async () => {
      body.edit('s1');
      await undo.group('inner', () => {
        body.edit('s2');
      });
      body.edit('s3');
    });
    expect(undo.isGrouping).toBe(false);
    expect(undo.undoDepth).toBe(3);
    expect(new Set(undo.entries().map((e) => e.groupId)).size).toBe(1);
    expect(undo.entries().every((e) => e.label === 'Script run')).toBe(true);
    expect(undo.undo()).toBe(true);
    expect(log).toEqual(['undo:body:s3', 'undo:body:s2', 'undo:body:s1']);
  });

  it('closes the group when the function throws', async () => {
    const undo = new UndoCoordinator();
    makeView(undo, 'body', []);
    await expect(
      undo.group('failing', () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(undo.isGrouping).toBe(false);
  });

  it('rolls back an open group (cancelled script) without leaving redo entries', () => {
    const log: string[] = [];
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', log);
    body.edit('keep');
    undo.beginGroup('Script');
    body.edit('x1');
    body.edit('x2');
    expect(undo.rollbackGroup()).toBe(2);
    expect(log).toEqual(['undo:body:x2', 'undo:body:x1']);
    expect(undo.isGrouping).toBe(false);
    expect(undo.canRedo).toBe(false);
    expect(undo.entries().map((e) => e.label)).toEqual(['keep']);
    expect(undo.rollbackGroup()).toBe(0);
  });

  it('a view switch commits a boundary that closes an open group', () => {
    const log: string[] = [];
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', log);
    const source = makeView(undo, 'source', log);
    undo.beginGroup('batch');
    body.edit('g1');
    undo.boundary('source'); // user switched views in the middle
    expect(undo.isGrouping).toBe(false);
    expect(undo.currentView).toBe('source');
    source.edit('s1');
    expect(undo.entries().map((e) => e.groupId !== 0)).toEqual([true, false]);
    expect(undo.undo()).toBe(true);
    expect(log).toEqual(['undo:source:s1']);
    expect(undo.undo()).toBe(true);
    expect(log.at(-1)).toBe('undo:body:g1');
  });

  it('a new change clears the redo stack', () => {
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', []);
    body.edit('a');
    body.edit('b');
    undo.undo();
    expect(undo.canRedo).toBe(true);
    body.edit('c');
    expect(undo.canRedo).toBe(false);
    expect(undo.entries().map((e) => e.label)).toEqual(['a', 'c']);
  });

  it('ignores steps reported by adapters while replaying', () => {
    const undo = new UndoCoordinator();
    const adapter = {
      canUndo: true,
      canRedo: false,
      undo: () => {
        // A real history plugin fires a transaction while undoing; the editor glue would call
        // record() for it - the coordinator must ignore that.
        undo.record('body', 'phantom');
        return true;
      },
      redo: () => true,
    };
    undo.registerView('body', adapter);
    undo.record('body', 'real');
    expect(undo.isReplaying).toBe(false);
    expect(undo.undo()).toBe(true);
    expect(undo.undoDepth).toBe(0);
    expect(undo.redoDepth).toBe(1);
  });

  it('drops entries whose view cannot replay them', () => {
    const undo = new UndoCoordinator();
    const log: string[] = [];
    const body = makeView(undo, 'body', log);
    body.edit('a');
    undo.record('ghost', 'no adapter'); // a view that never registered
    expect(undo.undo()).toBe(false); // ghost entry dropped, nothing undone
    expect(undo.undoDepth).toBe(1);
    expect(undo.undo()).toBe(true);
    expect(log).toEqual(['undo:body:a']);
  });

  it('clear() and clearView() forget history and notify subscribers', () => {
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', []);
    const source = makeView(undo, 'source', []);
    const listener = vi.fn();
    undo.subscribe(listener);
    body.edit('a');
    source.edit('b');
    body.edit('c');
    undo.clearView('source');
    expect(undo.entries().map((e) => e.label)).toEqual(['a', 'c']);
    undo.clear();
    expect(undo.canUndo).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('respects the entry limit', () => {
    const undo = new UndoCoordinator({ limit: 3 });
    const body = makeView(undo, 'body', []);
    for (const label of ['1', '2', '3', '4']) body.edit(label);
    expect(undo.entries().map((e) => e.label)).toEqual(['2', '3', '4']);
  });

  it('unregistering a view removes its adapter', () => {
    const undo = new UndoCoordinator();
    const adapter = new ArrayHistoryAdapter<string>();
    const off = undo.registerView('body', adapter);
    expect(undo.hasView('body')).toBe(true);
    off();
    expect(undo.hasView('body')).toBe(false);
  });
});

describe('UndoCoordinator snapshot entries', () => {
  /** A change kept as "before" / "after" states of one value, like a script run. */
  function snapshot(state: { value: string }, before: string, after: string, log: string[]) {
    return {
      undo: () => {
        state.value = before;
        log.push(`undo:${after}`);
      },
      redo: () => {
        state.value = after;
        log.push(`redo:${after}`);
      },
    };
  }

  it('undoes and redoes a snapshot entry by itself, activating its view', () => {
    const activated: UndoView[] = [];
    const log: string[] = [];
    const undo = new UndoCoordinator({ activateView: (view) => activated.push(view) });
    const state = { value: 'A' };
    undo.boundary('description');
    state.value = 'B';
    undo.recordSnapshot('body', 'Run', snapshot(state, 'A', 'B', log));
    expect(undo.peekUndo()).toMatchObject({ view: 'body', label: 'Run', groupId: 0 });
    // No adapter is registered for the view: the entry needs none.
    expect(undo.undo()).toBe(true);
    expect(state.value).toBe('A');
    expect(activated).toEqual(['body']);
    expect(undo.redo()).toBe(true);
    expect(state.value).toBe('B');
    expect(log).toEqual(['undo:B', 'redo:B']);
  });

  it('keeps a snapshot entry when its view history is cleared, unless a later change is lost', () => {
    const log: string[] = [];
    const undo = new UndoCoordinator();
    const body = makeView(undo, 'body', log);
    const state = { value: 'A' };
    body.edit('typed before');
    undo.recordSnapshot('body', 'Run', snapshot(state, 'A', 'B', log));
    // The editor history is reset (the section window moved): the run stays undoable.
    undo.clearView('body');
    expect(undo.entries().map((e) => e.label)).toEqual(['Run']);
    // A change made after the run whose history is then lost: undoing the run would discard
    // it, so the run is no longer undoable.
    body.edit('typed after');
    undo.clearView('body');
    expect(undo.canUndo).toBe(false);
  });

  it('drops a snapshot entry below an entry that could not be undone or redone', () => {
    const log: string[] = [];
    const undo = new UndoCoordinator();
    const source = makeView(undo, 'source', log);
    const state = { value: 'A' };
    undo.recordSnapshot('body', 'Run', snapshot(state, 'A', 'B', log));
    source.edit('s1');
    // The Source history lost its step: the undo fails and the run below it is dropped too.
    source.adapter.undo();
    expect(undo.undo()).toBe(false);
    expect(undo.canUndo).toBe(false);
    expect(state.value).toBe('A');

    const redoState = { value: 'B' };
    const redo = new UndoCoordinator();
    const view = makeView(redo, 'source', log);
    view.edit('s0');
    redo.recordSnapshot('body', 'Run', snapshot(redoState, 'A', 'B', log));
    expect(redo.undo()).toBe(true);
    expect(redo.undo()).toBe(true);
    // The step before the run cannot be redone: redoing the run would bring it back.
    view.adapter.redo();
    expect(redo.redo()).toBe(false);
    expect(redo.canRedo).toBe(false);
    expect(redoState.value).toBe('A');
  });

  it('counts as one entry however large the change was', () => {
    const undo = new UndoCoordinator({ limit: 3 });
    const state = { value: 'A' };
    undo.recordSnapshot('body', 'Run', snapshot(state, 'A', 'B', []));
    expect(undo.undoDepth).toBe(1);
    expect(undo.canRedo).toBe(false);
  });
});

describe('ArrayHistoryAdapter', () => {
  it('tracks past and future', () => {
    const applied: string[] = [];
    const adapter = new ArrayHistoryAdapter<string>((c, d) => applied.push(`${d}:${c}`));
    expect(adapter.undo()).toBe(false);
    adapter.push('a');
    adapter.push('b');
    expect(adapter.canUndo).toBe(true);
    expect(adapter.undo()).toBe(true);
    expect(adapter.canRedo).toBe(true);
    adapter.push('c'); // truncates the future
    expect(adapter.canRedo).toBe(false);
    expect(adapter.depth).toBe(2);
    expect(applied).toEqual(['undo:b']);
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006, US10 (T157; I8; C2; data-model §6.3): a rich field's entries */
/* ------------------------------------------------------------------------ */

describe('a rich field of the Description view on the coordinator (feature 006, US10)', () => {
  const KEY = 'titleInfo.annotation';

  /** The annotation the field writes: a paragraph `text`, and a table after it when `rows`. */
  function annotation(text: string, rows = 0): AnnotationNode {
    const table = {
      type: 'table',
      attrs: { nodeId: 't1' },
      content: Array.from({ length: rows }, (_, row) => ({
        type: 'tr',
        attrs: { nodeId: `t1-r${row}` },
        content: [{ type: 'td', attrs: { nodeId: `t1-${row}` }, content: [] }],
      })),
    };
    return {
      type: 'annotation',
      attrs: { nodeId: 'a1' },
      content: [
        { type: 'p', attrs: { nodeId: 'a2' }, content: [{ type: 'text', text }] },
        ...(rows > 0 ? [table] : []),
      ],
    } as unknown as AnnotationNode;
  }

  it('typing, a table command and typing again within the burst time are three description entries; one Undo per entry restores the form before it, Redo reapplies it', () => {
    const store = createAppStore();
    const undo = new UndoCoordinator();
    const document = fakeDocument();
    actions.setDocument(store, {
      ...document,
      description: {
        ...document.description,
        titleInfo: { ...document.description.titleInfo, annotation: annotation('') },
      },
    });
    let now = 1000;
    const controller = new DescriptionController({ store, undo, now: () => now });
    undo.registerView(DESCRIPTION_UNDO_VIEW, controller.undoAdapter);
    const start = controller.currentForm;

    // Typing: a burst of coalesced changes, one entry.
    controller.setValue(KEY, annotation('W'), { coalesce: true });
    now += 100;
    controller.setValue(KEY, annotation('Wo'), { coalesce: true });
    const typed = controller.currentForm;
    expect(undo.undoDepth).toBe(1);
    // The command (DISCRETE_STEP): setValue without coalesce, an entry of its own that closes
    // the burst.
    now += 100;
    controller.setValue(KEY, annotation('Wo', 1));
    const commanded = controller.currentForm;
    expect(undo.undoDepth).toBe(2);
    // Typing again, well within the burst time: a new entry all the same.
    now += 100;
    controller.setValue(KEY, annotation('Wor', 1), { coalesce: true });
    now += 100;
    controller.setValue(KEY, annotation('Word', 1), { coalesce: true });
    const retyped = controller.currentForm;
    expect(undo.undoDepth).toBe(3);
    expect(undo.peekUndo()?.view).toBe(DESCRIPTION_UNDO_VIEW);

    expect(undo.undo()).toBe(true);
    expect(controller.currentForm).toBe(commanded);
    expect(undo.undo()).toBe(true);
    expect(controller.currentForm).toBe(typed);
    expect(undo.undo()).toBe(true);
    expect(controller.currentForm).toBe(start);
    expect(store.getState().document!.description.titleInfo.annotation).toEqual(annotation(''));
    expect(undo.canUndo).toBe(false);

    expect(undo.redo()).toBe(true);
    expect(controller.currentForm).toBe(typed);
    expect(undo.redo()).toBe(true);
    expect(controller.currentForm).toBe(commanded);
    expect(undo.redo()).toBe(true);
    expect(controller.currentForm).toBe(retyped);
    expect(store.getState().document!.description.titleInfo.annotation).toEqual(
      annotation('Word', 1),
    );
  });
});
