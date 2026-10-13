/**
 * Description view (T075-T077, FR-050): the editable metadata form of the book - Title info,
 * optional Source title info, Document info, Publish info, Custom info, Binary objects and a
 * read-only File block - bound to `document.description` through the `DescriptionController`
 * (binding.ts). Required fields carry a marker (FR-052); preserved `<output>` elements and
 * unknown description-level elements are reported as a read-only note. Every control has a
 * stable `data-testid` (`description-book-title`, `description-author-0-first`,
 * `description-id-new`, `binary-objects-row-<id>`...).
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';
import { useAppState } from '@/model/store';

import { BinaryObjects } from './BinaryObjects';
import { descriptionControllerFor } from './binding';
import { CustomInfoList } from './CustomInfoList';
import { DocumentInfoForm } from './DocumentInfoForm';
import { Section, SmallButton } from './fields';
import { DescriptionFormContext, type DescriptionFormContextValue } from './formContext';
import { descriptionExtrasCount, emptyTitleInfo } from './model';
import { PublishInfoForm } from './PublishInfoForm';
import { useResourceCatalogs } from './resources';
import { TitleInfoForm } from './TitleInfoForm';

import './description.css';

const EMPTY_BINARIES: never[] = [];

export function DescriptionView() {
  const { t } = useTranslation();
  const { store, undo, rpc } = useAppServices();
  const controller = useMemo(() => descriptionControllerFor(store, undo), [store, undo]);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const document = useAppState((s) => s.document, store);
  const sourceOnly = useAppState((s) => s.sourceOnly, store);
  const connection = useAppState((s) => s.connection, store);
  const language = useAppState((s) => s.uiLanguage, store);
  const { genres, languages, reloadGenres } = useResourceCatalogs(rpc, connection === 'connected');

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
        ? { controller, form, issues, language, genres, languages, reloadGenres, docId, binaries }
        : null,
    [controller, form, issues, language, genres, languages, reloadGenres, docId, binaries],
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
        <div className="mfbe-desc" data-testid="description-view" data-revision={snapshot.revision}>
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
    </div>
  );
}
