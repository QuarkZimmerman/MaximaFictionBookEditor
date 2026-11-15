/**
 * Feature 015 (User Story 2, FR-007, FR-008): the explanation of the user's own genre files - the
 * file name rule, the five fields, the languages and an example line - behind a "?" button in
 * Settings > Other and in Choose a genre. The example's raw line (with real tabs) is on its
 * `data-line`, so that a file written from it is the file the explanation shows.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

/** The example line, fields separated by real tabs. */
const GENRE_FILE_EXAMPLE = ['my_genre', 'sf', 'My genre', 'Мой жанр', 'Мій жанр'].join('\t');

export function GenreFileHelp({ place }: { place: 'settings' | 'picker' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    // Esc closes the explanation only, not the dialog it is in.
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span className="mfbe-genre-help">
      <button
        ref={button}
        type="button"
        className="mfbe-genre-help-button"
        data-testid={`genre-file-help-${place}`}
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('genreFileHelp.button')}
        title={t('genreFileHelp.button')}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={t('genreFileHelp.title')}
          tabIndex={-1}
          className="mfbe-genre-help-popover"
          data-testid="genre-file-help-popover"
          onKeyDown={onKeyDown}
        >
          <strong>{t('genreFileHelp.title')}</strong>
          <p>{t('genreFileHelp.name')}</p>
          <p>{t('genreFileHelp.lines')}</p>
          <p>{t('genreFileHelp.code')}</p>
          <p>{t('genreFileHelp.languages')}</p>
          <p>{t('genreFileHelp.example')}</p>
          <code data-testid="genre-file-help-example" data-line={GENRE_FILE_EXAMPLE}>
            {GENRE_FILE_EXAMPLE.split('\t').join(' → ')}
          </code>
          <p>{t('genreFileHelp.note')}</p>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              button.current?.focus();
            }}
          >
            {t('genreFileHelp.close')}
          </button>
        </div>
      ) : null}
    </span>
  );
}
