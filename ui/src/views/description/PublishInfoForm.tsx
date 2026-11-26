/**
 * Publish info ("Paper Book") form (T075, FR-050): book name, publisher, city, year, ISBN and
 * sequences - the `pi` template of the original `fb2.xsl`. The whole block is omitted on save
 * when every field is empty.
 */

import { useTranslation } from 'react-i18next';

import { Row, TextField } from './fields';
import { useDescriptionForm } from './formContext';
import { MaximaLookupDropdown } from './MaximaLookupDropdown';
import { MaximaRowStatusBadge } from './maximaLookupStatus';
import { SequenceList } from './SequenceList';
import { useMaximaPublisherLookup } from './useMaximaPublisherLookup';

export function PublishInfoForm() {
  const { t } = useTranslation();
  const { maximaLookup } = useDescriptionForm();
  const publisherLookup = useMaximaPublisherLookup();
  const publisherClass =
    publisherLookup.active && publisherLookup.status === 'confirmed'
      ? 'mfbe-ml-input-confirmed'
      : publisherLookup.active && publisherLookup.status === 'unresolved'
        ? 'mfbe-ml-input-unresolved'
        : undefined;

  return (
    <div className="mfbe-desc-form" data-testid="description-publish-info-form">
      <TextField
        fieldKey="publishInfo.bookName"
        testId="description-publish-book-name"
        label={t('description.fields.bookName')}
        size="wide"
      />
      <div className={publisherLookup.active ? 'mfbe-ml-anchor' : undefined}>
        <Row>
          <TextField
            fieldKey="publishInfo.publisher"
            testId="description-publish-publisher"
            label={t('description.fields.publisher')}
            size="wide"
            className={publisherClass}
            autoComplete={publisherLookup.active ? 'off' : undefined}
            onValueChange={publisherLookup.active ? publisherLookup.handleChange : undefined}
            onFocus={publisherLookup.active ? publisherLookup.handleFocus : undefined}
            onClick={publisherLookup.active ? publisherLookup.handleClick : undefined}
            onBlur={publisherLookup.active ? publisherLookup.handleBlur : undefined}
            onKeyDown={publisherLookup.active ? publisherLookup.handleKeyDown : undefined}
          />
          {publisherLookup.active ? (
            <MaximaRowStatusBadge
              status={publisherLookup.status}
              libraryId={publisherLookup.confirmedLibraryId}
              url={publisherLookup.confirmedUrl}
              testIdPrefix="description-publish-publisher-lookup"
              rpc={maximaLookup?.rpc ?? null}
            />
          ) : null}
        </Row>
        {publisherLookup.active ? (
          <MaximaLookupDropdown
            testIdPrefix="description-publish-publisher-lookup"
            open={publisherLookup.dropdownOpen}
            loading={publisherLookup.loading}
            disambiguationPrompt={publisherLookup.disambiguationPrompt}
            errorMessage={publisherLookup.errorMessage}
            items={publisherLookup.items}
            activeIndex={publisherLookup.activeIndex}
            page={publisherLookup.page}
            hasMore={publisherLookup.hasMore}
            rpc={maximaLookup?.rpc ?? null}
            onHighlightIndex={publisherLookup.setActiveIndex}
            onPick={publisherLookup.handlePick}
            onPrevPage={publisherLookup.handlePrevPage}
            onNextPage={publisherLookup.handleNextPage}
            onClose={publisherLookup.closeDropdown}
          />
        ) : null}
      </div>
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
        lookupMode="publisherSeries"
      />
    </div>
  );
}
