/**
 * Rendering tests of the US1 views and dialogs inside the application shell: Body view (window,
 * selection path, undo adapter, caret provider), Source view (toXml load, dirty flag, parse error
 * cursor), Description summary, ValidationPanel and the Save changes / Encoding dialogs.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { createAppServices, type AppServices } from '@/app/services';
import { DialogService, EncodingDialog, SaveChangesPrompt, ValidationPanel } from '@/dialogs';
import { changeLanguage, initI18n } from '@/i18n';
import type { Document, ValidationReport } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { sourceSession } from '@/views/source/sourceSession';

import { CLEAN_REPORT, fakeDocument, fakeRpc } from '../features/testUtils';

// ProseMirror / CodeMirror need layout APIs jsdom lacks.
beforeAll(() => {
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
  if (!('ResizeObserver' in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  document.elementFromPoint = () => null;
});

function bigDocument(sections: number, bodies = 1): Document {
  const base = fakeDocument();
  return {
    ...base,
    bodies: Array.from({ length: bodies }, (_, b) => ({
      type: 'body' as const,
      attrs: b === 0 ? { nodeId: `b${b}` } : { nodeId: `b${b}`, name: 'notes' },
      content: Array.from({ length: sections }, (_, i) => ({
        type: 'section' as const,
        attrs: { nodeId: `b${b}s${i}` },
        content: [
          {
            type: 'p' as const,
            attrs: { nodeId: `b${b}p${i}` },
            content: [{ type: 'text' as const, text: `Body ${b} section ${i}` }],
          },
        ],
      })),
    })),
  };
}

async function renderApp(responses: Record<string, unknown> = {}) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'settings.get': new Error('no settings'),
    'doc.recent': [],
    'doc.watch': {},
    'doc.position': {},
    'doc.close': {},
    ...responses,
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  const user = userEvent.setup();
  render(<App services={services} startupSearch="" />);
  // The connection starts the shell's asynchronous start-up work (settings.get, doc.recent, the
  // start-up document); let it settle inside act so its state updates are accounted for.
  await act(async () => {
    actions.setConnection(store, 'connected');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { store, services, rpc, user };
}

describe('Body view (T049)', () => {
  it('shows the "no document" state, then mounts the ProseMirror editor with the FBE classes', async () => {
    const { store } = await renderApp();
    expect(screen.getByTestId('panel-body-empty')).toBeInTheDocument();
    act(() => actions.setDocument(store, fakeDocument()));
    const editor = await screen.findByTestId('body-editor');
    expect(editor).toHaveAttribute('contenteditable', 'true');
    expect(editor.querySelector('.fb-body .fb-section p.fb-p')).toHaveTextContent('Hello');
    expect(screen.getByTestId('body-view')).toHaveAttribute('data-whole-book', 'true');
    expect(screen.queryByTestId('body-window-after')).not.toBeInTheDocument();
    act(() => actions.closeDocument(store));
    expect(screen.getByTestId('panel-body-empty')).toBeInTheDocument();
  });

  it('windows large books, extends on the placeholders and switches bodies', async () => {
    const { store, user } = await renderApp();
    act(() => actions.setDocument(store, bigDocument(50, 2)));
    const container = await screen.findByTestId('panel-body-document');
    expect(container).toHaveAttribute('data-section-count', '20');
    expect(container).toHaveAttribute('data-section-total', '50');
    expect(screen.getByTestId('body-view')).toHaveAttribute('data-whole-book', 'false');
    const after = screen.getByTestId('body-window-after');
    expect(after).toHaveTextContent('... 30 more sections');
    expect(screen.queryByTestId('body-window-before')).not.toBeInTheDocument();
    await user.click(after);
    await waitFor(() => expect(container).toHaveAttribute('data-section-count', '40'));
    expect(screen.getByTestId('body-window-after')).toHaveTextContent('... 10 more sections');
    await user.click(screen.getByTestId('body-window-after'));
    await waitFor(() => expect(screen.queryByTestId('body-window-after')).not.toBeInTheDocument());

    const selector = screen.getByTestId('body-selector');
    expect(within(selector).getByTestId('body-tab-1')).toHaveTextContent('notes');
    await user.click(within(selector).getByTestId('body-tab-1'));
    await waitFor(() =>
      expect(screen.getByTestId('body-view')).toHaveAttribute('data-body-index', '1'),
    );
    expect(screen.getByTestId('body-editor')).toHaveTextContent('Body 1 section 0');
    expect(screen.getByTestId('panel-body-document')).toHaveAttribute('data-section-count', '20');
  });

  it('registers the body undo adapter and caret provider; caret restore moves the window', async () => {
    const { store, services } = await renderApp();
    act(() => actions.setDocument(store, bigDocument(50)));
    await screen.findByTestId('body-editor');
    expect(services.undo.hasView('body')).toBe(true);
    expect(services.carets.has('body')).toBe(true);
    // section 45 is not mounted: the caret provider re-windows around it (store updates)
    let placed = false;
    act(() => {
      placed = services.carets.set({ view: 'body', nodeId: 'b0p45', offset: 3 });
    });
    expect(placed).toBe(true);
    await waitFor(() =>
      expect(screen.getByTestId('panel-body-document')).toHaveAttribute('data-section-start', '35'),
    );
    expect(services.carets.get('body')).toEqual({ view: 'body', nodeId: 'b0p45', offset: 3 });
    expect(store.getState().selectionPath).toBe('body[1]/section[46]/p[1]');
    expect(store.getState().selectionNodeId).toBe('b0p45');
    expect(services.carets.set({ view: 'body', nodeId: 'nope' })).toBe(false);
  });
});

describe('Source view (T050)', () => {
  it('loads doc.toXml with elided binaries, tracks edits as modified and places the cursor on parse errors', async () => {
    const xml = '<?xml version="1.0"?>\n<FictionBook>\n<body/>\n</FictionBook>\n';
    const { store, rpc, services, user } = await renderApp({
      'doc.toXml': { text: xml },
    });
    act(() => actions.setDocument(store, fakeDocument()));
    await user.click(screen.getByTestId('view-source'));
    const view = await screen.findByTestId('source-view');
    await waitFor(() => expect(view).toHaveAttribute('data-status', 'ready'));
    // `positions: true`: the serialisation records the position map of the Body <-> Source
    // mapping (feature 004 US7).
    expect(rpc.calls.find((c) => c.method === 'doc.toXml')?.params).toEqual({
      docId: 'doc-1',
      document: store.getState().document,
      elideBinaries: true,
      positions: true,
    });
    expect(screen.getByTestId('source-editor')).toHaveTextContent('<FictionBook>');
    expect(store.getState()).toMatchObject({ sourceDirty: false, modified: false });
    expect(services.undo.hasView('source')).toBe(true);
    expect(services.carets.get('source')).toEqual({ view: 'source', line: 1, column: 1 });

    // Typing marks the document modified and the Source text dirty.
    const content = screen.getByTestId('source-editor');
    content.focus();
    await user.keyboard('x');
    await waitFor(() => expect(store.getState().sourceDirty).toBe(true));
    expect(store.getState().modified).toBe(true);
    expect(sourceSession(store).text).toContain('x');
    expect(document.title).toBe('alpha.fb2* - Maxima Fiction Book Editor');

    // A parse error reported by a commit moves the caret to its line/column.
    act(() => actions.setSourceParseError(store, { line: 3, column: 2, message: 'bad' }));
    expect(screen.getByTestId('source-parse-error')).toHaveTextContent('line 3, column 2: bad');
    await waitFor(() =>
      expect(services.carets.get('source')).toEqual({ view: 'source', line: 3, column: 2 }),
    );
    expect(services.carets.set({ view: 'source', line: 2, column: 5 })).toBe(true);
    expect(services.carets.get('source')).toEqual({ view: 'source', line: 2, column: 5 });
  });

  it('shows the Source-only notice and the raw text without calling the core', async () => {
    const { store, rpc } = await renderApp();
    const { setSourceOnlyText } = await import('@/views/source/sourceSession');
    const { sourceOnlyDocument } = await import('@/features/file/fileCommands');
    act(() => {
      actions.setDocument(store, sourceOnlyDocument('doc-3', '/b/bad.fb2', 'utf-8'), {
        sourceOnly: true,
      });
      setSourceOnlyText(store, 'doc-3', '<FictionBook><p>oops</FictionBook>');
    });
    const view = await screen.findByTestId('source-view');
    await waitFor(() => expect(view).toHaveAttribute('data-status', 'ready'));
    expect(screen.getByTestId('source-only-notice')).toBeInTheDocument();
    expect(screen.getByTestId('source-editor')).toHaveTextContent('oops');
    expect(rpc.calls.map((c) => c.method)).not.toContain('doc.toXml');
    expect(screen.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('ValidationPanel (T053)', () => {
  const report: ValidationReport = {
    issues: [
      {
        severity: 'error',
        code: 'validation.schema',
        params: { element: 'section', detail: 'missing p' },
        line: 42,
        column: 7,
        nodeId: 'n10',
        path: 'body[1]/section[3]',
      },
      { severity: 'warning', code: 'validation.genreUnknown', params: { code: 'sf_litrpg' } },
      { severity: 'warning', code: 'binary.unreferenced', params: { id: 'blob.bin' } },
    ],
    errorCount: 1,
    warningCount: 2,
    durationMs: 17,
  };

  it('lists issues with severity/line/column/localised message and navigates on double-click / Enter', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ValidationPanel report={report} onNavigate={onNavigate} onClose={onClose} />);
    expect(screen.getByTestId('validation-summary')).toHaveTextContent(
      '1 error found. 2 warnings.',
    );
    const first = screen.getByTestId('validation-issue-0');
    expect(first).toHaveAttribute('data-severity', 'error');
    expect(first).toHaveTextContent('Error');
    expect(first).toHaveTextContent('42');
    expect(first).toHaveTextContent('section: missing p');
    expect(first).toHaveTextContent('body[1]/section[3]');
    expect(screen.getByTestId('validation-issue-1')).toHaveTextContent('Unknown genre "sf_litrpg"');
    expect(screen.getByTestId('validation-issue-2')).toHaveTextContent(
      'Binary object "blob.bin" is not referenced',
    );
    await user.dblClick(screen.getByTestId('validation-issue-1'));
    expect(onNavigate).toHaveBeenLastCalledWith(report.issues[1]);
    act(() => first.focus()); // focus selects the row: a state update
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(first, { key: 'Enter' });
    expect(onNavigate).toHaveBeenLastCalledWith(report.issues[1]);
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    await user.click(screen.getByTestId('validation-close'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows "No errors found." for a clean report and is docked in the shell by the store', async () => {
    const { store, user } = await renderApp();
    act(() => actions.setValidation(store, CLEAN_REPORT));
    expect(await screen.findByTestId('validation-panel')).toBeInTheDocument();
    expect(screen.getByTestId('validation-empty')).toHaveTextContent('No errors found.');
    await user.click(screen.getByTestId('validation-close'));
    expect(screen.queryByTestId('validation-panel')).not.toBeInTheDocument();
    expect(store.getState().validation).toBeNull();
  });
});

describe('Save changes prompt and Encoding dialog (T052)', () => {
  it('SaveChangesPrompt asks "Save changes to <name>?" with Yes / No / Cancel', async () => {
    await initI18n({ language: 'en' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SaveChangesPrompt name="alpha.fb2" onClose={onClose} />);
    expect(screen.getByTestId('dialog-save-changes-text')).toHaveTextContent(
      'Save changes to alpha.fb2?',
    );
    expect(screen.getByTestId('dialog-save-changes-button-yes')).toHaveFocus();
    await user.click(screen.getByTestId('dialog-save-changes-button-no'));
    expect(onClose).toHaveBeenCalledWith('no');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenLastCalledWith('cancel');
  });

  it('EncodingDialog lists the nine encodings, preselects the default and returns the choice', async () => {
    await initI18n({ language: 'en' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    const service = new DialogService();
    void service;
    render(<EncodingDialog defaultEncoding="cp1251" path="/x.fb2" onClose={onClose} />);
    const select = screen.getByTestId('dialog-encoding-select') as HTMLSelectElement;
    expect(select.options).toHaveLength(9);
    expect(select.value).toBe('windows-1251');
    expect(screen.getByTestId('dialog-encoding-path')).toHaveTextContent('/x.fb2');
    await user.selectOptions(select, 'koi8-r');
    await user.click(screen.getByTestId('dialog-encoding-button-ok'));
    expect(onClose).toHaveBeenCalledWith('koi8-r');
    await user.click(screen.getByTestId('dialog-encoding-button-cancel'));
    expect(onClose).toHaveBeenLastCalledWith(null);
  });
});
