/**
 * Registration of the AI assistant (feature 005 T031; research R8.3-R8.4; data-model §3.1, §3.3
 * "start-up"; FR-094, FR-096 to FR-098; the visibility model of FR-040 / FR-096 as amended on
 * 2026-10-23, T100): nothing is registered before the first settings snapshot; the live
 * `ai.toggle` takes its stub over in every mode (it shows and hides the panel), `ai.ask` and
 * `ai.cancel` join it for the `free` and `custom` modes and only then; `disabled` leaves the
 * stub of `ai.ask` (invisible, inert) and no `ai.cancel`; a core with `apiMinor` 3 gets nothing
 * and `coreTooOld`; a mode change re-registers or de-registers without a reload; the chunk is
 * imported once, on the first turn-on - the start-up restore of a visible panel included -,
 * never while the panel is hidden or the mode is disabled; and the `__mfbeTest.ai` hooks
 * report it all.
 *
 * The transitions of data-model §3.3 (US3 T053; FR-091 to FR-095): the panel's visibility
 * (`store.ai.visible`, the session key `aiPanelVisible`, true by default) is the user's toggle;
 * `on` (live) follows it while the mode is a service. The turn-on opens the panel with the
 * focus in its field and sends nothing; hiding turns the assistant off - clears the
 * conversation and the slot without touching the document; hiding while a request runs asks
 * `dialog-ai-stop-confirm` (No: nothing changes, Yes: cancelled first, then off and hidden);
 * the document replaced clears the conversation with the panel open; Disabled chosen in
 * Settings while a request runs asks the same question before OK (`beforeApply`); the quit
 * flow's prompt names the AI request.
 *
 * The Disabled transitions of data-model §3.3 rows "settings OK, mode → disabled" and
 * "disabled → free | custom" (US9 T064-T066; FR-096 to FR-098): the de-registration restores
 * the inert stub of `ai.ask`, removes `ai.cancel` and the context-menu slot, drops the catalogue
 * and the conversation and leaves a visible panel visible - inert (`feature.inert`, the static
 * `DisabledPanel` in App.tsx) -, the View entry, the toolbar button and the hotkey staying; a
 * request still running then is cancelled and waited for; `enabled` / `canAsk` / `canSend` are
 * false under `disabled` whatever the rest of the state; no dynamic import happens while hidden
 * or disabled; the re-registration brings the live commands back and makes a visible panel
 * live again without a second import, a hidden one staying hidden.
 */

import {
  AiFeature,
  getAiFeature,
  registerAiFeature,
  unregisterAiFeature,
  type AiChunkModule,
} from '@/ai';
import { appendActivity, appendMessage, conversationFor } from '@/ai/activity';
import { aiTestHooks } from '@/ai/testHooks';
import { createCommandRegistry, type CommandContext, type CommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import type { FeatureContext } from '@/app/services';
import { FileFeature } from '@/features/file/fileCommands';
import { CaretRegistry } from '@/model/caret';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import type { MessageButtonId, Settings } from '@/rpc/types';
import { contextMenuExtensions } from '@/views/body/contextMenuExtensions';

import {
  fakeDialogs,
  fakeDocument,
  fakeRpc,
  rpcError,
  type FakeDialogs,
  type FakeRpc,
} from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

/**
 * Lets the feature's asynchronous settings handling (the `app.info` check) run to its end. The
 * turn-on a snapshot or a show may start is a matter of `feature.pendingTurnOn`: the import of
 * the real chunk - the file's first takes a few hundred milliseconds on a fast machine, well
 * over a second on a loaded CI runner - takes as long as it takes, so a test awaits it rather
 * than a number of ticks or `vi.waitFor`'s second.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A snapshot with the mode and, as the first snapshot adopts it, the stored panel visibility. */
function settingsWithMode(mode: Settings['ai']['mode'], panelVisible = true): Settings {
  const settings = defaultSettings();
  settings.ai.mode = mode;
  settings.session.aiPanelVisible = panelVisible;
  return settings;
}

interface Harness {
  store: AppStore;
  commands: CommandRegistry;
  rpc: FakeRpc;
  feature: AiFeature;
  ctx: CommandContext;
  dialogs: FakeDialogs;
  load: ReturnType<typeof vi.fn>;
}

/** The harness of the running test: `stopLeftovers` turns a live assistant off after it. */
let current: Pick<Harness, 'store' | 'feature'> | null = null;

/**
 * The catalogue instance of a turn-on lives in `assistant.ts`'s module state (one per page):
 * a test that leaves the assistant on would hand its instance to the next test's store. A
 * turn-on still under way (a test that failed while the chunk was imported) lands first, so
 * that it cannot turn the assistant on behind the next test's back.
 */
async function stopLeftovers(): Promise<void> {
  const harness = current;
  current = null;
  if (!harness) return;
  await harness.feature.pendingTurnOn?.catch(() => {});
  if (harness.store.getState().ai.on) harness.feature.assistant?.stopAssistant(harness.store);
}

function setup(
  options: {
    apiMinor?: number | Error;
    rpc?: false;
    module?: Partial<AiChunkModule>;
    answers?: MessageButtonId[];
    cancelWaitMs?: number;
  } = {},
): Harness {
  const store = createAppStore();
  const commands = createCommandRegistry();
  const rpc = fakeRpc({
    'app.info':
      options.apiMinor instanceof Error
        ? options.apiMinor
        : { version: '0.0.5', apiVersion: 1, apiMinor: options.apiMinor ?? 4, testHooks: false },
  });
  const load = vi.fn(async (): Promise<AiChunkModule> => {
    const real = await import('@/ai/chunk');
    return { ...real, ...options.module };
  });
  const featureContext: FeatureContext = {
    commands,
    rpc: options.rpc === false ? null : rpc.client,
    undo: new UndoCoordinator(),
    carets: new CaretRegistry(),
    store,
    hotkeys: new HotkeyMap('linux'),
  };
  const feature = registerAiFeature(featureContext, {
    loadAssistant: load,
    testHooks: true,
    ...(options.cancelWaitMs === undefined ? {} : { cancelWaitMs: options.cancelWaitMs }),
  });
  const dialogs = fakeDialogs(options.answers ?? []);
  const ctx: CommandContext = {
    store,
    rpc: featureContext.rpc ?? null,
    undo: featureContext.undo,
    dialogs,
    hotkeys: featureContext.hotkeys,
    t: ((key: string) => key) as unknown as CommandContext['t'],
    version: '0.0.5-test',
  };
  const harness: Harness = { store, commands, rpc, feature, ctx, dialogs, load };
  current = harness;
  return harness;
}

/**
 * A stand-in for a running request of the chunk: after `begin(store)` `activeRequest()` answers
 * it until `cancelRequest` is called, which ends it the way the loop does - the end entry and
 * the notice written, the lock released, the view dropped - after a tick.
 */
function requestStandIn(): {
  module: Partial<AiChunkModule>;
  begin(store: AppStore): void;
  cancelled(): number;
} {
  let active: { id: string; cancel(): void } | null = null;
  let cancelled = 0;
  return {
    module: {
      activeRequest: () => active,
      cancelRequest: (store: AppStore) => {
        if (!active) return;
        cancelled += 1;
        setTimeout(() => {
          appendActivity(store, { requestId: 'r9', elapsedMs: 10, kind: 'request.cancelled' });
          appendMessage(store, { requestId: 'r9', role: 'notice', text: 'Request cancelled.' });
          actions.setRunLock(store, null);
          actions.updateAi(store, { request: null });
          active = null;
        }, 5);
      },
    },
    begin(store) {
      active = { id: 'r9', cancel() {} };
      actions.setRunLock(store, { kind: 'ai', label: 'Svc · m', startedAt: Date.now() });
      actions.updateAi(store, {
        request: { id: 'r9', origin: 'panel', state: 'exchanging', startedAt: Date.now() },
      });
      conversationFor(store, store.getState().docId ?? 'doc-1');
      appendMessage(store, { requestId: 'r9', role: 'user', text: 'instruction' });
    },
    cancelled: () => cancelled,
  };
}

/** Lets a cancelled stand-in request end and the feature's wait notice it. */
async function settleCancel(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 60));
}

/** A conversation of the open document, as the loop leaves one behind. */
function conversationWith(store: AppStore, docId = 'doc-1'): void {
  conversationFor(store, docId);
  appendMessage(store, { requestId: 'r1', role: 'user', text: 'Make titles title case' });
  appendActivity(store, { requestId: 'r1', elapsedMs: 5, kind: 'request.done' });
  appendMessage(store, { requestId: 'r1', role: 'assistant', text: 'Done.' });
}

function ids(commands: CommandRegistry): string[] {
  return commands
    .all()
    .map((c) => c.id)
    .filter((id) => id.startsWith('ai.'))
    .sort();
}

describe('AI assistant registration', () => {
  afterEach(async () => {
    await stopLeftovers();
    delete (window as { __mfbeTest?: unknown }).__mfbeTest;
  });

  it('registers nothing before the first settings snapshot', async () => {
    const { commands, feature, rpc, ctx, load } = setup();
    await settle();
    expect(feature.status).toBe('waiting');
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    expect(commands.get('ai.toggle')!.stub).toBe(true);
    expect(commands.isVisible('ai.toggle', ctx)).toBe(false);
    expect(commands.isEnabled('ai.toggle', ctx)).toBe(false);
    expect(rpc.calls).toEqual([]); // not even the version check
    expect(load).not.toHaveBeenCalled();
    expect(feature.enabled()).toBe(false);
  });

  it.each(['free', 'custom'] as const)(
    'takes the stubs over with the three live commands for the %s mode (the panel hidden: nothing loaded)',
    async (mode) => {
      const { store, commands, feature, rpc, ctx, load } = setup();
      // As a session with the panel closed restores it: the first snapshot adopts `visible`.
      actions.setSettings(store, settingsWithMode(mode, false));
      await settle();
      expect(feature.status).toBe('registered');
      expect(feature.coreTooOld).toBe(false);
      expect(feature.enabled()).toBe(true);
      expect(rpc.calls.map((c) => c.method)).toEqual(['app.info']);
      expect(ids(commands)).toEqual(['ai.ask', 'ai.cancel', 'ai.toggle']);

      // View → AI Assistant: visible, a toggle checked while the panel is shown, enabled in
      // every state - it only shows and hides the panel (FR-040 as amended).
      const toggle = commands.get('ai.toggle')!;
      expect(toggle.stub).toBeUndefined();
      expect(toggle.labelKey).toBe('menu.view.aiAssistant');
      expect(toggle.icon).toBe('ai-assistant');
      expect(toggle.group).toBe('view');
      expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
      expect(commands.isChecked('ai.toggle', ctx)).toBe(false);
      expect(commands.isEnabled('ai.toggle', ctx)).toBe(true); // no document needed
      actions.setDocument(store, fakeDocument());
      expect(commands.isEnabled('ai.toggle', ctx)).toBe(true);

      // Ask AI: visible and enabled only while on; Stop: disabled while no request runs.
      expect(commands.isVisible('ai.ask', ctx)).toBe(false);
      expect(commands.isEnabled('ai.ask', ctx)).toBe(false);
      expect(feature.canAsk(ctx)).toBe(false);
      expect(commands.get('ai.cancel')!.group).toBe('tools');
      expect(commands.isVisible('ai.cancel', ctx)).toBe(true);
      expect(commands.isEnabled('ai.cancel', ctx)).toBe(false);

      // Nothing was loaded: the chunk is imported on the first turn-on only (SC-013).
      expect(load).not.toHaveBeenCalled();
      expect(store.getState().ai.loaded).toBe(false);
      expect(store.getState().ai.on).toBe(false);
      expect(store.getState().ai.visible).toBe(false);
    },
  );

  it('restores a visible panel live at start-up: the first snapshot with a service imports the chunk once and turns on, nothing sent (FR-040 as amended)', async () => {
    const { store, commands, feature, rpc, ctx, load } = setup();
    expect(store.getState().ai.visible).toBe(true); // the default: open at the first start
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(feature.status).toBe('registered');
    expect(load).toHaveBeenCalledTimes(1);
    // The turn-on the snapshot started: the chunk's import (the file's first, the slow one)
    // and `startAssistant`; null - and `on` still false below - had none been started.
    await feature.pendingTurnOn;
    expect(store.getState().ai).toMatchObject({ visible: true, on: true, loaded: true });
    expect(store.getState().ai.panelFocus).toBe(false); // the restore does not steal the focus
    expect(commands.isChecked('ai.toggle', ctx)).toBe(true);
    expect(rpc.calls.map((c) => c.method)).toEqual(['app.info']); // no service, no context
    expect(store.getState().runLock).toBeNull();
    expect(feature.inert).toBe(false);
    // A later snapshot with the same mode changes nothing.
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().ai.on).toBe(true);
  });

  it('leaves the stub of ai.ask for the disabled mode: the toggle live, no ai.cancel, nothing loaded, a visible panel inert', async () => {
    const { store, commands, feature, ctx, load } = setup();
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(feature.status).toBe('disabled');
    expect(feature.enabled()).toBe(false);
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    // The View entry, the toolbar button and the hotkey stay: they show and hide the panel.
    expect(commands.get('ai.toggle')!.stub).toBeUndefined();
    expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
    expect(commands.isEnabled('ai.toggle', ctx)).toBe(true);
    expect(commands.isChecked('ai.toggle', ctx)).toBe(true); // the panel is shown (inert)
    // Ask AI: the inert, invisible stub; its chord dispatches nothing.
    expect(commands.get('ai.ask')!.stub).toBe(true);
    expect(commands.isVisible('ai.ask', ctx)).toBe(false);
    expect(commands.isEnabled('ai.ask', ctx)).toBe(false);
    expect(commands.dispatch('ai.ask', ctx)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().ai.on).toBe(false);
    expect(store.getState().ai.visible).toBe(true);
    expect(feature.inert).toBe(true);
    // The hooks read the same picture (US9's journey).
    expect(aiTestHooks()!.status()).toBe('disabled');
    expect(aiTestHooks()!.on).toBe(false);
    expect(aiTestHooks()!.state().visible).toBe(true);
    expect(aiTestHooks()!.commands()).toEqual([
      { id: 'ai.toggle', visible: true, enabled: true, stub: false },
      { id: 'ai.ask', visible: false, enabled: false, stub: true },
    ]);
    // The toggle hides and shows the inert panel without loading anything.
    expect(commands.dispatch('ai.toggle', ctx)).toBe(true);
    await settle();
    expect(store.getState().ai.visible).toBe(false);
    expect(feature.inert).toBe(false);
    expect(commands.isChecked('ai.toggle', ctx)).toBe(false);
    await feature.toggle(ctx);
    expect(store.getState().ai.visible).toBe(true);
    expect(feature.inert).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().ai.on).toBe(false);
  });

  it('registers nothing with a core before API minor 4 and says so', async () => {
    const { store, commands, feature } = setup({ apiMinor: 3 });
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(feature.status).toBe('coreTooOld');
    expect(feature.coreTooOld).toBe(true);
    expect(feature.enabled()).toBe(false);
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    expect(commands.get('ai.toggle')!.stub).toBe(true);
    // A snapshot without the `ai` group is an old core's as well.
    const older = setup();
    const legacy = defaultSettings();
    delete (legacy as Partial<Settings>).ai;
    actions.setSettings(older.store, legacy);
    await settle();
    expect(older.feature.status).toBe('coreTooOld');
    expect(older.feature.coreTooOld).toBe(true);
  });

  it('asks app.info again with the next snapshot when the first call failed', async () => {
    const { store, feature, rpc } = setup({ apiMinor: rpcError(-32000, 'not yet') });
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(feature.status).toBe('waiting');
    expect(feature.coreTooOld).toBe(false);
    rpc.responses['app.info'] = { apiMinor: 4 };
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(feature.status).toBe('registered');
    expect(rpc.calls.filter((c) => c.method === 'app.info')).toHaveLength(2);
  });

  it('turns on with one import of the chunk, off without a new one; the hooks follow', async () => {
    const { store, commands, feature, ctx, load } = setup();
    actions.setSettings(store, settingsWithMode('free', false)); // the panel hidden
    actions.setDocument(store, fakeDocument());
    await settle();
    expect(load).not.toHaveBeenCalled(); // hidden: nothing of the chunk

    expect(await commands.execute('ai.toggle', ctx)).toBe(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().ai).toMatchObject({
      visible: true,
      on: true,
      loaded: true,
      request: null,
    });
    expect(store.getState().ai.conversation.messages).toEqual([]);
    expect(commands.isChecked('ai.toggle', ctx)).toBe(true);
    expect(commands.isVisible('ai.ask', ctx)).toBe(true);
    expect(commands.isEnabled('ai.ask', ctx)).toBe(true); // Body view, a document, no lock
    expect(feature.canAsk(ctx)).toBe(true);
    expect(feature.canSend(ctx)).toBe(true);
    // Not in the Description view, not while a run holds the lock.
    actions.setActiveView(store, 'description');
    expect(feature.canAsk(ctx)).toBe(false);
    actions.setActiveView(store, 'source');
    expect(feature.canAsk(ctx)).toBe(true);
    actions.setRunLock(store, { kind: 'script', label: 'x', startedAt: Date.now() });
    expect(feature.canAsk(ctx)).toBe(false);
    expect(commands.isEnabled('ai.ask', ctx)).toBe(false);
    expect(commands.isEnabled('ai.toggle', ctx)).toBe(true); // turning off is always possible
    actions.setRunLock(store, null);
    // Nothing was sent, locked or changed by the turn-on (FR-091).
    expect(store.getState().runLock).toBeNull();
    expect(store.getState().modified).toBe(false);

    const hooks = aiTestHooks()!;
    expect(hooks.on).toBe(true);
    expect(hooks.status()).toBe('registered');
    // The one catalogue instance of the turn-on (data-model §8.5): built in memory - nothing
    // listens, nothing is sent, no outline is computed - and dropped at turn-off.
    await vi.waitFor(() => expect(hooks.state().catalogue).toBe(true));
    expect(hooks.state()).toMatchObject({
      visible: true,
      on: true,
      loaded: true,
      catalogue: true,
      width: 360,
    });
    expect(store.getState().runLock).toBeNull();
    expect(hooks.commands()).toEqual([
      { id: 'ai.toggle', visible: true, enabled: true, stub: false },
      { id: 'ai.ask', visible: true, enabled: true, stub: false },
      { id: 'ai.cancel', visible: true, enabled: false, stub: false },
    ]);
    expect(hooks.lastRequest()).toBeNull();

    // Off = hidden: the toggle hides the panel and turns the assistant off.
    expect(await commands.execute('ai.toggle', ctx)).toBe(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1); // the module is kept
    expect(store.getState().ai).toMatchObject({
      visible: false,
      on: false,
      loaded: true,
      request: null,
    });
    expect(commands.isChecked('ai.toggle', ctx)).toBe(false);
    expect(commands.isVisible('ai.ask', ctx)).toBe(false);
    expect(hooks.on).toBe(false);

    // A request while the assistant is off (the UI never asks then) answers `failed
    // (internal)` without touching anything; there is nothing to cancel.
    const module = feature.assistant!;
    await expect(module.startRequest(ctx, { origin: 'panel', instruction: 'x' })).resolves.toEqual({
      kind: 'failed',
      failure: { kind: 'internal' },
    });
    module.cancelRequest(store);
    expect(store.getState().ai.on).toBe(false);
  });

  it('de-registers when the mode becomes disabled and re-registers when it changes back, without a reload (FR-097)', async () => {
    const { store, commands, feature, ctx, load } = setup();
    const statuses: string[] = [];
    feature.subscribe(() => statuses.push(feature.status));
    actions.setSettings(store, settingsWithMode('free'));
    actions.setDocument(store, fakeDocument());
    await settle();
    await feature.pendingTurnOn;
    expect(store.getState().ai.on).toBe(true); // the visible panel restored live

    // Settings OK with Disabled: the panel stays visible but inert, the conversation is
    // dropped, `ai.ask` is its stub, `ai.cancel` is gone; the toggle stays live.
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(feature.status).toBe('disabled');
    expect(store.getState().ai).toMatchObject({
      visible: true,
      on: false,
      request: null,
      catalogue: null,
    });
    expect(feature.inert).toBe(true);
    expect(store.getState().ai.conversation).toEqual({
      docId: null,
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    expect(store.getState().ai.loaded).toBe(true); // the imported chunk stays idle
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    expect(commands.get('ai.toggle')!.stub).toBeUndefined();
    expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
    expect(commands.get('ai.ask')!.stub).toBe(true);
    expect(commands.dispatch('ai.ask', ctx)).toBe(false);
    expect(aiTestHooks()!.commands()).toEqual([
      { id: 'ai.toggle', visible: true, enabled: true, stub: false },
      { id: 'ai.ask', visible: false, enabled: false, stub: true },
    ]);

    // Back to a live mode: the commands return and the visible panel is live again without
    // a second import.
    actions.setSettings(store, settingsWithMode('custom'));
    await settle();
    await feature.pendingTurnOn;
    expect(feature.status).toBe('registered');
    expect(ids(commands)).toEqual(['ai.ask', 'ai.cancel', 'ai.toggle']);
    expect(commands.get('ai.toggle')!.stub).toBeUndefined();
    expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
    expect(store.getState().ai.on).toBe(true);
    expect(feature.inert).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['registered', 'disabled', 'registered']);

    // A later snapshot with the same mode changes nothing; the same registry instance keeps
    // the live commands.
    const toggle = commands.get('ai.toggle');
    actions.setSettings(store, settingsWithMode('custom'));
    await settle();
    expect(commands.get('ai.toggle')).toBe(toggle);
    expect(statuses).toHaveLength(3);
  });

  it('is registered once per store and found by getAiFeature; without a core there is nothing too old', async () => {
    const { store, feature } = setup({ rpc: false });
    expect(getAiFeature(store)).toBe(feature);
    const again = registerAiFeature({
      commands: createCommandRegistry(),
      rpc: null,
      undo: new UndoCoordinator(),
      carets: new CaretRegistry(),
      store,
      hotkeys: new HotkeyMap('linux'),
    });
    expect(again).toBe(feature);
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(feature.status).toBe('registered'); // UI-only run: no version check possible
    expect(feature.coreTooOld).toBe(false);
    unregisterAiFeature(store);
    expect(getAiFeature(store)).toBeUndefined();
    // Disposed: a later snapshot changes nothing.
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(feature.status).toBe('registered');
  });

  it('counts a snapshot that arrived before the registrar as the first one', async () => {
    const store = createAppStore();
    actions.setSettings(store, settingsWithMode('free'));
    const commands = createCommandRegistry();
    const rpc = fakeRpc({ 'app.info': { apiMinor: 4 } });
    const feature = registerAiFeature({
      commands,
      rpc: rpc.client,
      undo: new UndoCoordinator(),
      carets: new CaretRegistry(),
      store,
      hotkeys: new HotkeyMap('linux'),
    });
    current = { store, feature }; // the visible panel is restored live: `stopLeftovers` turns it off
    await settle();
    expect(feature.status).toBe('registered');
    expect(commands.has('ai.cancel')).toBe(true);
  });
});

describe('AI assistant transitions (data-model §3.3)', () => {
  afterEach(async () => {
    await stopLeftovers();
    delete (window as { __mfbeTest?: unknown }).__mfbeTest;
  });

  /** A registered feature with a document, the panel hidden (the assistant off). */
  async function registered(options: Parameters<typeof setup>[0] = {}): Promise<Harness> {
    const harness = setup(options);
    actions.setSettings(harness.store, settingsWithMode('free', false));
    actions.setDocument(harness.store, fakeDocument());
    await settle();
    expect(harness.store.getState().ai.on).toBe(false);
    return harness;
  }

  it('turns on: the chunk with the panel component, the focus asked for, nothing sent or locked (FR-091)', async () => {
    const { store, commands, feature, ctx, rpc, load } = await registered();
    await commands.execute('ai.toggle', ctx);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().ai).toMatchObject({
      visible: true,
      on: true,
      loaded: true,
      panelFocus: true,
    });
    expect(feature.panel).not.toBeNull(); // App.tsx renders it inside the right pane
    expect(feature.panel).toBe(feature.assistant && (await import('@/ai/chunk')).AiPanel);
    expect(store.getState().ai.width).toBe(360);
    expect(rpc.calls.map((c) => c.method)).toEqual(['app.info']); // no service, no context
    expect(store.getState().runLock).toBeNull();
    expect(store.getState().modified).toBe(false);
    expect(ctx.undo.canUndo).toBe(false);
    expect(feature.requestRunning()).toBe(false);
    // The second toggle hides the panel (off); the third shows it again without an import.
    await feature.toggle(ctx);
    await settle();
    expect(store.getState().ai).toMatchObject({ visible: false, on: false });
    await feature.toggle(ctx);
    expect(store.getState().ai).toMatchObject({ visible: true, on: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('turns off idle: the panel hidden, the conversation gone, nothing of the document touched, no question asked (FR-092, FR-095)', async () => {
    const { store, commands, feature, ctx, dialogs } = await registered();
    await commands.execute('ai.toggle', ctx);
    await settle();
    conversationWith(store);
    expect(store.getState().ai.conversation.messages).toHaveLength(2);

    await expect(feature.close(ctx)).resolves.toBe(true);
    expect(dialogs.shown).toEqual([]);
    expect(store.getState().ai).toMatchObject({
      visible: false,
      on: false,
      request: null,
      catalogue: null,
      panelFocus: false,
    });
    expect(store.getState().ai.conversation).toEqual({
      docId: null,
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    expect(feature.panel).not.toBeNull(); // the imported chunk stays idle
    expect(store.getState().modified).toBe(false);
    expect(store.getState().runLock).toBeNull();
    expect(ctx.undo.canUndo).toBe(false);
    expect(commands.isVisible('ai.ask', ctx)).toBe(false);
    // Off again is a no-op.
    await expect(feature.close(ctx)).resolves.toBe(true);
  });

  it('asks before turning off while a request runs: No leaves everything, Yes cancels first (FR-093)', async () => {
    const standIn = requestStandIn();
    const { store, commands, feature, ctx, dialogs } = await registered({
      module: standIn.module,
      answers: ['no', 'yes'],
    });
    await commands.execute('ai.toggle', ctx);
    await settle();
    standIn.begin(store);
    expect(feature.requestRunning()).toBe(true);
    expect(commands.isEnabled('ai.toggle', ctx)).toBe(true); // off is offered while locked

    // No: the panel and the request go on.
    await expect(commands.execute('ai.toggle', ctx)).resolves.toBe(true);
    expect(dialogs.shown).toHaveLength(1);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'dialog-ai-stop-confirm',
      text: 'ai.stopConfirm.closeText',
      caption: 'ai.stopConfirm.title',
      buttons: 'yesNo',
      defaultButton: 'no',
    });
    expect(standIn.cancelled()).toBe(0);
    expect(store.getState().ai.on).toBe(true);
    expect(store.getState().ai.request).not.toBeNull();
    expect(store.getState().runLock?.kind).toBe('ai');
    expect(store.getState().ai.conversation.messages).toHaveLength(1);

    // Yes: the request is cancelled and ends (its notice written), then the assistant is off
    // with nothing of the conversation left.
    const closing = feature.close(ctx);
    await new Promise((resolve) => setTimeout(resolve, 0)); // the question answered
    expect(standIn.cancelled()).toBe(1);
    expect(store.getState().ai.on).toBe(true); // not before the request has ended
    await settleCancel();
    await expect(closing).resolves.toBe(true);
    expect(dialogs.shown).toHaveLength(2);
    expect(store.getState().ai).toMatchObject({ on: false, request: null });
    expect(store.getState().ai.conversation.messages).toEqual([]);
    expect(store.getState().runLock).toBeNull();
  });

  it('joins a second close to the question already open', async () => {
    const standIn = requestStandIn();
    const { store, feature, ctx, dialogs } = await registered({
      module: standIn.module,
      answers: ['yes'],
    });
    await feature.toggle(ctx);
    await settle();
    standIn.begin(store);
    const first = feature.close(ctx);
    const second = feature.close(ctx);
    expect(second).toBe(first);
    await settleCancel();
    await expect(first).resolves.toBe(true);
    expect(dialogs.shown).toHaveLength(1);
    expect(standIn.cancelled()).toBe(1);
  });

  it('clears the conversation when the document is replaced, the panel staying open (FR-045)', async () => {
    const { store, feature, ctx } = await registered();
    await feature.toggle(ctx);
    await settle();
    conversationWith(store, 'doc-1');
    actions.setDocument(store, fakeDocument({ docId: 'doc-2' }));
    await settle();
    expect(store.getState().ai.on).toBe(true);
    expect(store.getState().ai.conversation).toEqual({
      docId: null,
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    // Closing the document empties it as well; a new one finds it empty.
    conversationWith(store, 'doc-2');
    actions.closeDocument(store);
    await settle();
    expect(store.getState().ai.conversation.messages).toEqual([]);
    expect(store.getState().ai.on).toBe(true);
  });

  it('cancels a running request first when the document is replaced, then clears', async () => {
    const standIn = requestStandIn();
    const { store, feature, ctx } = await registered({ module: standIn.module });
    await feature.toggle(ctx);
    await settle();
    standIn.begin(store);
    actions.setDocument(store, fakeDocument({ docId: 'doc-2' }));
    await settle();
    expect(standIn.cancelled()).toBe(1);
    await settleCancel();
    await settle();
    expect(store.getState().ai.on).toBe(true);
    expect(store.getState().ai.request).toBeNull();
    expect(store.getState().ai.conversation.messages).toEqual([]);
    expect(store.getState().ai.conversation.activity).toEqual([]);
  });

  it('leaves the conversation alone while the assistant is off or the document stays', async () => {
    const { store, feature, ctx } = await registered();
    actions.setDocument(store, fakeDocument({ docId: 'doc-2' })); // hidden: nothing to clear, nothing done
    expect(store.getState().ai.on).toBe(false);
    await feature.toggle(ctx);
    await settle();
    conversationWith(store, 'doc-2');
    actions.setModified(store, true); // the same document, another change of state
    await settle();
    expect(store.getState().ai.conversation.messages).toHaveLength(2);
  });

  it('asks before Settings OK applies Disabled while a request runs (FR-097): No keeps the dialog open', async () => {
    const standIn = requestStandIn();
    const { store, commands, feature, ctx, dialogs } = await registered({
      module: standIn.module,
      answers: ['no', 'yes'],
    });
    await commands.execute('ai.toggle', ctx); // remembers the context the hook asks with
    await settle();
    const free = settingsWithMode('free');
    const disabled = settingsWithMode('disabled');
    // Idle, or any other change: applies at once without a question.
    await expect(feature.beforeApply(disabled, free)).resolves.toBe('apply');
    await expect(feature.beforeApply(free, free)).resolves.toBe('apply');
    expect(dialogs.shown).toEqual([]);

    standIn.begin(store);
    await expect(feature.beforeApply(free, free)).resolves.toBe('apply'); // not Disabled
    await expect(feature.beforeApply(disabled, free)).resolves.toBe('keepOpen');
    expect(dialogs.shown).toHaveLength(1);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'dialog-ai-stop-confirm',
      text: 'ai.stopConfirm.disableText',
    });
    expect(standIn.cancelled()).toBe(0);
    expect(store.getState().ai.on).toBe(true);

    // Yes: the request is cancelled and has ended when the dialog applies; the snapshot with
    // Disabled then de-registers and turns the assistant off (T065's path, already in place).
    await expect(feature.beforeApply(disabled, free)).resolves.toBe('apply');
    expect(standIn.cancelled()).toBe(1);
    expect(store.getState().ai.request).toBeNull();
    actions.setSettings(store, disabled);
    await settle();
    expect(feature.status).toBe('disabled');
    expect(store.getState().ai).toMatchObject({ on: false, request: null });
    expect(store.getState().ai.conversation.messages).toEqual([]);
  });

  it('is disposed with its hook: a later turn-off question is not asked by a dead feature', async () => {
    const { store, feature } = await registered();
    unregisterAiFeature(store);
    const free = settingsWithMode('free');
    await expect(feature.beforeApply(settingsWithMode('disabled'), free)).resolves.toBe('apply');
  });

  it('exit while a request runs: the quit flow asks in the AI wording and cancels the run (FR-093)', async () => {
    const { store, ctx, dialogs } = await registered({ answers: ['no', 'yes'] });
    actions.setRunLock(store, { kind: 'ai', label: 'Svc · m', startedAt: Date.now() });
    const files = new FileFeature(createCommandRegistry());
    await expect(files.confirmCancelRunningScript(ctx)).resolves.toBe(false);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'cancel-run-prompt',
      text: 'ai.stopConfirm.exitText',
      caption: 'ai.stopConfirm.title',
    });
    expect(store.getState().runLock?.kind).toBe('ai');
    // Yes: the run is cancelled through its session (none here: the lock is released by hand
    // as the loop would) and the flow goes on to the save-changes prompt.
    const confirming = files.confirmCancelRunningScript(ctx);
    setTimeout(() => actions.setRunLock(store, null), 5);
    await expect(confirming).resolves.toBe(true);
    // A script run keeps the script wording.
    actions.setRunLock(store, { kind: 'script', label: 's', startedAt: Date.now() });
    dialogs.messageAnswers.push('no');
    await files.confirmCancelRunningScript(ctx);
    expect(dialogs.shown[2]).toMatchObject({
      text: 'msg.cancelRunningScript',
      caption: 'app.name',
    });
  });
});

describe('AI assistant Disabled transitions (US9; data-model §3.3, FR-096 to FR-098)', () => {
  afterEach(async () => {
    await stopLeftovers();
    delete (window as { __mfbeTest?: unknown }).__mfbeTest;
    delete contextMenuExtensions.ai;
  });

  /** A registered feature with a document, the assistant on through the user's toggle. */
  async function turnedOn(options: Parameters<typeof setup>[0] = {}): Promise<Harness> {
    const harness = setup(options);
    actions.setSettings(harness.store, settingsWithMode('free', false));
    actions.setDocument(harness.store, fakeDocument());
    await settle();
    await harness.commands.execute('ai.toggle', harness.ctx);
    await settle();
    expect(harness.store.getState().ai.on).toBe(true);
    return harness;
  }

  it('settings OK with Disabled while on and idle: off and de-registered - the slot removed, the panel visible but inert, the catalogue and the conversation dropped, the stub of ai.ask back, no ai.cancel, the toggle live, the document untouched', async () => {
    const { store, commands, feature, ctx, dialogs, load } = await turnedOn();
    const hooks = aiTestHooks()!;
    await vi.waitFor(() => expect(hooks.state().catalogue).toBe(true));
    conversationWith(store);
    expect(contextMenuExtensions.ai).toBeDefined(); // the "Ask AI..." slot while on
    expect(contextMenuExtensions.ai!(null as never)).toHaveLength(1);

    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    // Nothing was asked (idle); off and de-registered at once; the panel stays, inert.
    expect(dialogs.shown).toEqual([]);
    expect(feature.status).toBe('disabled');
    expect(feature.enabled()).toBe(false);
    expect(feature.inert).toBe(true);
    expect(store.getState().ai).toMatchObject({
      visible: true,
      on: false,
      request: null,
      catalogue: null,
      panelFocus: false,
    });
    expect(store.getState().ai.conversation).toEqual({
      docId: null,
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    expect(contextMenuExtensions.ai).toBeUndefined(); // the slot removed (FR-030, FR-096)
    expect(hooks.state().catalogue).toBe(false);
    expect(hooks.on).toBe(false);
    // The registry: the live toggle (the View entry, the toolbar button and the hotkey stay -
    // they show and hide the inert panel), the inert, invisible stub of `ai.ask` (its Hotkeys
    // row gone, its chord dispatching nothing) and no `ai.cancel`.
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    expect(commands.has('ai.cancel')).toBe(false);
    expect(commands.get('ai.toggle')!.stub).toBeUndefined();
    expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
    expect(commands.isEnabled('ai.toggle', ctx)).toBe(true);
    expect(commands.get('ai.ask')!.stub).toBe(true);
    expect(commands.isVisible('ai.ask', ctx)).toBe(false);
    expect(commands.isEnabled('ai.ask', ctx)).toBe(false);
    expect(commands.dispatch('ai.ask', ctx)).toBe(false);
    expect(await commands.execute('ai.ask', ctx)).toBe(false);
    expect(hooks.commands()).toEqual([
      { id: 'ai.toggle', visible: true, enabled: true, stub: false },
      { id: 'ai.ask', visible: false, enabled: false, stub: true },
    ]);
    // The document, its modified state and the undo history are untouched (FR-095); the
    // imported chunk stays idle, no second import.
    expect(store.getState().modified).toBe(false);
    expect(store.getState().runLock).toBeNull();
    expect(ctx.undo.canUndo).toBe(false);
    expect(store.getState().ai.loaded).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    // The predicates say no whatever the rest of the state (data-model §3.4).
    expect(feature.canAsk(ctx)).toBe(false);
    expect(feature.canSend(ctx)).toBe(false);
    // The toggle hides and shows the inert panel; nothing becomes live, nothing is imported.
    await feature.toggle(ctx);
    await settle();
    expect(store.getState().ai).toMatchObject({ visible: false, on: false });
    expect(feature.inert).toBe(false);
    await feature.toggle(ctx);
    await settle();
    expect(store.getState().ai).toMatchObject({ visible: true, on: false });
    expect(feature.inert).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a Disabled snapshot while a request runs (a route without the dialog question): the request is cancelled and waited for, then off and de-registered', async () => {
    const standIn = requestStandIn();
    const { store, commands, feature } = await turnedOn({ module: standIn.module });
    standIn.begin(store);
    expect(feature.requestRunning()).toBe(true);

    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    // De-registered at once; the turn-off waits for the request's end.
    expect(feature.status).toBe('disabled');
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    expect(standIn.cancelled()).toBe(1);
    await settleCancel();
    await settle();
    expect(store.getState().ai).toMatchObject({ on: false, request: null, catalogue: null });
    expect(store.getState().ai.conversation.messages).toEqual([]);
    expect(store.getState().ai.conversation.activity).toEqual([]);
    expect(store.getState().runLock).toBeNull();
    expect(contextMenuExtensions.ai).toBeUndefined();
  });

  it('disabled → free | custom with the panel hidden: the live commands return with the assistant off, no import, nothing else changed (FR-097)', async () => {
    const { store, commands, feature, ctx, load } = await turnedOn();
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(store.getState().ai.on).toBe(false);
    await feature.toggle(ctx); // the user hides the inert panel
    expect(store.getState().ai.visible).toBe(false);

    for (const mode of ['free', 'custom'] as const) {
      actions.setSettings(store, settingsWithMode(mode));
      await settle();
      expect(feature.status).toBe('registered');
      expect(feature.enabled()).toBe(true);
      expect(ids(commands)).toEqual(['ai.ask', 'ai.cancel', 'ai.toggle']);
      expect(commands.get('ai.toggle')!.stub).toBeUndefined();
      expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
      expect(commands.isEnabled('ai.toggle', ctx)).toBe(true);
      expect(commands.isChecked('ai.toggle', ctx)).toBe(false); // hidden
      expect(commands.isVisible('ai.ask', ctx)).toBe(false); // off: no Ask AI
      expect(commands.isEnabled('ai.cancel', ctx)).toBe(false);
      expect(store.getState().ai).toMatchObject({ visible: false, on: false, catalogue: null });
      expect(contextMenuExtensions.ai).toBeUndefined();
      expect(feature.canAsk(ctx)).toBe(false); // off
      expect(feature.canSend(ctx)).toBe(false);
      expect(aiTestHooks()!.commands()).toEqual([
        { id: 'ai.toggle', visible: true, enabled: true, stub: false },
        { id: 'ai.ask', visible: false, enabled: false, stub: false },
        { id: 'ai.cancel', visible: true, enabled: false, stub: false },
      ]);
      expect(store.getState().modified).toBe(false);
      expect(ctx.undo.canUndo).toBe(false);
      actions.setSettings(store, settingsWithMode('disabled'));
      await settle();
    }
    expect(load).toHaveBeenCalledTimes(1); // the first turn-on's import only

    // The hotkey shows the panel again once registered: live, without a second import.
    actions.setSettings(store, settingsWithMode('free'));
    await settle();
    expect(commands.dispatch('ai.toggle', ctx)).toBe(true);
    await feature.pendingTurnOn; // the dispatch does not wait for the show it started
    expect(store.getState().ai).toMatchObject({ visible: true, on: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('disabled → free | custom with the panel visible: the inert panel becomes live at once, no second import (FR-096, FR-097)', async () => {
    const { store, feature, ctx, load } = await turnedOn();
    conversationWith(store);
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(store.getState().ai).toMatchObject({ visible: true, on: false });
    expect(feature.inert).toBe(true);
    expect(contextMenuExtensions.ai).toBeUndefined();

    actions.setSettings(store, settingsWithMode('custom'));
    await settle();
    await feature.pendingTurnOn;
    expect(feature.status).toBe('registered');
    expect(feature.inert).toBe(false);
    expect(store.getState().ai).toMatchObject({ visible: true, on: true, panelFocus: false });
    expect(store.getState().ai.conversation.messages).toEqual([]); // a fresh conversation
    expect(contextMenuExtensions.ai).toBeDefined(); // the "Ask AI..." slot is back
    expect(feature.canSend(ctx)).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().modified).toBe(false);
    expect(ctx.undo.canUndo).toBe(false);
  });

  it('enabled / canAsk / canSend under each mode; no dynamic import while off or disabled', async () => {
    const { store, commands, feature, ctx, load } = setup();
    actions.setDocument(store, fakeDocument());
    // Before the first snapshot: nothing.  (The panel hidden throughout, as a session with it
    // closed restores it - the first snapshot below adopts the stored visibility.)
    expect(feature.enabled()).toBe(false);
    expect(feature.canAsk(ctx)).toBe(false);
    expect(feature.canSend(ctx)).toBe(false);
    expect(commands.dispatch('ai.toggle', ctx)).toBe(false); // the stub before the snapshot
    // Disabled: nothing, and the chords import nothing - the toggle shows the inert panel.
    actions.setSettings(store, settingsWithMode('disabled', false));
    await settle();
    expect(feature.enabled()).toBe(false);
    expect(feature.canAsk(ctx)).toBe(false);
    expect(feature.canSend(ctx)).toBe(false);
    expect(commands.dispatch('ai.toggle', ctx)).toBe(true);
    await settle();
    expect(store.getState().ai).toMatchObject({ visible: true, on: false });
    expect(commands.dispatch('ai.toggle', ctx)).toBe(true); // hidden again
    await settle();
    expect(store.getState().ai.visible).toBe(false);
    expect(commands.dispatch('ai.ask', ctx)).toBe(false);
    await settle();
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().ai.loaded).toBe(false);
    // Free and custom, off (hidden): enabled, yet nothing to ask or send with and no import.
    for (const mode of ['free', 'custom'] as const) {
      actions.setSettings(store, settingsWithMode(mode));
      await settle();
      expect(feature.enabled()).toBe(true);
      expect(feature.canAsk(ctx)).toBe(false);
      expect(feature.canSend(ctx)).toBe(false);
      expect(commands.dispatch('ai.ask', ctx)).toBe(false); // Mod+K is inert while off
      await settle();
      expect(load).not.toHaveBeenCalled();
    }
    // On: the predicates follow the view and the lock; the import happened once.
    await feature.toggle(ctx);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(feature.canAsk(ctx)).toBe(true);
    expect(feature.canSend(ctx)).toBe(true);
    actions.setActiveView(store, 'description');
    expect(feature.canAsk(ctx)).toBe(false);
    expect(feature.canSend(ctx)).toBe(true); // the panel sends from any view
    actions.setActiveView(store, 'body');
    actions.setRunLock(store, { kind: 'script', label: 's', startedAt: Date.now() });
    expect(feature.canAsk(ctx)).toBe(false);
    expect(feature.canSend(ctx)).toBe(false);
    actions.setRunLock(store, null);
    // Disabled while on: everything false again, and `on` is false (data-model §3.4).
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(store.getState().ai.on).toBe(false);
    expect(feature.enabled()).toBe(false);
    expect(feature.canAsk(ctx)).toBe(false);
    expect(feature.canSend(ctx)).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('the pre-apply hook: the question only for Disabled while a request runs; No keeps the dialog, Yes cancels and waits, then the snapshot turns off (FR-097, FR-093)', async () => {
    const standIn = requestStandIn();
    const { store, feature, dialogs } = await turnedOn({
      module: standIn.module,
      answers: ['no', 'yes'],
    });
    const free = settingsWithMode('free');
    const custom = settingsWithMode('custom');
    const disabled = settingsWithMode('disabled');
    standIn.begin(store);
    // Other changes while a request runs apply without a question - the target change among
    // them (data-model §3.3 "settings OK, target changed").
    await expect(feature.beforeApply(custom, free)).resolves.toBe('apply');
    await expect(feature.beforeApply(disabled, disabled)).resolves.toBe('apply'); // already
    expect(dialogs.shown).toEqual([]);
    // Disabled: the question in its Settings wording; No → keepOpen, nothing cancelled.
    await expect(feature.beforeApply(disabled, free)).resolves.toBe('keepOpen');
    expect(dialogs.shown).toHaveLength(1);
    expect(dialogs.shown[0]).toMatchObject({
      testId: 'dialog-ai-stop-confirm',
      text: 'ai.stopConfirm.disableText',
      caption: 'ai.stopConfirm.title',
      buttons: 'yesNo',
      defaultButton: 'no',
    });
    expect(standIn.cancelled()).toBe(0);
    expect(store.getState().ai.on).toBe(true);
    expect(feature.status).toBe('registered');
    // Yes → the request is cancelled and has ended before 'apply' is returned.
    const applying = feature.beforeApply(disabled, free);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(standIn.cancelled()).toBe(1);
    await expect(applying).resolves.toBe('apply');
    expect(feature.requestRunning()).toBe(false);
    expect(store.getState().runLock).toBeNull();
    expect(store.getState().ai.on).toBe(true); // the snapshot turns it off, not the hook
    actions.setSettings(store, disabled);
    await settle();
    expect(feature.status).toBe('disabled');
    expect(store.getState().ai.on).toBe(false);
    expect(dialogs.shown).toHaveLength(2);
  });
});
