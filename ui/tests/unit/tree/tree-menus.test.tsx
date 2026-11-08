// Feature 011 (US2 scenarios 6, 8; contracts/tree.md §4): the menus of the new rows.
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ModelNodeJson } from '@/editor/fromModel';
import { deleteNode } from '@/features/treeOps';
import { changeLanguage, initI18n } from '@/i18n';
import type { BodyNode, Document } from '@/model/document';
import { treeMenuFor, type TreeMenuItem } from '@/views/tree/treeMenuModel';
import { buildTreeIndex } from '@/views/tree/treeModel';

import { fakeDocument } from '../features/testUtils';

const text = (value: string): ModelNodeJson => ({ type: 'text', text: value });
const stanza = (nodeId: string): ModelNodeJson => ({
  type: 'stanza',
  attrs: { nodeId },
  content: [{ type: 'v', attrs: { nodeId: `${nodeId}v` }, content: [text('line')] }],
});

function book(): Document {
  const body: ModelNodeJson = {
    type: 'body',
    attrs: { nodeId: 'b' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 'S' },
        content: [
          { type: 'subtitle', attrs: { nodeId: 'sub' }, content: [text('* * *')] },
          { type: 'poem', attrs: { nodeId: 'one' }, content: [stanza('only')] },
          { type: 'poem', attrs: { nodeId: 'two' }, content: [stanza('st1'), stanza('st2')] },
          {
            type: 'p',
            attrs: { nodeId: 'pp' },
            content: [
              text('a '),
              { type: 'inline-image', attrs: { nodeId: 'pic', href: '#k.png' } },
            ],
          },
          {
            type: 'table',
            attrs: { nodeId: 'T' },
            content: [
              {
                type: 'tr',
                attrs: { nodeId: 'r' },
                content: [{ type: 'td', attrs: { nodeId: 'cell' }, content: [text('x')] }],
              },
            ],
          },
        ],
      },
    ],
  };
  return fakeDocument({ bodies: [body as unknown as BodyNode] });
}

const ids = (lines: ReturnType<typeof treeMenuFor>) =>
  lines.filter((line): line is TreeMenuItem => line !== 'separator').map((line) => line.id);

describe('the menus of the subtitle, stanza, cell and inline picture rows (feature 011)', () => {
  beforeAll(async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
  });
  const captions = { annotation: 'Annotation', history: 'History' };

  it('a subtitle row: Go To, Go To Source, Delete Subtitle', () => {
    const index = buildTreeIndex(book(), captions);
    const menu = treeMenuFor(index, 'sub', i18next.t);
    expect(ids(menu)).toEqual(['view', 'viewSource', 'delete']);
    const del = menu.find((line) => line !== 'separator' && line.id === 'delete') as TreeMenuItem;
    expect(del.label).toBe('&Delete Subtitle');
  });

  it('a stanza row: Delete Stanza, greyed with its reason on a poem’s only stanza', () => {
    const index = buildTreeIndex(book(), captions);
    const menu = treeMenuFor(index, 'only', i18next.t);
    const del = menu.find((line) => line !== 'separator' && line.id === 'delete') as TreeMenuItem;
    expect(del.label).toBe('&Delete Stanza');
    expect(del.reason).toBe('A poem keeps at least one stanza: this is its only one.');
    expect(deleteNode(book(), 'only')).toMatchObject({ ok: false, reason: 'onlyStanza' });
    const removed = deleteNode(book(), 'st1');
    expect(removed.ok).toBe(true);
  });

  it('a cell row: Go To and Go To Source only', () => {
    const index = buildTreeIndex(book(), captions);
    expect(ids(treeMenuFor(index, 'cell', i18next.t))).toEqual(['view', 'viewSource']);
  });

  it('an inline picture row: the picture’s entries and Delete Picture', () => {
    const index = buildTreeIndex(book(), captions);
    expect(ids(treeMenuFor(index, 'pic', i18next.t))).toEqual([
      'view',
      'viewSource',
      'changePicture',
      'showPicture',
      'saveImage',
      'delete',
    ]);
    const removed = deleteNode(book(), 'pic');
    expect(removed.ok).toBe(true);
  });
});
