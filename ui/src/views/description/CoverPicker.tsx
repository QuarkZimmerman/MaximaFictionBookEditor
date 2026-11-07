/**
 * Cover page images (T094): the `<coverpage>` image references of a title-info block, each
 * with a thumbnail (the core's preview, `binaryPreviewUrl`), a drop-down of the
 * document's binaries (plus free text for external references) and Remove; "Add cover..." opens
 * the picker dialog - a thumbnail grid of the existing image binaries and an "Add file..."
 * button that embeds a new image through `binary.add` and selects it. While a script runs
 * (form `readOnly`, feature 003 FR-011) the list is read-only: Add, Remove, the thumbnail
 * button and the drop-down are unavailable, the reference text stays selectable.
 */

import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { binaryPreviewUrl } from '@/model/binaryUrls';
import { openPictureView } from '@/features/images/openPictureView';
import { PictureChooser } from '@/features/images/PictureChooser';
import type { BinaryMeta, ImageRef } from '@/model/document';
import type { RpcClient } from '@/rpc/client';

import { AddButton, EmptyHint, RemoveButton, SmallButton, SubSection, TextField } from './fields';
import { readOnlySelectProps, useDescriptionForm } from './formContext';
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
  const { controller, form, binaries, docId, readOnly } = useDescriptionForm();
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
        onBinaryRemoved={(id) => {
          const document = store.getState().document;
          if (!document) return;
          const list = document.binaries.filter((b) => b.id !== id);
          store.setState({ document: { ...document, binaries: list } });
        }}
        onShowPicture={(binary) => {
          if (docId) void openPictureView(dialogs, { docId, binary, store });
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
          const coverBinary = dangling
            ? undefined
            : images.find((binary) => `#${binary.id}` === cover.href);
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
                title={t('descriptionForm.cover.view')}
                data-testid={`${testPrefix}-${index}-thumb`}
                disabled={!coverBinary}
                onClick={() => {
                  // Feature 008 (D9, FR-051): the thumbnail shows the cover, as a thumbnail of the
                  // Binary objects list does (feature 007); Choose... opens the picker.
                  if (coverBinary && docId) {
                    void openPictureView(dialogs, { docId, binary: coverBinary, store });
                  }
                }}
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
                  {...readOnlySelectProps(readOnly, (event) =>
                    controller.setValue(`${fieldKey}.${index}.href`, event.target.value),
                  )}
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
              <SmallButton
                testId={`${testPrefix}-${index}-choose`}
                title={t('descriptionForm.cover.choose')}
                disabled={readOnly}
                onClick={() => void change(index)}
              >
                {t('descriptionForm.cover.chooseButton')}
              </SmallButton>
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
  /** A file was embedded through *From file...* (the caller adds it to the model). */
  onBinaryAdded: (meta: BinaryMeta) => void;
  /** A file added in the dialog was removed again on Cancel (feature 010, D6). */
  onBinaryRemoved?: (id: string) => void;
  /** The enlarge button of a preview (feature 010, D3). */
  onShowPicture?: (binary: BinaryMeta) => void;
  onClose: (href: string | null) => void;
}

/** The cover's chooser: the picture chooser of feature 010 with the cover's caption and test ids. */
export function CoverPickerDialog(props: CoverPickerDialogProps) {
  const { t } = useTranslation();
  return (
    <PictureChooser
      {...props}
      caption={t('descriptionForm.cover.pickerCaption')}
      testIdPrefix="cover-picker"
    />
  );
}
