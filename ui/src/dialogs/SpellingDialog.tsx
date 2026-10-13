/**
 * Spelling dialog (T089) after the original `IDD_SPELL_CHECK`: "Not In Dictionary", "Change
 * To", the "Suggestions" list and the buttons Ignore, Ignore All, Change, Change All, Add,
 * Undo last and Close (Cancel in the original), plus the dictionaries in use (FR-070: the
 * document language by default, switchable). The walk itself lives in
 * `features/spell/dialogController.ts`; reaching the end of the document closes the dialog and
 * shows "The spelling check is complete." (`IDS_SPELL_COMPLETED`).
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { SpellDialogController } from '@/features/spell/dialogController';
import type { SpellFeature } from '@/features/spell';
import { parseAccelerator } from '@/i18n';

import { Dialog } from './Dialog';

import './spelling.css';

export interface SpellingDialogProps {
  ctx: CommandContext;
  feature: SpellFeature;
  onClose: () => void;
}

export function SpellingDialog({ ctx, feature, onClose }: SpellingDialogProps) {
  const { t } = useTranslation();
  const controller = useMemo(() => new SpellDialogController({ ctx, feature }), [ctx, feature]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [replacement, setReplacement] = useState('');
  const [busy, setBusy] = useState(false);
  const replacementRef = useRef<HTMLInputElement>(null);
  const completed = useRef(false);

  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
  }, [controller]);

  // A new word: the first suggestion becomes the proposed replacement (as in the original).
  // Suggestions arrive asynchronously; they may only replace the proposal while the user has
  // not typed a correction of their own (otherwise a late suggestion would overwrite it).
  const firstSuggestion = state.suggestions[0] ?? '';
  const currentWord = state.phase === 'word' ? state.word : null;
  const [proposedFor, setProposedFor] = useState<string | null>(null);
  const [userEdited, setUserEdited] = useState(false);
  if (currentWord !== proposedFor) {
    setProposedFor(currentWord);
    setUserEdited(false);
    setReplacement(currentWord === null ? '' : firstSuggestion || currentWord);
  } else if (
    currentWord !== null &&
    !userEdited &&
    firstSuggestion &&
    replacement === currentWord &&
    replacement !== firstSuggestion
  ) {
    setReplacement(firstSuggestion);
  }

  useEffect(() => {
    if (state.phase === 'word') replacementRef.current?.focus();
  }, [state.phase, state.word]);

  // End of the document: close and report completion (the original destroyed the dialog first).
  useEffect(() => {
    if (state.phase !== 'complete' || completed.current) return;
    completed.current = true;
    onClose();
    void ctx.dialogs.showMessage({
      text: ctx.t('msg.spellingComplete'),
      caption: ctx.t('dialog.spelling.caption'),
      icon: 'info',
      testId: 'spelling-complete',
    });
  }, [state.phase, onClose, ctx]);

  const run = (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    void action().finally(() => setBusy(false));
  };

  const atWord = state.phase === 'word' && !busy;
  const label = (key: string) => parseAccelerator(t(key)).text;

  const toggleLanguage = (tag: string, checked: boolean) => {
    const active = new Set(state.activeLangs);
    if (checked) active.add(tag);
    else active.delete(tag);
    if (active.size === 0) return; // at least one dictionary stays active
    run(() => controller.setLanguages([...active]));
  };

  return (
    <Dialog
      title={t('dialog.spelling.caption')}
      testId="dialog-spelling"
      className="mfbe-spelling-dialog"
      buttons={[{ id: 'close', label: t('dialog.buttons.close'), onClick: onClose }]}
      cancelButtonId="close"
      defaultButtonId="close"
      initialFocus="[data-testid='spelling-change-to']"
    >
      <div className="mfbe-spelling">
        <label className="mfbe-spelling-row" htmlFor="mfbe-spelling-word">
          <span className="mfbe-spelling-label">{label('dialog.spelling.notInDictionary')}</span>
          <input
            id="mfbe-spelling-word"
            className="mfbe-inputdialog-input mfbe-spelling-word"
            type="text"
            readOnly
            value={state.phase === 'word' ? state.word : ''}
            data-testid="spelling-not-in-dictionary"
          />
        </label>
        <label className="mfbe-spelling-row" htmlFor="mfbe-spelling-replacement">
          <span className="mfbe-spelling-label">{label('dialog.spelling.changeTo')}</span>
          <input
            id="mfbe-spelling-replacement"
            ref={replacementRef}
            className="mfbe-inputdialog-input"
            type="text"
            value={replacement}
            disabled={!atWord}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setUserEdited(true);
              setReplacement(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && atWord && replacement) {
                event.preventDefault();
                event.stopPropagation();
                run(() => controller.change(replacement));
              }
            }}
            data-testid="spelling-change-to"
          />
        </label>
        <div className="mfbe-spelling-main">
          <div className="mfbe-spelling-suggestions-block">
            <span className="mfbe-spelling-label">{label('dialog.spelling.suggestions')}</span>
            <ul
              className="mfbe-spelling-suggestions"
              role="listbox"
              aria-label={label('dialog.spelling.suggestions')}
              data-testid="spelling-suggestions"
            >
              {state.phase === 'word' && state.suggestions.length === 0 ? (
                <li
                  className="mfbe-spelling-suggestion-empty"
                  data-testid="spelling-no-suggestions"
                >
                  {t('spell.dialog.noSuggestions')}
                </li>
              ) : null}
              {state.suggestions.map((suggestion, index) => (
                <li
                  key={`${index}-${suggestion}`}
                  role="option"
                  aria-selected={suggestion === replacement}
                  className={`mfbe-spelling-suggestion${suggestion === replacement ? ' mfbe-spelling-suggestion-selected' : ''}`}
                  data-testid={`spelling-suggestion-${index}`}
                  onClick={() => setReplacement(suggestion)}
                  onDoubleClick={() => run(() => controller.change(suggestion))}
                >
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
          <div className="mfbe-spelling-actions">
            <button
              type="button"
              className="mfbe-button"
              disabled={!atWord}
              data-testid="spelling-ignore"
              onClick={() => run(() => controller.ignore())}
            >
              {label('dialog.spelling.ignore')}
            </button>
            <button
              type="button"
              className="mfbe-button"
              disabled={!atWord}
              data-testid="spelling-ignore-all"
              onClick={() => run(() => controller.ignoreAll())}
            >
              {label('dialog.spelling.ignoreAll')}
            </button>
            <button
              type="button"
              className="mfbe-button mfbe-button-default"
              disabled={!atWord || !replacement}
              data-testid="spelling-change"
              onClick={() => run(() => controller.change(replacement))}
            >
              {label('dialog.spelling.change')}
            </button>
            <button
              type="button"
              className="mfbe-button"
              disabled={!atWord || !replacement}
              data-testid="spelling-change-all"
              onClick={() => run(() => controller.changeAll(replacement))}
            >
              {label('dialog.spelling.changeAll')}
            </button>
            <button
              type="button"
              className="mfbe-button"
              disabled={!atWord}
              data-testid="spelling-add"
              onClick={() => run(() => controller.add())}
            >
              {label('dialog.spelling.add')}
            </button>
            <button
              type="button"
              className="mfbe-button"
              disabled={!state.canUndo || busy}
              data-testid="spelling-undo"
              onClick={() => run(() => controller.undoLast())}
            >
              {label('dialog.spelling.undoLast')}
            </button>
          </div>
        </div>
        <div className="mfbe-spelling-dictionaries" data-testid="spelling-dictionaries">
          <span className="mfbe-spelling-label">{t('spell.dialog.dictionaries')}</span>
          {state.dictionaries.length === 0 ? (
            <span className="mfbe-spelling-muted">{t('spell.dialog.noDictionaries')}</span>
          ) : (
            state.dictionaries.map((dictionary) => (
              <label key={dictionary.tag} className="mfbe-check-field">
                <input
                  type="checkbox"
                  checked={state.activeLangs.includes(dictionary.tag)}
                  disabled={busy}
                  onChange={(event) => toggleLanguage(dictionary.tag, event.target.checked)}
                  data-testid={`spelling-dictionary-${dictionary.tag}`}
                />
                <span>{dictionary.name || dictionary.tag}</span>
              </label>
            ))
          )}
        </div>
        <div className="mfbe-spelling-status" data-testid="spelling-status" aria-live="polite">
          {state.phase === 'checking' ? t('spell.dialog.checking') : null}
          {state.phase === 'word' && state.where
            ? t('spell.dialog.location', { where: t(`spell.dialog.where.${state.where}`) })
            : null}
          {state.phase === 'unavailable'
            ? t('spell.status.noDictionary', { lang: state.unavailableLang ?? '' })
            : null}
        </div>
      </div>
    </Dialog>
  );
}
