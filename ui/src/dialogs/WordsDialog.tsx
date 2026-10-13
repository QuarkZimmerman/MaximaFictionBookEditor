/**
 * Words dialog (US10, T136) after the original `IDD_WORDS`: a virtualised, sortable table of
 * every distinct word of the book (Word / Replacement / Count) with inline replacement
 * editing and the row states normal / highlighted / replaced / excluded; the buttons Highlight
 * all, Set replaced all, Invert, Set replaced, Reset replaced, To exclusions; the Show/hide
 * exclusions switch (persisted as `words.showExclusionsInWordsDialog`); the "Current word" box
 * whose Find / Next / Replace act in the Body through the search feature; OK applies every
 * marked replacement document-wide as one undo entry and reports "N replacement(s) done".
 *
 * The analysis comes from `words.analyze` (job-aware); the exclusion list changes go to
 * `words.exclusions` immediately, as in the original (the list is a user resource, not part of
 * the book).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { isValidExclusionWord } from '@/dialogs/settings/model';
import {
  applyWordReplacements,
  bodySearchTarget,
  findWordNext,
  replaceCurrentWord,
} from '@/features/words/apply';
import { analyzeWords, updateExclusions } from '@/features/words/rpc';
import { WordsSession, rowState, type SortColumn, type WordRow } from '@/features/words/session';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import { Dialog, type DialogButton } from './Dialog';

import './words.css';

export interface WordsDialogProps {
  ctx: CommandContext;
  onClose: () => void;
  /** Row height / viewport rows for the virtualised table (tests shrink the viewport). */
  rowHeight?: number;
  viewportRows?: number;
}

const OVERSCAN = 6;

type LoadStatus = 'loading' | 'ready' | 'failed';

export function WordsDialog({ ctx, onClose, rowHeight = 24, viewportRows = 12 }: WordsDialogProps) {
  const { t } = useTranslation();
  const { rpc, store, undo } = ctx;
  const [session] = useState(
    () =>
      new WordsSession({
        showExclusions: store.getState().settings?.words.showExclusionsInWordsDialog ?? false,
      }),
  );
  useSyncExternalStore(
    useCallback((listener: () => void) => session.subscribe(listener), [session]),
    session.getVersion,
    session.getVersion,
  );
  const canAnalyze = (() => {
    const state = store.getState();
    return rpc !== null && !!state.docId && !!state.document;
  })();
  const [status, setStatus] = useState<LoadStatus>(canAnalyze ? 'loading' : 'failed');
  const [loadError, setLoadError] = useState(canAnalyze ? '' : t('dialog.words.noDocument'));
  const [found, setFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Analyse the open book (job-aware for big books).
  useEffect(() => {
    const state = store.getState();
    if (!rpc || !state.docId || !state.document) return;
    let cancelled = false;
    analyzeWords(rpc, state.docId, state.document, true)
      .then((analysis) => {
        if (cancelled) return;
        session.load(analysis.words, analysis);
        setStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [rpc, store, session, t]);

  const rows = session.visibleRows();
  const current = session.current;
  const currentIndex = current ? rows.findIndex((r) => r.word === current.word) : -1;

  // Virtual window.
  const viewportHeight = rowHeight * viewportRows;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN,
  );
  const windowRows = rows.slice(first, last);

  const scrollRowIntoView = useCallback(
    (index: number) => {
      const viewport = viewportRef.current;
      if (!viewport || index < 0) return;
      const top = index * rowHeight;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      else if (top + rowHeight > viewport.scrollTop + viewport.clientHeight) {
        viewport.scrollTop = top + rowHeight - viewport.clientHeight;
      }
    },
    [rowHeight],
  );

  const setCurrent = (word: string) => {
    session.setCurrent(word);
    setFound(false);
  };

  const run = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------ exclusions */

  const addExclusions = async (candidates: WordRow[]) => {
    if (!rpc) return;
    const valid = candidates.filter((row) => isValidExclusionWord(row.word)).map((r) => r.word);
    const invalid = candidates.filter((row) => !isValidExclusionWord(row.word)).map((r) => r.word);
    if (valid.length > 0) {
      try {
        await updateExclusions(rpc, { add: valid });
        session.markExcluded(valid, true);
      } catch (error) {
        if (error instanceof RpcError && error.code === RpcErrorCode.invalidParams) {
          const data = error.data as { word?: string } | undefined;
          invalid.push(data?.word ?? valid.join(', '));
        } else {
          throw error;
        }
      }
    }
    if (invalid.length > 0) {
      await ctx.dialogs.showMessage({
        text: t('dialog.words.exclusionsRejected', { words: invalid.join('\n') }),
        caption: t('msg.wordAddErrorCaption'),
        icon: 'warning',
        testId: 'dialog-words-exclusions-rejected',
      });
    }
  };

  const toggleExclusion = (row: WordRow) =>
    run(async () => {
      if (!rpc) return;
      if (row.excluded) {
        await updateExclusions(rpc, { remove: [row.word] });
        session.markExcluded([row.word], false);
      } else {
        await addExclusions([row]);
      }
    });

  const toExclusions = () => run(() => addExclusions(session.highlightedForExclusion()));

  const setShowExclusions = (show: boolean) => {
    session.setShowExclusions(show);
    if (!rpc) return;
    rpc
      .call('settings.set', { patch: { words: { showExclusionsInWordsDialog: show } } })
      .then((result) => actions.setSettings(store, result.settings))
      .catch(() => {
        // the switch keeps working for this session
      });
  };

  /* ---------------------------------------------------------- current word */

  const find = () =>
    run(async () => {
      const row = session.current;
      const target = bodySearchTarget(store);
      if (!row || !target) return;
      const ok = findWordNext(target, row.word);
      setFound(ok);
      if (!ok) {
        await ctx.dialogs.showMessage({
          text: t('msg.searchFailed', { text: row.word }),
          caption: t('dialog.words.caption'),
          icon: 'warning',
          testId: 'dialog-words-not-found',
        });
      }
    });

  const replaceOne = () =>
    run(() => {
      const row = session.current;
      const target = bodySearchTarget(store);
      if (!row || !target || !found) return;
      const replaced = replaceCurrentWord(target, row.word, row.replacement);
      if (replaced) session.decrementCount(row.word);
      const stillThere = session.row(row.word) !== undefined;
      setFound(stillThere ? findWordNext(target, row.word) : false);
    });

  /* ------------------------------------------------------------------- OK */

  const ok = () =>
    run(async () => {
      const effective = session.effectiveReplacements();
      const target = bodySearchTarget(store);
      if (effective.length === 0 || !target) {
        onClose();
        return;
      }
      const count = await applyWordReplacements(
        undo,
        target,
        effective,
        t('msg.replaceWordsCaption'),
      );
      onClose();
      actions.setStatusMessage(store, t('msg.wordsReplaced', { count }));
      await ctx.dialogs.showMessage({
        text: t('msg.wordsReplaced', { count }),
        caption: t('msg.replaceWordsCaption'),
        icon: 'info',
        testId: 'dialog-words-done',
      });
    });

  /* --------------------------------------------------------------- keyboard */

  const onGridKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing !== null) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const next = Math.min(
        rows.length - 1,
        Math.max(0, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)),
      );
      if (rows[next]) {
        setCurrent(rows[next].word);
        scrollRowIntoView(next);
      }
    } else if (event.key === ' ' && current) {
      event.preventDefault();
      event.stopPropagation();
      session.toggleHighlight(current.word);
    } else if (event.key === 'F4' && current) {
      event.preventDefault();
      event.stopPropagation();
      setEditing(current.word);
    } else if (event.key === 'F3') {
      event.preventDefault();
      event.stopPropagation();
      void find();
    }
  };

  /** Re-sorting starts the list at the top again. */
  const sortBy = (column: SortColumn) => {
    session.sortBy(column);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
    setScrollTop(0);
  };

  const sortLabel = (column: SortColumn) =>
    session.sort.column === column
      ? session.sort.direction === 'asc'
        ? ' \u25B2'
        : ' \u25BC'
      : '';

  const currentReplacementUsable =
    !!current && current.replacement.trim() !== '' && current.replacement !== current.word;

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: busy || status !== 'ready',
      onClick: () => void ok(),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: onClose },
  ];

  return (
    <Dialog
      title={t('dialog.words.caption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      initialFocus='[data-testid="words-grid"]'
      testId="dialog-words"
      className="mfbe-wordsdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-words-table" data-testid="words-table" data-status={status}>
        <div className="mfbe-words-header" role="row">
          <span
            className="mfbe-words-cell mfbe-words-cell-center"
            title={t('dialog.words.columns.highlight')}
          >
            {'\u2713'}
          </span>
          <button
            type="button"
            onClick={() => sortBy('word')}
            aria-label={t('dialog.words.sortBy', { column: t('dialog.words.columns.word') })}
            data-testid="words-sort-word"
          >
            {t('dialog.words.columns.word')}
            {sortLabel('word')}
          </button>
          <button
            type="button"
            onClick={() => sortBy('replacement')}
            aria-label={t('dialog.words.sortBy', { column: t('dialog.words.columns.replacement') })}
            data-testid="words-sort-replacement"
          >
            {t('dialog.words.columns.replacement')}
            {sortLabel('replacement')}
          </button>
          <button
            type="button"
            onClick={() => sortBy('count')}
            aria-label={t('dialog.words.sortBy', { column: t('dialog.words.columns.counted') })}
            data-testid="words-sort-count"
          >
            {t('dialog.words.columns.counted')}
            {sortLabel('count')}
          </button>
          <span
            className="mfbe-words-cell mfbe-words-cell-center"
            title={t('dialog.words.columns.replaced')}
          >
            {'\u21C4'}
          </span>
          <span className="mfbe-words-cell mfbe-words-cell-center">
            {t('dialog.words.columns.state')}
          </span>
        </div>
        <div
          ref={viewportRef}
          className="mfbe-words-viewport"
          style={{ height: viewportHeight }}
          role="grid"
          tabIndex={0} // one Tab stop; rows are virtualised, so their controls are tabIndex -1
          aria-rowcount={rows.length}
          aria-busy={status === 'loading'}
          data-testid="words-grid"
          data-row-count={rows.length}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onKeyDown={onGridKeyDown}
        >
          {status === 'loading' ? (
            <div className="mfbe-words-empty" data-testid="words-loading">
              {t('dialog.words.analyzing')}
            </div>
          ) : status === 'failed' ? (
            <div className="mfbe-words-empty" data-testid="words-failed">
              {loadError === t('dialog.words.noDocument')
                ? loadError
                : t('dialog.words.analyzeFailed', { reason: loadError })}
            </div>
          ) : rows.length === 0 ? (
            <div className="mfbe-words-empty" data-testid="words-empty">
              {t('dialog.words.empty')}
            </div>
          ) : (
            <>
              <div style={{ height: first * rowHeight }} aria-hidden="true" />
              {windowRows.map((row, offset) => {
                const index = first + offset;
                const state = rowState(row);
                const isCurrent = current?.word === row.word;
                const id = `words-row-${index}`;
                return (
                  <div
                    key={row.word}
                    className="mfbe-words-row"
                    role="row"
                    aria-rowindex={index + 1}
                    aria-selected={isCurrent}
                    data-testid={id}
                    data-word={row.word}
                    data-state={state}
                    data-highlighted={row.highlighted ? 'true' : 'false'}
                    data-replaced={row.replaced ? 'true' : 'false'}
                    data-excluded={row.excluded ? 'true' : 'false'}
                    style={{ height: rowHeight }}
                    onClick={() => setCurrent(row.word)}
                  >
                    <span className="mfbe-words-cell mfbe-words-cell-center" role="gridcell">
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        checked={row.highlighted}
                        aria-label={t('dialog.words.toggleHighlight', { word: row.word })}
                        onChange={() => session.toggleHighlight(row.word)}
                        onClick={(event) => event.stopPropagation()}
                        data-testid={`${id}-highlight`}
                      />
                    </span>
                    <span className="mfbe-words-cell" role="gridcell" data-testid={`${id}-word`}>
                      {row.word}
                    </span>
                    <span
                      className="mfbe-words-cell mfbe-words-cell-replacement"
                      role="gridcell"
                      title={t('dialog.words.editReplacement', { word: row.word })}
                      data-testid={`${id}-replacement`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setCurrent(row.word);
                        setEditing(row.word);
                      }}
                    >
                      {editing === row.word ? (
                        <ReplacementEditor
                          value={row.replacement}
                          testId={`${id}-replacement-input`}
                          onCommit={(value) => {
                            session.setReplacement(row.word, value);
                            setEditing(null);
                          }}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        row.replacement
                      )}
                    </span>
                    <span
                      className="mfbe-words-cell mfbe-words-cell-count"
                      role="gridcell"
                      data-testid={`${id}-count`}
                    >
                      {row.count}
                    </span>
                    <span className="mfbe-words-cell mfbe-words-cell-center" role="gridcell">
                      <input
                        type="checkbox"
                        tabIndex={-1}
                        checked={row.replaced}
                        aria-label={t('dialog.words.toggleReplaced', { word: row.word })}
                        onChange={() => session.toggleReplaced(row.word)}
                        onClick={(event) => event.stopPropagation()}
                        data-testid={`${id}-replaced`}
                      />
                    </span>
                    <span className="mfbe-words-cell mfbe-words-cell-center" role="gridcell">
                      <button
                        type="button"
                        tabIndex={-1}
                        className="mfbe-words-state"
                        title={t('dialog.words.toggleExclusion', { word: row.word })}
                        disabled={busy || !rpc}
                        onClick={(event) => {
                          event.stopPropagation();
                          void toggleExclusion(row);
                        }}
                        data-testid={`${id}-state`}
                      >
                        {t(`dialog.words.states.${state}`)}
                      </button>
                    </span>
                  </div>
                );
              })}
              <div
                style={{ height: Math.max(0, rows.length - last) * rowHeight }}
                aria-hidden="true"
              />
            </>
          )}
        </div>
      </div>

      <div className="mfbe-words-toolbar">
        <label className="mfbe-check-field">
          <input
            type="checkbox"
            checked={session.showExclusions}
            onChange={(event) => setShowExclusions(event.target.checked)}
            data-testid="words-show-exclusions"
          />
          <span>{t('dialog.words.showHideExclusions')}</span>
        </label>
        <button
          type="button"
          className="mfbe-button"
          disabled={status !== 'ready'}
          onClick={() => session.highlightAll()}
          data-testid="words-highlight-all"
        >
          {t('dialog.words.highlightAll')}
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={status !== 'ready'}
          onClick={() => session.setReplacedAll()}
          data-testid="words-set-replaced-all"
        >
          {t('dialog.words.setReplacedAll')}
        </button>
      </div>

      <fieldset className="mfbe-words-group" data-testid="words-process-highlighted">
        <legend>{t('dialog.words.processHighlighted')}</legend>
        <button
          type="button"
          className="mfbe-button"
          disabled={busy || status !== 'ready' || !rpc}
          onClick={() => void toExclusions()}
          data-testid="words-to-exclusions"
        >
          {t('dialog.words.toExclusions')}
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={status !== 'ready'}
          onClick={() => session.setReplacedForHighlighted()}
          data-testid="words-set-replaced"
        >
          {t('dialog.words.setReplaced')}
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={status !== 'ready'}
          onClick={() => session.invertHighlight()}
          data-testid="words-invert"
        >
          {t('dialog.words.invert')}
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={status !== 'ready'}
          onClick={() => session.resetReplacedForHighlighted()}
          data-testid="words-reset-replaced"
        >
          {t('dialog.words.resetReplaced')}
        </button>
      </fieldset>

      <fieldset className="mfbe-words-group" data-testid="words-current">
        <legend>{t('dialog.words.currentWord')}</legend>
        <label>
          <span>{t('dialog.words.word')}</span>
          <input
            className="mfbe-inputdialog-input"
            type="text"
            readOnly
            value={current?.word ?? ''}
            data-testid="words-current-word"
          />
        </label>
        <label>
          <span>{t('dialog.words.replacement')}</span>
          <input
            className="mfbe-inputdialog-input"
            type="text"
            value={current?.replacement ?? ''}
            disabled={!current}
            spellCheck={false}
            onChange={(event) => {
              if (current) session.setReplacement(current.word, event.target.value);
            }}
            data-testid="words-current-replacement"
          />
        </label>
        <button
          type="button"
          className="mfbe-button"
          disabled={busy || !current || !rpc}
          onClick={() => void find()}
          data-testid="words-find"
        >
          {found ? t('dialog.words.next') : t('dialog.words.find')}
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={busy || !found || !currentReplacementUsable}
          onClick={() => void replaceOne()}
          data-testid="words-replace"
        >
          {t('dialog.words.replace')}
        </button>
      </fieldset>

      {status === 'ready' ? (
        <div className="mfbe-words-summary" data-testid="words-summary">
          {t('dialog.words.summary', {
            distinct: session.allRows().length,
            total: session.totalWords,
            duration: session.durationMs,
          })}
          {' \u00B7 '}
          {t('dialog.words.visibleRows', { count: rows.length })}
          {session.hiddenExclusionCount() > 0
            ? ` \u00B7 ${t('dialog.words.hiddenExclusions', { count: session.hiddenExclusionCount() })}`
            : ''}
        </div>
      ) : null}
    </Dialog>
  );
}

/** Inline editor of a replacement cell: Enter / blur commit, Escape cancels. */
function ReplacementEditor({
  value,
  onCommit,
  onCancel,
  testId,
}: {
  value: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  testId: string;
}) {
  const [text, setText] = useState(value);
  const committed = useRef(false);
  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(text);
  };
  return (
    <input
      type="text"
      value={text}
      autoFocus
      spellCheck={false}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          committed.current = true;
          onCancel();
        }
      }}
      data-testid={testId}
    />
  );
}
