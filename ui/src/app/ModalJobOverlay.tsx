/**
 * Feature 011 (research DP-11; FR-054, FR-020g): the overlay of a modal job - its title, a progress
 * bar and *Cancel* - over the whole window. See modalJob.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cancelModalJob, currentModalJob, onModalJob, type ModalJob } from './modalJob';
import './ModalJobOverlay.css';

export function ModalJobOverlay() {
  const { t } = useTranslation();
  const [job, setJob] = useState<ModalJob | null>(currentModalJob());
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => onModalJob(setJob), []);
  useEffect(() => {
    if (job) cancelRef.current?.focus({ preventScroll: true });
  }, [job !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!job) return null;
  // In thousandths: a long job's bar moves with every report, not only at each hundredth
  // (feature 014, SC-010).
  const permille = job.total > 0 ? Math.min(1000, Math.round((job.done / job.total) * 1000)) : null;
  return (
    <div
      className="mfbe-modal-job"
      data-testid="modal-job"
      role="dialog"
      aria-modal="true"
      aria-label={job.title}
    >
      <div className="mfbe-modal-job-box">
        <div className="mfbe-modal-job-title">{job.title}</div>
        <progress
          className="mfbe-modal-job-bar"
          data-testid="modal-job-progress"
          max={1000}
          {...(permille === null ? {} : { value: permille })}
        />
        <button
          ref={cancelRef}
          type="button"
          data-testid="modal-job-cancel"
          title={t('tip.modalJob.cancel')}
          onClick={() => cancelModalJob()}
        >
          {t('dialog.buttons.cancel')}
        </button>
      </div>
    </div>
  );
}
