/**
 * The first-use notice dialog (feature 005 T035; FR-021; review C14): names the service and
 * its host, lists exactly what leaves the computer, links the terms page through `app.openUrl`
 * (no `target`, no navigation), adds the unencrypted sentence for a plain hosted address only,
 * Yes / No with Escape as No; `requireAgreement` skips the dialog when no notice is due, writes
 * the agreement at once on Yes and nothing on No.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AiNoticeDialog, requireAgreement, type NoticeTarget } from '@/ai/notice';
import { changeLanguage, initI18n } from '@/i18n';
import { actions } from '@/model/store';
import type { AiAgreement } from '@/rpc/types';

import { fakeDialogs, fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

const HOSTED: NoticeTarget = {
  kind: 'free',
  id: 'standin',
  name: 'Stand-in (hosted)',
  address: 'http://ai.standin.test:8787/v1',
  termsUrl: 'https://ai.standin.test/terms',
};

async function renderNotice(target: NoticeTarget) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const rpc = fakeRpc({ 'app.openUrl': {} });
  const onClose = vi.fn();
  render(<AiNoticeDialog target={target} rpc={rpc.client} onClose={onClose} />);
  return { rpc, onClose, user: userEvent.setup() };
}

describe('AiNoticeDialog', () => {
  it('names the service and host, lists what leaves the computer, links the terms, warns about http', async () => {
    const { rpc, onClose, user } = await renderNotice(HOSTED);
    const dialog = screen.getByTestId('dialog-ai-notice');
    expect(screen.getByTestId('dialog-ai-notice-service')).toHaveTextContent(
      'Service: Stand-in (hosted) (ai.standin.test:8787)',
    );
    const sent = within(screen.getByTestId('dialog-ai-notice-sent'));
    expect(sent.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'your instruction',
      'the conversation of this session',
      "the book's title and its chapter titles",
      'the parts of the book the assistant reads for the task',
      "the editor's name and version",
    ]);
    // Nothing else is named (no authors, no genres - review C14).
    expect(dialog.textContent).not.toMatch(/author|genre/i);
    const terms = screen.getByTestId('dialog-ai-notice-terms');
    expect(terms.tagName).toBe('A');
    expect(terms).toHaveAttribute('href', 'https://ai.standin.test/terms');
    expect(terms).not.toHaveAttribute('target');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      terms.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(rpc.calls).toEqual([
      { method: 'app.openUrl', params: { url: 'https://ai.standin.test/terms' } },
    ]);
    expect(screen.getByTestId('dialog-ai-notice-unencrypted')).toBeInTheDocument();
    // Yes / No buttons of the frame; Yes is the default, Escape answers No.
    expect(screen.getByTestId('dialog-ai-notice-button-yes')).toBeInTheDocument();
    await user.click(screen.getByTestId('dialog-ai-notice-button-no'));
    expect(onClose).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenLastCalledWith(false);
    await user.click(screen.getByTestId('dialog-ai-notice-button-yes'));
    expect(onClose).toHaveBeenLastCalledWith(true);
  });

  it('has no terms link without a termsUrl and no http sentence for an https address', async () => {
    await renderNotice({
      kind: 'custom',
      name: 'api.example',
      address: 'https://api.example/v1',
    });
    expect(screen.queryByTestId('dialog-ai-notice-terms')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dialog-ai-notice-unencrypted')).not.toBeInTheDocument();
    expect(screen.getByTestId('dialog-ai-notice-service')).toHaveTextContent('api.example');
  });

  it('shows a javascript: termsUrl never as a link', async () => {
    await renderNotice({ ...HOSTED, termsUrl: 'javascript:alert(1)' });
    expect(screen.queryByTestId('dialog-ai-notice-terms')).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});

describe('requireAgreement', () => {
  async function context(agreements: AiAgreement[], answers: unknown[]) {
    const settings = defaultSettings();
    settings.ai.agreements = agreements;
    let stored = settings;
    const rpc = fakeRpc({
      'settings.set': (params: unknown) => {
        const patch = (params as { patch: { ai: { agreements: AiAgreement[] } } }).patch;
        stored = { ...stored, ai: { ...stored.ai, agreements: patch.ai.agreements } };
        return { settings: stored, restartRequired: false };
      },
    });
    const ctx = await makeContext({ rpc: rpc.client, dialogs: fakeDialogs([], answers) });
    actions.setSettings(ctx.store, settings);
    return { ctx, rpc, stored: () => stored };
  }

  it('resolves true without a dialog when no notice is due (local, or already agreed)', async () => {
    const { ctx, rpc } = await context(
      [{ service: 'standin', host: 'ai.standin.test:8787', at: '2026-10-22T10:00:00Z' }],
      [],
    );
    await expect(requireAgreement(ctx, HOSTED)).resolves.toBe(true);
    await expect(
      requireAgreement(ctx, { ...HOSTED, id: 'local', address: 'http://127.0.0.1:8787/v1' }),
    ).resolves.toBe(true);
    expect(ctx.dialogs.custom).toEqual([]);
    expect(rpc.calls).toEqual([]);
  });

  it('shows the notice for a hosted service; Yes records the agreement at once, No writes nothing', async () => {
    const { ctx, rpc, stored } = await context([], [false, true, true, true]);
    await expect(requireAgreement(ctx, HOSTED)).resolves.toBe(false);
    expect(ctx.dialogs.custom.map((c) => c.name)).toEqual(['AiNoticeDialog']);
    expect(rpc.calls).toEqual([]);
    await expect(requireAgreement(ctx, HOSTED)).resolves.toBe(true);
    expect(rpc.calls).toHaveLength(1);
    expect(rpc.calls[0]!.method).toBe('settings.set');
    expect(stored().ai.agreements).toEqual([
      { service: 'standin', host: 'ai.standin.test:8787', at: expect.stringMatching(/^\d{4}-/) },
    ]);
    expect(ctx.store.getState().settings?.ai.agreements).toEqual(stored().ai.agreements);
    // Agreed now: not asked again.
    await expect(requireAgreement(ctx, HOSTED)).resolves.toBe(true);
    expect(ctx.dialogs.custom).toHaveLength(2);
    // ... unless forced (the core's gate refused) or the host changed.
    await expect(requireAgreement(ctx, HOSTED, { force: true })).resolves.toBe(true);
    expect(ctx.dialogs.custom).toHaveLength(3);
    await requireAgreement(ctx, { ...HOSTED, address: 'http://other.example/v1' });
    expect(ctx.dialogs.custom).toHaveLength(4);
  });
});
