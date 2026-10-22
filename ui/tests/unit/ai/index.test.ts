/**
 * Registration of the AI assistant (feature 005 T031; research R8.3-R8.4; data-model §3.1, §3.3
 * "start-up"; FR-090, FR-094, FR-096 to FR-098): nothing is registered before the first settings
 * snapshot; the live commands `ai.toggle` / `ai.ask` / `ai.cancel` take the inert stubs over for
 * the `free` and `custom` modes and only then; `disabled` leaves the stubs (invisible, inert);
 * a core with `apiMinor` 3 gets nothing and `coreTooOld`; a mode change re-registers or
 * de-registers without a reload; the chunk is imported once, on the first turn-on, never while
 * off; and the `__mfbeTest.ai` hooks report it all.
 */

import { AiFeature, getAiFeature, registerAiFeature, unregisterAiFeature } from '@/ai';
import type { AssistantModule } from '@/ai/assistant';
import { aiTestHooks } from '@/ai/testHooks';
import { createCommandRegistry, type CommandContext, type CommandRegistry } from '@/app/commands';
import { HotkeyMap } from '@/app/hotkeys';
import type { FeatureContext } from '@/app/services';
import { CaretRegistry } from '@/model/caret';
import { actions, createAppStore, type AppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import type { Settings } from '@/rpc/types';

import { fakeDialogs, fakeDocument, fakeRpc, rpcError, type FakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

/** Lets the feature's asynchronous settings handling (the `app.info` check) run to its end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function settingsWithMode(mode: Settings['ai']['mode']): Settings {
  const settings = defaultSettings();
  settings.ai.mode = mode;
  return settings;
}

interface Harness {
  store: AppStore;
  commands: CommandRegistry;
  rpc: FakeRpc;
  feature: AiFeature;
  ctx: CommandContext;
  load: ReturnType<typeof vi.fn>;
}

function setup(
  options: { apiMinor?: number | Error; rpc?: false; module?: Partial<AssistantModule> } = {},
): Harness {
  const store = createAppStore();
  const commands = createCommandRegistry();
  const rpc = fakeRpc({
    'app.info':
      options.apiMinor instanceof Error
        ? options.apiMinor
        : { version: '0.0.5', apiVersion: 1, apiMinor: options.apiMinor ?? 4, testHooks: false },
  });
  const load = vi.fn(async (): Promise<AssistantModule> => {
    const real = await import('@/ai/assistant');
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
  const feature = registerAiFeature(featureContext, { loadAssistant: load, testHooks: true });
  const ctx: CommandContext = {
    store,
    rpc: featureContext.rpc ?? null,
    undo: featureContext.undo,
    dialogs: fakeDialogs(),
    hotkeys: featureContext.hotkeys,
    t: ((key: string) => key) as unknown as CommandContext['t'],
    version: '0.0.5-test',
  };
  return { store, commands, rpc, feature, ctx, load };
}

function ids(commands: CommandRegistry): string[] {
  return commands
    .all()
    .map((c) => c.id)
    .filter((id) => id.startsWith('ai.'))
    .sort();
}

describe('AI assistant registration', () => {
  afterEach(() => {
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
    'takes the stubs over with the three live commands for the %s mode',
    async (mode) => {
      const { store, commands, feature, rpc, ctx, load } = setup();
      actions.setSettings(store, settingsWithMode(mode));
      await settle();
      expect(feature.status).toBe('registered');
      expect(feature.coreTooOld).toBe(false);
      expect(feature.enabled()).toBe(true);
      expect(rpc.calls.map((c) => c.method)).toEqual(['app.info']);
      expect(ids(commands)).toEqual(['ai.ask', 'ai.cancel', 'ai.toggle']);

      // View → AI Assistant: visible, a toggle, enabled only with a document while off.
      const toggle = commands.get('ai.toggle')!;
      expect(toggle.stub).toBeUndefined();
      expect(toggle.labelKey).toBe('menu.view.aiAssistant');
      expect(toggle.icon).toBe('ai-assistant');
      expect(toggle.group).toBe('view');
      expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
      expect(commands.isChecked('ai.toggle', ctx)).toBe(false);
      expect(commands.isEnabled('ai.toggle', ctx)).toBe(false); // no document
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
    },
  );

  it('leaves the inert stubs for the disabled mode: nothing of the feature exists', async () => {
    const { store, commands, feature, ctx, load } = setup();
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(feature.status).toBe('disabled');
    expect(feature.enabled()).toBe(false);
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    for (const id of ['ai.toggle', 'ai.ask']) {
      expect(commands.get(id)!.stub).toBe(true);
      expect(commands.isVisible(id, ctx)).toBe(false);
      expect(commands.isEnabled(id, ctx)).toBe(false);
      expect(commands.dispatch(id, ctx)).toBe(false); // the hotkeys are inert
    }
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().ai.on).toBe(false);
    // The hooks read the same picture (US9's journey).
    expect(aiTestHooks()!.status()).toBe('disabled');
    expect(aiTestHooks()!.commands()).toEqual([
      { id: 'ai.toggle', visible: false, enabled: false, stub: true },
      { id: 'ai.ask', visible: false, enabled: false, stub: true },
    ]);
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
    actions.setSettings(store, settingsWithMode('free'));
    actions.setDocument(store, fakeDocument());
    await settle();

    expect(await commands.execute('ai.toggle', ctx)).toBe(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().ai).toMatchObject({ on: true, loaded: true, request: null });
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
    expect(hooks.state()).toMatchObject({ on: true, loaded: true, catalogue: false, width: 360 });
    expect(hooks.commands()).toEqual([
      { id: 'ai.toggle', visible: true, enabled: true, stub: false },
      { id: 'ai.ask', visible: true, enabled: true, stub: false },
      { id: 'ai.cancel', visible: true, enabled: false, stub: false },
    ]);
    expect(hooks.lastRequest()).toBeNull();

    expect(await commands.execute('ai.toggle', ctx)).toBe(true);
    await settle();
    expect(load).toHaveBeenCalledTimes(1); // the module is kept
    expect(store.getState().ai).toMatchObject({ on: false, loaded: true, request: null });
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
    await commands.execute('ai.toggle', ctx);
    await settle();
    expect(store.getState().ai.on).toBe(true);

    // Settings OK with Disabled: the panel closes, the conversation is dropped, the stubs are
    // back, `ai.cancel` is gone, the hotkeys are inert.
    actions.setSettings(store, settingsWithMode('disabled'));
    await settle();
    expect(feature.status).toBe('disabled');
    expect(store.getState().ai).toMatchObject({ on: false, request: null, catalogue: null });
    expect(store.getState().ai.conversation).toEqual({
      docId: null,
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    expect(store.getState().ai.loaded).toBe(true); // the imported chunk stays idle
    expect(ids(commands)).toEqual(['ai.ask', 'ai.toggle']);
    expect(commands.get('ai.toggle')!.stub).toBe(true);
    expect(commands.isVisible('ai.toggle', ctx)).toBe(false);
    expect(commands.dispatch('ai.toggle', ctx)).toBe(false);
    expect(
      aiTestHooks()!
        .commands()
        .every((c) => c.stub && !c.visible && !c.enabled),
    ).toBe(true);

    // Back to a live mode: the entry, the button and the hotkeys return; the assistant stays
    // off and the chunk is not imported again.
    actions.setSettings(store, settingsWithMode('custom'));
    await settle();
    expect(feature.status).toBe('registered');
    expect(ids(commands)).toEqual(['ai.ask', 'ai.cancel', 'ai.toggle']);
    expect(commands.get('ai.toggle')!.stub).toBeUndefined();
    expect(commands.isVisible('ai.toggle', ctx)).toBe(true);
    expect(store.getState().ai.on).toBe(false);
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
    await settle();
    expect(feature.status).toBe('registered');
    expect(commands.has('ai.cancel')).toBe(true);
  });
});
