/**
 * The book chooser of a ZIP archive with several books (feature 009, D7, data-model §3): the
 * books in the archive's order with name, folder and size; a filter box narrows the list by
 * name; OK, Enter or a double-click opens the selected book, Cancel opens nothing (the window's
 * book stays as it was). Open it with `showArchiveBookChooser()` (show.ts).
 */

import { useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { ArchiveChoice } from '@/rpc/types';

import { Dialog, type DialogButton } from './Dialog';
import { tip } from '@/app/tooltips';

export interface ArchiveBookChooserProps {
  choice: ArchiveChoice;
  /** The archive's file name, for the title. */
  archiveName: string;
  /** The chosen book's entry, or null for Cancel. */
  onClose: (entry: string | null) => void;
}

export function ArchiveBookChooser({ choice, archiveName, onClose }: ArchiveBookChooserProps) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(choice.books[0]?.entry ?? null);
  const rows = useMemo(() => {
    const wanted = filter.trim().toLocaleLowerCase();
    return choice.books
      .map((book, index) => ({ book, index }))
      .filter(({ book }) => !wanted || book.name.toLocaleLowerCase().includes(wanted));
  }, [filter, choice.books]);
  const current = rows.some((r) => r.book.entry === selected)
    ? selected
    : (rows[0]?.book.entry ?? null);
  const size = (bytes: number) =>
    t('archive.chooser.sizeKb', {
      size: Math.max(1, Math.round(bytes / 1024)).toLocaleString(i18n.language),
    });
  const move = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = rows.findIndex((r) => r.book.entry === current);
    const next =
      rows[Math.min(rows.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) setSelected(next.book.entry);
  };
  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: current === null,
      onClick: () => current !== null && onClose(current),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  return (
    <Dialog
      title={t('archive.chooser.title', { archive: archiveName })}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      testId="archive-chooser"
      className="mfbe-archive-chooser"
      closeLabel={t('dialog.buttons.close')}
    >
      <label className="mfbe-archive-chooser-filter">
        {t('archive.chooser.filter')}{' '}
        <input
          {...tip(t('tip.archive.filter'))}
          type="search"
          value={filter}
          autoFocus
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={move}
          data-testid="archive-chooser-filter"
        />
      </label>
      <div className="mfbe-archive-chooser-list" tabIndex={0} onKeyDown={move}>
        <table role="grid" data-testid="archive-chooser-list">
          <thead>
            <tr>
              <th>{t('archive.chooser.name')}</th>
              <th>{t('archive.chooser.folder')}</th>
              <th>{t('archive.chooser.size')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ book, index }) => (
              <tr
                key={book.entry}
                aria-selected={book.entry === current}
                className={book.entry === current ? 'is-selected' : undefined}
                onClick={() => setSelected(book.entry)}
                onDoubleClick={() => onClose(book.entry)}
                data-testid={`archive-chooser-row-${index}`}
              >
                <td>{book.name}</td>
                <td>{book.folder}</td>
                <td className="mfbe-archive-chooser-size">{size(book.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {choice.booksTotal > choice.books.length && (
        <div className="mfbe-archive-chooser-more" data-testid="archive-chooser-more">
          {t('archive.chooser.more', { count: choice.booksTotal - choice.books.length })}
        </div>
      )}
    </Dialog>
  );
}
