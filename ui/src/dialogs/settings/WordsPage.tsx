/**
 * Settings > Words (T132) after `IDD_SETTINGS_WORDS`: the word-exclusion list (Counted / Word
 * columns - "Counted" is the number of occurrences in the open book), Add with validation
 * ("New exclusion word must contain only alpha characters and one '-' between them!", "This
 * word is already in list!"), Select All, Remove selected and "Show exclusions in Words
 * dialog". The list itself lives in `exclusions.txt` and is edited immediately through
 * `words.exclusions`; the checkbox is part of the settings draft (applied with OK / Apply).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { analyzeWords, fetchExclusions, updateExclusions } from '@/features/words/rpc';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type Settings } from '@/rpc/types';

import { CheckField, GroupBox } from './controls';
import { isValidExclusionWord } from './model';

export interface WordsPageProps {
  draft: Settings;
  onChange: (patch: Partial<Settings['words']>) => void;
  ctx: CommandContext;
}

export function WordsPage({ draft, onChange, ctx }: WordsPageProps) {
  const { t } = useTranslation();
  const rpc = ctx.rpc;
  const [words, setWords] = useState<string[] | null>(null);
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [newWord, setNewWord] = useState('');
  const [busy, setBusy] = useState(false);

  // The exclusion list, then (when a book is open) the occurrence counts.
  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    fetchExclusions(rpc)
      .then((list) => {
        if (!cancelled) setWords(list);
      })
      .catch(() => {
        if (!cancelled) setWords([]);
      });
    const state = ctx.store.getState();
    if (state.docId && state.document) {
      analyzeWords(rpc, state.docId, state.document, true)
        .then((analysis) => {
          if (cancelled) return;
          setCounts(new Map(analysis.words.map((w) => [w.word, w.count])));
        })
        .catch(() => {
          // counts are informative only
        });
    }
    return () => {
      cancelled = true;
    };
  }, [rpc, ctx.store]);

  const showError = (text: string) =>
    ctx.dialogs.showMessage({
      text,
      caption: t('msg.wordAddErrorCaption'),
      icon: 'error',
      testId: 'dialog-exclusion-error',
    });

  const add = async () => {
    const word = newWord.trim();
    if (!rpc || !word || busy) return;
    if (!isValidExclusionWord(word)) {
      await showError(t('msg.wordInvalid'));
      return;
    }
    if (words?.includes(word)) {
      await showError(t('msg.wordExists'));
      return;
    }
    setBusy(true);
    try {
      setWords(await updateExclusions(rpc, { add: [word] }));
      setNewWord('');
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.invalidParams) {
        await showError(t('msg.wordInvalid'));
      } else {
        throw error;
      }
    } finally {
      setBusy(false);
    }
  };

  const removeSelected = async () => {
    if (!rpc || selected.size === 0 || busy) return;
    const answer = await ctx.dialogs.showMessage({
      text: t('dialog.settings.words.removeConfirm', { count: selected.size }),
      caption: t('dialog.settings.pages.words'),
      buttons: 'yesNo',
      icon: 'question',
      testId: 'dialog-exclusion-remove',
    });
    if (answer !== 'yes') return;
    setBusy(true);
    try {
      setWords(await updateExclusions(rpc, { remove: [...selected] }));
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const toggle = (word: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  };

  const allSelected = words !== null && words.length > 0 && selected.size === words.length;

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-words">
      <GroupBox title={t('dialog.settings.words.exclusionList')}>
        <div className="mfbe-exclusions-table" data-testid="settings-words-list">
          {words === null ? (
            <div className="mfbe-settings-note">{t('dialog.settings.loading')}</div>
          ) : words.length === 0 ? (
            <div className="mfbe-settings-note" data-testid="settings-words-empty">
              {t('dialog.settings.words.empty')}
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col" aria-label={t('dialog.settings.words.selectAll')} />
                  <th scope="col" title={t('dialog.settings.words.counted')}>
                    {t('dialog.settings.words.columns.counted')}
                  </th>
                  <th scope="col">{t('dialog.settings.words.columns.word')}</th>
                </tr>
              </thead>
              <tbody>
                {words.map((word) => (
                  <tr
                    key={word}
                    aria-selected={selected.has(word)}
                    data-testid={`settings-words-row-${word}`}
                    onClick={() => toggle(word)}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(word)}
                        onChange={() => toggle(word)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={word}
                      />
                    </td>
                    <td className="mfbe-exclusions-count">
                      {counts ? (counts.get(word) ?? 0) : t('dialog.settings.words.noDocument')}
                    </td>
                    <td>{word}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="mfbe-exclusions-toolbar">
          <CheckField
            label={t('dialog.settings.words.selectAll')}
            checked={allSelected}
            disabled={!words || words.length === 0}
            onChange={(checked) => setSelected(checked && words ? new Set(words) : new Set())}
            testId="settings-words-select-all"
          />
          <button
            type="button"
            className="mfbe-button"
            disabled={!rpc || selected.size === 0 || busy}
            onClick={() => void removeSelected()}
            data-testid="settings-words-remove"
          >
            {t('dialog.settings.words.removeSelected')}
          </button>
        </div>
        <div className="mfbe-settings-row">
          <input
            className="mfbe-inputdialog-input"
            type="text"
            value={newWord}
            placeholder={t('dialog.settings.words.newWord')}
            aria-label={t('dialog.settings.words.newWord')}
            spellCheck={false}
            disabled={!rpc}
            onChange={(event) => setNewWord(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                void add();
              }
            }}
            data-testid="settings-words-new"
          />
          <button
            type="button"
            className="mfbe-button"
            disabled={!rpc || newWord.trim() === '' || busy}
            onClick={() => void add()}
            data-testid="settings-words-add"
          >
            {t('dialog.settings.words.add')}
          </button>
        </div>
      </GroupBox>
      <CheckField
        label={t('dialog.settings.words.showExclusions')}
        checked={draft.words.showExclusionsInWordsDialog}
        onChange={(checked) => onChange({ showExclusionsInWordsDialog: checked })}
        testId="settings-words-show-exclusions"
      />
    </div>
  );
}
