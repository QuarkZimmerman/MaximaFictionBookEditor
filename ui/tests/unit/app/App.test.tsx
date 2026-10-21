import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { App } from '@/app/App';
import { createAppServices, type AppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';
import { ArrayHistoryAdapter } from '@/model/undo';

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
    services.undo.registerView('body', adapter);
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
