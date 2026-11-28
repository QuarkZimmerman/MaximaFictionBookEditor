/**
 * Feature 018 (T036, contracts/settings.md): Settings > Exports listing MOBI after TXT, all six
 * controls of MobiPage, out-of-the-box default display, individual Reset, and Reset all.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';

import { ExportsPage } from '@/dialogs/settings/ExportsPage';
import { changeLanguage, initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

import { fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from '../settings/fixtures';

async function setup() {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const rpc = fakeRpc({
    'pdf.fonts.list': () => ({ shipped: [], added: [] }),
  });
  const ctx = await makeContext({ rpc: rpc.client });
  const changes: { section: string; patch: unknown }[] = [];

  function Host() {
    const [draft, setDraft] = useState<Settings>(() => ({
      ...defaultSettings(),
      mobi: {
        format: 'joint',
        tocPlacement: 'afterTitle',
        seriesInTitle: 'seriesAndNumber',
        openAt: 'titlePage',
        kf8PopupFootnotes: true,
        zip: false,
      },
    }));
    return createElement(ExportsPage, {
      draft,
      ctx,
      onChange: (section, patch) => {
        changes.push({ section, patch });
        setDraft((d) => ({ ...d, [section]: { ...(d[section] as object), ...patch } }));
      },
    });
  }

  render(createElement(Host));
  return { changes, user: userEvent.setup() };
}

describe('Settings > Exports > MOBI (feature 018, T036)', () => {
  it('lists MOBI immediately after TXT in the Format selector', async () => {
    await setup();
    const format = screen.getByTestId('settings-exports-format');
    const options = [...format.querySelectorAll('option')].map((o) => ({
      value: o.value,
      label: o.textContent,
    }));
    expect(options).toEqual([
      { value: 'pdf', label: 'PDF' },
      { value: 'epub', label: 'EPUB' },
      { value: 'markdown', label: 'Markdown' },
      { value: 'txt', label: 'TXT' },
      { value: 'mobi', label: 'MOBI' },
      { value: 'docx', label: 'DOCX' },
    ]);
  });

  it('displays all six MOBI defaults, updates each, supports individual Reset and Reset all', async () => {
    const { changes, user } = await setup();
    await user.selectOptions(screen.getByTestId('settings-exports-format'), 'mobi');

    expect(screen.getByTestId('settings-page-mobi')).toBeInTheDocument();
    expect(screen.getByTestId('settings-mobi-format')).toHaveValue('joint');
    expect(screen.getByTestId('settings-mobi-tocPlacement')).toHaveValue('afterTitle');
    expect(screen.getByTestId('settings-mobi-seriesInTitle')).toHaveValue('seriesAndNumber');
    expect(screen.getByTestId('settings-mobi-openAt')).toHaveValue('titlePage');
    expect(screen.getByTestId('settings-mobi-kf8PopupFootnotes')).toBeChecked();
    expect(screen.getByTestId('settings-mobi-kf8PopupFootnotes-hint')).toHaveTextContent(
      /KF8.*MOBI 7/i,
    );
    expect(screen.getByTestId('settings-mobi-zip')).not.toBeChecked();

    // All individual Reset buttons and Reset all start disabled at defaults
    for (const id of [
      'format',
      'tocPlacement',
      'seriesInTitle',
      'openAt',
      'kf8PopupFootnotes',
      'zip',
      'all',
    ]) {
      expect(screen.getByTestId(`settings-mobi-reset-${id}`)).toBeDisabled();
    }

    // Out-of-the-box default notes are shown beside every field
    expect(screen.getByTestId('settings-page-mobi')).toHaveTextContent(
      'Default: MOBI 7 + KF8 (joint .mobi)',
    );
    expect(screen.getByTestId('settings-page-mobi')).toHaveTextContent('Default: After title page');
    expect(screen.getByTestId('settings-page-mobi')).toHaveTextContent('Default: Title page');

    // Change all six settings
    await user.selectOptions(screen.getByTestId('settings-mobi-format'), 'kf8');
    expect(changes.at(-1)).toEqual({ section: 'mobi', patch: { format: 'kf8' } });

    await user.selectOptions(screen.getByTestId('settings-mobi-tocPlacement'), 'end');
    expect(changes.at(-1)).toEqual({ section: 'mobi', patch: { tocPlacement: 'end' } });

    await user.selectOptions(screen.getByTestId('settings-mobi-seriesInTitle'), 'off');
    expect(changes.at(-1)).toEqual({
      section: 'mobi',
      patch: { seriesInTitle: 'off' },
    });

    await user.selectOptions(screen.getByTestId('settings-mobi-openAt'), 'mainText');
    expect(changes.at(-1)).toEqual({ section: 'mobi', patch: { openAt: 'mainText' } });

    await user.click(screen.getByTestId('settings-mobi-kf8PopupFootnotes'));
    expect(changes.at(-1)).toEqual({ section: 'mobi', patch: { kf8PopupFootnotes: false } });

    await user.click(screen.getByTestId('settings-mobi-zip'));
    expect(changes.at(-1)).toEqual({ section: 'mobi', patch: { zip: true } });

    // Individual Reset on format restores only format
    expect(screen.getByTestId('settings-mobi-reset-format')).toBeEnabled();
    await user.click(screen.getByTestId('settings-mobi-reset-format'));
    expect(changes.at(-1)).toEqual({ section: 'mobi', patch: { format: 'joint' } });
    expect(screen.getByTestId('settings-mobi-format')).toHaveValue('joint');
    expect(screen.getByTestId('settings-mobi-reset-format')).toBeDisabled();
    expect(screen.getByTestId('settings-mobi-tocPlacement')).toHaveValue('end');

    // Reset all restores all six to defaults
    expect(screen.getByTestId('settings-mobi-reset-all')).toBeEnabled();
    await user.click(screen.getByTestId('settings-mobi-reset-all'));
    expect(changes.at(-1)).toEqual({
      section: 'mobi',
      patch: {
        format: 'joint',
        tocPlacement: 'afterTitle',
        seriesInTitle: 'seriesAndNumber',
        openAt: 'titlePage',
        kf8PopupFootnotes: true,
        zip: false,
      },
    });
    expect(screen.getByTestId('settings-mobi-reset-all')).toBeDisabled();
    expect(screen.getByTestId('settings-mobi-kf8PopupFootnotes')).toBeChecked();
    expect(screen.getByTestId('settings-mobi-zip')).not.toBeChecked();
  });
});
