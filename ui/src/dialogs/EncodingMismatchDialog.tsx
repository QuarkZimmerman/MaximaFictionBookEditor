/**
 * On-load encoding mismatch dialog: shown when a FictionBook file's declared XML encoding does not
 * match its actual bytes. Offers a ranked encoding dropdown with a live paged text preview and an
 * opt-in cleanup checkbox (on by default) for hidden/invalid characters that turn into '?' in
 * legacy encodings. Confirming "Fix" opens with the chosen encoding and marks the document
 * modified without saving to disk; "Load as is" opens without modifying; "Cancel" leaves the
 * previous document open.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';

import { Dialog, type DialogButton } from './Dialog';
import { ENCODING_CHOICES, normalizeEncoding } from './encodings';

import './dialogs.css';

export interface EncodingPreviewData {
  blocks: string[];
  initialBlock: number;
  undecodableCount: number;
  invalidCharCount: number;
}

export type EncodingMismatchAnswer =
  | { action: 'fix'; encoding: string; cleanInvalidChars: boolean }
  | { action: 'asIs' }
  | { action: 'cancel' };

export interface EncodingMismatchDialogProps {
  path: string;
  declared: string;
  detected: string;
  confident: boolean;
  candidates: string[];
  fetchPreview: (encoding: string, cleanInvalidChars: boolean) => Promise<EncodingPreviewData>;
  onClose: (answer: EncodingMismatchAnswer) => void;
}

function buildEncodingOrder(detected: string, candidates: readonly string[]): string[] {
  const out: string[] = [];
  const push = (name: string | null | undefined) => {
    const norm = normalizeEncoding(name);
    if (norm && !out.includes(norm)) out.push(norm);
  };
  push(detected);
  for (const c of candidates) push(c);
  for (const c of ENCODING_CHOICES) push(c);
  return out;
}

export function EncodingMismatchDialog({
  path,
  declared,
  detected,
  confident,
  candidates,
  fetchPreview,
  onClose,
}: EncodingMismatchDialogProps) {
  const { t } = useTranslation();
  const options = useMemo(() => buildEncodingOrder(detected, candidates), [detected, candidates]);
  const [encoding, setEncoding] = useState(() => options[0] ?? 'utf-8');
  const [cleanInvalidChars, setCleanInvalidChars] = useState(true);
  const previewKey = `${encoding}:${cleanInvalidChars ? '1' : '0'}`;
  const [previewState, setPreviewState] = useState<{
    key: string;
    data: EncodingPreviewData | null;
    error: boolean;
  }>({ key: '', data: null, error: false });
  const [blockIndex, setBlockIndex] = useState(0);
  const userPagedRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const id = ++requestIdRef.current;
    void fetchPreview(encoding, cleanInvalidChars)
      .then((data) => {
        if (requestIdRef.current !== id) return;
        setPreviewState({ key: previewKey, data, error: false });
        setBlockIndex((current) => {
          if (data.blocks.length === 0) return 0;
          if (!userPagedRef.current) {
            return Math.min(data.initialBlock, data.blocks.length - 1);
          }
          return Math.min(current, data.blocks.length - 1);
        });
      })
      .catch(() => {
        if (requestIdRef.current !== id) return;
        setPreviewState({ key: previewKey, data: null, error: true });
      });
  }, [encoding, cleanInvalidChars, previewKey, fetchPreview]);

  const loading = previewState.key !== previewKey;
  const preview = previewState.data;
  const error = !loading && previewState.error;

  const totalBlocks = preview?.blocks.length ?? 0;
  const currentBlock = totalBlocks > 0 ? Math.min(blockIndex, totalBlocks - 1) : 0;
  const previewText = totalBlocks > 0 ? (preview?.blocks[currentBlock] ?? '') : '';

  const declaredDisplay = declared || t('dialog.encodingMismatch.noneDeclared');
  const message = confident
    ? t('dialog.encodingMismatch.messageConfident', {
        declared: declaredDisplay,
        detected,
      })
    : t('dialog.encodingMismatch.messageAmbiguous', {
        declared: declaredDisplay,
      });

  const buttons: DialogButton[] = [
    {
      id: 'fix',
      label: t('dialog.encodingMismatch.fix'),
      onClick: () => onClose({ action: 'fix', encoding, cleanInvalidChars }),
    },
    {
      id: 'asIs',
      label: t('dialog.encodingMismatch.loadAsIs'),
      onClick: () => onClose({ action: 'asIs' }),
    },
    {
      id: 'cancel',
      label: t('dialog.buttons.cancel'),
      onClick: () => onClose({ action: 'cancel' }),
    },
  ];

  return (
    <Dialog
      title={t('dialog.encodingMismatch.caption')}
      buttons={buttons}
      defaultButtonId="fix"
      cancelButtonId="cancel"
      initialFocus="#dialog-encoding-mismatch-select"
      testId="dialog-encoding-mismatch"
      className="mfbe-encoding-mismatch"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-encodingdialog-path" data-testid="dialog-encoding-mismatch-path">
        {path}
      </div>
      <p className="mfbe-encoding-mismatch-message" data-testid="dialog-encoding-mismatch-message">
        {message}
      </p>
      <div className="mfbe-encoding-mismatch-row">
        <label htmlFor="dialog-encoding-mismatch-select">{t('dialog.saveFile.encoding')}</label>
        <select
          id="dialog-encoding-mismatch-select"
          className="mfbe-encoding-mismatch-dropdown"
          value={encoding}
          onChange={(event) => setEncoding(event.target.value)}
          {...tip(t('tip.encodingMismatch.encoding'))}
          data-testid="dialog-encoding-mismatch-select"
        >
          {options.map((choice) => (
            <option
              key={choice}
              value={choice}
              data-testid={`dialog-encoding-mismatch-option-${choice}`}
            >
              {choice}
            </option>
          ))}
        </select>
      </div>

      <div className="mfbe-encoding-mismatch-preview-head">
        <span>{t('dialog.encodingMismatch.preview')}</span>
        <div className="mfbe-encoding-mismatch-pager">
          <button
            type="button"
            className="mfbe-button"
            disabled={loading || currentBlock <= 0}
            onClick={() => {
              userPagedRef.current = true;
              setBlockIndex((n) => Math.max(0, n - 1));
            }}
            {...tip(t('tip.encodingMismatch.prevBlock'))}
            data-testid="dialog-encoding-mismatch-prev"
          >
            {t('dialog.encodingMismatch.prevBlock')}
          </button>
          <span className="mfbe-encoding-mismatch-page" data-testid="dialog-encoding-mismatch-page">
            {totalBlocks > 0
              ? t('dialog.encodingMismatch.blockOf', {
                  current: currentBlock + 1,
                  total: totalBlocks,
                })
              : '—'}
          </span>
          <button
            type="button"
            className="mfbe-button"
            disabled={loading || currentBlock + 1 >= totalBlocks}
            onClick={() => {
              userPagedRef.current = true;
              setBlockIndex((n) => Math.min(totalBlocks - 1, n + 1));
            }}
            {...tip(t('tip.encodingMismatch.nextBlock'))}
            data-testid="dialog-encoding-mismatch-next"
          >
            {t('dialog.encodingMismatch.nextBlock')}
          </button>
        </div>
      </div>

      <div
        className="mfbe-encoding-mismatch-preview"
        role="region"
        aria-label={t('dialog.encodingMismatch.preview')}
        data-testid="dialog-encoding-mismatch-preview"
      >
        {loading
          ? t('dialog.encodingMismatch.loadingPreview')
          : error
            ? t('dialog.encodingMismatch.previewUnavailable')
            : previewText || t('dialog.encodingMismatch.previewEmpty')}
      </div>

      {preview && preview.undecodableCount > 0 ? (
        <div
          className="mfbe-encoding-mismatch-warn"
          data-testid="dialog-encoding-mismatch-undecodable"
        >
          {t('dialog.encodingMismatch.undecodable', { count: preview.undecodableCount })}
        </div>
      ) : null}

      <label
        className="mfbe-encoding-mismatch-clean"
        title={t('tip.encodingMismatch.cleanInvalid')}
      >
        <input
          type="checkbox"
          checked={cleanInvalidChars}
          onChange={(event) => setCleanInvalidChars(event.target.checked)}
          {...tip(t('tip.encodingMismatch.cleanInvalid'))}
          data-testid="dialog-encoding-mismatch-clean"
        />
        <span>
          {preview && preview.invalidCharCount > 0
            ? t('dialog.encodingMismatch.cleanInvalidWithCount', {
                count: preview.invalidCharCount,
              })
            : t('dialog.encodingMismatch.cleanInvalid')}
        </span>
      </label>
    </Dialog>
  );
}
