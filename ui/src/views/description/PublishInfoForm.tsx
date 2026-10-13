/**
 * Publish info ("Paper Book") form (T075, FR-050): book name, publisher, city, year, ISBN and
 * sequences - the `pi` template of the original `fb2.xsl`. The whole block is omitted on save
 * when every field is empty.
 */

import { useTranslation } from 'react-i18next';

import { Row, TextField } from './fields';
import { SequenceList } from './SequenceList';

export function PublishInfoForm() {
  const { t } = useTranslation();
  return (
    <div className="mfbe-desc-form" data-testid="description-publish-info-form">
      <TextField
        fieldKey="publishInfo.bookName"
        testId="description-publish-book-name"
        label={t('description.fields.bookName')}
        size="wide"
      />
      <TextField
        fieldKey="publishInfo.publisher"
        testId="description-publish-publisher"
        label={t('description.fields.publisher')}
        size="wide"
      />
      <Row>
        <TextField
          fieldKey="publishInfo.city"
          testId="description-publish-city"
          label={t('description.fields.city')}
          size="middle"
        />
        <TextField
          fieldKey="publishInfo.year"
          testId="description-publish-year"
          label={t('description.fields.year')}
          size="short"
          maxLength={8}
        />
        <TextField
          fieldKey="publishInfo.isbn"
          testId="description-publish-isbn"
          label={t('description.fields.isbn')}
          size="middle"
        />
      </Row>
      <SequenceList
        fieldKey="publishInfo.sequences"
        testPrefix="description-publish-sequence"
        title={t('descriptionForm.sequences')}
      />
    </div>
  );
}
