import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { registerAiFeature, unregisterAiFeature } from '@/ai';
import { App } from '@/app/App';
import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { createAppServices, type AppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { CaretRegistry } from '@/model/caret';
import { actions, createAppStore, emptyConversation } from '@/model/store';
import { ArrayHistoryAdapter, UndoCoordinator } from '@/model/undo';

import { fakeDocument } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const MENUS = ['file', 'edit', 'view', 'add', 'style', 'tools', 'scripts', 'help'] as const;

async function renderApp(overrides: Partial<Parameters<typeof createAppServices>[0]> = {}) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const services: AppServices = createAppServices({ store, platform: 'linux', ...overrides });
  const user = userEvent.setup();
  render(<App services={services} />);
  return { store, services, user };
}

describe('App shell', () => {
  it('renders the eight menus with their English labels, the toolbars and the status bar', async () => {
    await renderApp();
    expect(screen.getByTestId('app-root')).toBeInTheDocument();
    const labels = MENUS.map((id) => screen.getByTestId(`menu-${id}`).textContent);
    expect(labels).toEqual(['File', 'Edit', 'View', 'Add', 'Style', 'Tools', 'Scripts', 'Help']);
    expect(screen.getByTestId('toolbar-file.new')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-tools.spellcheck')).toBeInTheDocument();
    expect(screen.getByTestId('toolbar-scripts')).toBeInTheDocument();
    expect(screen.getByTestId('linksbar')).toBeInTheDocument();
    expect(screen.getByTestId('tablebar')).toBeInTheDocument();
    expect(screen.getByTestId('status-message')).toHaveTextContent('Not connected');
    expect(screen.getByTestId('status-insmode')).toHaveTextContent('INS');
    expect(screen.getByTestId('panel-tree-caption')).toHaveTextContent('Document structure');
    expect(screen.getByTestId('panel-body-empty')).toBeInTheDocument();
    expect(document.title).toBe('Maxima Fiction Book Editor');
  });

  it('opens menus with the mouse, shows items, separators, checkmarks and disabled state', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByTestId('menu-file'));
    const popup = screen.getByTestId('menu-file-popup');
    expect(within(popup).getByTestId('menu-file-new')).toHaveTextContent('New');
    expect(within(popup).getByTestId('menu-file-new')).toHaveAttribute('aria-disabled', 'true'); // no core
    expect(within(popup).getByTestId('menu-file-exit')).not.toHaveAttribute('aria-disabled');
    expect(within(popup).getByTestId('menu-file-import')).toHaveTextContent('Import');
    expect(within(popup).getByTestId('menu-file-recent')).toHaveTextContent('Recent Files');
    expect(within(popup).getAllByRole('separator')).toHaveLength(3);

    // Hovering another top-level menu switches to it.
    await user.hover(screen.getByTestId('menu-view'));
    const view = screen.getByTestId('menu-view-popup');
    expect(within(view).getByTestId('menu-view-statusBar')).toHaveAttribute('data-checked', 'true');
    expect(within(view).getByTestId('menu-view-body')).toHaveAttribute('data-checked', 'true');
    expect(within(view).getByTestId('menu-view-source')).not.toHaveAttribute('data-checked');
    expect(within(view).getByTestId('menu-view-body')).toHaveTextContent('Alt+F2'); // hotkey column

    await user.click(within(view).getByTestId('menu-view-source'));
    expect(screen.queryByTestId('menu-view-popup')).not.toBeInTheDocument();
    expect(screen.getByTestId('panel-source')).toBeInTheDocument();
    expect(screen.getByTestId('view-source')).toHaveAttribute('aria-selected', 'true');
  });

  it('leaves an invisible command out of the menu and the toolbar without doubling a separator (feature 005)', async () => {
    const { user, services } = await renderApp();
    // The View menu: the AI entry sits between Document Tree and the first separator; as an
    // invisible stub it leaves no row, no doubled separator and no gap in the arrow order.
    await user.click(screen.getByTestId('menu-view'));
    let view = screen.getByTestId('menu-view-popup');
    expect(within(view).queryByTestId('menu-view-toggle')).not.toBeInTheDocument();
    expect(within(view).getAllByRole('separator')).toHaveLength(2);
    expect(view.querySelectorAll('[role^="menuitem"]')).toHaveLength(10);
    expect(screen.queryByTestId('toolbar-ai.toggle')).not.toBeInTheDocument();
    // Not even an empty wrapper of the toolbar slot (US9 T065: a hidden item has no element;
    // the stored layout keeps it - toolbarLayouts.ts), and no doubled separator either.
    const toolbar = screen.getByTestId('toolbar-commands');
    expect(toolbar.querySelector('[data-toolbar-item="ai.toggle"]')).toBeNull();
    const toolbarItems = [...toolbar.querySelectorAll('[data-toolbar-item]')].map((item) =>
      item.getAttribute('data-toolbar-item'),
    );
    expect(toolbarItems).toContain('view.source');
    expect(toolbarItems[toolbarItems.indexOf('view.source') + 1]).toBe('-');
    expect(toolbarItems[toolbarItems.indexOf('view.source') + 2]).toBe('insert.binary');
    await user.keyboard('{Escape}');

    // The feature takes the stub over with a visible command: the row and the button appear,
    // with the label, the hotkey and the checked state of a toggle.
    act(() => {
      services.commands.replace({
        id: 'ai.toggle',
        group: 'view',
        labelKey: 'menu.view.aiAssistant',
        tooltipKey: 'cmd.ai.toggle.tooltip',
        icon: 'ai-assistant',
        checked: () => true,
        run: () => {},
      });
    });
    await user.click(screen.getByTestId('menu-view'));
    view = screen.getByTestId('menu-view-popup');
    const entry = within(view).getByTestId('menu-view-toggle');
    expect(entry).toHaveTextContent('AI Assistant');
    expect(entry).toHaveTextContent('Ctrl+Shift+A');
    expect(entry).toHaveAttribute('data-checked', 'true');
    expect(within(view).getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByTestId('toolbar-ai.toggle')).toHaveAttribute(
      'title',
      'AI Assistant (Ctrl+Shift+A)',
    );
    // Back in its stored place: after the view buttons, before their separator.
    expect(
      toolbar.querySelector('[data-toolbar-item="view.source"] + [data-toolbar-item]'),
    ).toHaveAttribute('data-toolbar-item', 'ai.toggle');
    await user.keyboard('{Escape}');

    // Hidden again (the assistant disabled): both are gone, the separator count unchanged.
    act(() => {
      services.commands.replace({
        id: 'ai.toggle',
        group: 'view',
        labelKey: 'menu.view.aiAssistant',
        visible: () => false,
        run: () => {},
      });
    });
    await user.click(screen.getByTestId('menu-view'));
    view = screen.getByTestId('menu-view-popup');
    expect(within(view).queryByTestId('menu-view-toggle')).not.toBeInTheDocument();
    expect(within(view).getAllByRole('separator')).toHaveLength(2);
    expect(screen.queryByTestId('toolbar-ai.toggle')).not.toBeInTheDocument();
  });

  it('hosts the AI panel slot on the right while the assistant is on (feature 005 FR-040)', async () => {
    const { store } = await renderApp();
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-splitter')).not.toBeInTheDocument();

    act(() => {
      actions.updateAi(store, { on: true });
    });
    const panel = screen.getByTestId('ai-panel');
    expect(panel).toHaveAttribute('data-ai-width', '360'); // the stored value as is
    const splitter = screen.getByTestId('ai-splitter');
    expect(splitter).toHaveAttribute('role', 'separator');
    expect(splitter).toHaveAttribute('aria-label', 'AI assistant panel divider');
    // The divider and the panel follow the view area; the applied width is the clamped one
    // (jsdom's main area is 0 px wide: the panel minimum).
    const main = panel.parentElement!;
    expect(main).toHaveClass('mfbe-main');
    expect(splitter.nextElementSibling).toBe(panel);
    expect(splitter.previousElementSibling).toBe(screen.getByTestId('view-area'));
    expect(main.style.getPropertyValue('--mfbe-ai-panel-width')).toBe('280px');

    act(() => {
      actions.updateAi(store, { on: false });
    });
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-splitter')).not.toBeInTheDocument();
    expect(store.getState().ai.width).toBe(360); // hiding the panel keeps the width
  });

  it('toggling the status bar through the View menu hides it', async () => {
    const { user } = await renderApp();
    await user.click(screen.getByTestId('menu-view'));
    await user.click(screen.getByTestId('menu-view-statusBar'));
    expect(screen.queryByTestId('statusbar')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('menu-view'));
    expect(screen.getByTestId('menu-view-statusBar')).not.toHaveAttribute('data-checked');
    await user.click(screen.getByTestId('menu-view-tree'));
    expect(screen.queryByTestId('tree-panel')).not.toBeInTheDocument();
  });

  it('is keyboard operable: Alt+accelerator, arrows, Enter, Escape, item accelerators', async () => {
    const { user } = await renderApp();
    await user.keyboard('{Alt>}v{/Alt}');
    const view = screen.getByTestId('menu-view-popup');
    expect(view).toBeInTheDocument();
    expect(within(view).getByTestId('menu-view-toolbarCommands')).toHaveClass(
      'mfbe-menu-item-highlighted',
    );
    await user.keyboard('{ArrowUp}'); // wraps to the last item
    expect(within(view).getByTestId('menu-view-fastMode')).toHaveClass(
      'mfbe-menu-item-highlighted',
    );
    await user.keyboard('{ArrowDown}{ArrowDown}'); // wraps to the first item, then the second
    expect(within(view).getByTestId('menu-view-toolbarScripts')).toHaveClass(
      'mfbe-menu-item-highlighted',
    );
    await user.keyboard('{ArrowRight}'); // next menu
    expect(screen.getByTestId('menu-add-popup')).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}'); // back to View, then Edit
    expect(screen.getByTestId('menu-edit-popup')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('menu-edit-popup')).not.toBeInTheDocument();

    // Item accelerator: View > So&urce
    await user.keyboard('{Alt>}v{/Alt}');
    await user.keyboard('u');
    expect(screen.getByTestId('panel-source')).toBeInTheDocument();

    // Enter activates the highlighted item: View > D&escription (first item after Home + 7 downs)
    await user.keyboard('{Alt>}v{/Alt}');
    await user.keyboard('{End}{ArrowUp}{ArrowUp}{ArrowUp}'); // Fast Mode -> Source -> Body -> Description
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('panel-description')).toBeInTheDocument();
  });

  it('submenus open with ArrowRight and show their entries', async () => {
    const { user } = await renderApp();
    await user.keyboard('{Alt>}f{/Alt}');
    // New, Open, Save, Save As, Validate, (sep), Import
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByTestId('menu-file-import')).toHaveClass('mfbe-menu-item-highlighted');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('menu-file-import-popup')).toBeInTheDocument();
    // The description import of feature 004 (FR-030) took the place of the plugin placeholder.
    expect(screen.queryByTestId('menu-file-import-none')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-file-import-importDescription')).toHaveTextContent(
      'Description from FictionBook file...',
    );
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByTestId('menu-file-import-popup')).not.toBeInTheDocument();
    // Export: the FBD export of feature 004 (FR-040) in place of the plugin placeholder.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('menu-file-export')).toHaveClass('mfbe-menu-item-highlighted');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('menu-file-export-popup')).toBeInTheDocument();
    expect(screen.queryByTestId('menu-file-export-none')).not.toBeInTheDocument();
    expect(screen.getByTestId('menu-file-export-exportFbd')).toHaveTextContent('Export as FBD...');
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByTestId('menu-file-export-popup')).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByTestId('menu-scripts'));
    expect(screen.getByTestId('menu-scripts-none')).toHaveTextContent('No scripts found');
    expect(screen.getByTestId('menu-scripts-none')).toHaveAttribute('aria-disabled', 'true');
  });

  it('dispatches global hotkeys to enabled commands only', async () => {
    const { user, store, services } = await renderApp();
    await user.keyboard('{Alt>}{F3}{/Alt}'); // View > Source (FBE default)
    expect(store.getState().activeView).toBe('source');
    await user.keyboard('{Alt>}{F1}{/Alt}');
    expect(store.getState().activeView).toBe('description');

    // Ctrl+Z is bound to edit.undo, disabled while there is nothing to undo.
    const adapter = new ArrayHistoryAdapter<string>();
    act(() => services.undo.registerView('body', adapter)); // the toolbar re-renders on it
    adapter.push('x');
    act(() => services.undo.record('body', 'typing'));
    expect(screen.getByTestId('toolbar-edit.undo')).toBeEnabled();
    await user.keyboard('{Control>}z{/Control}');
    expect(services.undo.canUndo).toBe(false);
    expect(screen.getByTestId('toolbar-edit.undo')).toBeDisabled();
    expect(screen.getByTestId('toolbar-edit.redo')).toBeEnabled();
  });

  it('an enabled command hotkey takes precedence over a menu mnemonic (Alt+S)', async () => {
    const { user, services } = await renderApp();
    // style.subtitle (Alt+S) is a disabled stub: Alt+S opens the &Style menu.
    await user.keyboard('{Alt>}s{/Alt}');
    expect(screen.getByTestId('menu-style-popup')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    const run = vi.fn();
    act(() => {
      services.commands.replace({ id: 'style.subtitle', group: 'style', run });
    });
    await user.keyboard('{Alt>}s{/Alt}');
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('menu-style-popup')).not.toBeInTheDocument();
  });

  it('toolbar buttons carry tooltips with hotkeys and reflect pressed state', async () => {
    const { user } = await renderApp();
    const body = screen.getByTestId('toolbar-view.body');
    expect(body).toHaveAttribute('aria-pressed', 'true');
    expect(body).toHaveAttribute('title', 'Body (Alt+F2)');
    expect(screen.getByTestId('toolbar-file.open')).toHaveAttribute('title', 'Open (Ctrl+O)');
    expect(screen.getByTestId('toolbar-file.new')).toHaveAttribute('title', 'New');
    await user.click(screen.getByTestId('view-description'));
    expect(screen.getByTestId('toolbar-view.description')).toHaveAttribute('aria-pressed', 'true');
    expect(body).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the document name in the title and the status pane changes', async () => {
    const { store } = await renderApp();
    act(() => {
      actions.setConnection(store, 'connected');
    });
    expect(screen.getByTestId('status-message')).toHaveTextContent('Ready');
    act(() => {
      actions.setStatusMessage(store, 'No errors found.');
      actions.setSelection(store, 'body[1]/section[2]/p[3]');
      actions.toggleInsertMode(store);
    });
    expect(screen.getByTestId('status-message')).toHaveTextContent('No errors found.');
    expect(screen.getByTestId('status-path')).toHaveTextContent('body[1]/section[2]/p[3]');
    expect(screen.getByTestId('status-insmode')).toHaveTextContent('OVR');
    act(() => {
      actions.setProgress(store, { jobId: 'j', phase: 'parse', done: 1, total: 4 });
    });
    expect(screen.getByTestId('status-message')).toHaveTextContent('parse: 25%');
  });

  it('shows the run banner per kind of the run lock: a script run, an AI request', async () => {
    // Feature 005 T025 (data-model §4.1, FR-022): the banner follows `store.runLock`.
    const { store } = await renderApp();
    expect(screen.queryByTestId('script-run-banner')).not.toBeInTheDocument();

    // A script run (no host run in this test: the lock alone drives the banner's text).
    act(() => {
      actions.setRunLock(store, {
        kind: 'script',
        label: 'Append paragraph',
        startedAt: Date.now() - 65_000,
      });
    });
    const banner = screen.getByTestId('script-run-banner');
    expect(banner).toHaveAttribute('data-run-kind', 'script');
    expect(banner).toHaveAttribute('aria-label', 'Running script');
    expect(screen.getByTestId('script-run-name')).toHaveTextContent(
      'Script "Append paragraph" is running',
    );
    // The clock reads 00:00 the moment the lock appears and the real time from its first tick.
    expect(screen.getByTestId('script-run-elapsed')).toHaveTextContent('00:00');
    await waitFor(
      () => expect(screen.getByTestId('script-run-elapsed')).toHaveTextContent(/^01:0[5-9]$/),
      { timeout: 2_500 },
    );
    expect(screen.queryByTestId('ai-banner-operation')).not.toBeInTheDocument();
    expect(screen.getByTestId('script-run-cancel')).toHaveTextContent('Cancel');
    // The status bar's run line takes the message pane's place for the same lock.
    expect(screen.getByTestId('script-run-bar')).toHaveAttribute('data-run-kind', 'script');
    expect(screen.getByTestId('script-run-text')).toHaveTextContent(
      'Running script "Append paragraph"...',
    );
    expect(screen.queryByTestId('status-message')).not.toBeInTheDocument();

    // An AI request: `<service name> · <model>`, the current operation, Cancel.
    act(() => {
      actions.setRunLock(store, {
        kind: 'ai',
        label: 'OVHcloud AI Endpoints · gpt-oss-120b',
        startedAt: Date.now(),
        phase: 'waiting for the answer',
      });
    });
    expect(screen.getByTestId('script-run-banner')).toHaveAttribute('data-run-kind', 'ai');
    expect(screen.getByTestId('script-run-banner')).not.toHaveAttribute('data-script-id');
    expect(screen.getByTestId('script-run-name')).toHaveTextContent(
      'OVHcloud AI Endpoints · gpt-oss-120b',
    );
    expect(screen.getByTestId('ai-banner-operation')).toHaveTextContent('waiting for the answer');
    expect(screen.getByTestId('script-run-elapsed')).toHaveTextContent(/^00:0[0-1]$/);
    expect(screen.getByTestId('script-run-cancel')).toBeInTheDocument();
    expect(screen.getByTestId('script-run-bar')).toHaveAttribute('data-run-kind', 'ai');
    expect(screen.getByTestId('script-run-text')).toHaveTextContent('waiting for the answer');
    // The phase follows the request's state through a new lock object.
    act(() => {
      actions.setRunLock(store, {
        ...store.getState().runLock!,
        phase: 'running replace_node',
      });
    });
    expect(screen.getByTestId('ai-banner-operation')).toHaveTextContent('running replace_node');

    act(() => {
      actions.setRunLock(store, null);
    });
    expect(screen.queryByTestId('script-run-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('script-run-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-message')).toBeInTheDocument();
  });

  it('renders the panel component of the loaded chunk inside the pane while on; its field keeps its keys (feature 005 US3)', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const store = createAppStore();
    const commands = createCommandRegistry();
    const undo = new UndoCoordinator();
    const hotkeys = new HotkeyMap('linux');
    const split = vi.fn();
    // The feature registered first with a stand-in chunk: a panel with a text field, the
    // on/off helpers; `createAppServices` then finds and keeps this instance.
    registerAiFeature(
      { commands, rpc: null, undo, carets: new CaretRegistry(), store, hotkeys },
      {
        loadAssistant: async () => ({
          AiPanel: () => (
            <div data-testid="ai-panel-stub">
              <textarea data-testid="ai-input" aria-label="x" />
            </div>
          ),
          startAssistant: (s) => actions.updateAi(s, { on: true, loaded: true }),
          stopAssistant: (s) =>
            actions.updateAi(s, { on: false, request: null, conversation: emptyConversation() }),
          startRequest: async () => ({ kind: 'cancelled' as const }),
          cancelRequest: () => {},
          activeRequest: () => null,
        }),
      },
    );
    const services = createAppServices({ store, commands, undo, hotkeys, platform: 'linux' });
    const user = userEvent.setup();
    render(<App services={services} />);
    act(() => {
      // The session restores the panel hidden (FR-040 as amended): nothing of the chunk.
      actions.setSettings(
        store,
        defaultSettings({ session: { ...defaultSettings().session, aiPanelVisible: false } }),
      );
      actions.setDocument(store, fakeDocument());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
    expect(store.getState().ai.visible).toBe(false);

    await user.click(screen.getByTestId('menu-view'));
    await user.click(screen.getByTestId('menu-view-toggle'));
    const panel = await screen.findByTestId('ai-panel');
    expect(within(panel).getByTestId('ai-panel-stub')).toBeInTheDocument();
    expect(panel).not.toHaveAttribute('data-ai-inert');
    expect(store.getState().ai).toMatchObject({ visible: true, on: true });

    // In the panel's field Shift+Enter is a line break, not `edit.split`; Enter and Escape are
    // the field's as well; Mod+Z is the field's own undo, not the document's.
    act(() => services.commands.replace({ id: 'edit.split', group: 'edit', run: split }));
    const dispatch = vi.spyOn(services.commands, 'dispatch');
    const field = within(panel).getByTestId('ai-input');
    await user.click(field);
    await user.keyboard('{Shift>}{Enter}{/Shift}{Enter}{Escape}');
    expect(split).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    await user.keyboard('{Control>}z{/Control}');
    expect(dispatch).not.toHaveBeenCalledWith('edit.undo', expect.anything());
    // Outside the panel the dispatcher is as before: Mod+Z reaches edit.undo.
    await user.click(screen.getByTestId('view-area'));
    await user.keyboard('{Control>}z{/Control}');
    expect(dispatch).toHaveBeenCalledWith('edit.undo', expect.anything());

    // Hidden through the toolbar button: the pane and its content are gone, the assistant off.
    await user.click(screen.getByTestId('toolbar-ai.toggle'));
    await waitFor(() => expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument());
    expect(screen.queryByTestId('ai-panel-stub')).not.toBeInTheDocument();
    expect(store.getState().ai).toMatchObject({ visible: false, on: false });
    unregisterAiFeature(store);
  });

  it('renders the inert panel while the assistant is Disabled: every control disabled, the centred notice with its settings link, the toggle hides it, nothing of the chunk loaded (feature 005 FR-096, T100)', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const store = createAppStore();
    const commands = createCommandRegistry();
    const undo = new UndoCoordinator();
    const hotkeys = new HotkeyMap('linux');
    const load = vi.fn(async () => ({
      AiPanel: () => <div data-testid="ai-panel-stub" />,
      startAssistant: (s: typeof store) => actions.updateAi(s, { on: true, loaded: true }),
      stopAssistant: (s: typeof store) =>
        actions.updateAi(s, { on: false, request: null, conversation: emptyConversation() }),
      startRequest: async () => ({ kind: 'cancelled' as const }),
      cancelRequest: () => {},
      activeRequest: () => null,
    }));
    registerAiFeature(
      { commands, rpc: null, undo, carets: new CaretRegistry(), store, hotkeys },
      { loadAssistant: load },
    );
    const services = createAppServices({ store, commands, undo, hotkeys, platform: 'linux' });
    const user = userEvent.setup();
    render(<App services={services} />);
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument(); // before the snapshot
    const disabled = defaultSettings();
    disabled.ai.mode = 'disabled';
    act(() => {
      actions.setSettings(store, disabled);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The pane with the inert panel (the default visibility: open at the first start).
    const panel = await screen.findByTestId('ai-panel');
    expect(panel).toHaveAttribute('data-ai-inert', 'true');
    expect(screen.getByTestId('ai-splitter')).toBeInTheDocument();
    const inert = within(panel).getByTestId('ai-panel-disabled');
    expect(inert).toHaveAttribute('data-inert', 'true');
    expect(within(inert).queryByTestId('ai-panel-stub')).not.toBeInTheDocument();
    expect(within(inert).queryByTestId('ai-messages')).not.toBeInTheDocument(); // no conversation
    for (const id of ['ai-input', 'ai-send', 'ai-clear', 'ai-undo']) {
      expect(within(inert).getByTestId(id), id).toBeDisabled();
    }
    expect(within(inert).getByTestId('ai-panel-disabled-notice')).toHaveTextContent(
      'The AI assistant is disabled. Enable it in Settings → AI assistant to work with it.',
    );
    expect(within(inert).getByTestId('ai-panel-disabled-settings')).toBeEnabled();
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().ai).toMatchObject({ visible: true, on: false, loaded: false });

    // The View entry and the toolbar button are present and checked; the toggle hides the
    // inert panel and shows it again without loading anything.
    await user.click(screen.getByTestId('menu-view'));
    const entry = screen.getByTestId('menu-view-toggle');
    expect(entry).toHaveAttribute('data-checked', 'true');
    expect(entry).not.toHaveAttribute('aria-disabled');
    await user.click(entry);
    await waitFor(() => expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument());
    expect(store.getState().ai.visible).toBe(false);
    await user.click(screen.getByTestId('toolbar-ai.toggle'));
    await screen.findByTestId('ai-panel-disabled');
    expect(load).not.toHaveBeenCalled();

    // The close button hides it too.
    await user.click(screen.getByTestId('ai-panel-close'));
    await waitFor(() => expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument());
    expect(store.getState().ai.visible).toBe(false);

    // A service chosen (the settings snapshot): the hidden panel stays hidden; shown, it is
    // the live one - the chunk loaded then, and only then.
    act(() => {
      actions.setSettings(store, defaultSettings());
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.queryByTestId('ai-panel')).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('toolbar-ai.toggle'));
    const live = await screen.findByTestId('ai-panel');
    expect(within(live).getByTestId('ai-panel-stub')).toBeInTheDocument();
    expect(live).not.toHaveAttribute('data-ai-inert');
    expect(load).toHaveBeenCalledTimes(1);
    // Disabled again at once: the same visible pane turns inert, the chunk stays idle.
    act(() => {
      actions.setSettings(store, disabled);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByTestId('ai-panel')).toHaveAttribute('data-ai-inert', 'true');
    expect(screen.getByTestId('ai-panel-disabled')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-panel-stub')).not.toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    unregisterAiFeature(store);
  });

  it('renders Russian labels after a language switch', async () => {
    await renderApp();
    await act(async () => {
      await changeLanguage('ru');
    });
    expect(screen.getByTestId('menu-file')).toHaveTextContent('Файл');
    expect(screen.getByTestId('menu-add')).toHaveTextContent('Вставка');
    expect(screen.getByTestId('status-message')).toHaveTextContent('Нет соединения');
    expect(screen.getByTestId('status-insmode')).toHaveTextContent('ВСТ');
    expect(screen.getByTestId('view-body')).toHaveTextContent('Дизайн');
    await act(async () => {
      await changeLanguage('en');
    });
  });
});
