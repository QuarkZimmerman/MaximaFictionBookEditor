/**
 * Feature 015 (FR-010, FR-013..FR-015): adds a genre to the user's own genres - the code (filled
 * in when it comes from the book), its names in English, Russian and Ukrainian and its category -
 * through `resources.addGenre`, which writes it into the user's my.genres.tsv. The code is checked
 * before sending; the core's refusals are shown with their reasons.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { RpcError } from '@/rpc/client';
import type { GenreEntry, UiLanguage } from '@/rpc/types';

import { collapseToken, isGenreCode, proposedCategory, rememberCategory } from './genreCodes';
import { categoryTitle, type GenreCatalog } from './resources';

export interface AddGenreDialogProps {
  catalog: GenreCatalog;
  language: UiLanguage;
  initialCode?: string;
  onClose: (entry: GenreEntry | null) => void;
}

export function AddGenreDialog({ catalog, language, initialCode, onClose }: AddGenreDialogProps) {
  const { t } = useTranslation();
  const { rpc } = useAppServices();
  const [code, setCode] = useState(initialCode ?? '');
  const [names, setNames] = useState({ en: '', ru: '', uk: '' });
  const [category, setCategory] = useState(() => proposedCategory(catalog));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const token = collapseToken(code);
  const known = catalog.entries.some((e) => e.code === token);
  const local = !isGenreCode(code)
    ? t('addGenre.error.invalidCode')
    : known
      ? t('addGenre.error.duplicate', { code: token })
      : null;

  const submit = async () => {
    if (!rpc || local) return;
    setBusy(true);
    setError(null);
    try {
      const result = await rpc.call('resources.addGenre', { code: token, category, names });
      rememberCategory(category);
      onClose(result.entry);
    } catch (e) {
      const data =
        e instanceof RpcError
          ? (e.data as { reason?: string; folders?: { path: string }[] })
          : undefined;
      const reason = data?.reason;
      setError(
        reason === 'notWritable'
          ? t('addGenre.error.notWritable', {
              folders: (data?.folders ?? []).map((f) => f.path).join(', '),
            })
          : reason === 'invalidCode' || reason === 'duplicate' || reason === 'invalidText'
            ? t(`addGenre.error.${reason}`, { code: token })
            : t('addGenre.error.other', { message: e instanceof Error ? e.message : String(e) }),
      );
    } finally {
      setBusy(false);
    }
  };

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('addGenre.add'),
      disabled: busy || local !== null || !rpc,
      onClick: () => void submit(),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];
  const field = (key: 'en' | 'ru' | 'uk') => (
    <label className="mfbe-field-row" key={key}>
      <span>{t(`addGenre.name.${key}`)}</span>
      <input
        {...tip(t(`tip.addGenre.name.${key}`))}
        className="mfbe-inputdialog-input"
        type="text"
        id={`add-genre-name-${key}`}
        data-testid={`add-genre-name-${key}`}
        value={names[key]}
        placeholder={key === 'uk' ? '' : token}
        onChange={(event) => setNames((current) => ({ ...current, [key]: event.target.value }))}
      />
    </label>
  );

  return (
    <Dialog
      title={t('addGenre.title')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus={initialCode ? '#add-genre-name-en' : '#add-genre-code'}
      testId="add-genre"
      className="mfbe-add-genre"
      closeLabel={t('dialog.buttons.close')}
    >
      <label className="mfbe-field-row" htmlFor="add-genre-code">
        <span>{t('addGenre.code')}</span>
        <input
          {...tip(t('tip.addGenre.code'))}
          id="add-genre-code"
          className="mfbe-inputdialog-input"
          type="text"
          data-testid="add-genre-code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
        />
      </label>
      {field('en')}
      {field('ru')}
      {field('uk')}
      <label className="mfbe-field-row">
        <span>{t('addGenre.category')}</span>
        <select
          {...tip(t('tip.addGenre.category'))}
          className="mfbe-inputdialog-input"
          data-testid="add-genre-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          {catalog.categories.map((c) => (
            <option key={c.key} value={c.key}>
              {categoryTitle(catalog, c.key, language)}
            </option>
          ))}
        </select>
      </label>
      <p className="mfbe-desc-muted">{t('addGenre.hint')}</p>
      {local && code !== '' ? (
        <p className="mfbe-desc-warning" data-testid="add-genre-problem">
          {local}
        </p>
      ) : null}
      {error ? (
        <p className="mfbe-desc-warning" role="alert" data-testid="add-genre-error">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
