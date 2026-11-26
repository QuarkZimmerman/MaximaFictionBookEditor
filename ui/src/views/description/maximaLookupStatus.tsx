/**
 * Shared confirmation/advisory badge and external site link for Maxima Library Lookup Service v2
 * rows in Description view (feature 021).
 */

import { useTranslation } from 'react-i18next';

import { ExternalLink } from '@/dialogs/ExternalLink';
import type { RowConfirmationStatus } from '@/features/lookup/descriptionLookupSession';
import type { RpcClient } from '@/rpc/client';

import './maximaLookup.css';

export interface MaximaRowStatusBadgeProps {
  status: RowConfirmationStatus;
  libraryId: number | null;
  url: string | null;
  testIdPrefix: string;
  rpc: RpcClient | null;
}

export function MaximaRowStatusBadge({
  status,
  libraryId,
  url,
  testIdPrefix,
  rpc,
}: MaximaRowStatusBadgeProps) {
  const { t } = useTranslation();

  if (status === 'confirmed' && libraryId && libraryId > 0) {
    return (
      <span className="mfbe-ml-status-strip" data-testid={`${testIdPrefix}-status`}>
        <span
          className="mfbe-ml-badge is-confirmed"
          data-testid={`${testIdPrefix}-confirmed`}
          data-library-id={String(libraryId)}
          title={t('maximaLibrary.lookup.confirmedTooltip', { id: libraryId })}
        >
          {t('maximaLibrary.lookup.confirmedBadge', { id: libraryId })}
        </span>
        {url ? (
          <ExternalLink
            url={url}
            rpc={rpc}
            className="mfbe-ml-row-link"
            testId={`${testIdPrefix}-site-link`}
          >
            {t('maximaLibrary.lookup.openOnSiteShort')}
          </ExternalLink>
        ) : null}
      </span>
    );
  }

  if (status === 'unresolved') {
    return (
      <span className="mfbe-ml-status-strip" data-testid={`${testIdPrefix}-status`}>
        <span
          className="mfbe-ml-badge is-unresolved"
          data-testid={`${testIdPrefix}-unresolved`}
          title={t('maximaLibrary.lookup.unresolvedTooltip')}
        >
          {t('maximaLibrary.lookup.unresolvedBadge')}
        </span>
      </span>
    );
  }

  return null;
}
