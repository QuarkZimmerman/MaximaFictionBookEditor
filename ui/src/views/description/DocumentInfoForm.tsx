/**
 * Document info form (T075, FR-050): version and ID with the "new" button (UUID v4 after the
 * confirmation of the original editor: "Are you sure you want to generate a new ID? This will
 * affect library submission. Previous value will be lost!"), document authors, program used,
 * date, source OCR, source URLs, history (rich) and publishers - the `di` template of `fb2.xsl`.
 */

import { useTranslation } from 'react-i18next';

import { useAppServices } from '@/app/services';

import { DateField } from './DateField';
import { Row, SmallButton, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { newDocumentId, setAtPath } from './model';
import { PersonList, StringList } from './PersonList';
import { RichField } from './RichField';

export function DocumentInfoForm() {
  const { t } = useTranslation();
  const { dialogs } = useAppServices();
  const { controller, form, issues } = useDescriptionForm();
  const info = form.documentInfo;

  const generateId = async () => {
    const answer = await dialogs.showMessage({
      text: t('descriptionForm.id.warning'),
      caption: t('app.name'),
      buttons: 'yesNo',
      icon: 'warning',
      defaultButton: 'no',
      testId: 'dialog-new-id',
    });
    if (answer !== 'yes') return;
    controller.update((current) => setAtPath(current, 'documentInfo.id', newDocumentId()));
    controller.focusField('documentInfo.id');
  };

  return (
    <div className="mfbe-desc-form" data-testid="description-document-info-form">
      <Row>
        <TextField
          fieldKey="documentInfo.version"
          testId="description-version"
          label={t('description.fields.version')}
          required
          size="short"
          invalid={
            issues.missing.has('documentInfo.version') ? t('descriptionForm.required') : null
          }
        />
        <TextField
          fieldKey="documentInfo.id"
          testId="description-id"
          label={t('description.id')}
          required
          size="wide"
          invalid={issues.missing.has('documentInfo.id') ? t('descriptionForm.required') : null}
        />
        <SmallButton
          testId="description-id-new"
          onClick={() => void generateId()}
          title={t('descriptionForm.id.generate')}
        >
          {t('descriptionForm.id.new')}
        </SmallButton>
      </Row>
      <PersonList
        fieldKey="documentInfo.authors"
        testPrefix="description-doc-author"
        title={t('descriptionForm.documentAuthors')}
        required
      />
      <TextField
        fieldKey="documentInfo.programUsed"
        testId="description-program-used"
        label={t('description.fields.programUsed')}
        size="wide"
      />
      <DateField fieldKey="documentInfo.date" testPrefix="description-doc-date" required />
      <TextField
        fieldKey="documentInfo.srcOcr"
        testId="description-src-ocr"
        label={t('description.fields.srcOcr')}
        size="wide"
      />
      <StringList
        fieldKey="documentInfo.srcUrls"
        values={info.srcUrls}
        label={t('description.fields.srcUrls')}
        testPrefix="description-src-url"
        onAdd={() =>
          controller.update((current) =>
            setAtPath(current, 'documentInfo.srcUrls', [...current.documentInfo.srcUrls, '']),
          )
        }
        onRemove={(index) =>
          controller.update((current) =>
            setAtPath(
              current,
              'documentInfo.srcUrls',
              current.documentInfo.srcUrls.filter((_, i) => i !== index),
            ),
          )
        }
      />
      <RichField
        fieldKey="documentInfo.history"
        testId="description-history"
        label={t('description.fields.history')}
      />
      <PersonList
        fieldKey="documentInfo.publishers"
        testPrefix="description-publisher"
        title={t('descriptionForm.publishers')}
      />
    </div>
  );
}
