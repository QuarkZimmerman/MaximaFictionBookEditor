/**
 * Feature 009, User Story 3 (T047): the way back to the very link a jump started from
 * (FR-036, data-model §7). A jump from a link - Ctrl+click or *Go to footnote or reference* -
 * remembers the link; while the caret stays in the target, the command returns there; leaving
 * the target or loading another document forgets it.
 */
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

import type { CommandContext } from '@/app/commands';
import { createAppServices } from '@/app/services';
import { followLink } from '@/features/footnotes';
import { initI18n } from '@/i18n';
import type { BodyNode, Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDialogs, fakeDocument, fakeRpc } from './testUtils';

const NOTE = [{ type: 'link', attrs: { href: '#n_1', type: 'note' } }];

function paragraph(nodeId: string, content: unknown[]) {
  return { type: 'p', attrs: { nodeId }, content } as SectionNode['content'][number];
}

function book(): Document {
  const main: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 's1' },
        content: [
          paragraph('p1', [
            { type: 'text', text: 'First ' },
            { type: 'text', text: '[1]', marks: NOTE },
          ] as never),
          paragraph('p2', [
            { type: 'text', text: 'Second ' },
            { type: 'text', text: '[1]', marks: NOTE },
          ] as never),
          paragraph('p3', [{ type: 'text', text: 'Elsewhere.' }] as never),
        ],
      },
    ] as BodyNode['content'],
  };
  const notes: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b2', name: 'notes' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 'ns1', id: 'n_1' },
        content: [paragraph('np1', [{ type: 'text', text: 'The note.' }] as never)],
      },
    ] as BodyNode['content'],
  };
  return { ...fakeDocument(), bodies: [main, notes] };
}

async function harness() {
  const i18n = await initI18n({ instance: createInstance(), react: false, language: 'en' });
  const store = createAppStore();
  const rpc = fakeRpc({});
  const services = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const ctx: CommandContext = {
    store,
    rpc: rpc.client,
    undo: services.undo,
    dialogs: fakeDialogs(),
    hotkeys: services.hotkeys,
    carets: services.carets,
    t: i18n.t,
    version: 'test',
  };
  actions.setConnection(store, 'connected');
  actions.setDocument(store, book());
  const controller = getBodyController(store);
  const goto = () => services.commands.execute('edit.gotoFootnote', ctx);
  return { store, ctx, controller, goto };
}

describe('the way back to the link of a jump (FR-036)', () => {
  it('returns to the second of two references, not the first', async () => {
    const h = await harness();
    expect(h.controller.setCaret({ view: 'body', nodeId: 'p2', offset: 8 })).toBe(true);
    await h.goto();
    expect(h.controller.getCaret()?.nodeId).toBe('np1');
    await h.goto();
    expect(h.controller.getCaret()).toMatchObject({ nodeId: 'p2', offset: 8 });
    expect(h.controller.jumpOrigin).toBeNull();
  });

  it('a Ctrl+click jump is remembered the same way', async () => {
    const h = await harness();
    const state = h.controller.editorState!;
    let pos = -1;
    state.doc.descendants((node, at) => {
      if (pos < 0 && node.attrs.nodeId === 'p2') pos = at + 1 + 'Second '.length + 1;
    });
    await followLink(h.ctx, h.controller, '#n_1', pos);
    expect(h.controller.getCaret()?.nodeId).toBe('np1');
    await h.goto();
    expect(h.controller.getCaret()?.nodeId).toBe('p2');
  });

  it('leaving the target forgets the link: the first reference is found as before', async () => {
    const h = await harness();
    h.controller.setCaret({ view: 'body', nodeId: 'p2', offset: 8 });
    await h.goto();
    h.controller.setCaret({ view: 'body', nodeId: 'p3', offset: 0 });
    expect(h.controller.jumpOrigin).toBeNull();
    h.controller.setCaret({ view: 'body', nodeId: 'np1', offset: 0 });
    await h.goto();
    expect(h.controller.getCaret()?.nodeId).toBe('p1');
  });

  it('loading another document forgets it', async () => {
    const h = await harness();
    h.controller.setCaret({ view: 'body', nodeId: 'p2', offset: 8 });
    await h.goto();
    expect(h.controller.jumpOrigin).not.toBeNull();
    actions.setDocument(h.store, { ...book(), docId: 'other' });
    expect(h.controller.jumpOrigin).toBeNull();
  });
});

describe('jumps during a script run (User Story 3, scenario 12)', () => {
  it('Ctrl+click and the way back move only the caret, so they work under the run lock', async () => {
    const h = await harness();
    actions.setRunLock(h.store, { kind: 'script', label: 'runs.longSilent' } as never);
    const state = h.controller.editorState!;
    let pos = -1;
    state.doc.descendants((node, at) => {
      if (pos < 0 && node.attrs.nodeId === 'p2') pos = at + 1 + 'Second '.length + 1;
    });
    await followLink(h.ctx, h.controller, '#n_1', pos);
    expect(h.controller.getCaret()?.nodeId).toBe('np1');
    await h.goto();
    expect(h.controller.getCaret()?.nodeId).toBe('p2');
  });
});
