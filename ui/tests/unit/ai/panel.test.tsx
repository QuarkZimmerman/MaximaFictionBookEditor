/**
 * The AI assistant panel (feature 005 T052; FR-040 to FR-042, FR-045, FR-105; quickstart §0.5,
 * §3): the header with the service and model and the settings link, the conversation as plain
 * text (no markup, no links - review C16), the activity list with one line per kind, the
 * field's keyboard rules (Enter sends, Shift+Enter breaks the line), Send / Stop in one place,
 * Clear, the Undo button bound to the request's step while it is the latest, the Tab order,
 * the focus request of the popup's "Continue in panel" and the close button. The request loop
 * is mocked: the panel only starts and stops requests and shows what the store holds.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProvider } from '@/app/AppContext';
import { createAppServices, type AppServices } from '@/app/services';
import { changeLanguage, initI18n } from '@/i18n';
import { actions, createAppStore, type AppStore, type AssistantMessage } from '@/model/store';
import type { Settings } from '@/rpc/types';

import { fakeDocument, fakeRpc } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const startRequest = vi.fn();
const cancelRequest = vi.fn();
const activeRequest = vi.fn(() => null);
const openSettingsDialog = vi.fn();

vi.mock('@/ai/assistant', () => ({
  startRequest: (...args: unknown[]) => startRequest(...args),
  cancelRequest: (...args: unknown[]) => cancelRequest(...args),
  activeRequest: () => activeRequest(),
}));

vi.mock('@/features/settings/index', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/settings/index')>();
  return { ...original, openSettingsDialog: (...args: unknown[]) => openSettingsDialog(...args) };
});

import { AiPanel } from '@/ai/AiPanel';
import { appendActivity, appendMessage } from '@/ai/activity';

function customSettings(): Settings {
  const settings = defaultSettings();
  settings.ai.mode = 'custom';
  settings.ai.custom = { address: 'https://api.example.test/v1', key: 'k', model: 'my-model' };
  return settings;
}

interface Harness {
  store: AppStore;
  services: AppServices;
  user: ReturnType<typeof userEvent.setup>;
}

async function renderPanel(
  options: { settings?: Settings; document?: boolean; services?: Record<string, unknown> } = {},
): Promise<Harness> {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const store = createAppStore();
  const rpc = fakeRpc({
    'app.info': { apiMinor: 4 },
    'ai.services': {
      services: [
        {
          id: 'first',
          name: 'First Service',
          address: 'https://first.example.test/v1',
          model: 'first-model',
          keyRequired: false,
          hasKey: false,
          tools: false,
          limits: { en: '', ru: '', uk: '' },
          source: 'bundled',
          replaced: false,
          local: false,
          plainHttp: false,
        },
      ],
      issues: [],
    },
  });
  const services = createAppServices({ store, platform: 'linux', rpc: rpc.client });
  actions.setSettings(store, options.settings ?? customSettings());
  if (options.document !== false) actions.setDocument(store, fakeDocument());
  actions.updateAi(store, { on: true, loaded: true });
  const user = userEvent.setup();
  // The header resolves its target asynchronously (the service list of the core): settled here.
  await act(async () => {
    render(
      <AppProvider services={services}>
        <AiPanel />
      </AppProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { store, services, user };
}

function message(store: AppStore, fields: Omit<AssistantMessage, 'id' | 'at'>): void {
  act(() => {
    appendMessage(store, fields);
  });
}

function activity(
  store: AppStore,
  kind: string,
  payload: Record<string, unknown> = {},
  requestId = 'r1',
): void {
  act(() => {
    appendActivity(store, {
      requestId,
      elapsedMs: 1500,
      kind: kind as Parameters<typeof appendActivity>[1]['kind'],
      payload,
    });
  });
}

describe('AiPanel', () => {
  beforeEach(() => {
    startRequest.mockReset();
    cancelRequest.mockReset();
    activeRequest.mockReset().mockReturnValue(null);
    openSettingsDialog.mockReset();
  });

  it('names the service and model, links to the settings page and starts empty (FR-041)', async () => {
    const { store } = await renderPanel();
    expect(await screen.findByText('api.example.test · my-model')).toBeInTheDocument();
    expect(screen.getByTestId('ai-service')).toHaveTextContent('api.example.test · my-model');
    expect(screen.getByTestId('ai-empty')).toBeInTheDocument();
    expect(screen.queryAllByTestId(/^ai-message-/)).toHaveLength(0);
    expect(screen.getByTestId('ai-activity').children).toHaveLength(0);
    expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'idle');
    expect(screen.getByTestId('ai-send')).toBeDisabled(); // nothing typed yet
    expect(screen.queryByTestId('ai-stop')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-clear')).toBeDisabled();
    expect(screen.getByTestId('ai-undo')).toBeDisabled();
    expect(screen.getByTestId('ai-panel-close')).toHaveAccessibleName(
      'Close the AI assistant panel',
    );

    fireEvent.click(screen.getByTestId('ai-settings-link'));
    expect(openSettingsDialog).toHaveBeenCalledTimes(1);
    expect(openSettingsDialog.mock.calls[0]![2]).toEqual({ initialPage: 'ai' });
    // Nothing of the turn-on touched the document (FR-095).
    expect(store.getState().modified).toBe(false);
    expect(store.getState().runLock).toBeNull();
  });

  it('says so when the saved free entry is gone (the first entry stands in) and when the model answers only', async () => {
    const settings = defaultSettings();
    settings.ai.mode = 'free';
    settings.ai.freeServiceId = 'vanished';
    await renderPanel({ settings });
    expect(await screen.findByText('First Service · first-model')).toBeInTheDocument();
    expect(screen.getByTestId('ai-service-note')).toHaveTextContent(
      'the chosen service is no longer in the list; the first entry is in use',
    );
  });

  it('renders every message as plain text with its role, the interim and cut-off marks (C16)', async () => {
    const { store } = await renderPanel();
    message(store, { requestId: 'r1', role: 'user', text: 'Make <b>bold</b>\nsecond line' });
    message(store, {
      requestId: 'r1',
      role: 'assistant',
      text: 'Thinking [link](javascript:alert(1)) https://x.test',
      interim: true,
    });
    message(store, { requestId: 'r1', role: 'assistant', text: 'Done.', cutOff: true });
    message(store, { requestId: 'r1', role: 'notice', text: 'Request cancelled.' });

    const first = screen.getByTestId('ai-message-0');
    expect(first).toHaveAttribute('data-role', 'user');
    expect(first.querySelector('.mfbe-ai-message-text')!.textContent).toBe(
      'Make <b>bold</b>\nsecond line',
    );
    expect(first.querySelector('b')).toBeNull();
    const second = screen.getByTestId('ai-message-1');
    expect(second).toHaveAttribute('data-role', 'assistant');
    expect(second).toHaveAttribute('data-interim', 'true');
    expect(second.querySelector('a')).toBeNull();
    expect(second).toHaveTextContent('Thinking [link](javascript:alert(1)) https://x.test');
    expect(second).toHaveTextContent('interim words beside the operations');
    const third = screen.getByTestId('ai-message-2');
    expect(third).toHaveAttribute('data-cutoff', 'true');
    expect(third).toHaveTextContent('The answer was cut off by the service');
    expect(screen.getByTestId('ai-message-3')).toHaveAttribute('data-role', 'notice');
    expect(screen.queryByTestId('ai-empty')).not.toBeInTheDocument();
    expect(screen.getByTestId('ai-clear')).toBeEnabled();
  });

  it('marks the final message of a request with where its changes went, or that a claimed change was never made (FR-106)', async () => {
    const { store } = await renderPanel();
    // Request 1: committed with a description change - the mark names the Description view.
    message(store, { requestId: 'r1', role: 'user', text: 'Translate the title' });
    message(store, { requestId: 'r1', role: 'assistant', text: 'Reading…', interim: true });
    message(store, { requestId: 'r1', role: 'assistant', text: 'The title is translated.' });
    activity(store, 'request.done', {
      changes: { total: 1, body: 0, description: 1, fields: ['titleInfo.bookTitle'] },
      exchanges: 3,
      elapsedMs: 46000,
    });
    // Request 2: words only, claiming a change - the mark says no change was made.
    message(store, { requestId: 'r2', role: 'user', text: 'Translate it again' });
    message(store, { requestId: 'r2', role: 'assistant', text: 'The title has been translated.' });
    activity(store, 'request.answered', { claimedChange: true }, 'r2');
    // Request 3: a plain answer - no mark.
    message(store, { requestId: 'r3', role: 'user', text: 'How many footnotes?' });
    message(store, { requestId: 'r3', role: 'assistant', text: 'Two.' });
    activity(store, 'request.answered', {}, 'r3');

    expect(screen.queryByTestId('ai-result-1')).not.toBeInTheDocument(); // interim
    const first = screen.getByTestId('ai-message-2');
    expect(first).toHaveAttribute('data-result', 'applied');
    expect(screen.getByTestId('ai-result-2')).toHaveTextContent(
      'Applied to the book: 1 change in the Description view (book title)',
    );
    const second = screen.getByTestId('ai-message-4');
    expect(second).toHaveAttribute('data-result', 'claimedChange');
    expect(screen.getByTestId('ai-result-4')).toHaveTextContent(
      'No change was made — the assistant only described one.',
    );
    expect(screen.getByTestId('ai-message-6')).not.toHaveAttribute('data-result');
    expect(screen.queryByTestId('ai-result-6')).not.toBeInTheDocument();
    // The end lines of the activity list say the same: the place, or words only - never Done.
    const lines = Array.from(screen.getByTestId('ai-activity').children).map(
      (li) => li.querySelector('.mfbe-ai-activity-text')!.textContent,
    );
    expect(lines).toEqual([
      'Done: 1 change in the Description view (book title) — 3 exchanges, 00:46',
      'Answered — the book was not changed (no change was made — the assistant only described one)',
      'Answered — the book was not changed',
    ]);
  });

  it('lists every activity entry in order with its kind and a localised line (FR-042)', async () => {
    const { store } = await renderPanel();
    const entries: Array<[string, Record<string, unknown>, string]> = [
      ['request.start', { service: 'Svc', model: 'm1' }, 'Request started — Svc · m1'],
      ['validate.baseline', { errors: 2, warnings: 0 }, 'Checked the book: 2 pre-existing errors'],
      ['exchange.sent', { n: 1, messages: 2, tools: 8 }, 'Sent exchange 1 (2 messages, 8 tools)'],
      [
        'exchange.answered',
        {
          n: 1,
          elapsedMs: 2300,
          toolCalls: 3,
          rateLimit: { limit: 2, remaining: 1, resetSeconds: 18 },
        },
        'Answer 1 after 00:02 — 3 tool calls; limit 2, 1 left, resets in 18 s',
      ],
      [
        'limit.wait',
        { seconds: 2, source: 'header' },
        'Limit reached — waiting 2 s before the retry (stated in the headers)',
      ],
      ['history.trimmed', { turns: 1 }, 'The oldest 1 turn was left out of this exchange'],
      [
        'split',
        { what: 'toolResult', tool: 'read_part', part: 1, parts: 3 },
        'Part 1 of 3 — the result of read_part',
      ],
      [
        'tool.call',
        { name: 'read_part', summary: 'Read section 1 "<b>Title</b>"' },
        'Read section 1 "<b>Title</b>"',
      ],
      [
        'tool.result',
        { name: 'read_part', summary: 'read_part' },
        'Result of read_part: read_part',
      ],
      [
        'tool.error',
        {
          name: 'frobnicate',
          code: 'unknownTool',
          message: 'no such tool',
          strike: { count: 1, of: 3 },
        },
        'The assistant called frobnicate wrongly (unknownTool): no such tool (strike 1 of 3)',
      ],
      [
        'change.try',
        { tool: 'replace_node', target: { path: 'body[1]/section[2]' } },
        'Trying replace_node at body[1]/section[2]',
      ],
      ['validate', { new: 0, preExisting: 2 }, 'Validated: OK'],
      [
        'change.accepted',
        { tool: 'replace_node', target: { nodeId: 'n7' } },
        'Changed: replace_node at n7',
      ],
      ['validate', { new: 1, preExisting: 2 }, 'Validated: 1 new error'],
      [
        'change.rejected',
        { tool: 'insert_node', target: 'x', issues: [{}, {}], strike: { count: 2, of: 3 } },
        'Rejected (strike 2 of 3): 2 new errors — correction requested',
      ],
      ['script.dialog', { id: 's1', name: 'Upper case' }, 'Script Upper case asks…'],
      [
        'script.proposed',
        { id: 'p1', written: true, files: [{}, {}] },
        'Proposed script p1: 2 files — written',
      ],
      [
        'request.done',
        { changes: 3, exchanges: 5, elapsedMs: 61000 },
        'Done: 3 changes in 5 exchanges, 01:01',
      ],
      ['request.answered', {}, 'Answered — the book was not changed'],
      ['request.askedBack', {}, 'The assistant asked a question — the book was not changed'],
      ['request.cancelled', {}, 'Request cancelled'],
      [
        'request.failed',
        { kind: 'service', message: 'boom' },
        'Failed: The service answered with an error. The service said: boom',
      ],
      [
        'request.rejected',
        { issues: [] },
        'Stopped: the same change was rejected three times — the book was not changed',
      ],
    ];
    for (const [kind, payload] of entries) activity(store, kind, payload);

    const list = screen.getByTestId('ai-activity');
    expect(list.children).toHaveLength(entries.length);
    entries.forEach(([kind, , text], index) => {
      const row = screen.getByTestId(`ai-activity-${index}`);
      expect(row).toHaveAttribute('data-kind', kind);
      expect(row.querySelector('.mfbe-ai-activity-text')!.textContent).toBe(text);
      expect(row.querySelector('b')).toBeNull();
    });
    expect(screen.getByText('23 entries')).toBeInTheDocument();
  });

  it('sends on Enter, breaks the line on Shift+Enter and clears the field (FR-105)', async () => {
    const { store, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    let resolveRequest: (value: unknown) => void = () => {};
    startRequest.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const input = screen.getByTestId('ai-input');
    await user.click(input);
    await user.keyboard('{Enter}'); // empty: nothing
    expect(startRequest).not.toHaveBeenCalled();
    await user.keyboard('first line{Shift>}{Enter}{/Shift}second line');
    expect(input).toHaveValue('first line\nsecond line');
    expect(startRequest).not.toHaveBeenCalled();
    expect(screen.getByTestId('ai-send')).toBeEnabled();
    await user.keyboard('{Enter}');
    expect(startRequest).toHaveBeenCalledTimes(1);
    const [ctx, options] = startRequest.mock.calls[0]!;
    expect(ctx.store).toBe(store);
    expect(options).toEqual({
      origin: 'panel',
      instruction: 'first line\nsecond line',
      selection: null,
    });
    expect(input).toHaveValue('');
    // The loop appends the user's message: the panel shows it; the outcome keeps the field empty.
    message(store, { requestId: 'r1', role: 'user', text: 'first line\nsecond line' });
    await act(async () => {
      resolveRequest({ kind: 'answered', text: 'ok' });
    });
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
  });

  it('brings the instruction back and shows the reason when the request never started', async () => {
    const { user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    startRequest.mockResolvedValue({ kind: 'failed', failure: { kind: 'noService' } });
    await user.click(screen.getByTestId('ai-input'));
    await user.keyboard('do it{Enter}');
    await screen.findByText(/No AI service is available/);
    expect(screen.getByTestId('ai-status')).toHaveAttribute('data-state', 'failed');
    expect(screen.getByTestId('ai-input')).toHaveValue('do it');
  });

  it('shows Stop in the place of Send while a request runs, with the phase, the time and the countdown', async () => {
    const { store, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    act(() => {
      actions.updateAi(store, {
        request: {
          id: 'r1',
          origin: 'popup',
          state: 'waiting',
          startedAt: Date.now(),
          phase: 'waiting for the answer',
          elapsedMs: 65000,
          countdown: 7,
        },
      });
    });
    expect(screen.queryByTestId('ai-send')).not.toBeInTheDocument();
    const status = screen.getByTestId('ai-status');
    expect(status).toHaveAttribute('data-state', 'running');
    expect(status).toHaveTextContent('waiting for the answer — 01:05');
    expect(screen.getByTestId('ai-wait')).toHaveTextContent('retry in 7 s');
    // Enter does nothing while the request runs.
    await user.click(screen.getByTestId('ai-input'));
    await user.keyboard('next{Enter}');
    expect(startRequest).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('ai-stop'));
    expect(cancelRequest).toHaveBeenCalledWith(store);
    act(() => {
      actions.updateAi(store, { request: null });
    });
    expect(screen.getByTestId('ai-send')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-wait')).not.toBeInTheDocument();
  });

  it('disables Send while a script holds the lock or no document is open', async () => {
    const { store, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    await user.click(screen.getByTestId('ai-input'));
    await user.keyboard('x');
    expect(screen.getByTestId('ai-send')).toBeEnabled();
    act(() => {
      actions.setRunLock(store, { kind: 'script', label: 's', startedAt: Date.now() });
    });
    expect(screen.getByTestId('ai-send')).toBeDisabled();
    expect(screen.getByTestId('ai-send')).toHaveAttribute(
      'title',
      'A script is running; wait until it ends.',
    );
    await user.keyboard('{Enter}');
    expect(startRequest).not.toHaveBeenCalled();
    act(() => {
      actions.setRunLock(store, null);
      actions.closeDocument(store);
    });
    expect(screen.getByTestId('ai-send')).toBeDisabled();
    expect(screen.getByTestId('ai-send')).toHaveAttribute('title', 'Open a document first.');
  });

  it('offers Undo for the committed request while its step is the latest, then the Edit > Undo hint', async () => {
    const { store, services, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    const undone = vi.fn();
    // A request runs, commits (one snapshot entry) and ends with `request.done`.
    act(() => {
      actions.updateAi(store, {
        request: { id: 'r1', origin: 'panel', state: 'exchanging', startedAt: Date.now() },
      });
    });
    message(store, { requestId: 'r1', role: 'user', text: 'Title case' });
    act(() => {
      services.undo.recordSnapshot('body', 'Title case', { undo: undone, redo: () => {} });
    });
    activity(store, 'request.done', { changes: 3, exchanges: 2, elapsedMs: 100 });
    message(store, { requestId: 'r1', role: 'assistant', text: 'Done', undoLabel: 'Title case' });
    act(() => {
      actions.updateAi(store, { request: null });
    });
    const undo = screen.getByTestId('ai-undo');
    expect(undo).toBeEnabled();
    expect(screen.queryByTestId('ai-undo-hint')).not.toBeInTheDocument();

    // A later change of the user's: the button is disabled with the hint.
    act(() => {
      services.undo.recordSnapshot('body', 'typing', { undo: () => {}, redo: () => {} });
    });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute('title', 'Later changes were made; use Edit > Undo.');
    expect(screen.getByTestId('ai-undo-hint')).toBeInTheDocument();
    // Edit > Undo takes the later step back: the request's step is the latest again.
    act(() => {
      services.undo.undo();
    });
    expect(undo).toBeEnabled();
    await user.click(undo);
    expect(undone).toHaveBeenCalledTimes(1);
    expect(undo).toBeDisabled();
    expect(screen.queryByTestId('ai-undo-hint')).not.toBeInTheDocument();
  });

  it('Clear empties the messages and the activity and takes the Undo button with it (FR-045)', async () => {
    const { store, services, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    act(() => {
      actions.updateAi(store, {
        request: { id: 'r1', origin: 'panel', state: 'exchanging', startedAt: Date.now() },
      });
      services.undo.recordSnapshot('body', 'x', { undo: () => {}, redo: () => {} });
    });
    message(store, { requestId: 'r1', role: 'user', text: 'x' });
    activity(store, 'request.done', { changes: 1, exchanges: 1, elapsedMs: 1 });
    act(() => {
      actions.updateAi(store, { request: null });
    });
    expect(screen.getByTestId('ai-undo')).toBeEnabled();
    await user.click(screen.getByTestId('ai-clear'));
    expect(store.getState().ai.conversation).toEqual({
      docId: null,
      messages: [],
      activity: [],
      droppedTurns: 0,
    });
    expect(screen.getByTestId('ai-empty')).toBeInTheDocument();
    expect(screen.getByTestId('ai-clear')).toBeDisabled();
    expect(screen.getByTestId('ai-undo')).toBeDisabled();
    expect(services.undo.canUndo).toBe(true); // Edit > Undo still reaches the step
    expect(store.getState().ai.on).toBe(true);
  });

  it('follows the Tab order field → Send → Clear → Undo → close (quickstart §3)', async () => {
    const { store, services, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    act(() => {
      actions.updateAi(store, {
        request: { id: 'r1', origin: 'panel', state: 'exchanging', startedAt: Date.now() },
      });
      services.undo.recordSnapshot('body', 'x', { undo: () => {}, redo: () => {} });
    });
    message(store, { requestId: 'r1', role: 'user', text: 'x' });
    activity(store, 'request.done', { changes: 1, exchanges: 1, elapsedMs: 1 });
    act(() => {
      actions.updateAi(store, { request: null });
    });
    await user.click(screen.getByTestId('ai-input'));
    await user.keyboard('next');
    const order: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      order.push(document.activeElement?.getAttribute('data-testid') ?? '');
    }
    expect(order).toEqual(['ai-send', 'ai-clear', 'ai-undo', 'ai-panel-close']);
    // From the panel's first control (the settings link) Tab reaches the field: the two
    // scrolling lists are no stops.
    screen.getByTestId('ai-settings-link').focus();
    await user.tab();
    expect(screen.getByTestId('ai-input')).toHaveFocus();
  });

  it('takes the focus when the popup hands the conversation over (panelFocus) and resets the flag', async () => {
    const { store } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    expect(screen.getByTestId('ai-input')).not.toHaveFocus();
    act(() => {
      actions.updateAi(store, { panelFocus: true });
    });
    expect(screen.getByTestId('ai-input')).toHaveFocus();
    expect(store.getState().ai.panelFocus).toBe(false);
  });

  it("the close button hides the panel and turns the assistant off (FR-092; the visibility is the session's, FR-040)", async () => {
    const { store, user } = await renderPanel();
    await screen.findByText('api.example.test · my-model');
    message(store, { requestId: 'r1', role: 'user', text: 'x' });
    expect(store.getState().ai.visible).toBe(true);
    await user.click(screen.getByTestId('ai-panel-close'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(store.getState().ai.on).toBe(false);
    expect(store.getState().ai.visible).toBe(false);
    expect(store.getState().ai.conversation.messages).toEqual([]);
    expect(store.getState().modified).toBe(false);
  });
});

describe('DisabledPanel (the inert panel of FR-096, T100)', () => {
  beforeEach(() => {
    openSettingsDialog.mockReset();
  });

  async function renderInert(): Promise<Harness> {
    await initI18n({ language: 'en' });
    await changeLanguage('en');
    const store = createAppStore();
    const services = createAppServices({ store, platform: 'linux' });
    const settings = defaultSettings();
    settings.ai.mode = 'disabled';
    actions.setSettings(store, settings);
    const user = userEvent.setup();
    const { DisabledPanel } = await import('@/ai/DisabledPanel');
    render(
      <AppProvider services={services}>
        <DisabledPanel />
      </AppProvider>,
    );
    return { store, services, user };
  }

  it('shows every control disabled and greyed, no conversation, and the centred notice with the link that opens Settings → AI assistant', async () => {
    const { user } = await renderInert();
    const panel = screen.getByTestId('ai-panel-disabled');
    expect(panel).toHaveAttribute('data-inert', 'true');
    expect(panel).not.toHaveAttribute('aria-disabled'); // the link and the close button are live
    expect(screen.getByTestId('ai-service')).toHaveTextContent('disabled');
    expect(screen.queryByTestId('ai-messages')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-activity')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-settings-link')).not.toBeInTheDocument();
    for (const id of ['ai-input', 'ai-send', 'ai-clear', 'ai-undo']) {
      expect(screen.getByTestId(id), id).toBeDisabled();
    }
    const notice = screen.getByTestId('ai-panel-disabled-notice');
    expect(notice).toHaveTextContent(
      'The AI assistant is disabled. Enable it in Settings → AI assistant to work with it.',
    );
    const link = screen.getByTestId('ai-panel-disabled-settings');
    expect(link).toBeEnabled();
    expect(link).toHaveTextContent('Open Settings → AI assistant');
    await user.click(link);
    expect(openSettingsDialog).toHaveBeenCalledTimes(1);
    expect(openSettingsDialog.mock.calls[0]![2]).toEqual({ initialPage: 'ai' });
    // The close button is the panel's own (it hides the panel like the View entry does).
    expect(screen.getByTestId('ai-panel-close')).toHaveAccessibleName(
      'Close the AI assistant panel',
    );
  });

  it('the close button hides the panel (a bare render: the store flag directly)', async () => {
    const { store, user } = await renderInert();
    expect(store.getState().ai.visible).toBe(true);
    await user.click(screen.getByTestId('ai-panel-close'));
    expect(store.getState().ai.visible).toBe(false);
    expect(store.getState().ai.on).toBe(false);
    expect(store.getState().ai.loaded).toBe(false); // nothing of the chunk
  });
});
