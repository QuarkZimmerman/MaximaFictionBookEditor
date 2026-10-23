/**
 * Feature 005 T026 (research R4.2-R4.3; data-model §4.1, §6.4-§6.6) - the run session shared
 * by script runs and AI requests: it takes the run lock with the holder's kind, label and
 * phase and is the store's one active session; it ticks the elapsed time; `commit(after)`
 * shows the result and records exactly one undo entry (undo and redo exact), `commit(null)`
 * publishes nothing; `discard()` restores the document before the run and its `modified` flag;
 * a document replaced from outside is reported to the owner and left alone (`lost`); Cancel
 * reaches the owner once through `cancel()` / `cancelActiveRun`.
 */

import { createAppServices } from '@/app/services';
import type { Document } from '@/model/document';
import { actions, createAppStore, type AppStore } from '@/model/store';
import {
  activeRunSession,
  cancelActiveRun,
  RunSession,
  startRunSession,
  type RunSessionOptions,
} from '@/scripting/runSession';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitUntil(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The fixture document with its one paragraph reading `text`. */
function documentWith(text: string, overrides: Partial<Document> = {}): Document {
  const base = fakeDocument(overrides);
  return {
    ...base,
    bodies: [
      {
        ...base.bodies[0]!,
        content: [
          {
            type: 'section',
            attrs: { nodeId: 'n2' },
            content: [{ type: 'p', attrs: { nodeId: 'n3' }, content: [{ type: 'text', text }] }],
          },
        ],
      },
    ] as Document['bodies'],
  };
}

function paragraph(store: AppStore): string {
  const section = store.getState().document!.bodies[0]!.content[0] as {
    content: { content?: { text?: string }[] }[];
  };
  return section.content[0]!.content?.[0]?.text ?? '';
}

function harness(options: { controller?: boolean; tickMs?: number } = {}) {
  const store = createAppStore();
  const rpc = fakeRpc({});
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  actions.setDocument(store, documentWith('Hello'));
  const deps = {
    store,
    undo: services.undo,
    getController: () => (options.controller ? getBodyController(store) : null),
    tickMs: options.tickMs,
  };
  const start = (overrides: Partial<RunSessionOptions> = {}) =>
    startRunSession(deps, { kind: 'ai', label: 'Service · model', ...overrides });
  return { store, services, deps, start };
}

describe('RunSession', () => {
  it("takes the run lock with kind, label and phase, is the store's one session, and refuses a second", () => {
    const { store, start } = harness();
    expect(activeRunSession(store)).toBeNull();
    const before = store.getState().document!;
    const session = start({ phase: 'preparing' })!;
    expect(session).toBeInstanceOf(RunSession);
    expect(activeRunSession(store)).toBe(session);
    expect(session.before).toBe(before);
    expect(session.modifiedBefore).toBe(false);
    expect(session.own).toBe(true);
    expect(session.ended).toBe(false);
    expect(session.outcome).toBeNull();
    expect(store.getState().runLock).toEqual({
      kind: 'ai',
      label: 'Service · model',
      startedAt: session.startedAt,
      phase: 'preparing',
    });

    // One session at a time: a script run cannot start while the request holds the lock.
    expect(startRunSession(harness().deps, { kind: 'script', label: 'x' })).not.toBeNull();
    expect(start()).toBeNull();
    expect(
      startRunSession({ ...harness().deps, store }, { kind: 'script', label: 'x' }),
    ).toBeNull();

    // The phase changes through a new lock object; the start time stays.
    const lockBefore = store.getState().runLock;
    session.setPhase('waiting for the answer');
    expect(store.getState().runLock).not.toBe(lockBefore);
    expect(store.getState().runLock).toEqual({ ...lockBefore, phase: 'waiting for the answer' });
    expect(session.phase).toBe('waiting for the answer');
    session.setPhase(undefined);
    expect(store.getState().runLock).toEqual({
      kind: 'ai',
      label: 'Service · model',
      startedAt: session.startedAt,
    });

    expect(session.commit(null)).toBe('unchanged');
    expect(store.getState().runLock).toBeNull();
    expect(activeRunSession(store)).toBeNull();
    expect(session.lock).toBeNull();
    // Ended: the phase no longer reaches the store, a second end keeps the first outcome.
    session.setPhase('late');
    expect(store.getState().runLock).toBeNull();
    expect(session.discard()).toBe('unchanged');
    // The lock is free again.
    expect(start()).not.toBeNull();
  });

  it('needs a document', () => {
    const { store, start } = harness();
    actions.closeDocument(store);
    expect(start()).toBeNull();
    expect(store.getState().runLock).toBeNull();
  });

  it('ticks the elapsed time while running and stops at the end', async () => {
    const ticks: number[] = [];
    const { start } = harness({ tickMs: 10 });
    let notified = 0;
    const session = start({ onTick: (ms) => ticks.push(ms) })!;
    session.subscribe(() => {
      notified += 1;
    });
    expect(session.elapsedMs).toBe(0);
    await waitUntil(() => ticks.length >= 2, 'two ticks');
    expect(session.elapsedMs).toBeGreaterThan(0);
    expect(ticks[1]!).toBeGreaterThanOrEqual(ticks[0]!);
    expect(notified).toBeGreaterThanOrEqual(2);
    session.discard();
    const atEnd = ticks.length;
    const notifiedAtEnd = notified;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(ticks.length).toBe(atEnd);
    expect(notified).toBe(notifiedAtEnd);
    expect(session.elapsedMs).toBeGreaterThan(0);
  });

  it('commit(after) shows the result as one undo entry; undo and redo are exact', () => {
    const { store, services, start } = harness();
    const before = store.getState().document!;
    const session = start({ label: 'Service · model', undoLabel: 'Make it shorter' })!;
    const after = documentWith('Changed');
    expect(session.commit(after)).toBe('committed');
    expect(session.outcome).toBe('committed');
    expect(store.getState().document).toBe(after);
    expect(store.getState().modified).toBe(true);
    expect(store.getState().runLock).toBeNull();
    expect(services.undo.undoDepth).toBe(1);
    expect(services.undo.peekUndo()?.label).toBe('Make it shorter');
    services.undo.undo();
    expect(store.getState().document).toBe(before);
    expect(paragraph(store)).toBe('Hello');
    services.undo.redo();
    expect(store.getState().document).toBe(after);
    expect(paragraph(store)).toBe('Changed');
  });

  it('commit(after) goes through the Body controller when there is one', () => {
    const { store, services, start } = harness({ controller: true });
    const controller = getBodyController(store);
    const session = start()!;
    session.commit(documentWith('Changed'));
    expect(paragraph(store)).toBe('Changed');
    expect(controller.editorState!.doc.textContent).toContain('Changed');
    services.undo.undo();
    expect(controller.editorState!.doc.textContent).toContain('Hello');
    expect(services.undo.peekRedo()?.label).toBe('Service · model');
  });

  it('commit(null) publishes nothing: no undo entry, `modified` untouched', () => {
    const { store, services, start } = harness();
    const before = store.getState().document!;
    const session = start()!;
    expect(session.commit(null)).toBe('unchanged');
    expect(store.getState().document).toBe(before);
    expect(store.getState().modified).toBe(false);
    expect(services.undo.canUndo).toBe(false);
    expect(store.getState().runLock).toBeNull();
  });

  it('discard() restores the document before the run and its `modified` flag', () => {
    const { store, services, start } = harness();
    const before = store.getState().document!;
    const session = start()!;
    // An intermediate state shown meanwhile (a script's dialog) marked the document modified.
    actions.updateDocument(store, documentWith('Intermediate'));
    expect(store.getState().modified).toBe(true);
    expect(session.discard()).toBe('discarded');
    expect(store.getState().document).toBe(before);
    expect(store.getState().modified).toBe(false);
    expect(services.undo.canUndo).toBe(false);
    expect(store.getState().runLock).toBeNull();

    // Nothing shown: nothing to restore, the store is left alone.
    actions.setModified(store, true);
    const clean = start()!;
    expect(clean.discard()).toBe('discarded');
    expect(store.getState().document).toBe(before);
    expect(store.getState().modified).toBe(true);
  });

  it('reports a document replaced from outside and leaves the new one alone', async () => {
    const { store, services, start } = harness();
    const replaced = vi.fn();
    const session = start({ onDocumentReplaced: replaced })!;
    const other = documentWith('Other book', { docId: 'doc-2' });
    actions.setDocument(store, other);
    expect(replaced).not.toHaveBeenCalled(); // reported after the store's own notification
    await tick();
    expect(replaced).toHaveBeenCalledTimes(1);
    expect(session.own).toBe(false);
    expect(session.commit(documentWith('Result'))).toBe('lost');
    expect(store.getState().document).toBe(other);
    expect(services.undo.canUndo).toBe(false);
    expect(store.getState().runLock).toBeNull();

    const another = start()!;
    actions.closeDocument(store);
    await tick();
    expect(another.own).toBe(false);
    expect(another.discard()).toBe('lost');
    expect(store.getState().document).toBeNull();
  });

  it("cancel() reaches the owner once; cancelActiveRun() is the banner's way to it", () => {
    const { store, start } = harness();
    const onCancel = vi.fn();
    const session = start({ onCancel })!;
    expect(session.cancelRequested).toBe(false);
    cancelActiveRun(store);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(session.cancelRequested).toBe(true);
    // The owner is asked once; the session still runs until the owner discards it.
    session.cancel();
    cancelActiveRun(store);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(session.ended).toBe(false);
    expect(store.getState().runLock).not.toBeNull();
    session.discard();
    expect(store.getState().runLock).toBeNull();
    // Nothing to cancel afterwards.
    cancelActiveRun(store);
    session.cancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
