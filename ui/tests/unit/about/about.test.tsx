/**
 * About dialog (T149, FR-126 / FR-131): product name, version, build stamp, platform and engine
 * versions from `app.info`, the repository link, the MIT licence line, "Open log folder" with
 * the headless (1050) fallback - and no credits or personal names.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { AboutDialog, REPOSITORY_URL } from '@/dialogs/AboutDialog';
import { registerSettingsFeature } from '@/features/settings';
import { changeLanguage, initI18n } from '@/i18n';
import { CaretRegistry } from '@/model/caret';
import { UndoCoordinator } from '@/model/undo';

import { fakeRpc, makeContext, rpcError } from '../features/testUtils';

const INFO = {
  version: '0.0.1',
  build: '2026-10-13T00:00:00Z+abc1234',
  platform: 'linux',
  cefVersion: '131.0.0',
  uiLanguage: 'en',
  dataDir: '/home/user/.local/share/maxfbeditor',
  logDir: '/home/user/.local/state/maxfbeditor/logs',
  resourceLayers: [],
  apiVersion: 1,
};

async function setup(options: { info?: unknown; openError?: Error; rpc?: boolean } = {}) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const rpc = fakeRpc({
    'app.info': options.info ?? INFO,
    'app.openLogFolder': options.openError ?? {},
  });
  const ctx = await makeContext({ rpc: options.rpc === false ? null : rpc.client });
  const onClose = vi.fn();
  render(<AboutDialog ctx={ctx} onClose={onClose} />);
  return { ctx, rpc, onClose, user: userEvent.setup() };
}

describe('AboutDialog', () => {
  it('shows name, version, build, platform, engine, repository link and the MIT licence', async () => {
    await setup();
    expect(screen.getByTestId('about-name')).toHaveTextContent('Maxima Fiction Book Editor');
    await waitFor(() =>
      expect(screen.getByTestId('about-version')).toHaveTextContent('Version 0.0.1'),
    );
    expect(screen.getByTestId('about-build')).toHaveTextContent('2026-10-13T00:00:00Z+abc1234');
    expect(screen.getByTestId('about-platform')).toHaveTextContent('linux');
    expect(screen.getByTestId('about-engine')).toHaveTextContent('CEF 131.0.0');
    expect(screen.getByTestId('about-api-version')).toHaveTextContent('1');
    const link = screen.getByTestId('about-repository');
    expect(link).toHaveAttribute('href', REPOSITORY_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(screen.getByTestId('about-licence')).toHaveTextContent('MIT License');
    expect(screen.getByTestId('about-log-folder')).toHaveTextContent(INFO.logDir);
    // FR-126: no credits, no personal names, no copyright line.
    const text = screen.getByTestId('dialog-about').textContent ?? '';
    expect(text).not.toMatch(/copyright|©|contributors|thanks|author/i);
    expect(text).not.toMatch(/@/);
  });

  it('opens the log folder through app.openLogFolder and closes with Close / Escape', async () => {
    const { rpc, user, onClose } = await setup();
    await user.click(screen.getByTestId('about-open-log-folder'));
    await waitFor(() => expect(rpc.calls.some((c) => c.method === 'app.openLogFolder')).toBe(true));
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('explains where the log folder is when no shell can open it (1050)', async () => {
    const { ctx, user } = await setup({
      openError: rpcError(1050, 'dialog.unavailable', { reason: 'no shell' }),
    });
    await waitFor(() => expect(screen.getByTestId('about-build')).toHaveTextContent('abc1234'));
    await user.click(screen.getByTestId('about-open-log-folder'));
    await waitFor(() => expect(ctx.dialogs.shown).toHaveLength(1));
    expect(ctx.dialogs.shown[0]!.text).toContain(INFO.logDir);
    expect(ctx.dialogs.shown[0]!.text).toMatch(/cannot be opened from here/);
  });

  it('falls back to the bundled UI version without a core', async () => {
    await setup({ rpc: false });
    expect(screen.getByTestId('about-version')).toHaveTextContent('Version 0.1.0-test');
    expect(screen.getByTestId('about-build')).toHaveTextContent('unknown');
    expect(screen.getByTestId('about-open-log-folder')).toBeDisabled();
    expect(screen.getByTestId('about-log-folder')).toHaveTextContent(
      'unknown (core not connected)',
    );
  });

  it('is wired to the help.about command by the settings feature', async () => {
    const { ctx } = await setup({ rpc: false });
    const commands = createCommandRegistry();
    registerSettingsFeature({
      commands,
      undo: new UndoCoordinator(),
      carets: new CaretRegistry(),
      store: ctx.store,
      hotkeys: new HotkeyMap('linux'),
    });
    const about = commands.get('help.about')!;
    expect(about.stub).toBeUndefined();
    expect(commands.get('tools.settings')!.stub).toBeUndefined();
    await commands.execute('help.about', ctx);
    expect(ctx.dialogs.custom.map((d) => d.name)).toEqual(['AboutDialog']);
  });
});
