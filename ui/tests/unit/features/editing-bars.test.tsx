/**
 * Links bar / Table bar (T062) and Body view chrome (T057/T067): the bars follow the Body
 * selection and write attributes back; the Body view is editable, shows the context menu with
 * Cut / Copy / Paste / Select entries and publishes the selected text. Feature 006 (US3, T081,
 * FR-029): the Links bar's Alt text edits a selected picture's `alt`, inline or block, in a
 * cell or elsewhere. Feature 006 (US8, T125; FR-036, FR-043, FR-045; C13; U17; data-model §4.7,
 * §10.1): the Table bar's colspan and rowspan merge and split through the span plan, refuse a
 * span past the edge, a value that is no whole number and a growth a merged cell above or to the
 * left reaches, ask before a linked cell goes, and are disabled on a table too large to edit.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { undoDepth } from 'prosemirror-history';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';

import { App } from '@/app/App';
import { LinksBar } from '@/app/LinksBar';
import { TableBar } from '@/app/TableBar';
import { AppProvider } from '@/app/AppContext';
import { createAppServices, type AppServices } from '@/app/services';
import { insertTableCommand } from '@/editor/commands/tableInsertion';
import { findNodeById } from '@/editor/schema';
import { createTable } from '@/editor/table/ops';
import { CellBlockSelection } from '@/editor/table/selection';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { getBodyController, type BodyEditorController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc, fakeRunLock } from './testUtils';

beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  document.elementFromPoint = () => null;
});

function bookWithLink(): Document {
  const base = fakeDocument();
  const section: SectionNode = {
    type: 'section',
    attrs: { nodeId: 's1', id: 'chapter-1' },
    content: [
      {
        type: 'p',
        attrs: { nodeId: 'p1', id: 'para-1' },
        content: [
          { type: 'text', text: 'See ' },
          {
            type: 'text',
            text: 'the site',
            marks: [{ type: 'link', attrs: { href: 'http://a.example/' } }],
          },
          { type: 'text', text: ' now.' },
        ],
      },
      { type: 'image', attrs: { nodeId: 'img1', href: '#pic.jpg', title: 'A picture' } },
    ] as SectionNode['content'],
  };
  return { ...base, bodies: [{ type: 'body', attrs: { nodeId: 'b1' }, content: [section] }] };
}

/** A paragraph with an inline picture, a block picture and a table with a picture in a cell. */
function bookWithPictures(): Document {
  const base = fakeDocument();
  const section = {
    type: 'section',
    attrs: { nodeId: 's1' },
    content: [
      {
        type: 'p',
        attrs: { nodeId: 'p1' },
        content: [
          { type: 'text', text: 'A picture ' },
          { type: 'inline-image', attrs: { nodeId: 'inline1', href: '#pic.jpg' } },
        ],
      },
      { type: 'image', attrs: { nodeId: 'block1', href: '#pic.jpg', alt: 'A block picture' } },
      {
        type: 'table',
        attrs: { nodeId: 't1' },
        content: [
          {
            type: 'tr',
            attrs: { nodeId: 'r1' },
            content: [
              {
                type: 'td',
                attrs: { nodeId: 'c1' },
                content: [
                  { type: 'text', text: 'In a cell ' },
                  {
                    type: 'inline-image',
                    attrs: { nodeId: 'cell1', href: '#pic.jpg', alt: 'A cell picture' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  } as unknown as SectionNode;
  return { ...base, bodies: [{ type: 'body', attrs: { nodeId: 'b1' }, content: [section] }] };
}

/** The model's attributes of the node `nodeId` of the first section. */
function modelAttrs(document: Document, nodeId: string): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const visit = (node: { attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.attrs?.nodeId === nodeId) found = node.attrs;
    for (const child of node.content ?? []) visit(child as typeof node);
  };
  visit(document.bodies[0]! as unknown as { content?: unknown[] });
  return found;
}

/** A model cell holding `text`. */
function modelCell(nodeId: string, text: string, attrs: Record<string, unknown> = {}) {
  return { type: 'td', attrs: { nodeId, ...attrs }, content: [{ type: 'text', text }] };
}

const p = (nodeId: string, text: string) => ({
  type: 'p',
  attrs: { nodeId },
  content: [{ type: 'text', text }],
});

/**
 * Two tables between paragraphs (feature 006, US7): `t1` (`id` tab-1, `style` grid), 3 × 3
 * cells `a1 b1 c1 / a2 b2 c2 / a3 b3 c3` - node ids `t1-<row>-<column>` -, rows 1 and 2
 * right-aligned; a1, b1, a2 and b2 share `valign` middle and `style` wide, a1 is left-aligned
 * and the other three centred, a2's language is fr and the others' de; a1 has the id c-a1, b2
 * the id c-b2. `t2`: 2 × 2 cells `x1 y1 / x2 y2`. A notes body holds the id note-1.
 */
function bookWithTables(): Document {
  const base = fakeDocument();
  const shared = { valign: 'middle', style: 'wide' };
  const t1 = {
    type: 'table',
    attrs: { nodeId: 't1', id: 'tab-1', style: 'grid' },
    content: [
      {
        type: 'tr',
        attrs: { nodeId: 't1-r0', align: 'right' },
        content: [
          modelCell('t1-0-0', 'a1', { id: 'c-a1', align: 'left', lang: 'de', ...shared }),
          modelCell('t1-0-1', 'b1', { align: 'center', lang: 'de', ...shared }),
          modelCell('t1-0-2', 'c1'),
        ],
      },
      {
        type: 'tr',
        attrs: { nodeId: 't1-r1', align: 'right' },
        content: [
          modelCell('t1-1-0', 'a2', { align: 'center', lang: 'fr', ...shared }),
          modelCell('t1-1-1', 'b2', { id: 'c-b2', align: 'center', lang: 'de', ...shared }),
          modelCell('t1-1-2', 'c2'),
        ],
      },
      {
        type: 'tr',
        attrs: { nodeId: 't1-r2' },
        content: [modelCell('t1-2-0', 'a3'), modelCell('t1-2-1', 'b3'), modelCell('t1-2-2', 'c3')],
      },
    ],
  };
  const t2 = {
    type: 'table',
    attrs: { nodeId: 't2' },
    content: [
      {
        type: 'tr',
        attrs: { nodeId: 't2-r0' },
        content: [modelCell('t2-0-0', 'x1'), modelCell('t2-0-1', 'y1')],
      },
      {
        type: 'tr',
        attrs: { nodeId: 't2-r1' },
        content: [modelCell('t2-1-0', 'x2'), modelCell('t2-1-1', 'y2')],
      },
    ],
  };
  return {
    ...base,
    bodies: [
      {
        type: 'body',
        attrs: { nodeId: 'b1' },
        content: [
          {
            type: 'section',
            attrs: { nodeId: 's1', id: 'chapter-1' },
            content: [p('p1', 'Before'), t1, p('p2', 'Between'), t2, p('p3', 'After')],
          },
        ],
      },
      {
        type: 'body',
        attrs: { nodeId: 'b2', name: 'notes' },
        content: [
          { type: 'section', attrs: { nodeId: 's2', id: 'note-1' }, content: [p('p4', 'A note.')] },
        ],
      },
    ],
  } as unknown as Document;
}

/** The model attributes of the node `nodeId` in any body. */
function attrsOf(document: Document, nodeId: string): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  const visit = (node: { attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.attrs?.nodeId === nodeId) found = node.attrs;
    for (const child of node.content ?? []) visit(child as typeof node);
  };
  for (const body of document.bodies) visit(body as unknown as { content?: unknown[] });
  return found;
}

/** The position before the node `nodeId` in the Body editor. */
function posIn(doc: PMNode, nodeId: string): number {
  const found = findNodeById(doc, nodeId);
  if (!found) throw new Error(`no node ${nodeId}`);
  return found.pos;
}

/** A block of cells from `anchor` to `head` in the Body editor (a selection only). */
function selectBlock(controller: BodyEditorController, anchor: string, head: string): void {
  const state = controller.editorState!;
  act(() =>
    controller.apply(
      state.tr.setSelection(
        CellBlockSelection.create(state.doc, posIn(state.doc, anchor), posIn(state.doc, head)),
      ),
    ),
  );
}

/** Focuses a Table bar text field, types `value` and presses Enter. */
function enterValue(testId: string, value: string): HTMLInputElement {
  const input = screen.getByTestId(testId) as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
  return input;
}

/** The language catalogue `resources.languages` serves (rpc-api.md §3.6), two groups of it. */
const LANGUAGES = {
  groups: [
    {
      key: 'main',
      title: { en: 'Main' },
      languages: [
        { code: 'ru', name: { en: 'Russian', ru: 'Русский' } },
        { code: 'en', name: { en: 'English', ru: 'Английский' } },
      ],
    },
    {
      key: 'europe',
      title: { en: 'Europe' },
      languages: [
        { code: 'de', name: { en: 'German' } },
        { code: 'uk', name: { en: 'Ukrainian' } },
      ],
    },
  ],
  entries: [],
};

async function renderShell(document: Document) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.get': new Error('none'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.position': {},
    'doc.close': {},
    'resources.languages': LANGUAGES,
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(
    <AppProvider services={services}>
      <App services={services} startupSearch="" />
      <LinksBar />
      <TableBar />
    </AppProvider>,
  );
  actions.setConnection(store, 'connected');
  // The shell still renders the T062 placeholder bars: hide them, the real ones are above.
  act(() => actions.setToolbars(store, { links: false, table: false }));
  act(() => actions.setDocument(store, document));
  await screen.findByTestId('body-editor');
  return { store, services, user };
}

describe('Links bar and Table bar (T062)', () => {
  it('shows the ids / href / image title of the selection and writes edits back', async () => {
    const { store } = await renderShell(bookWithLink());
    const controller = getBodyController(store);
    expect(screen.getByTestId('body-editor')).toHaveAttribute('contenteditable', 'true');

    // Caret in the paragraph: paragraph id, section id, no link, no image.
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('links-bar-id')).toHaveValue('para-1'));
    expect(screen.getByTestId('links-bar-section-id')).toHaveValue('chapter-1');
    expect(screen.getByTestId('links-bar-href')).toBeDisabled();
    expect(screen.getByTestId('links-bar-image-title')).toBeDisabled();
    expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'false');

    // Inside the link: the href is editable; a bare host gets http://.
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 6 }));
    await waitFor(() =>
      expect(screen.getByTestId('links-bar-href')).toHaveValue('http://a.example/'),
    );
    const href = screen.getByTestId('links-bar-href') as HTMLInputElement;
    fireEvent.focus(href);
    fireEvent.change(href, { target: { value: 'b.example/page' } });
    fireEvent.keyDown(href, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('links-bar-href')).toHaveValue('http://b.example/page'),
    );
    const paragraph = (store.getState().document!.bodies[0]!.content[0] as SectionNode)
      .content[0] as {
      content: { text: string; marks?: { attrs: { href: string } }[] }[];
    };
    expect(paragraph.content.find((c) => c.text === 'the site')!.marks![0]!.attrs.href).toBe(
      'http://b.example/page',
    );

    // The section id field renames the section.
    const sectionId = screen.getByTestId('links-bar-section-id');
    fireEvent.focus(sectionId);
    fireEvent.change(sectionId, { target: { value: 'ch1' } });
    fireEvent.blur(sectionId);
    await waitFor(() =>
      expect((store.getState().document!.bodies[0]!.content[0] as SectionNode).attrs.id).toBe(
        'ch1',
      ),
    );
  });

  it('binds the Table bar to the table / row / cell at the caret', async () => {
    const { store } = await renderShell(bookWithLink());
    const controller = getBodyController(store);
    // The end of p1 ("See the site now.", 17 characters): the table follows the paragraph. Three
    // columns (feature 006 US8, FR-036): colspan 3 merges the header row, which a one-column
    // table would refuse as past its last column.
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 17 }));
    act(
      () =>
        void controller.execute(
          insertTableCommand(
            createTable(1, 3, true, false, controller.nextNodeId),
            controller.nextNodeId,
          ),
        ),
    );
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    expect(store.getState().selectionPath).toBe('body[1]/section[1]/table[1]/tr[1]/th[1]');
    const colspan = screen.getByTestId('table-bar-colspan');
    fireEvent.focus(colspan);
    fireEvent.change(colspan, { target: { value: '3' } });
    fireEvent.keyDown(colspan, { key: 'Enter' });
    fireEvent.change(screen.getByTestId('table-bar-td-align'), { target: { value: 'center' } });
    fireEvent.change(screen.getByTestId('table-bar-tr-align'), { target: { value: 'right' } });
    const tableId = screen.getByTestId('table-bar-table-id');
    fireEvent.focus(tableId);
    fireEvent.change(tableId, { target: { value: 't1' } });
    fireEvent.blur(tableId);
    await waitFor(() => {
      const section = store.getState().document!.bodies[0]!.content[0] as SectionNode;
      const table = section.content.find((c) => c.type === 'table') as {
        attrs: { id?: string };
        content: { attrs: { align?: string }; content: { attrs: Record<string, unknown> }[] }[];
      };
      expect(table.attrs.id).toBe('t1');
      expect(table.content[0]!.attrs.align).toBe('right');
      expect(table.content[0]!.content[0]!.attrs).toMatchObject({ colspan: 3, align: 'center' });
    });
    expect(screen.getByTestId('table-bar-colspan')).toHaveValue('3');
    // Clearing the span removes the attribute and splits the header row again.
    fireEvent.focus(colspan);
    fireEvent.change(colspan, { target: { value: '' } });
    fireEvent.keyDown(colspan, { key: 'Enter' });
    await waitFor(() => {
      const section = store.getState().document!.bodies[0]!.content[0] as SectionNode;
      const table = section.content.find((c) => c.type === 'table') as {
        content: { content: { type: string; attrs: Record<string, unknown> }[] }[];
      };
      expect(table.content[0]!.content[0]!.attrs.colspan).toBeUndefined();
      expect(table.content[0]!.content.map((cell) => cell.type)).toEqual(['th', 'th', 'th']);
    });
  });

  /* Feature 006, US7 (T117; FR-020 to FR-022, FR-045; C8; data-model §6.1, §10.1). */

  it('the Table bar follows the active table target: in a cell of the Body view, not in a paragraph, the Source view, under the run lock or for a selection that leaves the table', async () => {
    const { store } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    const bar = screen.getByTestId('tablebar');
    const inTable = (value: 'true' | 'false') =>
      waitFor(() => expect(bar).toHaveAttribute('data-in-table', value));
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-1', offset: 1 }));
    await inTable('true');
    for (const id of ['table-bar-table-id', 'table-bar-cell-id', 'table-bar-lang']) {
      expect(screen.getByTestId(id), id).toBeEnabled();
    }
    expect(screen.getByTestId('table-bar-table-id')).toHaveValue('tab-1');
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 1 }));
    await inTable('false');
    expect(screen.getByTestId('table-bar-lang')).toBeDisabled();
    expect(screen.getByTestId('table-bar-table-id')).toHaveValue('');
    // A text selection from a cell to the paragraph after the table (mixedSelection).
    let state = controller.editorState!;
    const from = posIn(state.doc, 't1-2-2') + 2;
    const to = posIn(state.doc, 'p2') + 3;
    act(() => controller.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to))));
    await inTable('false');
    // The whole table selected: no head cell (data-model §5.5).
    state = controller.editorState!;
    act(() =>
      controller.apply(
        state.tr.setSelection(NodeSelection.create(state.doc, posIn(state.doc, 't1'))),
      ),
    );
    await inTable('false');
    // Back in a cell; the run lock; the Source view.
    act(() => void controller.setCaret({ view: 'body', nodeId: 't2-1-1', offset: 1 }));
    await inTable('true');
    act(() => actions.setRunLock(store, fakeRunLock()));
    await inTable('false');
    expect(screen.getByTestId('table-bar-style')).toBeDisabled();
    act(() => actions.setRunLock(store, null));
    await inTable('true');
    act(() => actions.setActiveView(store, 'source'));
    await inTable('false');
  });

  it('block-wide fields show the shared value or stay empty with data-mixed; the row field over the block’s rows', async () => {
    const { store } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    const field = (id: string) => screen.getByTestId(id);
    selectBlock(controller, 't1-0-0', 't1-1-1');
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    await waitFor(() => expect(field('table-bar-td-valign')).toHaveValue('middle'));
    // a1 is left-aligned, the others centred; a2's language differs: empty and mixed.
    expect(field('table-bar-td-align')).toHaveValue('');
    expect(field('table-bar-td-align')).toHaveAttribute('data-mixed', 'true');
    expect(field('table-bar-lang')).toHaveValue('');
    expect(field('table-bar-lang')).toHaveAttribute('data-mixed', 'true');
    // Shared by all four: shown, not mixed.
    for (const [id, value] of [
      ['table-bar-td-valign', 'middle'],
      ['table-bar-style', 'wide'],
      ['table-bar-tr-align', 'right'],
    ]) {
      expect(field(id!), id).toHaveValue(value);
      expect(field(id!), id).not.toHaveAttribute('data-mixed');
    }
    // A block over rows 2 and 3: row 3 has no align - mixed; so are the cells' styles.
    selectBlock(controller, 't1-1-1', 't1-2-2');
    await waitFor(() => expect(field('table-bar-tr-align')).toHaveAttribute('data-mixed', 'true'));
    expect(field('table-bar-tr-align')).toHaveValue('');
    expect(field('table-bar-style')).toHaveValue('');
    expect(field('table-bar-style')).toHaveAttribute('data-mixed', 'true');
    // A caret: its own cell's values, nothing mixed.
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-1-0', offset: 1 }));
    await waitFor(() => expect(field('table-bar-lang')).toHaveValue('fr'));
    expect(field('table-bar-lang')).not.toHaveAttribute('data-mixed');
    expect(field('table-bar-td-align')).toHaveValue('center');
    expect(field('table-bar-td-align')).not.toHaveAttribute('data-mixed');
  });

  it('the head-cell fields show the head cell: $head’s cell, not the top-left one', async () => {
    const { store } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    selectBlock(controller, 't1-0-0', 't1-1-1');
    await waitFor(() => expect(screen.getByTestId('table-bar-cell-id')).toHaveValue('c-b2'));
    expect(screen.getByTestId('table-bar-cell-id')).not.toHaveAttribute('data-mixed');
    selectBlock(controller, 't1-1-1', 't1-0-0');
    await waitFor(() => expect(screen.getByTestId('table-bar-cell-id')).toHaveValue('c-a1'));
    selectBlock(controller, 't1-1-1', 't1-2-2');
    await waitFor(() => expect(screen.getByTestId('table-bar-cell-id')).toHaveValue(''));
    // The table's fields show the table.
    expect(screen.getByTestId('table-bar-table-id')).toHaveValue('tab-1');
    expect(screen.getByTestId('table-bar-table-style')).toHaveValue('grid');
  });

  it('a value set in a block-wide field reaches every cell of the block, and an empty value removes it from all of them', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    const block = ['t1-0-0', 't1-0-1', 't1-1-0', 't1-1-1'];
    const doc = () => store.getState().document!;
    selectBlock(controller, 't1-0-0', 't1-1-1');
    await waitFor(() => expect(screen.getByTestId('table-bar-style')).toHaveValue('wide'));
    const depth = services.undo.undoDepth;
    enterValue('table-bar-style', 'narrow');
    await waitFor(() => {
      for (const id of block) expect(attrsOf(doc(), id)?.style, id).toBe('narrow');
    });
    expect(attrsOf(doc(), 't1-0-2')?.style).toBeUndefined();
    expect(services.undo.undoDepth).toBe(depth + 1);
    // The block is still selected: the next field acts on it too.
    expect(controller.editorState!.selection).toBeInstanceOf(CellBlockSelection);
    fireEvent.change(screen.getByTestId('table-bar-td-align'), { target: { value: 'right' } });
    await waitFor(() => {
      for (const id of block) expect(attrsOf(doc(), id)?.align, id).toBe('right');
    });
    fireEvent.change(screen.getByTestId('table-bar-tr-align'), { target: { value: 'center' } });
    await waitFor(() => {
      expect(attrsOf(doc(), 't1-r0')?.align).toBe('center');
      expect(attrsOf(doc(), 't1-r1')?.align).toBe('center');
    });
    expect(attrsOf(doc(), 't1-r2')?.align).toBeUndefined();
    expect(services.undo.undoDepth).toBe(depth + 3);
    // An empty value removes it from every cell of the block.
    await waitFor(() => expect(screen.getByTestId('table-bar-style')).toHaveValue('narrow'));
    enterValue('table-bar-style', '');
    await waitFor(() => {
      for (const id of block) expect(attrsOf(doc(), id)?.style, id).toBeUndefined();
    });
    expect(services.undo.undoDepth).toBe(depth + 4);
    // The mixed language field: a blur without typing commits nothing; Enter on the still-empty
    // field commits '' - the language goes from all four.
    const lang = screen.getByTestId('table-bar-lang') as HTMLInputElement;
    expect(lang).toHaveAttribute('data-mixed', 'true');
    act(() => lang.focus());
    act(() => lang.blur());
    expect(services.undo.undoDepth).toBe(depth + 4);
    act(() => lang.focus());
    fireEvent.keyDown(lang, { key: 'Enter' });
    await waitFor(() => {
      for (const id of block) expect(attrsOf(doc(), id)?.lang, id).toBeUndefined();
    });
    expect(services.undo.undoDepth).toBe(depth + 5);
    // A value in the mixed field sets it on all four.
    enterValue('table-bar-lang', 'uk');
    await waitFor(() => {
      for (const id of block) expect(attrsOf(doc(), id)?.lang, id).toBe('uk');
    });
    await waitFor(() => expect(screen.getByTestId('table-bar-lang')).toHaveValue('uk'));
    expect(screen.getByTestId('table-bar-lang')).not.toHaveAttribute('data-mixed');
  });

  it('a refused id or language shows its status message, restores the field and dispatches nothing', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-1', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('table-bar-lang')).toHaveValue('de'));
    const message = () => screen.getByTestId('status-message');
    const docBefore = controller.editorState!.doc;
    const depth = services.undo.undoDepth;
    const t = i18next.t;
    const cases: [string, string, string, string][] = [
      ['table-bar-cell-id', '1t', t('tables.msg.idInvalid'), ''],
      ['table-bar-cell-id', 'a b', t('tables.msg.idInvalid'), ''],
      // Only the notes body holds note-1; c-a1 is another cell's id; chapter-1 the section's.
      ['table-bar-cell-id', 'note-1', t('tables.msg.idInUse', { id: 'note-1' }), ''],
      ['table-bar-cell-id', 'c-a1', t('tables.msg.idInUse', { id: 'c-a1' }), ''],
      ['table-bar-table-id', 'chapter-1', t('tables.msg.idInUse', { id: 'chapter-1' }), 'tab-1'],
      ['table-bar-table-id', 'a:b', t('tables.msg.idInvalid'), 'tab-1'],
      ['table-bar-lang', 'de_DE', t('tables.msg.langInvalid', { value: 'de_DE' }), 'de'],
    ];
    for (const [id, value, text, shown] of cases) {
      act(() => actions.setStatusMessage(store, null));
      enterValue(id, value);
      await waitFor(() => expect(message(), `${id} ${value}`).toHaveTextContent(text));
      expect(screen.getByTestId(id), `${id} ${value}`).toHaveValue(shown);
      expect(controller.editorState!.doc, `${id} ${value}`).toBe(docBefore);
      expect(services.undo.undoDepth, `${id} ${value}`).toBe(depth);
    }
    expect(t('tables.msg.idInUse', { id: 'note-1' })).toContain('note-1');
  });

  it('Cell language offers the language list of resources.languages as a datalist', async () => {
    const { store } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-1', offset: 1 }));
    const lang = screen.getByTestId('table-bar-lang');
    expect(lang).toHaveAttribute('list', 'table-bar-lang-options');
    await waitFor(() =>
      expect(document.querySelectorAll('#table-bar-lang-options > option')).toHaveLength(4),
    );
    const options = [...document.querySelectorAll('#table-bar-lang-options > option')].map(
      (option) => [option.getAttribute('value'), option.getAttribute('label')],
    );
    expect(options).toEqual([
      ['ru', 'Russian'],
      ['en', 'English'],
      ['de', 'German'],
      ['uk', 'Ukrainian'],
    ]);
    // A code outside the list is accepted when it is a language tag.
    enterValue('table-bar-lang', 'pt-BR');
    await waitFor(() => expect(attrsOf(store.getState().document!, 't1-0-1')?.lang).toBe('pt-BR'));
  });

  it('each commit is one undo-coordinator entry, a value equal to the current one none', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-1', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('table-bar-style')).toHaveValue('wide'));
    const depth = () => services.undo.undoDepth;
    const start = depth();
    const steps: [() => void, number][] = [
      [() => enterValue('table-bar-style', 'wide'), 0],
      [() => enterValue('table-bar-style', ' wide '), 0],
      [() => enterValue('table-bar-style', 'narrow'), 1],
      [
        () =>
          fireEvent.change(screen.getByTestId('table-bar-td-align'), {
            target: { value: 'center' },
          }),
        0,
      ],
      [
        () =>
          fireEvent.change(screen.getByTestId('table-bar-td-align'), { target: { value: 'left' } }),
        1,
      ],
      [
        () =>
          fireEvent.change(screen.getByTestId('table-bar-tr-align'), {
            target: { value: 'right' },
          }),
        0,
      ],
      [() => enterValue('table-bar-table-style', 'grid'), 0],
      [() => enterValue('table-bar-table-style', 'plain'), 1],
      [() => enterValue('table-bar-table-id', 'tab-1'), 0],
      [() => enterValue('table-bar-cell-id', 'b-one'), 1],
      [() => enterValue('table-bar-lang', 'de'), 0],
    ];
    let expected = start;
    for (const [step, entries] of steps) {
      step();
      expected += entries;
      await waitFor(() => expect(depth()).toBe(expected));
    }
    expect(attrsOf(store.getState().document!, 't1-0-1')).toMatchObject({
      style: 'narrow',
      align: 'left',
      id: 'b-one',
    });
    expect(attrsOf(store.getState().document!, 't1')).toMatchObject({ style: 'plain' });
    // A field that shows a trimmed equal value shows the stored one again.
    expect(screen.getByTestId('table-bar-style')).toHaveValue('narrow');
  });

  it('Enter commits once: the blur that follows Enter commits nothing more, so a refusal shows its message once', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-2', offset: 1 }));
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    const status = vi.spyOn(actions, 'setStatusMessage');
    try {
      const input = enterValue('table-bar-cell-id', '9lives');
      await waitFor(() =>
        expect(screen.getByTestId('status-message')).toHaveTextContent(
          i18next.t('tables.msg.idInvalid'),
        ),
      );
      fireEvent.blur(input);
      act(() => input.blur());
      const refusals = status.mock.calls.filter(([, text]) => text !== null);
      expect(refusals).toHaveLength(1);
      // A valid id: one step, and the blur after it none.
      const depth = services.undo.undoDepth;
      const again = enterValue('table-bar-cell-id', 'c-c1');
      await waitFor(() => expect(services.undo.undoDepth).toBe(depth + 1));
      fireEvent.blur(again);
      act(() => again.blur());
      expect(services.undo.undoDepth).toBe(depth + 1);
      expect(attrsOf(store.getState().document!, 't1-0-2')?.id).toBe('c-c1');
    } finally {
      status.mockRestore();
    }
  });

  it('a commit after the selection moved to another table commits nothing, and the field shows the current value', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-1', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('table-bar-style')).toHaveValue('wide'));
    const depth = services.undo.undoDepth;
    const style = screen.getByTestId('table-bar-style') as HTMLInputElement;
    act(() => style.focus());
    fireEvent.change(style, { target: { value: 'moved' } });
    // The selection moves to the other table while the field is being edited and keeps the
    // focus (a selection change only: `setCaret` would take the focus, and the field commits on
    // blur, before the selection moves).
    const state = controller.editorState!;
    act(() =>
      controller.apply(
        state.tr.setSelection(TextSelection.create(state.doc, posIn(state.doc, 't2-0-0') + 2)),
      ),
    );
    expect(document.activeElement).toBe(style);
    await waitFor(() => expect(screen.getByTestId('table-bar-table-style')).toHaveValue(''));
    fireEvent.keyDown(style, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('table-bar-style')).toHaveValue(''));
    expect(services.undo.undoDepth).toBe(depth);
    expect(attrsOf(store.getState().document!, 't1-0-1')?.style).toBe('wide');
    expect(attrsOf(store.getState().document!, 't2-0-0')?.style).toBeUndefined();
  });
});

describe('Links bar: Alt text (feature 006, US3, FR-029)', () => {
  it('Alt text shows and edits the alt of a selected inline image in a cell, of an inline image in a paragraph and of a block image; an empty value removes it; it is disabled without a selected picture and outside the Body view; each commit is one undo step', async () => {
    const { store } = await renderShell(bookWithPictures());
    const controller = getBodyController(store);
    const alt = () => screen.getByTestId('links-bar-alt') as HTMLInputElement;
    const select = (nodeId: string) => {
      const state = controller.editorState!;
      let pos = -1;
      state.doc.descendants((node, p) => {
        if (pos < 0 && node.attrs.nodeId === nodeId) pos = p;
        return pos < 0;
      });
      act(() => controller.apply(state.tr.setSelection(NodeSelection.create(state.doc, pos))));
    };
    const commit = (value: string) => {
      fireEvent.focus(alt());
      fireEvent.change(alt(), { target: { value } });
      fireEvent.keyDown(alt(), { key: 'Enter' });
    };

    // Without a selected picture: disabled.
    act(() => void controller.setCaret({ view: 'body', nodeId: 'p1', offset: 2 }));
    await waitFor(() => expect(alt()).toBeDisabled());

    for (const [nodeId, shown] of [
      ['cell1', 'A cell picture'],
      ['inline1', ''],
      ['block1', 'A block picture'],
    ] as const) {
      select(nodeId);
      await waitFor(() => expect(alt()).toBeEnabled());
      expect(alt()).toHaveValue(shown);
      const depth = undoDepth(controller.editorState!);
      commit('New text');
      await waitFor(() =>
        expect(modelAttrs(store.getState().document!, nodeId)?.alt).toBe('New text'),
      );
      expect(undoDepth(controller.editorState!)).toBe(depth + 1);
      // An empty value removes it, again one undo step.
      select(nodeId);
      await waitFor(() => expect(alt()).toHaveValue('New text'));
      commit('');
      await waitFor(() =>
        expect(modelAttrs(store.getState().document!, nodeId)?.alt).toBeUndefined(),
      );
      expect(undoDepth(controller.editorState!)).toBe(depth + 2);
      // Undo brings the previous value back.
      act(() => void controller.undoStep());
      await waitFor(() =>
        expect(modelAttrs(store.getState().document!, nodeId)?.alt).toBe('New text'),
      );
    }

    // Outside the Body view the bar is not active.
    select('cell1');
    await waitFor(() => expect(alt()).toBeEnabled());
    act(() => actions.setActiveView(store, 'description'));
    await waitFor(() => expect(alt()).toBeDisabled());
  });
});

describe('Body view chrome (T057/T067)', () => {
  it('opens the context menu with Cut / Copy / Paste and Select entries and publishes the selection', async () => {
    const { store } = await renderShell(bookWithLink());
    const controller = getBodyController(store);
    act(() => void controller.selectRange('p1', 0, 3));
    await waitFor(() =>
      expect(screen.getByTestId('body-view')).toHaveAttribute('data-selected-text', 'See'),
    );
    fireEvent.contextMenu(screen.getByTestId('body-view'), { clientX: 10, clientY: 10 });
    const menu = await screen.findByTestId('context-menu');
    expect(menu).toHaveTextContent('Undo');
    expect(screen.getByTestId('context-menu-edit.cut')).toHaveTextContent('Cut');
    expect(screen.getByTestId('context-menu-edit.copy')).toHaveTextContent('Copy');
    expect(screen.getByTestId('context-menu-edit.paste')).toHaveTextContent('Paste');
    expect(screen.getByTestId('context-menu-select-3')).toHaveTextContent('Select p');
    expect(screen.getByTestId('context-menu-select-2')).toHaveTextContent('Select section');
    expect(screen.getByTestId('context-menu-select-1')).toHaveTextContent('Select body');
    const selected: string[] = [];
    const off = controller.subscribeContext(() =>
      selected.push(controller.getContext().selectedText),
    );
    fireEvent.click(screen.getByTestId('context-menu-select-2'));
    await waitFor(() => expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument());
    off();
    // The section's text got selected (jsdom's focus handling may move the caret afterwards).
    expect(selected.some((text) => text.includes('See the site now.'))).toBe(true);
    // Escape closes it too.
    fireEvent.contextMenu(screen.getByTestId('body-view'), { clientX: 10, clientY: 10 });
    fireEvent.keyDown(await screen.findByTestId('context-menu'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument());
  });

  it('renders images and unknown elements through their node views', async () => {
    const doc = bookWithLink();
    (doc.bodies[0]!.content[0] as SectionNode).content.push({
      type: 'raw-xml',
      attrs: { nodeId: 'raw1', xml: '<weird a="1"/>', inline: false },
    } as SectionNode['content'][number]);
    await renderShell(doc);
    const image = screen.getByTestId('body-image');
    expect(image).toHaveAttribute('data-href', '#pic.jpg');
    expect(image.querySelector('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/binary/doc-1/pic.jpg/preview'),
    );
    expect(image.querySelector('figcaption')).toHaveTextContent('A picture');
    const unknown = screen.getByTestId('body-unknown');
    expect(unknown).toHaveTextContent('weird');
    expect(unknown).toHaveAttribute('contenteditable', 'false');
  });
});

/* ------------------------------------------------------------------------ */
/* Feature 006, US8 (T125): the span fields                                 */
/* ------------------------------------------------------------------------ */

/** The model node `nodeId` of any body, or null. */
function nodeIn(document: Document, nodeId: string): { content?: unknown[] } | null {
  let found: { content?: unknown[] } | null = null;
  const visit = (node: { attrs?: Record<string, unknown>; content?: unknown[] }) => {
    if (node.attrs?.nodeId === nodeId) found = node;
    for (const child of node.content ?? []) visit(child as typeof node);
  };
  for (const body of document.bodies) visit(body as unknown as { content?: unknown[] });
  return found;
}

/** The text of a model node. */
function textIn(node: { content?: unknown[] } | null): string {
  return (node?.content ?? [])
    .map((child) => {
      const one = child as { type: string; text?: string; content?: unknown[] };
      return one.type === 'text' ? (one.text ?? '') : textIn(one);
    })
    .join('');
}

/** `bookWithTables` with `t3` - `[x1, y1 rowspan 2] / [x2]` - and a link to b2's id `c-b2`. */
function bookWithSpans(): Document {
  const book = bookWithTables();
  const section = book.bodies[0]!.content[0] as unknown as { content: unknown[] };
  section.content.push(
    {
      type: 'table',
      attrs: { nodeId: 't3' },
      content: [
        {
          type: 'tr',
          attrs: { nodeId: 't3-r0' },
          content: [modelCell('t3-0-0', 'x1'), modelCell('t3-0-1', 'y1', { rowspan: 2 })],
        },
        { type: 'tr', attrs: { nodeId: 't3-r1' }, content: [modelCell('t3-1-0', 'x2')] },
      ],
    },
    {
      type: 'p',
      attrs: { nodeId: 'p5' },
      content: [
        { type: 'text', text: 'See ' },
        { type: 'text', text: 'b2', marks: [{ type: 'link', attrs: { href: '#c-b2' } }] },
      ],
    },
  );
  return book;
}

/** A book whose table is one row of 4195 cells of colspan 1000: above MAX_GRID_POSITIONS. */
function bookWithBigTable(): Document {
  const base = fakeDocument();
  const cells = Array.from({ length: 4195 }, (_, index) =>
    modelCell(`big-0-${index}`, `w${index}`, { colspan: 1000 }),
  );
  const section = {
    type: 'section',
    attrs: { nodeId: 's1' },
    content: [
      p('p1', 'Before'),
      {
        type: 'table',
        attrs: { nodeId: 'big' },
        content: [{ type: 'tr', attrs: { nodeId: 'big-r0' }, content: cells }],
      },
      p('p2', 'After'),
    ],
  };
  return {
    ...base,
    bodies: [{ type: 'body', attrs: { nodeId: 'b1' }, content: [section] }],
  } as unknown as Document;
}

describe('Table bar: colspan and rowspan (feature 006, US8)', () => {
  it('colspan and rowspan merge and split through the span plan: 3 merges the head cell’s row, 1 and an empty field split; each one undo step', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    const doc = () => store.getState().document!;
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-0', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('table-bar-cell-id')).toHaveValue('c-a1'));
    expect(screen.getByTestId('table-bar-colspan')).toHaveValue('');
    const depth = services.undo.undoDepth;
    enterValue('table-bar-colspan', '3');
    await waitFor(() => expect(attrsOf(doc(), 't1-0-0')?.colspan).toBe(3));
    expect(textIn(nodeIn(doc(), 't1-0-0'))).toBe('a1 b1 c1');
    expect(nodeIn(doc(), 't1-0-1')).toBeNull();
    expect(nodeIn(doc(), 't1-0-2')).toBeNull();
    expect(services.undo.undoDepth).toBe(depth + 1);
    await waitFor(() => expect(screen.getByTestId('table-bar-colspan')).toHaveValue('3'));
    // 1 splits it: the cell keeps the joined text, two empty cells of its kind follow.
    enterValue('table-bar-colspan', '1');
    await waitFor(() => expect(attrsOf(doc(), 't1-0-0')?.colspan).toBeUndefined());
    const firstRow = () => (nodeIn(doc(), 't1-r0')?.content ?? []) as { content?: unknown[] }[];
    expect(firstRow().map((cell) => textIn(cell))).toEqual(['a1 b1 c1', '', '']);
    expect(services.undo.undoDepth).toBe(depth + 2);
    // After Undo, an emptied field splits the same way.
    act(() => void services.undo.undo());
    await waitFor(() => expect(attrsOf(doc(), 't1-0-0')?.colspan).toBe(3));
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-0-0', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('table-bar-colspan')).toHaveValue('3'));
    enterValue('table-bar-colspan', '');
    await waitFor(() => expect(attrsOf(doc(), 't1-0-0')?.colspan).toBeUndefined());
    expect(firstRow().map((cell) => textIn(cell))).toEqual(['a1 b1 c1', '', '']);
    // rowspan 2 in c2 merges c2 and c3.
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-1-2', offset: 1 }));
    await waitFor(() => expect(screen.getByTestId('table-bar-rowspan')).toHaveValue(''));
    const before = services.undo.undoDepth;
    enterValue('table-bar-rowspan', '2');
    await waitFor(() => expect(attrsOf(doc(), 't1-1-2')?.rowspan).toBe(2));
    expect(textIn(nodeIn(doc(), 't1-1-2'))).toBe('c2 c3');
    expect(nodeIn(doc(), 't1-2-2')).toBeNull();
    expect(services.undo.undoDepth).toBe(before + 1);
  });

  it('a span past the edge or not a whole number shows its message, restores the field and dispatches nothing', async () => {
    const { store, services } = await renderShell(bookWithTables());
    const controller = getBodyController(store);
    const t = i18next.t;
    const message = () => screen.getByTestId('status-message');
    const docBefore = () => controller.editorState!.doc;
    const cases: [string, string, string, string][] = [
      ['t1-0-1', 'table-bar-colspan', '3', t('tables.msg.spanPastEnd')],
      ['t1-0-1', 'table-bar-colspan', 'abc', t('tables.msg.spanInvalid')],
      ['t1-0-1', 'table-bar-colspan', '0', t('tables.msg.spanInvalid')],
      ['t1-0-1', 'table-bar-colspan', '2.5', t('tables.msg.spanInvalid')],
      ['t1-1-0', 'table-bar-rowspan', '3', t('tables.msg.spanPastEnd')],
      ['t1-1-0', 'table-bar-rowspan', '-1', t('tables.msg.spanInvalid')],
    ];
    for (const [cell, id, value, text] of cases) {
      act(() => void controller.setCaret({ view: 'body', nodeId: cell, offset: 1 }));
      await waitFor(() =>
        expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
      );
      act(() => actions.setStatusMessage(store, null));
      const doc = docBefore();
      const depth = services.undo.undoDepth;
      enterValue(id, value);
      await waitFor(() => expect(message(), `${id} ${value}`).toHaveTextContent(text));
      expect(screen.getByTestId(id), `${id} ${value}`).toHaveValue('');
      expect(controller.editorState!.doc, `${id} ${value}`).toBe(doc);
      expect(services.undo.undoDepth, `${id} ${value}`).toBe(depth);
    }
  });

  it('a span growth refused with merge-needs-block shows its reason, restores the field and dispatches nothing', async () => {
    const { store, services } = await renderShell(bookWithSpans());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 't3-1-0', offset: 1 }));
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    const doc = controller.editorState!.doc;
    const depth = services.undo.undoDepth;
    enterValue('table-bar-colspan', '2');
    await waitFor(() =>
      expect(screen.getByTestId('status-message')).toHaveTextContent(
        i18next.t('tables.reason.merge-needs-block'),
      ),
    );
    expect(i18next.t('tables.reason.merge-needs-block')).toContain('Merge cells');
    expect(screen.getByTestId('table-bar-colspan')).toHaveValue('');
    expect(controller.editorState!.doc).toBe(doc);
    expect(services.undo.undoDepth).toBe(depth);
  });

  it('a span growth over a linked id asks first: No commits nothing and records no undo entry, Yes merges as one entry', async () => {
    const { store, services } = await renderShell(bookWithSpans());
    const controller = getBodyController(store);
    const doc = () => store.getState().document!;
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-1-0', offset: 1 }));
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    const before = controller.editorState!.doc;
    const depth = services.undo.undoDepth;
    enterValue('table-bar-colspan', '2');
    const no = await screen.findByTestId('dialog-table-link-targets-button-no');
    expect(screen.getByTestId('dialog-table-link-targets-text')).toHaveTextContent(
      i18next.t('tables.msg.linkTargets', { count: 1 }),
    );
    fireEvent.click(no);
    await waitFor(() => expect(screen.queryByTestId('dialog-table-link-targets')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('table-bar-colspan')).toHaveValue(''));
    expect(controller.editorState!.doc).toBe(before);
    expect(services.undo.undoDepth).toBe(depth);
    // Yes: the merge, one entry; b2 and its id are gone.
    act(() => void controller.setCaret({ view: 'body', nodeId: 't1-1-0', offset: 1 }));
    enterValue('table-bar-colspan', '2');
    fireEvent.click(await screen.findByTestId('dialog-table-link-targets-button-yes'));
    await waitFor(() => expect(attrsOf(doc(), 't1-1-0')?.colspan).toBe(2));
    expect(nodeIn(doc(), 't1-1-1')).toBeNull();
    expect(services.undo.undoDepth).toBe(depth + 1);
  });

  it('on a table too large to edit the span fields are disabled with the reason as their title', async () => {
    const { store } = await renderShell(bookWithBigTable());
    const controller = getBodyController(store);
    act(() => void controller.setCaret({ view: 'body', nodeId: 'big-0-1', offset: 1 }));
    await waitFor(() =>
      expect(screen.getByTestId('tablebar')).toHaveAttribute('data-in-table', 'true'),
    );
    const reason = i18next.t('tables.reason.too-large');
    for (const id of ['table-bar-colspan', 'table-bar-rowspan']) {
      expect(screen.getByTestId(id), id).toBeDisabled();
      expect(screen.getByTestId(id), id).toHaveAttribute('title', reason);
    }
    // The attribute fields read no position: they stay available (data-model §2.5).
    expect(screen.getByTestId('table-bar-style')).toBeEnabled();
    expect(screen.getByTestId('table-bar-cell-id')).toBeEnabled();
  });
});
