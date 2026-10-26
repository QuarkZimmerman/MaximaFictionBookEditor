/**
 * Description view (T075-T077, FR-050): the editable metadata form of the book - Title info,
 * optional Source title info, Document info, Publish info, Custom info, Binary objects and a
 * read-only File block - bound to `document.description` through the `DescriptionController`
 * (binding.ts). Required fields carry a marker (FR-052); preserved `<output>` elements and
 * unknown description-level elements are reported as a read-only note. Every control has a
 * stable `data-testid` (`description-book-title`, `description-author-0-first`,
 * `description-id-new`, `binary-objects-row-<id>`...).
 *
 * Feature 006, US10 (FR-044; C28; data-model §9.3): a right-click in a rich field (the book
 * annotation, the source book's annotation, the history) makes that field the active table edit
 * target and applies the right-click rule at the clicked position before the field's menu opens,
 * which then offers the table section; a plain field's menu stays as it was.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { textFieldOf } from '@/app/textFields';
import { prepareTableClick } from '@/features/tables/contextMenu';
import { activateFieldTarget, fieldTargetFor } from '@/features/tables/target';
import { isRunLocked, useAppState } from '@/model/store';
import type { ContextMenuClick } from '@/views/body/contextMenuExtensions';

import { BinaryObjects } from './BinaryObjects';
import { descriptionControllerFor } from './binding';
import { CustomInfoList } from './CustomInfoList';
import { DocumentInfoForm } from './DocumentInfoForm';
import { FieldContextMenu } from './FieldContextMenu';
import { Section, SmallButton } from './fields';
import { DescriptionFormContext, type DescriptionFormContextValue } from './formContext';
import { descriptionExtrasCount, emptyTitleInfo } from './model';
import { PublishInfoForm } from './PublishInfoForm';
import { useResourceCatalogs } from './resources';
import { TitleInfoForm } from './TitleInfoForm';

import './description.css';

const EMPTY_BINARIES: never[] = [];

/** The click of a right-click at (x, y) on a rich field's editor: the position under it, or null. */
function fieldClick(
  view: { posAtCoords(coords: { left: number; top: number }): { pos: number } | null },
  x: number,
  y: number,
): ContextMenuClick {
  try {
    return { x, y, pos: view.posAtCoords({ left: x, top: y })?.pos ?? null };
  } catch {
    return { x, y, pos: null }; // a view that measures nothing
  }
}

export function DescriptionView() {
  const { t } = useTranslation();
  const { store, undo, rpc } = useAppServices();
  const controller = useMemo(() => descriptionControllerFor(store, undo), [store, undo]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const document = useAppState((s) => s.document, store);
  const sourceOnly = useAppState((s) => s.sourceOnly, store);
  const connection = useAppState((s) => s.connection, store);
  const language = useAppState((s) => s.uiLanguage, store);
  // The quiet lock of a run (feature 003 FR-011; a script or an AI request): the form is
  // read-only, not disabled.
  const readOnly = useAppState(isRunLocked, store);
  const { genres, languages, reloadGenres } = useResourceCatalogs(rpc, connection === 'connected');
  const [fieldMenu, setFieldMenu] = useState<{
    field: HTMLElement;
    position: { x: number; y: number };
    /** A rich field's click (US10): where its table section is judged. */
    click?: ContextMenuClick;
  } | null>(null);

  useEffect(() => {
    controller.setTranslate((key) => t(key));
  }, [controller, t]);

  const form = snapshot.form;
  const issues = snapshot.issues;
  const binaries = document?.binaries ?? EMPTY_BINARIES;
  const docId = document?.docId ?? null;
  const context = useMemo<DescriptionFormContextValue | null>(
    () =>
      form && issues
        ? {
            controller,
            form,
            issues,
            language,
            genres,
            languages,
            reloadGenres,
            docId,
            binaries,
            readOnly,
          }
        : null,
    [
      controller,
      form,
      issues,
      language,
      genres,
      languages,
      reloadGenres,
      docId,
      binaries,
      readOnly,
    ],
  );

  if (!document || !context) {
    return (
      <div
        className="mfbe-view mfbe-view-description"
        id="panel-description"
        role="tabpanel"
        data-testid="panel-description"
      >
        <div className="mfbe-view-placeholder" data-testid="panel-description-empty">
          {t('views.description.empty')}
        </div>
      </div>
    );
  }

  const extras = descriptionExtrasCount(document);
  const hasSource = !!context.form.srcTitleInfo;

  return (
    <div
      className="mfbe-view mfbe-view-description"
      id="panel-description"
      role="tabpanel"
      data-testid="panel-description"
    >
      <DescriptionFormContext.Provider value={context}>
        <div
          className="mfbe-desc"
          data-testid="description-view"
          data-revision={snapshot.revision}
          data-locked={readOnly ? 'true' : 'false'}
          onContextMenu={(event) => {
            const field = textFieldOf(event.target);
            if (!field) return;
            event.preventDefault();
            const position = { x: event.clientX, y: event.clientY };
            // A rich field (US10): the active target, the caret into a clicked cell (C28).
            const target = fieldTargetFor(field);
            const view = target?.view;
            if (target && view) {
              const click = fieldClick(view, event.clientX, event.clientY);
              activateFieldTarget(target.key);
              prepareTableClick(target, click);
              setFieldMenu({ field, position, click });
              return;
            }
            setFieldMenu({ field, position });
          }}
        >
          {sourceOnly ? (
            <div className="mfbe-desc-note mfbe-desc-warning" data-testid="description-source-only">
              {t('views.body.sourceOnly')}
            </div>
          ) : null}
          {extras > 0 ? (
            <div className="mfbe-desc-note" data-testid="description-extras-note">
              {t('descriptionForm.extrasNote', { count: extras })}
            </div>
          ) : null}

          <Section id="description-title-info" title={t('description.titleInfo')}>
            <TitleInfoForm block="titleInfo" />
          </Section>

          <Section
            id="description-src-title-info"
            title={t('description.srcTitleInfo')}
            actions={
              hasSource ? (
                <SmallButton
                  testId="description-src-title-info-remove"
                  onClick={() =>
                    controller.update((current) => ({ ...current, srcTitleInfo: undefined }))
                  }
                  title={t('descriptionForm.srcTitleInfo.remove')}
                  kind="remove"
                >
                  {t('descriptionForm.srcTitleInfo.remove')}
                </SmallButton>
              ) : (
                <SmallButton
                  testId="description-src-title-info-add"
                  onClick={() =>
                    controller.update((current) => ({ ...current, srcTitleInfo: emptyTitleInfo() }))
                  }
                  title={t('descriptionForm.srcTitleInfo.add')}
                >
                  {`+ ${t('descriptionForm.srcTitleInfo.add')}`}
                </SmallButton>
              )
            }
          >
            {hasSource ? (
              <TitleInfoForm block="srcTitleInfo" />
            ) : (
              <div className="mfbe-desc-empty">{t('descriptionForm.srcTitleInfo.hint')}</div>
            )}
          </Section>

          <Section id="description-document-info" title={t('description.documentInfo')}>
            <DocumentInfoForm />
          </Section>

          <Section id="description-publish-info" title={t('description.publishInfo')}>
            <PublishInfoForm />
          </Section>

          <Section id="description-custom-info" title={t('description.customInfo')}>
            <CustomInfoList />
          </Section>

          <Section id="description-binaries" title={t('description.binaries')}>
            <BinaryObjects />
          </Section>

          <Section id="description-file-info" title={t('description.fileInfo')}>
            <dl className="mfbe-desc-fileinfo">
              <dt>{t('description.fields.path')}</dt>
              <dd data-testid="description-path">{document.path ?? '\u2014'}</dd>
              <dt>{t('description.fields.encoding')}</dt>
              <dd data-testid="description-encoding">{document.sourceEncoding}</dd>
              <dt>{t('description.fields.schemaHint')}</dt>
              <dd data-testid="description-schema-hint">
                {t(
                  `description.schema.${document.schemaHint === '2.1' ? 'current' : document.schemaHint}`,
                )}
              </dd>
              <dt>{t('description.fields.bodiesCount')}</dt>
              <dd data-testid="description-bodies-count">{String(document.bodies.length)}</dd>
            </dl>
          </Section>
        </div>
      </DescriptionFormContext.Provider>
      {fieldMenu ? (
        <FieldContextMenu
          field={fieldMenu.field}
          position={fieldMenu.position}
          click={fieldMenu.click}
          onClose={() => setFieldMenu(null)}
        />
      ) : null}
    </div>
  );
}
