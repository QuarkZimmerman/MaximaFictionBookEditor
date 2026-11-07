/**
 * The picture chooser (feature 010, US2, spec D3/D6, research DP-16): the book's pictures as
 * previews with their ids and sizes, in the order of the Binary objects list, a filter by id, an
 * enlarge button on each preview (the picture view), *From file…*, OK and Cancel. Grown from the
 * cover's dialog, which now renders this component with its own caption and test ids.
 *
 * Files added through *From file…* are removed again on Cancel (D6), so Cancel leaves the book as
 * it was before the dialog; OK and a double-click on a preview answer the chosen `#id`.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { onPageClass, usePictureBackgrounds } from '@/app/usePictureBackground';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { imageFileTypes } from '@/dialogs/fileTypes';
import { addBinaryFromFile } from '@/features/images/binaries';
import { binaryPreviewUrl } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';
import { isRpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import { filterPictures } from './pictureChooserModel';

export interface PictureChooserProps {
  rpc: RpcClient | null;
  docId: string | null;
  /** The book's pictures, in the order of the Binary objects list. */
  binaries: BinaryMeta[];
  /** The picture's current image (`#id`), selected when the dialog opens. */
  initial?: string | null;
  caption: string;
  /** Prefix of every test id: `picture-chooser` (default) or the cover's `cover-picker`. */
  testIdPrefix?: string;
  className?: string;
  /** A file was embedded through *From file…* (the caller adds it to the model). */
  onBinaryAdded: (meta: BinaryMeta) => void;
  /** A file added in this dialog was removed again on Cancel (the caller drops it from the model). */
  onBinaryRemoved?: (id: string) => void;
  /** The enlarge button of a preview. */
  onShowPicture?: (binary: BinaryMeta) => void;
  onClose: (href: string | null) => void;
}

export function PictureChooser({
  rpc,
  docId,
  binaries,
  initial,
  caption,
  testIdPrefix = 'picture-chooser',
  className = 'mfbe-coverpicker',
  onBinaryAdded,
  onBinaryRemoved,
  onShowPicture,
  onClose,
}: PictureChooserProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<BinaryMeta[]>(binaries);
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [filter, setFilter] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => filterPictures(items, filter), [items, filter]);
  // Feature 010 (D10): the previews follow the pictures' background switch.
  usePictureBackgrounds();

  const addFile = async () => {
    if (!rpc || !docId) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await addBinaryFromFile(rpc, docId, {
        title: t('descriptionForm.cover.addFile'),
        filters: imageFileTypes(t),
        selectedFilter: 0,
        imagesOnly: true,
      });
      if (!meta) return;
      onBinaryAdded(meta);
      setAdded((current) => (current.includes(meta.id) ? current : current.concat(meta.id)));
      setItems((current) => current.filter((b) => b.id !== meta.id).concat(meta));
      setSelected(`#${meta.id}`);
    } catch (failure) {
      // A file that is not a picture: said plainly, nothing added, the dialog stays open.
      if (isRpcError(failure) && failure.code === RpcErrorCode.binaryNotImage) {
        setError(t('pictureChooser.notImage'));
      } else {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (rpc && docId) {
      for (const id of added) {
        await rpc.call('binary.remove', { docId, id, force: true }).catch(() => undefined);
        onBinaryRemoved?.(id);
      }
    }
    onClose(null);
  };

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !selected,
      onClick: () => onClose(selected),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => void cancel() },
  ];

  return (
    <Dialog
      title={caption}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      testId={testIdPrefix}
      className={className}
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-coverpicker-toolbar">
        <button
          type="button"
          className="mfbe-desc-smallbtn"
          data-testid={`${testIdPrefix}-add-file`}
          onClick={() => void addFile()}
          disabled={busy || !rpc || !docId}
          title={t('pictureChooser.fromFileTip')}
        >
          {t('pictureChooser.fromFile')}
        </button>
        <input
          type="search"
          className="mfbe-coverpicker-filter"
          data-testid={`${testIdPrefix}-filter`}
          value={filter}
          placeholder={t('pictureChooser.filter')}
          title={t('pictureChooser.filterTip')}
          aria-label={t('pictureChooser.filter')}
          onChange={(event) => setFilter(event.target.value)}
        />
        {error ? (
          <span className="mfbe-desc-warning" data-testid={`${testIdPrefix}-error`}>
            {error}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="mfbe-desc-muted">{t('descriptionForm.cover.noBinaries')}</p>
      ) : (
        <div className="mfbe-coverpicker-grid" role="listbox" data-testid={`${testIdPrefix}-grid`}>
          {shown.map((binary) => {
            const href = `#${binary.id}`;
            const url = binaryPreviewUrl(docId, href, 120);
            const active = selected === href;
            return (
              <div
                key={binary.id}
                className={`mfbe-coverpicker-cell${active ? ' mfbe-coverpicker-cell-selected' : ''}`}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`mfbe-coverpicker-item${active ? ' mfbe-coverpicker-item-selected' : ''}`}
                  data-testid={`${testIdPrefix}-item-${binary.id}`}
                  title={t('pictureChooser.itemTip', { id: binary.id })}
                  onClick={() => setSelected(href)}
                  onDoubleClick={() => onClose(href)}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={binary.id}
                      className={`mfbe-coverpicker-thumb${onPageClass(docId, binary.id)}`}
                    />
                  ) : null}
                  <span className="mfbe-coverpicker-caption">
                    <code>{binary.id}</code>
                    <span className="mfbe-desc-muted">
                      {binary.width && binary.height
                        ? ` ${binary.width}\u00D7${binary.height}`
                        : ''}
                    </span>
                  </span>
                </button>
                {onShowPicture ? (
                  <button
                    type="button"
                    className="mfbe-coverpicker-enlarge"
                    data-testid={`${testIdPrefix}-enlarge-${binary.id}`}
                    title={t('pictureChooser.enlargeTip')}
                    aria-label={t('pictureChooser.enlarge', { id: binary.id })}
                    onClick={() => onShowPicture(binary)}
                  >
                    <span className="mfbe-hrefcombo-enlarge-glyph" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
