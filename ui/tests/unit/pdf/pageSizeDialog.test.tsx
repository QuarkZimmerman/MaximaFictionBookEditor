/**
 * Feature 014 (D2, D3; tasks T029): the page size window, for a Save dialog that could not carry the
 * *Page size* list.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PageSizeDialog } from '@/features/pdf/PageSizeDialog';
import { changeLanguage, initI18n } from '@/i18n';

describe('the PDF page size window (D2, D3)', () => {
  it('lists the nine sizes in their two groups, the proposed one chosen, and returns the choice', async () => {
    await initI18n({ language: 'en' });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<PageSizeDialog defaultSize="a5" path="/books/x.pdf" onClose={onClose} />);
    const select = screen.getByTestId('dialog-pdf-page-size-select') as HTMLSelectElement;
    const groups = [...select.querySelectorAll('optgroup')];
    expect(groups.map((group) => group.label)).toEqual(['ISO sizes', 'North American sizes']);
    expect(
      groups.map((group) => [...group.querySelectorAll('option')].map((o) => o.value)),
    ).toEqual([
      ['a4', 'b5', 'a5', 'b6', 'a6'],
      ['legal', 'letter', 'executive', 'statement'],
    ]);
    expect(select.value).toBe('a5');
    expect(screen.getByTestId('dialog-pdf-page-size-option-letter')).toHaveTextContent(
      'Letter (8.5 × 11 in)',
    );
    expect(screen.getByTestId('dialog-pdf-page-size-path')).toHaveTextContent('/books/x.pdf');
    await user.selectOptions(select, 'letter');
    await user.click(screen.getByTestId('dialog-pdf-page-size-button-ok'));
    expect(onClose).toHaveBeenCalledWith('letter');
    await user.click(screen.getByTestId('dialog-pdf-page-size-button-cancel'));
    expect(onClose).toHaveBeenLastCalledWith(null);
  });

  it('names the sizes in Russian with their dimensions', async () => {
    await initI18n({ language: 'en' });
    await changeLanguage('ru');
    render(<PageSizeDialog defaultSize="a4" onClose={() => undefined} />);
    expect(screen.getByTestId('dialog-pdf-page-size-option-a4')).toHaveTextContent(
      'A4 (210 × 297 мм)',
    );
    expect(screen.getByTestId('dialog-pdf-page-size-option-legal')).toHaveTextContent(
      'Legal (8,5 × 14 дюйма)',
    );
    await changeLanguage('en');
  });
});
