/**
 * Title info / source title info form (T075, FR-050): genres (with match %), authors, book
 * title, annotation (rich), keywords, date, cover page images, language / source language,
 * translators and nested sequences - the `ti` / `sti` templates of the original `fb2.xsl`.
 * The same component serves `titleInfo` and `srcTitleInfo` (test ids get the `sti-` prefix,
 * e.g. `description-sti-book-title`).
 */

import { useTranslation } from 'react-i18next';

import { CoverList } from './CoverPicker';
import { DateField } from './DateField';
import { TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { GenreList } from './GenrePicker';
import { LanguagePicker } from './LanguagePicker';
import { PersonList } from './PersonList';
import { RichField } from './RichField';
import { SequenceList } from './SequenceList';

export interface TitleInfoFormProps {
  /** `titleInfo` or `srcTitleInfo`. */
  block: 'titleInfo' | 'srcTitleInfo';
}

export function TitleInfoForm({ block }: TitleInfoFormProps) {
  const { t } = useTranslation();
  const { issues } = useDescriptionForm();
  const main = block === 'titleInfo';
  const p = main ? 'description' : 'description-sti';
  const required = main;

  return (
    <div className="mfbe-desc-form" data-testid={`${p}-title-info-form`}>
      <GenreList
        fieldKey={`${block}.genres`}
        testPrefix={`${p}-genre`}
        testId={`${p}-genres`}
        required={required}
      />
      <PersonList
        fieldKey={`${block}.authors`}
        testPrefix={`${p}-author`}
        title={t('descriptionForm.authors')}
        required={required}
      />
      <TextField
        fieldKey={`${block}.bookTitle`}
        testId={`${p}-book-title`}
        label={t('description.fields.bookTitle')}
        required={required}
        size="wide"
        invalid={
          required && issues.missing.has('titleInfo.bookTitle')
            ? t('descriptionForm.required')
            : null
        }
      />
      <RichField
        fieldKey={`${block}.annotation`}
        testId={`${p}-annotation`}
        label={t('description.fields.annotation')}
      />
      <TextField
        fieldKey={`${block}.keywords`}
        testId={`${p}-keywords`}
        label={t('descriptionForm.keywords')}
        size="wide"
      />
      <DateField fieldKey={`${block}.date`} testPrefix={`${p}-date`} />
      <CoverList fieldKey={`${block}.coverpage`} testPrefix={`${p}-cover`} />
      <div className="mfbe-desc-row">
        <LanguagePicker
          fieldKey={`${block}.lang`}
          testId={`${p}-lang`}
          label={t('description.fields.lang')}
          required={required}
        />
        <LanguagePicker
          fieldKey={`${block}.srcLang`}
          testId={`${p}-src-lang`}
          label={t('description.fields.srcLang')}
        />
      </div>
      <PersonList
        fieldKey={`${block}.translators`}
        testPrefix={`${p}-translator`}
        title={t('descriptionForm.translators')}
      />
      <SequenceList
        fieldKey={`${block}.sequences`}
        testPrefix={`${p}-sequence`}
        title={t('descriptionForm.sequences')}
      />
    </div>
  );
}
