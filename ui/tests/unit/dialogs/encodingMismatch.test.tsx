import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  EncodingMismatchDialog,
  type EncodingMismatchAnswer,
  type EncodingPreviewData,
} from '@/dialogs/EncodingMismatchDialog';
import { initI18n } from '@/i18n';

beforeAll(async () => {
  await initI18n({ language: 'en' });
});

describe('EncodingMismatchDialog', () => {
  it('shows ranked encodings, live paged preview, default cleanup toggle, and Fix/AsIs/Cancel', async () => {
    const user = userEvent.setup();
    const fetchPreview = vi.fn(
      async (encoding: string, cleanInvalidChars: boolean): Promise<EncodingPreviewData> => {
        if (encoding === 'utf-8') {
          return {
            blocks: ['ASCII line', '\uFFFD\uFFFD broken'],
            initialBlock: 1,
            undecodableCount: 2,
            invalidCharCount: 2,
          };
        }
        return {
          blocks: [
            'ASCII header',
            cleanInvalidChars ? 'Чистый текст?' : 'Грязный \u200Bтекст?',
            'Третий блок',
          ],
          initialBlock: 1,
          undecodableCount: 0,
          invalidCharCount: 5,
        };
      },
    );
    const onClose = vi.fn<(answer: EncodingMismatchAnswer) => void>();

    render(
      <EncodingMismatchDialog
        path="/books/sample.fb2"
        declared="utf-8"
        detected="windows-1251"
        confident={true}
        candidates={['windows-1251', 'koi8-r']}
        fetchPreview={fetchPreview}
        onClose={onClose}
      />,
    );

    // Preselected to detected encoding, cleanup checkbox ON by default, starts on initialBlock.
    const select = screen.getByTestId('dialog-encoding-mismatch-select') as HTMLSelectElement;
    expect(select.value).toBe('windows-1251');
    const cleanBox = screen.getByTestId('dialog-encoding-mismatch-clean') as HTMLInputElement;
    expect(cleanBox.checked).toBe(true);

    await waitFor(() =>
      expect(screen.getByTestId('dialog-encoding-mismatch-preview')).toHaveTextContent(
        'Чистый текст?',
      ),
    );
    expect(screen.getByTestId('dialog-encoding-mismatch-page')).toHaveTextContent('2 / 3');
    expect(screen.queryByTestId('dialog-encoding-mismatch-undecodable')).toBeNull();

    // Paging to Next and Previous blocks.
    await user.click(screen.getByTestId('dialog-encoding-mismatch-next'));
    expect(screen.getByTestId('dialog-encoding-mismatch-preview')).toHaveTextContent('Третий блок');
    expect(screen.getByTestId('dialog-encoding-mismatch-next')).toBeDisabled();

    await user.click(screen.getByTestId('dialog-encoding-mismatch-prev'));
    expect(screen.getByTestId('dialog-encoding-mismatch-preview')).toHaveTextContent(
      'Чистый текст?',
    );

    // Unchecking cleanup updates preview live.
    await user.click(cleanBox);
    expect(cleanBox.checked).toBe(false);
    await waitFor(() =>
      expect(screen.getByTestId('dialog-encoding-mismatch-preview')).toHaveTextContent(
        'Грязный \u200Bтекст?',
      ),
    );

    // Switching encoding to utf-8 shows undecodable byte warning.
    await user.selectOptions(select, 'utf-8');
    await waitFor(() =>
      expect(screen.getByTestId('dialog-encoding-mismatch-undecodable')).toHaveTextContent(
        '2 bytes could not be decoded',
      ),
    );

    // Switching back to koi8-r and clicking Fix returns chosen encoding and cleanup flag.
    await user.selectOptions(select, 'koi8-r');
    await user.click(cleanBox);
    await user.click(screen.getByTestId('dialog-encoding-mismatch-button-fix'));
    expect(onClose).toHaveBeenCalledWith({
      action: 'fix',
      encoding: 'koi8-r',
      cleanInvalidChars: true,
    });
  });

  it('supports Load as is and Cancel without modifying', async () => {
    const user = userEvent.setup();
    const fetchPreview = vi.fn(async () => ({
      blocks: ['Preview line'],
      initialBlock: 0,
      undecodableCount: 0,
      invalidCharCount: 0,
    }));
    const onClose = vi.fn<(answer: EncodingMismatchAnswer) => void>();

    const { rerender } = render(
      <EncodingMismatchDialog
        path="/books/sample.fb2"
        declared="utf-8"
        detected="windows-1251"
        confident={false}
        candidates={['windows-1251', 'koi8-r']}
        fetchPreview={fetchPreview}
        onClose={onClose}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('dialog-encoding-mismatch-preview')).toHaveTextContent(
        'Preview line',
      ),
    );
    await user.click(screen.getByTestId('dialog-encoding-mismatch-button-asIs'));
    expect(onClose).toHaveBeenCalledWith({ action: 'asIs' });

    onClose.mockClear();
    rerender(
      <EncodingMismatchDialog
        path="/books/sample.fb2"
        declared="utf-8"
        detected="windows-1251"
        confident={false}
        candidates={['windows-1251', 'koi8-r']}
        fetchPreview={fetchPreview}
        onClose={onClose}
      />,
    );
    await user.click(screen.getByTestId('dialog-encoding-mismatch-button-cancel'));
    expect(onClose).toHaveBeenCalledWith({ action: 'cancel' });
  });
});
