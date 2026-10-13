/**
 * T105 - the Scripts menu / toolbar integration rendered through the real `MenuBar` and the
 * `useScriptsMenu()` / `<ScriptsToolbar/>` hooks exactly as App.tsx mounts them: groups become
 * sub-menus in `NN` order with the manifest names, scripts become `script.<id>` commands with
 * their default hotkeys, tree scripts stay out of the menu, "No scripts found" appears for an
 * empty catalogue, the housekeeping entries (Last script / Open scripts folder / Reload
 * scripts) follow, toolbar buttons exist for scripts with icons and `needsSelection` disables.
 */

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMemo } from 'react';

import { AppProvider } from '@/app/AppContext';
import { MenuBar } from '@/app/MenuBar';
import { createAppServices, type AppServices } from '@/app/services';
import { Toolbars } from '@/app/Toolbars';
import { changeLanguage, initI18n } from '@/i18n';
import { actions, createAppStore } from '@/model/store';
import { getScriptsFeature, type ScriptsFeature } from '@/scripting/catalog';
import { useScriptsMenu } from '@/scripting/ScriptsMenu';
import { ScriptsToolbar } from '@/scripting/ScriptsToolbar';
import type { ScriptInfo, ScriptsListResult } from '@/scripting/types';

import { fakeDocument, fakeRpc } from '../features/testUtils';

function script(id: string, group: string, extra: Partial<ScriptInfo> = {}): ScriptInfo {
  return {
    manifestVersion: 1,
    id,
    name: { en: `Name ${id}`, ru: `Имя ${id}` },
    kind: 'menu',
    entry: 'index.js',
    needsSelection: false,
    group,
    dir: `/scripts/${group}/${id}`,
    folder: id,
    source: 'bundled',
    entryUrl: `/scripts/${id}/index.js`,
    warnings: [],
    ...extra,
  };
}

const LIST: ScriptsListResult = {
  groups: [
    {
      id: '01_Case',
      order: 1,
      names: { en: 'Case', ru: 'Регистр' },
      dir: '/scripts/01_Case',
      scripts: [
        script('test.case.upper', '01_Case', {
          iconUrl: '/scripts/test.case.upper/icon.png',
          defaultHotkey: 'Ctrl+Alt+U',
          needsSelection: true,
        }),
        script('test.case.lower', '01_Case'),
      ],
    },
    {
      id: '04_Model',
      order: 4,
      names: { en: 'Model' },
      dir: '/scripts/04_Model',
      scripts: [
        script('test.model.append', '04_Model', { iconUrl: '/scripts/test.model.append/icon.png' }),
      ],
    },
    {
      id: 'tree',
      order: 10000,
      names: { en: 'tree' },
      dir: '/scripts/tree',
      scripts: [script('test.tree.mark', 'tree', { kind: 'tree' })],
    },
  ],
  issues: [],
  folders: { user: '/data/scripts' },
};

/** What App.tsx does: the hook feeds the dynamic items, the toolbar gets the buttons. */
function Shell() {
  const scripts = useScriptsMenu();
  const items = useMemo(() => ({ scripts }), [scripts]);
  return (
    <>
      <MenuBar dynamicItems={items} />
      <Toolbars scripts={<ScriptsToolbar />} />
    </>
  );
}

async function renderShell(list: ScriptsListResult | null = LIST) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'scripts.list': list ?? { groups: [], issues: [], folders: {} },
    'scripts.lastRun': {},
    'app.info': { testHooks: false },
  });
  const services: AppServices = createAppServices({ store, rpc: rpc.client, platform: 'linux' });
  actions.setConnection(store, 'connected');
  const user = userEvent.setup();
  render(
    <AppProvider services={services}>
      <Shell />
    </AppProvider>,
  );
  const feature = getScriptsFeature(store)!;
  await act(async () => {
    await feature.refresh();
  });
  return { store, services, user, feature, rpc };
}

describe('Scripts menu and toolbar', () => {
  it('lists groups as sub-menus in NN order with the manifest names and hotkeys', async () => {
    const { user, feature } = await renderShell();
    expect(feature.loaded).toBe(true);
    await user.click(screen.getByTestId('menu-scripts'));
    const popup = screen.getByTestId('menu-scripts-popup');
    expect(within(popup).queryByTestId('menu-scripts-none')).not.toBeInTheDocument();
    const groups = within(popup).getAllByRole('menuitem', { name: /Case|Model/ });
    expect(groups.map((g) => g.textContent?.replace('\u25B8', ''))).toEqual(['Case', 'Model']);
    expect(within(popup).queryByTestId('menu-scripts-tree')).not.toBeInTheDocument();
    expect(within(popup).getByTestId('menu-scripts-last')).toHaveTextContent('Last script');
    expect(within(popup).getByTestId('menu-scripts-openFolder')).toHaveTextContent(
      'Open scripts folder',
    );
    expect(within(popup).getByTestId('menu-scripts-reload')).toHaveTextContent('Reload scripts');
    expect(within(popup).getAllByRole('separator')).toHaveLength(2);

    await user.hover(within(popup).getByTestId('menu-scripts-01_Case'));
    const submenu = screen.getByTestId('menu-scripts-01_Case-popup');
    const upper = within(submenu).getByTestId('menu-scripts-01_Case-test.case.upper');
    expect(upper).toHaveTextContent('Name test.case.upper');
    expect(upper).toHaveTextContent('Ctrl+Alt+U');
    // needsSelection without a document / selection: disabled; the other one needs a document.
    expect(upper).toHaveAttribute('aria-disabled', 'true');
    expect(within(submenu).getByTestId('menu-scripts-01_Case-test.case.lower')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('shows "No scripts found" plus the housekeeping entries for an empty catalogue', async () => {
    const { user } = await renderShell(null);
    await user.click(screen.getByTestId('menu-scripts'));
    const popup = screen.getByTestId('menu-scripts-popup');
    expect(within(popup).getByTestId('menu-scripts-none')).toHaveTextContent('No scripts found');
    expect(within(popup).getByTestId('menu-scripts-last')).toHaveAttribute('aria-disabled', 'true');
    expect(within(popup).getByTestId('menu-scripts-openFolder')).toBeInTheDocument();
    expect(screen.queryByTestId('scripts-toolbar-items')).not.toBeInTheDocument();
  });

  it('puts icon scripts on the toolbar and enables them with a document', async () => {
    const { store, user, feature } = await renderShell();
    expect(screen.getByTestId('scripts-toolbar-test.case.upper')).toBeDisabled();
    expect(screen.getByTestId('scripts-toolbar-test.model.append')).toBeDisabled();
    expect(screen.queryByTestId('scripts-toolbar-test.case.lower')).not.toBeInTheDocument();
    expect(screen.getByTestId('scripts-toolbar-test.case.upper')).toHaveAttribute(
      'title',
      'Name test.case.upper (Ctrl+Alt+U)',
    );
    await act(async () => {
      actions.setDocument(store, fakeDocument());
    });
    expect(screen.getByTestId('scripts-toolbar-test.model.append')).toBeEnabled();
    // Still no selection in the Body editor: the needsSelection script stays disabled.
    expect(screen.getByTestId('scripts-toolbar-test.case.upper')).toBeDisabled();
    expect(screen.getByTestId('toolbar-scripts.last')).toBeDisabled();
    await act(async () => {
      feature.host.setLastRunId('test.model.append');
    });
    expect(screen.getByTestId('toolbar-scripts.last')).toBeEnabled();
    // Russian names once the language changes.
    await act(async () => {
      actions.setUiLanguage(store, 'ru');
      await changeLanguage('ru');
    });
    await user.click(screen.getByTestId('menu-scripts'));
    await user.hover(screen.getByTestId('menu-scripts-01_Case'));
    expect(screen.getByTestId('menu-scripts-01_Case')).toHaveTextContent('Регистр');
    expect(screen.getByTestId('menu-scripts-01_Case-test.case.upper')).toHaveTextContent(
      'Имя test.case.upper',
    );
    await changeLanguage('en');
  });

  it('registers script commands with the manifest hotkeys and keeps the catalogue fresh', async () => {
    const { services, feature, rpc } = await renderShell();
    expect(services.commands.has('script.test.case.upper')).toBe(true);
    expect(services.commands.get('script.test.case.upper')?.group).toBe('scripts');
    expect(services.hotkeys.get('script.test.case.upper')).toBe('Ctrl+Alt+U');
    expect(services.hotkeys.lookup('Ctrl+Alt+U')).toEqual(['script.test.case.upper']);
    expect(services.commands.has('script.test.tree.mark')).toBe(true);
    const tree: ScriptsFeature['treeScripts'] = () => feature.treeScripts();
    expect(tree().map((s) => s.id)).toEqual(['test.tree.mark']);
    expect(feature.toolbarScripts().map((s) => s.id)).toEqual([
      'test.case.upper',
      'test.model.append',
    ]);
    // A changed folder drops a script: the command disappears on the next list.
    rpc.responses['scripts.list'] = { ...LIST, groups: LIST.groups.slice(1) };
    await act(async () => {
      rpc.notify('resources.changed', { what: 'scripts' });
      await feature.refresh();
    });
    expect(services.commands.has('script.test.case.upper')).toBe(false);
    expect(services.commands.has('script.test.model.append')).toBe(true);
  });
});
