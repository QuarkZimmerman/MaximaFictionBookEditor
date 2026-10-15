/**
 * Cover page images (T094): the `<coverpage>` image references of a title-info block, each
 * with a thumbnail (served by `GET /binary/{docId}/{id}/preview?w=`), a drop-down of the
 * document's binaries (plus free text for external references) and Remove; "Add cover..." opens
 * the picker dialog - a thumbnail grid of the existing image binaries and an "Add file..."
 * button that embeds a new image through `binary.add` and selects it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { imageFileTypes } from '@/dialogs/fileTypes';
import { binaryPreviewUrl } from '@/editor/nodeviews/image';
import { addBinaryFromFile } from '@/features/images/binaries';
import type { BinaryMeta, ImageRef } from '@/model/document';
import type { RpcClient } from '@/rpc/client';

import { AddButton, EmptyHint, RemoveButton, SmallButton, SubSection, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { getAtPath, setAtPath, type FieldKey } from './model';

export interface CoverListProps {
  /** Form path of the list, e.g. `titleInfo.coverpage`. */
  fieldKey: FieldKey;
  /** Test id prefix, e.g. `description-cover` -> `description-cover-0`. */
  testPrefix: string;
}

export function CoverList({ fieldKey, testPrefix }: CoverListProps) {
  const { t } = useTranslation();
  const { dialogs, rpc, store } = useAppServices();
  const { controller, form, binaries, docId } = useDescriptionForm();
  const covers = (getAtPath(form, fieldKey) as ImageRef[] | undefined) ?? [];
  const images = binaries.filter((b) => b.decodable);

  const pick = async (current?: string): Promise<string | null> =>
    dialogs.openCustom<string | null>((close) => (
      <CoverPickerDialog
        rpc={rpc}
        docId={docId}
        binaries={images}
        initial={current}
        onBinaryAdded={(meta) => {
          const document = store.getState().document;
          if (!document) return;
          const list = document.binaries.filter((b) => b.id !== meta.id).concat(meta);
          store.setState({ document: { ...document, binaries: list } });
        }}
        onClose={close}
      />
    ));

  const add = async () => {
    const href = await pick();
    if (!href) return;
    controller.update((state) =>
      setAtPath(state, fieldKey, [
        ...((getAtPath(state, fieldKey) as ImageRef[] | undefined) ?? []),
        { href },
      ]),
    );
  };
  const change = async (index: number) => {
    const href = await pick(covers[index]?.href);
    if (!href) return;
    controller.update((state) => {
      const ref = (getAtPath(state, `${fieldKey}.${index}`) as ImageRef | undefined) ?? { href };
      return setAtPath(state, `${fieldKey}.${index}`, { ...ref, href });
    });
  };
  const remove = (index: number) =>
    controller.update((state) =>
      setAtPath(
        state,
        fieldKey,
        ((getAtPath(state, fieldKey) as ImageRef[] | undefined) ?? []).filter(
          (_, i) => i !== index,
        ),
      ),
    );

  return (
    <SubSection
      id={`${testPrefix}-list`}
      title={t('descriptionForm.cover.title')}
      actions={
        <AddButton
          testId={`${testPrefix}-add`}
          onClick={() => void add()}
          label={t('descriptionForm.cover.add')}
        />
      }
    >
      {covers.length === 0 ? (
        <EmptyHint>{t('descriptionForm.cover.none')}</EmptyHint>
      ) : (
        covers.map((cover, index) => {
          const url = binaryPreviewUrl(docId, cover.href, 96);
          const dangling =
            cover.href.startsWith('#') && !binaries.some((b) => `#${b.id}` === cover.href);
          return (
            <div
              className="mfbe-desc-row mfbe-desc-cover"
              key={index}
              data-testid={`${testPrefix}-${index}`}
            >
              <RemoveButton
                testId={`${testPrefix}-${index}-remove`}
                onClick={() => remove(index)}
              />
              <button
                type="button"
                className="mfbe-desc-thumb-button"
                title={t('descriptionForm.cover.choose')}
                data-testid={`${testPrefix}-${index}-thumb`}
                onClick={() => void change(index)}
              >
                {url && !dangling ? (
                  <img className="mfbe-desc-thumb" src={url} alt={cover.alt ?? cover.href} />
                ) : (
                  <span className="mfbe-desc-thumb mfbe-desc-thumb-missing">
                    {t('descriptionForm.cover.missing')}
                  </span>
                )}
              </button>
              <label className="mfbe-desc-field">
                <span className="mfbe-desc-label">{t('descriptionForm.cover.image')}</span>
                <select
                  className={`mfbe-desc-select${dangling ? ' mfbe-desc-input-invalid' : ''}`}
                  data-testid={`${testPrefix}-${index}-href`}
                  value={cover.href}
                  title={dangling ? t('descriptionForm.cover.dangling') : undefined}
                  onChange={(event) =>
                    controller.setValue(`${fieldKey}.${index}.href`, event.target.value)
                  }
                >
                  {!images.some((b) => `#${b.id}` === cover.href) ? (
                    <option value={cover.href}>{cover.href}</option>
                  ) : null}
                  {images.map((binary) => (
                    <option key={binary.id} value={`#${binary.id}`}>
                      {`#${binary.id} (${binary.contentType}${
                        binary.width && binary.height
                          ? `, ${binary.width}\u00D7${binary.height}`
                          : ''
                      })`}
                    </option>
                  ))}
                </select>
              </label>
              <TextField
                fieldKey={`${fieldKey}.${index}.href`}
                testId={`${testPrefix}-${index}-href-text`}
                size="middle"
                title={t('descriptionForm.cover.hrefText')}
              />
              {dangling ? (
                <span className="mfbe-desc-warning" data-testid={`${testPrefix}-${index}-dangling`}>
                  {t('descriptionForm.cover.dangling')}
                </span>
              ) : null}
            </div>
          );
        })
      )}
    </SubSection>
  );
}

/* ------------------------------------------------------------------------ */
/* Picker dialog                                                            */
/* ------------------------------------------------------------------------ */

export interface CoverPickerDialogProps {
  rpc: RpcClient | null;
  docId: string | null;
  binaries: BinaryMeta[];
  initial?: string;
  /** A file was embedded through "Add file..." (the caller adds it to the model). */
  onBinaryAdded: (meta: BinaryMeta) => void;
  onClose: (href: string | null) => void;
}

export function CoverPickerDialog({
  rpc,
  docId,
  binaries,
  initial,
  onBinaryAdded,
  onClose,
}: CoverPickerDialogProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<BinaryMeta[]>(binaries);
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFile = async () => {
    if (!rpc || !docId) return;
    setBusy(true);
    setError(null);
    try {
      const meta = await addBinaryFromFile(rpc, docId, {
        title: t('descriptionForm.cover.addFile'),
        filters: imageFileTypes(t),
        selectedFilter: 0,
      });
      if (!meta) return;
      onBinaryAdded(meta);
      setItems((current) => current.filter((b) => b.id !== meta.id).concat(meta));
      setSelected(`#${meta.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: !selected,
      onClick: () => onClose(selected),
    },
    { id: 'cancel', label: t('dialog.buttons.cancel'), onClick: () => onClose(null) },
  ];

  return (
    <Dialog
      title={t('descriptionForm.cover.pickerCaption')}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      testId="cover-picker"
      className="mfbe-coverpicker"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-coverpicker-toolbar">
        <SmallButton
          testId="cover-picker-add-file"
          onClick={() => void addFile()}
          disabled={busy || !rpc || !docId}
          title={t('descriptionForm.cover.addFile')}
        >
          {t('descriptionForm.cover.addFile')}
        </SmallButton>
        {error ? (
          <span className="mfbe-desc-warning" data-testid="cover-picker-error">
            {error}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <EmptyHint>{t('descriptionForm.cover.noBinaries')}</EmptyHint>
      ) : (
        <div className="mfbe-coverpicker-grid" role="listbox" data-testid="cover-picker-grid">
          {items.map((binary) => {
            const href = `#${binary.id}`;
            const url = binaryPreviewUrl(docId, href, 120);
            const active = selected === href;
            return (
              <button
                type="button"
                role="option"
                aria-selected={active}
                key={binary.id}
                className={`mfbe-coverpicker-item${active ? ' mfbe-coverpicker-item-selected' : ''}`}
                data-testid={`cover-picker-item-${binary.id}`}
                onClick={() => setSelected(href)}
                onDoubleClick={() => onClose(href)}
              >
                {url ? <img src={url} alt={binary.id} className="mfbe-coverpicker-thumb" /> : null}
                <span className="mfbe-coverpicker-caption">
                  <code>{binary.id}</code>
                  <span className="mfbe-desc-muted">
                    {binary.width && binary.height ? ` ${binary.width}\u00D7${binary.height}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
