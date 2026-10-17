/**
 * The version check shared by Help > Check for new version and the scheduled check at
 * start-up (feature 003 US5, FR-041 to FR-045): `fetchLatest` records the check on any answer
 * and never on failure; the manual command keeps its three messages; `runScheduledCheck`
 * runs only when due, announces only a newer release - once no modal dialog, file dialog or
 * script run is active - and is silent on "latest" and on failure; a record later than now
 * is clamped to now before due-ness is decided.
 */

import { DialogService } from '@/dialogs/DialogService';
import {
  checkForNewVersion,
  fetchLatest,
  runScheduledCheck,
  whenQuiet,
  type QuietSources,
} from '@/features/help';
import { actions } from '@/model/store';
import type { ReleaseInfo, Settings, VersionCheckSchedule } from '@/rpc/types';

import { fakeRpc, makeContext, rpcError, type FakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const NOW = new Date('2026-10-17T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const NEWER: ReleaseInfo = {
  version: '99.0.1',
  tag: 'v99.0.1',
  url: 'https://github.com/QuarkZimmerman/MaximaFictionBookEditor/releases/tag/v99.0.1',
};

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

/** A fake RPC answering `app.latestRelease` from `answer` and recording settings patches. */
function rpcWith(answer: ReleaseInfo | Error | null, settings: Settings): FakeRpc {
  return fakeRpc({
    ...(answer === null ? {} : { 'app.latestRelease': answer }),
    'settings.set': (params: unknown) => {
      const patch = (params as { patch: { session?: Partial<Settings['session']> } }).patch;
      Object.assign(settings.session, patch.session);
      return { settings, restartRequired: false };
    },
  });
}

async function harness(options: {
  answer: ReleaseInfo | Error | null;
  schedule?: VersionCheckSchedule;
  last?: string;
  settings?: boolean;
}) {
  const settings = defaultSettings();
  settings.other.versionCheck = options.schedule ?? 'monthly';
  if (options.last !== undefined) settings.session.lastVersionCheck = options.last;
  const rpc = rpcWith(options.answer, settings);
  const ctx = await makeContext({ rpc: rpc.client, version: '0.0.3' });
  actions.setConnection(ctx.store, 'connected');
  if (options.settings !== false) actions.setSettings(ctx.store, settings);
  const dialogs = new DialogService();
  let fileDialogOpen = false;
  const fileDialogListeners = new Set<(open: boolean) => void>();
  const sources: QuietSources & { setFileDialog(open: boolean): void } = {
    dialogs,
    rpc: {
      get fileDialogOpen() {
        return fileDialogOpen;
      },
      onFileDialog: (listener) => {
        fileDialogListeners.add(listener);
        return () => {
          fileDialogListeners.delete(listener);
        };
      },
    },
    store: ctx.store,
    setFileDialog(open) {
      fileDialogOpen = open;
      for (const listener of [...fileDialogListeners]) listener(open);
    },
  };
  const recorded = () =>
    rpc.calls
      .filter((call) => call.method === 'settings.set')
      .map(
        (call) =>
          (call.params as { patch: { session: { lastVersionCheck: string } } }).patch.session
            .lastVersionCheck,
      );
  const requests = () => rpc.calls.filter((call) => call.method === 'app.latestRelease').length;
  return { ctx, rpc, settings, sources, recorded, requests };
}

describe('fetchLatest - request, comparison and the record (FR-041, FR-045)', () => {
  it('a newer release: "newer", and the time of the answer is recorded', async () => {
    const { ctx, recorded, settings } = await harness({ answer: NEWER });
    const outcome = await fetchLatest(ctx, () => NOW);
    expect(outcome).toEqual({ status: 'newer', release: NEWER });
    expect(recorded()).toEqual([NOW.toISOString()]);
    // The store mirrors the record at once (the next due-ness decision reads it there).
    expect(ctx.store.getState().settings?.session.lastVersionCheck).toBe(NOW.toISOString());
    expect(settings.session.lastVersionCheck).toBe(NOW.toISOString());
  });

  it('the same or an older version: "latest", recorded as well', async () => {
    for (const version of ['0.0.3', '0.0.1', '0.0.3.0']) {
      const { ctx, recorded } = await harness({
        answer: { version, tag: `v${version}`, url: 'https://example.invalid/' },
      });
      expect((await fetchLatest(ctx, () => NOW)).status).toBe('latest');
      expect(recorded()).toEqual([NOW.toISOString()]);
    }
  });

  it('no answer: "failed", nothing recorded', async () => {
    const { ctx, recorded } = await harness({
      answer: rpcError(1060, 'release unavailable', { reason: 'offline' }),
    });
    expect(await fetchLatest(ctx, () => NOW)).toEqual({ status: 'failed' });
    expect(recorded()).toEqual([]);
  });

  it('a failed write of the record is swallowed: the outcome stands', async () => {
    const { ctx, rpc } = await harness({ answer: NEWER });
    rpc.responses['settings.set'] = rpcError(1030, 'settings invalid');
    expect((await fetchLatest(ctx, () => NOW)).status).toBe('newer');
  });
});

describe('checkForNewVersion - Help > Check for new version keeps its three messages', () => {
  it('newer: the offer; Yes opens the page, No does nothing', async () => {
    const { ctx, recorded } = await harness({ answer: NEWER });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    ctx.dialogs.messageAnswers.push('no');
    await checkForNewVersion(ctx);
    expect(ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-version-new']);
    expect(ctx.dialogs.shown[0]!.text).toContain('99.0.1');
    expect(open).not.toHaveBeenCalled();
    expect(recorded()).toHaveLength(1);

    ctx.dialogs.messageAnswers.push('yes');
    await checkForNewVersion(ctx);
    expect(open).toHaveBeenCalledWith(NEWER.url, '_blank', 'noopener');
    expect(recorded()).toHaveLength(2);
    open.mockRestore();
  });

  it('latest: "You have the latest version", recorded', async () => {
    const { ctx, recorded } = await harness({
      answer: { version: '0.0.3', tag: 'v0.0.3', url: 'https://example.invalid/' },
    });
    await checkForNewVersion(ctx);
    expect(ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-version-latest']);
    expect(recorded()).toHaveLength(1);
  });

  it('no answer: "Can\'t connect to server", nothing recorded', async () => {
    const { ctx, recorded } = await harness({ answer: rpcError(1060, 'offline') });
    await checkForNewVersion(ctx);
    expect(ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-version-cant-connect']);
    expect(ctx.dialogs.shown[0]!.text).toBe("Can't connect to server");
    expect(recorded()).toEqual([]);
  });
});

describe('whenQuiet - no modal dialog, file dialog or script run (FR-043)', () => {
  it('resolves at once when nothing is active', async () => {
    const { sources } = await harness({ answer: null });
    await expect(whenQuiet(sources)).resolves.toBeUndefined();
  });

  it('waits for a modal dialog to close; a modeless one does not count', async () => {
    const { sources } = await harness({ answer: null });
    const dialogs = sources.dialogs as DialogService;
    void dialogs.open(() => null, { modeless: true });
    await expect(whenQuiet(sources)).resolves.toBeUndefined();

    void dialogs.open(() => null);
    let quiet = false;
    const waiting = whenQuiet(sources).then(() => {
      quiet = true;
    });
    await Promise.resolve();
    expect(quiet).toBe(false);
    dialogs.closeTop();
    await waiting;
    expect(quiet).toBe(true);
  });

  it('waits for a file dialog and for a script run to end', async () => {
    const { sources } = await harness({ answer: null });
    sources.setFileDialog(true);
    let quiet = false;
    const waiting = whenQuiet(sources).then(() => {
      quiet = true;
    });
    await Promise.resolve();
    expect(quiet).toBe(false);
    sources.setFileDialog(false);
    await waiting;

    actions.setScriptRunning(sources.store, true);
    quiet = false;
    const waitingRun = whenQuiet(sources).then(() => {
      quiet = true;
    });
    await Promise.resolve();
    expect(quiet).toBe(false);
    actions.setScriptRunning(sources.store, false);
    await waitingRun;
    expect(quiet).toBe(true);
  });

  it('waits for the last of several blockers, and resolves once', async () => {
    const { sources } = await harness({ answer: null });
    const dialogs = sources.dialogs as DialogService;
    void dialogs.open(() => null);
    actions.setScriptRunning(sources.store, true);
    let resolved = 0;
    const waiting = whenQuiet(sources).then(() => {
      resolved += 1;
    });
    dialogs.closeTop();
    await Promise.resolve();
    expect(resolved).toBe(0);
    actions.setScriptRunning(sources.store, false);
    await waiting;
    void dialogs.open(() => null);
    dialogs.closeTop();
    await Promise.resolve();
    expect(resolved).toBe(1);
  });
});

describe('runScheduledCheck - the check at start-up (FR-042, FR-043)', () => {
  it('not due: no request, nothing shown, the record untouched', async () => {
    const { ctx, sources, requests, recorded } = await harness({
      answer: NEWER,
      schedule: 'weekly',
      last: ago(2 * DAY),
    });
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('skipped');
    expect(requests()).toBe(0);
    expect(recorded()).toEqual([]);
    expect(ctx.dialogs.shown).toEqual([]);
  });

  it('"never": no request even without a record', async () => {
    const { ctx, sources, requests } = await harness({ answer: NEWER, schedule: 'never' });
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('skipped');
    expect(requests()).toBe(0);
  });

  it('due and newer: the manual prompt, after the record', async () => {
    const { ctx, sources, requests, recorded, rpc } = await harness({
      answer: NEWER,
      schedule: 'weekly',
      last: ago(8 * DAY),
    });
    ctx.dialogs.messageAnswers.push('no');
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('newer');
    expect(requests()).toBe(1);
    expect(recorded()).toEqual([NOW.toISOString()]);
    expect(ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-version-new']);
    expect(ctx.dialogs.shown[0]!.buttons).toBe('yesNo');
    // Nothing but the request and the record went to the core.
    expect(rpc.calls.map((c) => c.method)).toEqual(['app.latestRelease', 'settings.set']);
  });

  it('the same newer version is announced again at the next due check', async () => {
    const { ctx, sources, settings } = await harness({
      answer: NEWER,
      schedule: 'daily',
      last: ago(2 * DAY),
    });
    ctx.dialogs.messageAnswers.push('no', 'no');
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('newer');
    // The next day, with the record of this check in place.
    actions.setSettings(ctx.store, settings);
    const tomorrow = new Date(NOW.getTime() + DAY);
    expect(await runScheduledCheck(ctx, sources, () => tomorrow)).toBe('newer');
    expect(ctx.dialogs.shown).toHaveLength(2);
  });

  it('due and latest: silent, the check recorded', async () => {
    const { ctx, sources, requests, recorded } = await harness({
      answer: { version: '0.0.3', tag: 'v0.0.3', url: 'https://example.invalid/' },
      schedule: 'monthly',
    });
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('latest');
    expect(requests()).toBe(1);
    expect(recorded()).toEqual([NOW.toISOString()]);
    expect(ctx.dialogs.shown).toEqual([]);
  });

  it('due and no answer: silent, nothing recorded, nothing logged', async () => {
    const { ctx, sources, requests, recorded, rpc } = await harness({
      answer: rpcError(1060, 'release unavailable', { reason: 'timeout' }),
      schedule: 'daily',
      last: ago(3 * DAY),
    });
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('failed');
    expect(requests()).toBe(1);
    expect(recorded()).toEqual([]);
    expect(ctx.dialogs.shown).toEqual([]);
    expect(rpc.calls.some((c) => c.method === 'log.error')).toBe(false);
  });

  it('the newer prompt waits until the modal dialog has closed', async () => {
    const { ctx, sources, recorded } = await harness({ answer: NEWER, schedule: 'everyStart' });
    const dialogs = sources.dialogs as DialogService;
    void dialogs.open(() => null);
    ctx.dialogs.messageAnswers.push('no');
    let result: string | null = null;
    const run = runScheduledCheck(ctx, sources, () => NOW).then((r) => {
      result = r;
    });
    await vi.waitFor(() => expect(recorded()).toHaveLength(1));
    await Promise.resolve();
    expect(ctx.dialogs.shown).toEqual([]);
    expect(result).toBeNull();
    dialogs.closeTop();
    await run;
    expect(result).toBe('newer');
    expect(ctx.dialogs.shown.map((m) => m.testId)).toEqual(['dialog-version-new']);
  });

  it('the newer prompt waits for a script run to end', async () => {
    const { ctx, sources } = await harness({ answer: NEWER, schedule: 'everyStart' });
    actions.setScriptRunning(ctx.store, true);
    ctx.dialogs.messageAnswers.push('no');
    const run = runScheduledCheck(ctx, sources, () => NOW);
    await vi.waitFor(() =>
      expect(sources.store.getState().settings?.session.lastVersionCheck).toBe(NOW.toISOString()),
    );
    await Promise.resolve();
    expect(ctx.dialogs.shown).toEqual([]);
    actions.setScriptRunning(ctx.store, false);
    expect(await run).toBe('newer');
    expect(ctx.dialogs.shown).toHaveLength(1);
  });

  it('a record later than now is recorded as now first, and the check is not due', async () => {
    const future = ago(-30 * DAY);
    const { ctx, sources, requests, recorded, settings } = await harness({
      answer: NEWER,
      schedule: 'monthly',
      last: future,
    });
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('skipped');
    expect(recorded()).toEqual([NOW.toISOString()]);
    expect(settings.session.lastVersionCheck).toBe(NOW.toISOString());
    expect(requests()).toBe(0);
    // "At every start" still checks (and records the answer over the clamp).
    settings.other.versionCheck = 'everyStart';
    settings.session.lastVersionCheck = future;
    actions.setSettings(ctx.store, settings);
    ctx.dialogs.messageAnswers.push('no');
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('newer');
    expect(requests()).toBe(1);
    expect(recorded()).toEqual([NOW.toISOString(), NOW.toISOString(), NOW.toISOString()]);
  });

  it('without settings (an older core) or without a core nothing happens', async () => {
    const { ctx, sources, requests } = await harness({ answer: NEWER, settings: false });
    expect(await runScheduledCheck(ctx, sources, () => NOW)).toBe('skipped');
    expect(requests()).toBe(0);
    const offline = await makeContext();
    expect(await runScheduledCheck(offline, { ...sources, rpc: null }, () => NOW)).toBe('skipped');
  });
});
