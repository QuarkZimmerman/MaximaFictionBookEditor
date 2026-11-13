/**
 * Feature 014 (DP-5, DP-7; tasks T051): Settings > PDF export - each value with its default shown and
 * a Reset, Reset all, the fonts listed from the core, an added font removed.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';

import { PdfPage } from '@/dialogs/settings/PdfPage';
import { changeLanguage, initI18n } from '@/i18n';
import type { Settings } from '@/rpc/types';

import { fakeRpc, makeContext } from '../features/testUtils';
import { defaultSettings } from './fixtures';

const ADDED = 'c'.repeat(64);

async function setup(pdf: NonNullable<Settings['pdf']>) {
  await initI18n({ language: 'en' });
  await changeLanguage('en');
  const rpc = fakeRpc({
    'pdf.fonts.list': () => ({
      shipped: [
        { id: 'noto-serif', kind: 'serif', scripts: [], textFont: true, styles: ['Regular'] },
        { id: 'noto-sans', kind: 'sans-serif', scripts: [], textFont: true, styles: ['Regular'] },
        { id: 'dejavu-sans-mono', kind: 'monospace', scripts: [], textFont: false, styles: [] },
      ],
      added: [
        {
          id: ADDED,
          face: 0,
          family: 'Added Family',
          style: 'Regular',
          kind: 'serif',
          fsType: 0,
          wholeFont: false,
          source: 'file',
          name: 'added.ttf',
        },
      ],
    }),
    'pdf.fonts.remove': () => ({}),
  });
  const ctx = await makeContext({ rpc: rpc.client });
  const changes: Partial<NonNullable<Settings['pdf']>>[] = [];
  function Host() {
    const [draft, setDraft] = useState<Settings>({ ...defaultSettings(), pdf });
    return (
      <PdfPage
        draft={draft}
        ctx={ctx}
        onChange={(patch) => {
          changes.push(patch);
          setDraft((d) => ({ ...d, pdf: { ...d.pdf!, ...patch } }));
        }}
      />
    );
  }
  render(<Host />);
  return { rpc, changes, user: userEvent.setup() };
}

describe('Settings > PDF export (DP-5)', () => {
  it('shows each default with a Reset, and Reset all puts the page back', async () => {
    const { changes, user } = await setup({
      defaultPageSize: 'letter',
      textFont: 'noto-sans',
      textSize: 'larger',
      margins: 'wide',
    });
    await waitFor(() =>
      expect(screen.getByTestId('settings-pdf-text-font')).toHaveValue('noto-sans'),
    );
    expect(screen.getByTestId('settings-pdf-page-size')).toHaveValue('letter');
    expect(screen.getByText('Default: A4 (210 × 297 mm)')).toBeInTheDocument();
    expect(screen.getByText('Default: Noto Serif')).toBeInTheDocument();
    // The monospace family is not a text font.
    expect(screen.queryByRole('option', { name: 'DejaVu Sans Mono' })).toBeNull();
    await user.click(screen.getByTestId('settings-pdf-reset-textSize'));
    expect(changes.at(-1)).toEqual({ textSize: 'standard' });
    expect(screen.getByTestId('settings-pdf-reset-textSize')).toBeDisabled();
    await user.click(screen.getByTestId('settings-pdf-reset-all'));
    expect(changes.at(-1)).toEqual({
      defaultPageSize: 'a4',
      textFont: 'noto-serif',
      textSize: 'standard',
      margins: 'standard',
    });
    expect(screen.getByTestId('settings-pdf-reset-all')).toBeDisabled();
  });

  it('lists the added fonts, and removing the text font sets Noto Serif (DP-7)', async () => {
    const { rpc, changes, user } = await setup({
      defaultPageSize: 'a4',
      textFont: ADDED,
      textSize: 'standard',
      margins: 'standard',
    });
    await waitFor(() => expect(screen.getByTestId('settings-pdf-text-font')).toHaveValue(ADDED));
    expect(screen.getByRole('option', { name: 'Added Family Regular' })).toBeInTheDocument();
    await user.click(screen.getByTestId('settings-pdf-remove'));
    await waitFor(() => expect(changes.at(-1)).toEqual({ textFont: 'noto-serif' }));
    expect(rpc.calls.find((c) => c.method === 'pdf.fonts.remove')?.params).toEqual({ id: ADDED });
  });
});
