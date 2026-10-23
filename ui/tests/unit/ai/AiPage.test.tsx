/**
 * Settings > AI assistant, the free half (feature 005 T034; FR-001, FR-002, FR-005, FR-007,
 * FR-008, FR-013, FR-021): the three radios with `free` as the default; the select built from
 * an `AiServicesResult` fixture (names, models, order, the replaced-by-user-file label, the
 * `tools: false` note, the issues as file + index + reason); the disappeared-entry fallback;
 * *Reload list* and *Edit list* (`ai.createUserServices` then `app.openFolder`, 1050 tolerated);
 * *Test connection* as a job with the status element's three states; the first-use notice
 * before a hosted entry and again on a 1200 `noAgreement`; the agreements list with a revoke
 * that writes `ai.agreements` at once; the terms link (href, `app.openUrl` on click, default
 * navigation prevented, no `target`, never a link for a `javascript:` or `file:` URL); the
 * "core too old" text.
 *
 * The custom half (US8 T085; FR-003, FR-004, FR-009; data-model §2.2, review A1-A5): the
 * fields under the custom radio, the masked key with its reveal toggle, the live status
 * computed with WebCrypto over the draft triple against the draft's record (green iff equal
 * and non-empty, red "not tested" otherwise, the service's words after a failed test of the
 * same draft), the plain-http warning, *Test connection* and *Fetch models* as jobs on the
 * draft target (the record kept in the draft, nothing written before OK, the notice for a
 * hosted draft, the running job cancelled with the dialog), the suggestions list with
 * `contextLength === 0` last and marked, and the one patch of the triple with the record.
 */

import { createHash } from 'node:crypto';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CommandContext } from '@/app/commands';
import { AiPage, type AiPageProps, type RequireAgreementFn } from '@/dialogs/settings/AiPage';
import { tripleFingerprint } from '@/dialogs/settings/model';
import { cloneSettings, settingsPatch } from '@/features/settings/apply';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import type {
  AiModelsResult,
  AiServiceEntry,
  AiServicesResult,
  AiTestResult,
  AiVerifiedRecord,
  Settings,
} from '@/rpc/types';

import {
  fakeDialogs,
  fakeRpc,
  makeContext,
  rpcError,
  type FakeDialogs,
  type FakeRpc,
  type Responder,
} from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

function entry(overrides: Partial<AiServiceEntry> & Pick<AiServiceEntry, 'id'>): AiServiceEntry {
  return {
    name: overrides.id,
    address: `https://${overrides.id}.example/v1`,
    model: `${overrides.id}-model`,
    keyRequired: false,
    hasKey: false,
    tools: true,
    limits: {
      en: `${overrides.id} limits`,
      ru: `${overrides.id} лимиты`,
      uk: `${overrides.id} ліміти`,
    },
    source: 'bundled',
    replaced: false,
    local: false,
    plainHttp: false,
    ...overrides,
  };
}

const BUNDLED = '/res/ai-services.json';
const USER = '/data/ai-services.json';

function services(overrides: Partial<AiServicesResult> = {}): AiServicesResult {
  return {
    services: [
      entry({
        id: 'ovhcloud',
        name: 'OVHcloud AI Endpoints',
        model: 'gpt-oss-120b',
        termsUrl: 'https://www.ovhcloud.com/en/terms-and-conditions/',
      }),
      entry({ id: 'pollinations', name: 'Pollinations', model: 'openai-fast' }),
      entry({
        id: 'llm7',
        name: 'LLM7.io',
        model: 'minimax-m2.7',
        termsUrl: 'https://llm7.io/privacy',
      }),
    ],
    hidden: [],
    files: { bundled: BUNDLED, user: USER, userExists: false },
    issues: [],
    ...overrides,
  };
}

const VERIFIED: AiTestResult = {
  ok: true,
  status: 200,
  body: { choices: [{ message: { content: 'OK' } }], model: 'answering-model' },
  elapsedMs: 3,
  verified: true,
  model: 'answering-model',
};

interface Harness {
  ctx: CommandContext & { dialogs: FakeDialogs };
  rpc: FakeRpc;
  onChange: ReturnType<typeof vi.fn>;
  user: ReturnType<typeof userEvent.setup>;
  draft: Settings;
  rerender: (draft: Settings) => void;
}

async function setup(
  options: {
    settings?: Settings;
    services?: AiServicesResult | Error;
    responses?: Record<string, Responder>;
    customAnswers?: unknown[];
    props?: Partial<AiPageProps>;
    rpc?: false;
  } = {},
): Promise<Harness> {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const draft = options.settings ?? defaultSettings();
  const rpc = fakeRpc({
    'ai.services': () => options.services ?? services(),
    'ai.reloadServices': () => options.services ?? services(),
    'ai.createUserServices': { path: USER, created: true },
    'app.openFolder': rpcError(1050, 'dialog.unavailable'),
    'app.openUrl': {},
    'settings.set': (params: unknown) => ({
      settings: {
        ...draft,
        ai: { ...draft.ai, ...(params as { patch: { ai: object } }).patch.ai },
      },
      restartRequired: false,
    }),
    ...(options.responses ?? {}),
  });
  const dialogs = fakeDialogs([], options.customAnswers ?? []);
  const ctx = await makeContext({ rpc: options.rpc === false ? null : rpc.client, dialogs });
  actions.setConnection(ctx.store, 'connected');
  actions.setSettings(ctx.store, draft);
  const onChange = vi.fn();
  const user = userEvent.setup();
  const element = (current: Settings) => (
    <AiPage draft={current} onChange={onChange} ctx={ctx} {...options.props} />
  );
  const rendered = render(element(draft));
  await screen.findByTestId('settings-page-ai');
  return {
    ctx,
    rpc,
    onChange,
    user,
    draft,
    rerender: (current) => rendered.rerender(element(current)),
  };
}

const optionTexts = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent);

const optionValues = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.getAttribute('value'));

const settingsSetCalls = (rpc: FakeRpc) =>
  rpc.calls
    .filter((call) => call.method === 'settings.set')
    .map((call) => (call.params as { patch: Record<string, unknown> }).patch);

describe('AiPage - the radios and the list', () => {
  it('offers Free / own service / Disabled with the saved mode checked and the custom fields disabled', async () => {
    const { user, onChange } = await setup();
    expect(screen.getByTestId('settings-ai-mode-free')).toBeChecked();
    expect(screen.getByTestId('settings-ai-mode-custom')).not.toBeChecked();
    expect(screen.getByTestId('settings-ai-mode-disabled')).not.toBeChecked();
    for (const field of ['settings-ai-address', 'settings-ai-key', 'settings-ai-model']) {
      expect(screen.getByTestId(field)).toBeDisabled();
    }
    // The key is a password field: never displayed in clear.
    expect(screen.getByTestId('settings-ai-key')).toHaveAttribute('type', 'password');
    await user.click(screen.getByTestId('settings-ai-mode-disabled'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'disabled' });
    await user.click(screen.getByTestId('settings-ai-mode-custom'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'custom' });
  });

  it('shows Disabled checked for a fresh installation - the stored default (FR-001) - and for a draft without the ai group; Free selects the first bundled entry', async () => {
    const fresh = defaultSettings();
    fresh.ai.mode = 'disabled';
    const { user, onChange } = await setup({ settings: fresh });
    expect(screen.getByTestId('settings-ai-mode-disabled')).toBeChecked();
    expect(screen.getByTestId('settings-ai-mode-free')).not.toBeChecked();
    expect(screen.queryByTestId('settings-ai-test')).not.toBeInTheDocument();
    // Free chosen on the page: the drop-down with the first bundled entry selected (FR-002).
    await user.click(screen.getByTestId('settings-ai-mode-free'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'free' });
    cleanup();

    // A draft without the group (an older settings shape) reads as the default: Disabled.
    const legacy = defaultSettings();
    delete (legacy as Partial<Settings>).ai;
    await setup({ settings: legacy });
    expect(screen.getByTestId('settings-ai-mode-disabled')).toBeChecked();
    expect(screen.getByTestId('settings-ai-mode-free')).not.toBeChecked();
  });

  it('lists the entries in order as "<name> — <model>" with the first selected, limits and terms', async () => {
    const { user, onChange, draft, rerender } = await setup();
    const select = await screen.findByTestId('settings-ai-service');
    expect(optionValues(select)).toEqual(['ovhcloud', 'pollinations', 'llm7']);
    expect(optionTexts(select)).toEqual([
      'OVHcloud AI Endpoints — gpt-oss-120b',
      'Pollinations — openai-fast',
      'LLM7.io — minimax-m2.7',
    ]);
    expect(select).toHaveValue('ovhcloud');
    expect(screen.getByTestId('settings-ai-limits')).toHaveTextContent('ovhcloud limits');
    expect(screen.getByTestId('settings-ai-terms')).toHaveAttribute(
      'href',
      'https://www.ovhcloud.com/en/terms-and-conditions/',
    );
    expect(screen.queryByTestId('settings-ai-tools-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-ai-replaced')).not.toBeInTheDocument();
    // Picking another entry edits the draft (saved at OK, not here); the dialog re-renders
    // the page with it and the notes follow.
    await user.selectOptions(select, 'pollinations');
    expect(onChange).toHaveBeenLastCalledWith({ freeServiceId: 'pollinations' });
    rerender({ ...draft, ai: { ...draft.ai, freeServiceId: 'pollinations' } });
    expect(screen.getByTestId('settings-ai-service')).toHaveValue('pollinations');
    expect(screen.getByTestId('settings-ai-limits')).toHaveTextContent('pollinations limits');
    // No terms link for an entry without one.
    expect(screen.queryByTestId('settings-ai-terms')).not.toBeInTheDocument();
    // The list files (FR-007): the bundled path and the user file not created yet.
    const paths = screen.getByTestId('settings-ai-list-path');
    expect(paths).toHaveTextContent(BUNDLED);
    expect(paths).toHaveTextContent(USER);
    expect(paths).toHaveTextContent(/not created yet/);
  });

  it('marks a replaced entry, an answers-only entry and lists the issues as file + index + reason', async () => {
    const list = services({
      services: [
        entry({
          id: 'ovhcloud',
          name: 'OVHcloud (stand-in)',
          model: 'standin-chat',
          source: 'user',
          replaced: true,
          address: 'http://127.0.0.1:8787/v1',
          local: true,
          plainHttp: true,
        }),
        entry({ id: 'pollinations', name: 'Pollinations', model: 'openai-fast' }),
        entry({
          id: 'my-local',
          name: 'My local model',
          model: 'llama3.1:8b',
          tools: false,
          source: 'user',
        }),
      ],
      hidden: ['kilo'],
      files: { bundled: BUNDLED, user: USER, userExists: true },
      issues: [
        { file: USER, index: 3, reason: 'missingField', field: 'model' },
        { file: USER, reason: 'invalidJson' },
        { file: USER, index: 5, reason: 'duplicateId' },
      ],
    });
    const settings = defaultSettings();
    settings.ai.freeServiceId = 'my-local';
    const { user, onChange, rerender } = await setup({ services: list, settings });
    const select = await screen.findByTestId('settings-ai-service');
    expect(optionTexts(select)).toEqual([
      'OVHcloud (stand-in) — standin-chat',
      'Pollinations — openai-fast',
      'My local model — llama3.1:8b',
    ]);
    expect(select).toHaveValue('my-local');
    expect(screen.getByTestId('settings-ai-tools-note')).toHaveTextContent(
      'answers only — cannot operate the editor',
    );
    await user.selectOptions(select, 'ovhcloud');
    expect(onChange).toHaveBeenLastCalledWith({ freeServiceId: 'ovhcloud' });
    rerender({ ...settings, ai: { ...settings.ai, freeServiceId: 'ovhcloud' } });
    expect(screen.getByTestId('settings-ai-replaced')).toHaveTextContent(/your list file/i);
    expect(screen.queryByTestId('settings-ai-tools-note')).not.toBeInTheDocument();
    const issues = screen.getByTestId('settings-ai-list-issues');
    const rows = within(issues).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(`${USER}, entry 3:`);
    expect(rows[0]).toHaveTextContent('The field "model" is missing or of the wrong type.');
    expect(rows[1]).toHaveTextContent(`${USER}:`);
    expect(rows[1]).toHaveTextContent('The file is not valid JSON.');
    expect(rows[2]).toHaveTextContent(`${USER}, entry 5:`);
    expect(rows[2]).toHaveTextContent(/already used by an earlier entry/);
    expect(screen.getByTestId('settings-ai-list-path')).not.toHaveTextContent(/not created yet/);
  });

  it('falls back to the first entry when the saved id is gone and does not rewrite the setting', async () => {
    const settings = defaultSettings();
    settings.ai.freeServiceId = 'kilo';
    const { onChange } = await setup({ settings });
    const select = await screen.findByTestId('settings-ai-service');
    expect(select).toHaveValue('ovhcloud');
    expect(screen.getByTestId('settings-ai-fallback')).toHaveTextContent(
      'Your list file no longer has "kilo"; the first entry is selected instead.',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says the core is too old when the ai.services method does not exist', async () => {
    await setup({ services: rpcError(-32601, 'Method not found: ai.services') });
    expect(await screen.findByTestId('settings-ai-core-too-old')).toHaveTextContent(
      /older than the AI assistant needs/,
    );
    expect(screen.queryByTestId('settings-ai-test')).not.toBeInTheDocument();
  });

  it('hides Test connection while the Disabled radio is chosen', async () => {
    const settings = defaultSettings();
    settings.ai.mode = 'disabled';
    await setup({ settings });
    await screen.findByTestId('settings-ai-service');
    expect(screen.getByTestId('settings-ai-mode-disabled')).toBeChecked();
    expect(screen.queryByTestId('settings-ai-test')).not.toBeInTheDocument();
  });
});

describe('AiPage - Reload list and Edit list', () => {
  it('Reload list calls ai.reloadServices and shows the new list', async () => {
    const { user, rpc } = await setup();
    await screen.findByTestId('settings-ai-service');
    rpc.responses['ai.reloadServices'] = services({
      services: [entry({ id: 'standin', name: 'Stand-in', model: 'standin-chat' })],
    });
    await user.click(screen.getByTestId('settings-ai-reload-list'));
    await waitFor(() =>
      expect(optionValues(screen.getByTestId('settings-ai-service'))).toEqual(['standin']),
    );
    expect(rpc.calls.filter((c) => c.method === 'ai.reloadServices')).toHaveLength(1);
  });

  it('Edit list creates the user file and opens its folder, tolerating 1050 headless', async () => {
    const { user, rpc, ctx } = await setup();
    await screen.findByTestId('settings-ai-service');
    await user.click(screen.getByTestId('settings-ai-edit-list'));
    await waitFor(() => expect(rpc.calls.map((c) => c.method)).toContain('ai.createUserServices'));
    const methods = rpc.calls.map((c) => c.method);
    expect(methods.indexOf('ai.createUserServices')).toBeLessThan(
      methods.indexOf('app.openFolder'),
    );
    expect(rpc.calls.find((c) => c.method === 'app.openFolder')?.params).toEqual({ path: USER });
    // 1050 `dialog.unavailable` (no shell): no message box, the note says the file was created.
    expect(ctx.dialogs.shown).toEqual([]);
    expect(await screen.findByTestId('settings-ai-list-note')).toHaveTextContent(/created/);

    rpc.responses['ai.createUserServices'] = { path: USER, created: false };
    await user.click(screen.getByTestId('settings-ai-edit-list'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-ai-list-note')).toHaveTextContent(/already exists/),
    );
  });

  it('re-reads the list on resources.changed {what: "aiServices"}', async () => {
    const { rpc } = await setup();
    await screen.findByTestId('settings-ai-service');
    rpc.responses['ai.services'] = services({
      services: [entry({ id: 'only', name: 'Only', model: 'm' })],
    });
    act(() => rpc.notify('resources.changed', { what: 'aiServices' }));
    await waitFor(() =>
      expect(optionValues(screen.getByTestId('settings-ai-service'))).toEqual(['only']),
    );
    act(() => rpc.notify('resources.changed', { what: 'genres' }));
    expect(rpc.calls.filter((c) => c.method === 'ai.services')).toHaveLength(2);
  });
});

describe('AiPage - Test connection', () => {
  it('runs ai.test as a job for the free target: untested -> verified "answered (<model>)"', async () => {
    const { user, rpc } = await setup({
      responses: { 'ai.test': VERIFIED },
      props: { requireAgreement: () => Promise.resolve(true) },
    });
    await screen.findByTestId('settings-ai-service');
    const status = screen.getByTestId('settings-ai-status');
    expect(status).toHaveAttribute('data-status', 'untested');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Connection not tested');
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'verified'));
    expect(status).toHaveTextContent('answered (answering-model)');
    const call = rpc.calls.find((c) => c.method === 'ai.test');
    expect(call?.params).toEqual({ target: { kind: 'free', id: 'ovhcloud' } });
    // Nothing saved by a test (FR-005, FR-009).
    expect(settingsSetCalls(rpc)).toEqual([]);
  });

  it("shows the service's own words in the failed state and a localised text per transport kind", async () => {
    const { user, rpc } = await setup({
      responses: {
        'ai.test': {
          ok: false,
          kind: 'http',
          status: 429,
          body: { message: 'API rate limit exceeded' },
          retryAfterSeconds: 3,
          elapsedMs: 2,
          verified: false,
        } satisfies AiTestResult,
      },
      props: { requireAgreement: () => Promise.resolve(true) },
    });
    await screen.findByTestId('settings-ai-service');
    const status = screen.getByTestId('settings-ai-status');
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'failed'));
    expect(status).toHaveTextContent('API rate limit exceeded');
    // Plain text: an HTML error page is reduced to its text, never inserted as markup.
    rpc.responses['ai.test'] = {
      ok: false,
      kind: 'http',
      status: 400,
      text: '<html><body><pre>SyntaxError: Unexpected <b>end</b></pre></body></html>',
      elapsedMs: 2,
      verified: false,
    } satisfies AiTestResult;
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(status).toHaveTextContent('SyntaxError: Unexpected end'));
    expect(status.querySelector('b, pre, html')).toBeNull();
    // A transport failure: the localised text of its kind with the transport's message.
    rpc.responses['ai.test'] = {
      ok: false,
      kind: 'offline',
      message: 'Could not resolve host: api.example',
      elapsedMs: 2,
      verified: false,
    } satisfies AiTestResult;
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(status).toHaveTextContent(/could not be reached/));
    expect(status).toHaveTextContent('Could not resolve host: api.example');
    // A 200 with an error and no choices is not verified.
    rpc.responses['ai.test'] = {
      ok: true,
      status: 200,
      body: { error: { message: 'Upstream error from Nvidia: ResourceExhausted' } },
      elapsedMs: 2,
      verified: false,
    } satisfies AiTestResult;
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(status).toHaveTextContent('Upstream error from Nvidia'));
    expect(status).toHaveAttribute('data-status', 'failed');
  });

  it('shows the first-use notice before a hosted entry, and again on a 1200 noAgreement', async () => {
    let attempts = 0;
    const requireAgreement = vi.fn<RequireAgreementFn>(() => Promise.resolve(true));
    const { user, rpc } = await setup({
      responses: {
        'ai.test': () => {
          attempts += 1;
          if (attempts === 1) {
            return rpcError(1200, 'ai.noService', { reason: 'noAgreement', service: 'ovhcloud' });
          }
          return VERIFIED;
        },
      },
      props: { requireAgreement },
    });
    await screen.findByTestId('settings-ai-service');
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-ai-status')).toHaveAttribute('data-status', 'verified'),
    );
    // Once before the call (hosted address), once more after the core's gate refused.
    expect(requireAgreement).toHaveBeenCalledTimes(2);
    expect(requireAgreement.mock.calls[0]![0]).toMatchObject({
      kind: 'free',
      id: 'ovhcloud',
      address: 'https://ovhcloud.example/v1',
      name: 'OVHcloud AI Endpoints',
      termsUrl: 'https://www.ovhcloud.com/en/terms-and-conditions/',
    });
    expect(rpc.calls.filter((c) => c.method === 'ai.test')).toHaveLength(2);
  });

  it('No in the notice sends nothing; a local entry never asks', async () => {
    const requireAgreement = vi.fn(() => Promise.resolve(false));
    const list = services({
      services: [
        entry({ id: 'hosted', name: 'Hosted', model: 'h' }),
        entry({
          id: 'local',
          name: 'Local',
          model: 'l',
          address: 'http://127.0.0.1:11434/v1',
          local: true,
          plainHttp: true,
        }),
      ],
    });
    const settings = defaultSettings();
    settings.ai.freeServiceId = 'hosted';
    const { user, rpc, rerender } = await setup({
      services: list,
      settings,
      responses: { 'ai.test': VERIFIED },
      props: { requireAgreement },
    });
    await screen.findByTestId('settings-ai-service');
    await user.click(screen.getByTestId('settings-ai-test'));
    await act(async () => {});
    expect(requireAgreement).toHaveBeenCalledTimes(1);
    expect(rpc.calls.filter((c) => c.method === 'ai.test')).toHaveLength(0);
    expect(screen.getByTestId('settings-ai-status')).toHaveAttribute('data-status', 'untested');

    const local = { ...settings, ai: { ...settings.ai, freeServiceId: 'local' } };
    rerender(local);
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-ai-status')).toHaveAttribute('data-status', 'verified'),
    );
    expect(requireAgreement).toHaveBeenCalledTimes(1);
    expect(rpc.calls.find((c) => c.method === 'ai.test')?.params).toEqual({
      target: { kind: 'free', id: 'local' },
    });
  });

  it('opens the real notice for a hosted entry and records the agreement on Yes', async () => {
    const { user, rpc, ctx } = await setup({
      responses: { 'ai.test': VERIFIED },
      customAnswers: [true],
    });
    await screen.findByTestId('settings-ai-service');
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-ai-status')).toHaveAttribute('data-status', 'verified'),
    );
    expect(ctx.dialogs.custom.map((c) => c.name)).toEqual(['AiNoticeDialog']);
    const written = settingsSetCalls(rpc);
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual({
      ai: {
        agreements: [
          { service: 'ovhcloud', host: 'ovhcloud.example', at: expect.stringMatching(/^\d{4}-/) },
        ],
      },
    });
    // The page's agreements list follows at once.
    expect(screen.getByTestId('settings-ai-agreement-ovhcloud-revoke')).toBeInTheDocument();
  });
});

describe('AiPage - agreements and the terms link', () => {
  it('lists the agreements and writes ai.agreements at once on revoke', async () => {
    const settings = defaultSettings();
    settings.ai.agreements = [
      {
        service: 'ovhcloud',
        host: 'oai.endpoints.kepler.ai.cloud.ovh.net',
        at: '2026-10-22T10:00:00Z',
      },
      { service: 'custom:https://api.example/v1', host: 'api.example', at: '2026-10-21T09:30:00Z' },
    ];
    const { user, rpc, onChange, ctx } = await setup({ settings });
    await screen.findByTestId('settings-ai-service');
    const list = screen.getByTestId('settings-ai-agreements');
    // The known entry under its name, the custom key as stored, hosts shown.
    expect(list).toHaveTextContent('OVHcloud AI Endpoints');
    expect(list).toHaveTextContent('oai.endpoints.kepler.ai.cloud.ovh.net');
    expect(list).toHaveTextContent('custom:https://api.example/v1');
    expect(screen.getByTestId('settings-ai-agreement-ovhcloud-revoke')).toBeInTheDocument();
    await user.click(
      screen.getByTestId('settings-ai-agreement-custom:https://api.example/v1-revoke'),
    );
    await waitFor(() => expect(settingsSetCalls(rpc)).toHaveLength(1));
    expect(settingsSetCalls(rpc)[0]).toEqual({
      ai: { agreements: [settings.ai.agreements[0]] },
    });
    // The draft follows so that OK does not bring it back; the store too.
    expect(onChange).toHaveBeenLastCalledWith({ agreements: [settings.ai.agreements[0]] });
    expect(ctx.store.getState().settings?.ai.agreements).toEqual([settings.ai.agreements[0]]);
  });

  it('shows "none" without agreements', async () => {
    await setup();
    await screen.findByTestId('settings-ai-service');
    expect(screen.getByTestId('settings-ai-agreements')).toHaveTextContent(/None yet/);
  });

  it('renders the terms link with href and opens it through app.openUrl, never as navigation', async () => {
    const { rpc } = await setup();
    const link = await screen.findByTestId('settings-ai-terms');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', 'https://www.ovhcloud.com/en/terms-and-conditions/');
    expect(link).not.toHaveAttribute('target');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(rpc.calls.filter((c) => c.method === 'app.openUrl')).toHaveLength(1),
    );
    expect(rpc.calls.find((c) => c.method === 'app.openUrl')?.params).toEqual({
      url: 'https://www.ovhcloud.com/en/terms-and-conditions/',
    });
    // Enter on the focused link opens it too and does not reach the dialog's default button.
    const enter = fireEvent.keyDown(link, { key: 'Enter' });
    expect(enter).toBe(false);
    await waitFor(() =>
      expect(rpc.calls.filter((c) => c.method === 'app.openUrl')).toHaveLength(2),
    );
  });

  it('never renders a javascript: or file: termsUrl as a link', async () => {
    const list = services({
      services: [
        entry({ id: 'js', name: 'JS', model: 'm', termsUrl: 'javascript:alert(1)' }),
        entry({ id: 'file', name: 'File', model: 'm', termsUrl: 'file:///etc/passwd' }),
      ],
    });
    const settings = defaultSettings();
    settings.ai.freeServiceId = 'js';
    const { user } = await setup({ services: list, settings });
    const terms = await screen.findByTestId('settings-ai-terms');
    expect(terms.tagName).not.toBe('A');
    expect(terms).toHaveTextContent('javascript:alert(1)');
    expect(
      screen.getByTestId('settings-page-ai').querySelector('a[href^="javascript:"]'),
    ).toBeNull();
    await user.selectOptions(screen.getByTestId('settings-ai-service'), 'file');
    expect(screen.getByTestId('settings-ai-terms').tagName).not.toBe('A');
    expect(screen.getByTestId('settings-page-ai').querySelector('a[href^="file:"]')).toBeNull();
  });
});

describe('AiPage - without a core', () => {
  it('renders the radios and says the list is unavailable', async () => {
    await setup({ rpc: false });
    expect(screen.getByTestId('settings-ai-mode-free')).toBeChecked();
    expect(screen.getByTestId('settings-ai-list-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-ai-test')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ */
/* The custom option (US8 T085; FR-003, FR-004, FR-009; data-model §2.2)      */
/* ------------------------------------------------------------------------ */

const ADDRESS = 'http://127.0.0.1:8787/v1';

/** The fingerprint the core computes (rpc-api §3.7): SHA-256 hex of `address\0key\0model`. */
function fingerprintOf(address: string, key: string, model: string): string {
  return createHash('sha256').update(`${address}\0${key}\0${model}`, 'utf8').digest('hex');
}

function customSettings(
  triple: { address?: string; key?: string; model?: string } = {},
  verified?: AiVerifiedRecord,
): Settings {
  const settings = defaultSettings();
  settings.ai.mode = 'custom';
  settings.ai.custom = {
    address: triple.address ?? ADDRESS,
    key: triple.key ?? 'sk-test-123',
    model: triple.model ?? 'standin-chat',
  };
  if (verified) settings.ai.customVerified = verified;
  return settings;
}

const CUSTOM_VERIFIED: AiTestResult = {
  ok: true,
  status: 200,
  body: { choices: [{ message: { content: 'OK' } }], model: 'standin-chat' },
  elapsedMs: 3,
  verified: true,
  model: 'standin-chat',
  fingerprint: fingerprintOf(ADDRESS, 'sk-test-123', 'standin-chat'),
};

const MODELS: AiModelsResult = {
  ok: true,
  status: 200,
  models: [
    { id: 'standin-embed', contextLength: 0 },
    { id: 'standin-chat', contextLength: 131072 },
    { id: 'standin-mini', tools: false },
  ],
  elapsedMs: 2,
};

const suggestionValues = () =>
  Array.from(
    screen.getByTestId('settings-ai-model-list').querySelectorAll('option'),
    (option) => option.value,
  );

describe('AiPage - the custom option: fields, masking and the live status', () => {
  it('jsdom keeps WebCrypto: crypto.subtle.digest answers 32 bytes (the probe of 2026-10-22)', async () => {
    expect(window.crypto).toBe(globalThis.crypto);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('a\0b\0c'));
    expect(digest.byteLength).toBe(32);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe(fingerprintOf('a', 'b', 'c'));
    expect(await tripleFingerprint({ address: 'a', key: 'b', model: 'c' })).toBe(hex);
  });

  it('enables the fields under the custom radio with the OpenAI default and both examples in the placeholder; the key is masked with a reveal toggle and trimmed', async () => {
    const settings = defaultSettings();
    settings.ai.mode = 'custom';
    const { user, onChange } = await setup({ settings });
    const address = screen.getByTestId('settings-ai-address');
    const key = screen.getByTestId('settings-ai-key');
    const model = screen.getByTestId('settings-ai-model');
    for (const field of [address, key, model]) expect(field).toBeEnabled();
    expect(address).toHaveValue('https://api.openai.com/v1');
    expect(address).toHaveAttribute('placeholder', expect.stringContaining('api.openai.com/v1'));
    expect(address).toHaveAttribute('placeholder', expect.stringContaining('127.0.0.1:11434/v1'));
    // Masked, revealed while editing, masked again (FR-003).
    expect(key).toHaveAttribute('type', 'password');
    const reveal = screen.getByTestId('settings-ai-key-reveal');
    expect(reveal).toHaveAttribute('aria-pressed', 'false');
    await user.click(reveal);
    expect(key).toHaveAttribute('type', 'text');
    expect(reveal).toHaveAttribute('aria-pressed', 'true');
    await user.click(reveal);
    expect(key).toHaveAttribute('type', 'password');
    // Surrounding white space of a pasted key never reaches the draft.
    fireEvent.change(key, { target: { value: '  sk-pasted ' } });
    expect(onChange).toHaveBeenLastCalledWith({
      custom: { ...settings.ai.custom, key: 'sk-pasted' },
    });
    fireEvent.change(model, { target: { value: 'llama3.1:8b' } });
    expect(onChange).toHaveBeenLastCalledWith({
      custom: { ...settings.ai.custom, model: 'llama3.1:8b' },
    });
    // The suggestions list exists (empty before Fetch models) and the field accepts any name.
    expect(model).toHaveAttribute('list', 'settings-ai-model-list');
    expect(suggestionValues()).toEqual([]);
    // No Fetch models under the free radio.
    expect(screen.getByTestId('settings-ai-fetch-models')).toBeInTheDocument();
  });

  it('computes the status with WebCrypto over the draft triple: untested red, verified green while the record matches, red at once after an edit, green again with the same values', async () => {
    const record: AiVerifiedRecord = {
      fingerprint: fingerprintOf(ADDRESS, 'sk-test-123', 'standin-chat'),
      model: 'standin-chat',
      at: '2026-10-22T10:00:00.000Z',
    };
    const settings = customSettings({}, record);
    const { rerender, rpc } = await setup({ settings });
    const status = screen.getByTestId('settings-ai-status');
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'verified'));
    expect(status).toHaveTextContent('Verified — model standin-chat');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveClass('mfbe-settings-ai-status');
    // An edit of the model: red "not tested" at once (no RPC involved).
    rerender({
      ...settings,
      ai: { ...settings.ai, custom: { ...settings.ai.custom, model: 'x' } },
    });
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'untested'));
    expect(status).toHaveTextContent('Connection not tested');
    // An edit of the key: red too.
    rerender({ ...settings, ai: { ...settings.ai, custom: { ...settings.ai.custom, key: 'k' } } });
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'untested'));
    // The same values again: green without a new test.
    rerender(settings);
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'verified'));
    expect(rpc.calls.filter((c) => c.method === 'ai.test')).toEqual([]);
    // An empty record is never green, whatever the triple.
    rerender(customSettings({}, { fingerprint: '', model: '', at: '' }));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'untested'));
  });

  it('shows the plain-http warning for a hosted http address only', async () => {
    const settings = customSettings({ address: 'http://192.0.2.10:8080/v1' });
    const { rerender } = await setup({ settings });
    expect(screen.getByTestId('settings-ai-http-warning')).toHaveTextContent(/unencrypted/);
    for (const address of [
      'https://example.invalid/v1',
      'http://127.0.0.1:8787/v1',
      'http://localhost:8787/v1',
      'http://[::1]:8787/v1',
    ]) {
      rerender(customSettings({ address }));
      expect(screen.queryByTestId('settings-ai-http-warning')).not.toBeInTheDocument();
    }
    // Under the free radio the warning is not shown for the (inactive) custom address.
    const free = customSettings({ address: 'http://192.0.2.10:8080/v1' });
    free.ai.mode = 'free';
    rerender(free);
    expect(screen.queryByTestId('settings-ai-http-warning')).not.toBeInTheDocument();
  });
});

describe('AiPage - the custom option: Test connection and Fetch models on the draft', () => {
  it('Test connection sends the draft triple, keeps the verified record in the draft and writes nothing', async () => {
    const settings = customSettings();
    const { user, rpc, onChange, rerender } = await setup({
      settings,
      responses: { 'ai.test': CUSTOM_VERIFIED },
    });
    const status = screen.getByTestId('settings-ai-status');
    expect(status).toHaveAttribute('data-status', 'untested');
    expect(screen.getByTestId('settings-ai-test')).toBeEnabled();
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(rpc.calls.find((c) => c.method === 'ai.test')?.params).toEqual({
      target: { kind: 'custom', address: ADDRESS, key: 'sk-test-123', model: 'standin-chat' },
    });
    const patch = onChange.mock.calls.at(-1)![0] as { customVerified: AiVerifiedRecord };
    expect(patch.customVerified).toEqual({
      fingerprint: CUSTOM_VERIFIED.fingerprint,
      model: 'standin-chat',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    // Nothing written: the record travels with the triple at OK (review A2).
    expect(settingsSetCalls(rpc)).toEqual([]);
    // The dialog re-renders the page with the record: green.
    rerender({ ...settings, ai: { ...settings.ai, customVerified: patch.customVerified } });
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'verified'));
    expect(status).toHaveTextContent('Verified — model standin-chat');
  });

  it('a failed test shows the service words with the key masked until the draft changes; an empty address or model disables Test', async () => {
    const settings = customSettings({ key: 'sk-wrong-key' });
    const { user, rerender } = await setup({
      settings,
      responses: {
        'ai.test': {
          ok: false,
          kind: 'http',
          status: 401,
          body: {
            error: {
              message: 'Incorrect API key provided: sk-wrong-key.',
              code: 'invalid_api_key',
            },
          },
          elapsedMs: 2,
          verified: false,
        } satisfies AiTestResult,
      },
    });
    const status = screen.getByTestId('settings-ai-status');
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'failed'));
    expect(status).toHaveTextContent('Incorrect API key provided: •••.');
    expect(status).not.toHaveTextContent('sk-wrong-key');
    // The failure belongs to the tested draft: an edit makes it "not tested" again.
    rerender(customSettings({ key: 'sk-other' }));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'untested'));
    rerender(customSettings({ key: 'sk-wrong-key' }));
    await waitFor(() => expect(status).toHaveAttribute('data-status', 'failed'));
    // Nothing to test without an address or a model.
    rerender(customSettings({ model: '' }));
    expect(screen.getByTestId('settings-ai-test')).toBeDisabled();
    expect(screen.getByTestId('settings-ai-fetch-models')).toBeEnabled();
    rerender(customSettings({ address: '' }));
    expect(screen.getByTestId('settings-ai-test')).toBeDisabled();
    expect(screen.getByTestId('settings-ai-fetch-models')).toBeDisabled();
  });

  it('Fetch models fills the suggestions in the service order with contextLength 0 last and marked, keeps the list and the context length in memory, reports none and a format failure', async () => {
    const settings = customSettings();
    const { user, rpc, ctx } = await setup({ settings, responses: { 'ai.models': MODELS } });
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await waitFor(() =>
      expect(suggestionValues()).toEqual(['standin-chat', 'standin-mini', 'standin-embed']),
    );
    expect(rpc.calls.find((c) => c.method === 'ai.models')?.params).toEqual({
      target: { kind: 'custom', address: ADDRESS, key: 'sk-test-123', model: 'standin-chat' },
    });
    const options = screen.getByTestId('settings-ai-model-list').querySelectorAll('option');
    expect(options[0]!.label).toBe('');
    expect(options[1]!.label).toBe('answers only');
    expect(options[2]!.label).toBe('not a chat model?');
    expect(screen.getByTestId('settings-ai-models-note')).toHaveTextContent('3 models');
    // The answer is kept in memory for the session - never a setting (review C13): the
    // chosen model's context length as the hint, the list for the assistant's target.
    const memory = ctx.store.getState().ai;
    expect(memory.contextLengthHint).toBe(131072);
    expect(memory.customModels).toEqual({ address: ADDRESS, models: MODELS.ok && MODELS.models });
    expect(settingsSetCalls(rpc)).toEqual([]);

    // No models: the field is typed-only.
    rpc.responses['ai.models'] = { ok: true, status: 200, models: [], elapsedMs: 1 };
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-ai-models-note')).toHaveTextContent(/lists no models/),
    );
    expect(suggestionValues()).toEqual([]);
    expect(screen.getByTestId('settings-ai-model')).toBeEnabled();

    // A non-list body: the format message under the button.
    rpc.responses['ai.models'] = {
      ok: false,
      kind: 'format',
      status: 200,
      text: '{"message":"not a list"}',
      elapsedMs: 1,
    };
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await waitFor(() =>
      expect(screen.getByTestId('settings-ai-models-note')).toHaveTextContent(
        /could not be understood/,
      ),
    );
    expect(suggestionValues()).toEqual([]);
  });

  it('shows the notice before Fetch models and Test on a hosted draft, re-asks on 1200 noAgreement, never for a local draft', async () => {
    const requireAgreement = vi.fn<RequireAgreementFn>(() => Promise.resolve(true));
    let tests = 0;
    const hosted = customSettings({ address: 'http://ai.standin.test:8787/v1' });
    const { user, rpc, rerender } = await setup({
      settings: hosted,
      responses: {
        'ai.models': MODELS,
        'ai.test': () => {
          tests += 1;
          return tests === 1
            ? rpcError(1200, 'ai.noService', {
                reason: 'noAgreement',
                service: 'custom:http://ai.standin.test:8787/v1',
              })
            : CUSTOM_VERIFIED;
        },
      },
      props: { requireAgreement },
    });
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await waitFor(() => expect(rpc.calls.map((c) => c.method)).toContain('ai.models'));
    expect(requireAgreement).toHaveBeenCalledTimes(1);
    expect(requireAgreement.mock.calls[0]![0]).toEqual({
      kind: 'custom',
      address: 'http://ai.standin.test:8787/v1',
      name: 'ai.standin.test:8787',
    });
    await user.click(screen.getByTestId('settings-ai-test'));
    await waitFor(() => expect(rpc.calls.filter((c) => c.method === 'ai.test')).toHaveLength(2));
    // Once before the test, once more after the core's gate refused.
    expect(requireAgreement).toHaveBeenCalledTimes(3);
    expect(requireAgreement.mock.calls[2]![1]).toEqual({ force: true });

    // No: nothing is called.
    requireAgreement.mockImplementation(() => Promise.resolve(false));
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await act(async () => {});
    expect(rpc.calls.filter((c) => c.method === 'ai.models')).toHaveLength(1);

    // A local draft never asks.
    rerender(customSettings());
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await waitFor(() => expect(rpc.calls.filter((c) => c.method === 'ai.models')).toHaveLength(2));
    expect(requireAgreement).toHaveBeenCalledTimes(4);
  });

  it('cancels a running Fetch or Test job when the dialog closes', async () => {
    const settings = customSettings();
    const cancellers = new Set<() => void>();
    const { user, rpc } = await setup({
      settings,
      responses: { 'job.cancel': {} },
      props: {
        registerCancel: (cancel) => {
          cancellers.add(cancel);
          return () => cancellers.delete(cancel);
        },
      },
    });
    let started: string | null = null;
    (rpc.client as unknown as { runJob: unknown }).runJob = (
      method: string,
      params: unknown,
      options?: { onStart?: (jobId: string) => void },
    ) => {
      rpc.calls.push({ method, params });
      started = method;
      options?.onStart?.(`job-${method}`);
      return new Promise(() => {}); // never answers: the dialog closes first
    };
    await user.click(screen.getByTestId('settings-ai-fetch-models'));
    await waitFor(() => expect(started).toBe('ai.models'));
    expect(screen.getByTestId('settings-ai-fetch-models')).toBeDisabled();
    expect(screen.getByTestId('settings-ai-test')).toBeDisabled();
    act(() => {
      for (const cancel of cancellers) cancel();
    });
    await waitFor(() =>
      expect(rpc.calls.find((c) => c.method === 'job.cancel')?.params).toEqual({
        jobId: 'job-ai.models',
      }),
    );
  });

  it('the draft diff writes the triple and ai.customVerified in one patch (the dialog at OK) and Cancel discards the draft', () => {
    const original = defaultSettings();
    const draft = customSettings(
      {},
      {
        fingerprint: fingerprintOf(ADDRESS, 'sk-test-123', 'standin-chat'),
        model: 'standin-chat',
        at: '2026-10-22T10:00:00.000Z',
      },
    );
    expect(settingsPatch(original, draft)).toEqual({
      ai: {
        mode: 'custom',
        custom: { address: ADDRESS, key: 'sk-test-123', model: 'standin-chat' },
        customVerified: draft.ai.customVerified,
      },
    });
    // Nothing changed (Cancel keeps the original): an empty patch.
    expect(settingsPatch(original, cloneSettings(original))).toEqual({});
  });
});
