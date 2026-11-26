/**
 * Feature 021 (T016, US1): Vitest unit tests for Settings -> Maxima Library integration:
 * - Default disabled state (unchecked, https://maxima-library.com, dependent controls disabled)
 * - Apply / OK gating while checked and untested or while testing
 * - Domain/token edits immediately invalidating verified state
 * - Tab-leave revert discarding untested draft and restoring last saved state + Apply/OK
 * - Unchecking Enable restoring Apply/OK immediately
 * - Cancel aborting in-flight Test integration job
 * - Reveal toggle calling maximaLookup.revealToken
 * - Unreadable token warning banner
 * - External token-page link URL construction
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { createCommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import { SettingsDialog } from '@/dialogs/SettingsDialog';
import { registerSettingsRuntime } from '@/features/settings/apply';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import type {
  MaximaLookupSaveConfigParams,
  MaximaLookupStatusResult,
  MaximaLookupTestOutcome,
  MaximaLookupTestParams,
  Settings,
} from '@/rpc/types';

import { fakeRpc, makeContext } from './features/testUtils';
import { defaultSettings } from './settings/fixtures';

function makeStatus(overrides: Partial<MaximaLookupStatusResult> = {}): MaximaLookupStatusResult {
  return {
    enabled: false,
    domain: 'https://maxima-library.com',
    hasToken: false,
    tokenReadable: true,
    verified: false,
    tokenPageUrl:
      'https://maxima-library.com/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token',
    ...overrides,
  };
}

async function setupSettingsDialog(
  options: {
    initialSettings?: Settings;
    initialStatus?: MaximaLookupStatusResult;
    onTest?: (
      params: MaximaLookupTestParams,
      onStart?: (jobId: string) => void,
    ) => Promise<MaximaLookupTestOutcome>;
    revealedToken?: { token: string; readable: boolean };
  } = {},
) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');

  const settings = options.initialSettings ?? defaultSettings();
  const status = options.initialStatus ?? makeStatus();
  const cancelledJobs: string[] = [];
  const savedConfigs: MaximaLookupSaveConfigParams[] = [];

  const rpc = fakeRpc({
    'settings.get': () => settings,
    'settings.set': () => ({ settings, restartRequired: false }),
    'hotkeys.get': [],
    'hotkeys.set': { collisions: [] },
    'ocr.report': () => ({
      packs: [
        {
          code: 'eng',
          fb2Lang: 'en',
          script: 'latin',
          layer: 'bundled',
          path: '/eng',
          sizeBytes: 1,
          overridesBundled: false,
          bundled: true,
        },
      ],
      osdAvailable: true,
      osdLayer: 'bundled',
      activeFolder: '/ocr',
      customFolder: '',
      customFolderIssue: null,
      passedOver: [],
    }),
    'maximaLookup.status': () => status,
    'maximaLookup.revealToken': () =>
      options.revealedToken ?? { token: 'saved-secret-token', readable: true },
    'maximaLookup.saveConfig': (params: unknown) => {
      const p = params as MaximaLookupSaveConfigParams;
      savedConfigs.push(p);
      const nextStatus: MaximaLookupStatusResult = {
        enabled: p.enabled,
        domain: p.domain.replace(/\/+$/, ''),
        hasToken: Boolean(p.token || (p.useStoredToken && status.hasToken)),
        tokenReadable: true,
        verified: p.enabled,
        tokenPageUrl: `${p.domain.replace(/\/+$/, '')}/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token`,
      };
      const nextSettings: Settings = {
        ...settings,
        maximaLibrary: {
          enabled: nextStatus.enabled,
          domain: nextStatus.domain,
          verifiedFingerprint: nextStatus.verified ? 'a'.repeat(64) : '',
        },
      };
      return { settings: nextSettings, status: nextStatus };
    },
    'job.cancel': (params: unknown) => {
      cancelledJobs.push((params as { jobId: string }).jobId);
      return {};
    },
  });

  // Intercept `runJob('maximaLookup.test', ...)` directly so tests control outcomes & cancellation.
  const client = rpc.client;
  const origRunJob = client.runJob.bind(client);
  client.runJob = (async (
    method: string,
    params?: unknown,
    opts?: { onStart?: (id: string) => void },
  ) => {
    if (method === 'maximaLookup.test') {
      if (options.onTest) {
        return options.onTest(params as MaximaLookupTestParams, opts?.onStart);
      }
      opts?.onStart?.('job-test-1');
      return {
        ok: true,
        code: '',
        message: '',
        verifiedFingerprint: 'a'.repeat(64),
        normalizedDomain: (params as MaximaLookupTestParams).domain.replace(/\/+$/, ''),
      } satisfies MaximaLookupTestOutcome;
    }
    return (origRunJob as (m: string, p?: unknown, o?: unknown) => Promise<unknown>)(
      method,
      params,
      opts,
    );
  }) as typeof client.runJob;

  const ctx = await makeContext({ rpc: client, hotkeys: new HotkeyMap('linux') });
  actions.setConnection(ctx.store, 'connected');
  actions.setSettings(ctx.store, settings);
  const commands = createCommandRegistry();
  const root = document.createElement('div');
  const feature = registerSettingsRuntime(
    { store: ctx.store, hotkeys: ctx.hotkeys, commands },
    { root, window: null, search: '' },
  );
  await feature.attach(client);
  const onClose = vi.fn();

  return { ctx, feature, rpc, onClose, cancelledJobs, savedConfigs };
}

describe('Settings -> Maxima Library integration (T016)', () => {
  it('defaults to unchecked with https://maxima-library.com and disables all dependent controls', async () => {
    const { ctx, feature, onClose } = await setupSettingsDialog();
    render(
      <SettingsDialog ctx={ctx} feature={feature} onClose={onClose} initialPage="maximaLibrary" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-enable')).not.toBeChecked();
    });
    expect(screen.getByTestId('settings-maxima-domain')).toHaveValue('https://maxima-library.com');
    expect(screen.getByTestId('settings-maxima-domain')).toBeDisabled();
    expect(screen.getByTestId('settings-maxima-token')).toBeDisabled();
    expect(screen.getByTestId('settings-maxima-reveal')).toBeDisabled();
    expect(screen.getByTestId('settings-maxima-test')).toBeDisabled();
    expect(screen.getByTestId('settings-maxima-token-link').tagName).toBe('SPAN');
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeEnabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();
  });

  it('gates Apply and OK until Test integration succeeds, invalidates on edit, and unlocks on re-test', async () => {
    const user = userEvent.setup();
    let shouldFail = true;
    const { ctx, feature, onClose, savedConfigs } = await setupSettingsDialog({
      onTest: async (params) => {
        if (shouldFail) {
          return { ok: false, code: 'invalid_token', message: 'Invalid token' };
        }
        return {
          ok: true,
          code: '',
          message: '',
          verifiedFingerprint: 'b'.repeat(64),
          normalizedDomain: params.domain.replace(/\/+$/, ''),
        };
      },
    });

    render(
      <SettingsDialog ctx={ctx} feature={feature} onClose={onClose} initialPage="maximaLibrary" />,
    );

    const enable = screen.getByTestId('settings-maxima-enable');
    await user.click(enable);

    // Checked & untested: Apply and OK disabled; token link becomes active <a>.
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeDisabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();
    const link = screen.getByTestId('settings-maxima-token-link');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute(
      'href',
      'https://maxima-library.com/index.php?option=com_maxlib&view=maxlibuserconfig&tab=token',
    );

    // Failed test keeps Apply/OK disabled and shows error.
    await user.type(screen.getByTestId('settings-maxima-token'), 'bad-tok');
    await user.click(screen.getByTestId('settings-maxima-test'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-status')).toHaveAttribute('data-status', 'failed');
    });
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeDisabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    // Passing test unlocks Apply/OK.
    shouldFail = false;
    await user.clear(screen.getByTestId('settings-maxima-token'));
    await user.type(screen.getByTestId('settings-maxima-token'), 'good-tok');
    await user.click(screen.getByTestId('settings-maxima-test'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-status')).toHaveAttribute(
        'data-status',
        'verified',
      );
    });
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeEnabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeEnabled();

    // Editing domain invalidates verified state immediately.
    await user.clear(screen.getByTestId('settings-maxima-domain'));
    await user.type(screen.getByTestId('settings-maxima-domain'), 'https://maxima.lordkiron.org');
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeDisabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    // Re-test succeeds -> Apply persists via maximaLookup.saveConfig.
    await user.click(screen.getByTestId('settings-maxima-test'));
    await waitFor(() => {
      expect(screen.getByTestId('dialog-settings-button-apply')).toBeEnabled();
    });
    await user.click(screen.getByTestId('dialog-settings-button-apply'));
    await waitFor(() => {
      expect(savedConfigs).toHaveLength(1);
    });
    expect(savedConfigs[0]).toEqual({
      enabled: true,
      domain: 'https://maxima.lordkiron.org',
      token: 'good-tok',
    });
    // After Apply, in-memory state matches the draft so Apply disables immediately.
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeEnabled();
  });

  it('reverts untested draft on tab leave (both from previously disabled and previously enabled) and restores OK while keeping Apply disabled when clean', async () => {
    const user = userEvent.setup();

    // Case 1: Previously disabled -> check Enable without testing -> switch to View tab -> reverts to unchecked.
    const d1 = await setupSettingsDialog();
    const { unmount } = render(
      <SettingsDialog
        ctx={d1.ctx}
        feature={d1.feature}
        onClose={d1.onClose}
        initialPage="maximaLibrary"
      />,
    );
    await user.click(screen.getByTestId('settings-maxima-enable'));
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeDisabled();

    await user.click(screen.getByTestId('settings-tab-view'));
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeEnabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    await user.click(screen.getByTestId('settings-tab-maximaLibrary'));
    expect(screen.getByTestId('settings-maxima-enable')).not.toBeChecked();
    unmount();

    // Case 2: Previously saved enabled -> edit domain without re-testing -> undo or switch tab -> restores saved verified domain.
    const savedStatus = makeStatus({
      enabled: true,
      domain: 'https://maxima-library.com',
      hasToken: true,
      tokenReadable: true,
      verified: true,
    });
    const savedSettings = defaultSettings({
      maximaLibrary: {
        enabled: true,
        domain: 'https://maxima-library.com',
        verifiedFingerprint: 'c'.repeat(64),
      },
    });
    const d2 = await setupSettingsDialog({
      initialSettings: savedSettings,
      initialStatus: savedStatus,
    });
    render(
      <SettingsDialog
        ctx={d2.ctx}
        feature={d2.feature}
        onClose={d2.onClose}
        initialPage="maximaLibrary"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-enable')).toBeChecked();
    });
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    // Editing domain away invalidates verified state; editing it back restores verified and disables Apply.
    await user.clear(screen.getByTestId('settings-maxima-domain'));
    await user.type(screen.getByTestId('settings-maxima-domain'), 'https://other.example.org');
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeDisabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    await user.clear(screen.getByTestId('settings-maxima-domain'));
    await user.type(screen.getByTestId('settings-maxima-domain'), 'https://maxima-library.com');
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeEnabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    // Edit away again, then leave tab -> reverts to saved verified domain.
    await user.clear(screen.getByTestId('settings-maxima-domain'));
    await user.type(screen.getByTestId('settings-maxima-domain'), 'https://other.example.org');
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeDisabled();

    await user.click(screen.getByTestId('settings-tab-view'));
    expect(screen.getByTestId('dialog-settings-button-ok')).toBeEnabled();
    expect(screen.getByTestId('dialog-settings-button-apply')).toBeDisabled();

    await user.click(screen.getByTestId('settings-tab-maximaLibrary'));
    expect(screen.getByTestId('settings-maxima-enable')).toBeChecked();
    expect(screen.getByTestId('settings-maxima-domain')).toHaveValue('https://maxima-library.com');
  });

  it('reveals stored token on explicit click, warns on unreadable token, and cancels in-flight test on Cancel', async () => {
    const user = userEvent.setup();
    const pendingRef: { resolve?: (value: MaximaLookupTestOutcome) => void } = {};
    const savedStatus = makeStatus({
      enabled: true,
      hasToken: true,
      tokenReadable: true,
      verified: true,
    });
    const savedSettings = defaultSettings({
      maximaLibrary: {
        enabled: true,
        domain: 'https://maxima-library.com',
        verifiedFingerprint: 'd'.repeat(64),
      },
    });
    const d = await setupSettingsDialog({
      initialSettings: savedSettings,
      initialStatus: savedStatus,
      revealedToken: { token: 'my-revealed-token', readable: true },
      onTest: (_params, onStart) => {
        onStart?.('job-slow-99');
        return new Promise<MaximaLookupTestOutcome>((resolve) => {
          pendingRef.resolve = resolve;
        });
      },
    });

    const { unmount } = render(
      <SettingsDialog
        ctx={d.ctx}
        feature={d.feature}
        onClose={d.onClose}
        initialPage="maximaLibrary"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-enable')).toBeChecked();
    });

    // Reveal stored token via RPC.
    expect(screen.getByTestId('settings-maxima-token')).toHaveAttribute('type', 'password');
    await user.click(screen.getByTestId('settings-maxima-reveal'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-token')).toHaveAttribute('type', 'text');
      expect(screen.getByTestId('settings-maxima-token')).toHaveValue('my-revealed-token');
    });

    // Start slow test, then click Cancel -> cancels job-slow-99 immediately.
    await user.click(screen.getByTestId('settings-maxima-test'));
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-status')).toHaveAttribute(
        'data-status',
        'testing',
      );
    });
    await user.click(screen.getByTestId('dialog-settings-button-cancel'));
    expect(d.cancelledJobs).toContain('job-slow-99');
    expect(d.onClose).toHaveBeenCalled();
    pendingRef.resolve?.({ ok: false, code: 'cancelled', message: '' });
    unmount();

    // Unreadable token notice renders when tokenReadable === false.
    const dBad = await setupSettingsDialog({
      initialStatus: makeStatus({ hasToken: true, tokenReadable: false, enabled: false }),
    });
    render(
      <SettingsDialog
        ctx={dBad.ctx}
        feature={dBad.feature}
        onClose={dBad.onClose}
        initialPage="maximaLibrary"
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('settings-maxima-unreadable')).toBeVisible();
    });
  });
});
