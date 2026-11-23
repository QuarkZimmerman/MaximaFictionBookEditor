/**
 * Batch-only export options modal for the selected format (PDF, MOBI / KF8, TXT, Markdown).
 * Reuses the Settings -> Exports page components against a local draft copy so edits persist
 * solely to Batch Converter (`batch-converter.json`) and never modify global settings.json.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { MarkdownPage } from '@/dialogs/settings/MarkdownPage';
import { MobiPage } from '@/dialogs/settings/MobiPage';
import { PdfPage } from '@/dialogs/settings/PdfPage';
import { TxtPage } from '@/dialogs/settings/TxtPage';
import '@/dialogs/settings/settings.css';
import type { Settings } from '@/rpc/types';

import { cloneExportSettingsOverrides, mergeBatchExportSettings } from './engine/configState';
import type { BatchConfigurableExportFormat, BatchExportSettingsOverrides } from './engine/types';

export interface BatchExportSettingsDialogProps {
  ctx: CommandContext;
  format: BatchConfigurableExportFormat;
  effectiveSettings: Settings | null;
  onApply: (patch: BatchExportSettingsOverrides) => Promise<void> | void;
  onSave: (patch: BatchExportSettingsOverrides) => Promise<void> | void;
  onCancel: () => void;
}

function buildInitialDraft(
  format: BatchConfigurableExportFormat,
  effectiveSettings: Settings | null,
): Settings {
  return mergeBatchExportSettings(effectiveSettings, { [format]: {} })!;
}

export function BatchExportSettingsDialog({
  ctx,
  format,
  effectiveSettings,
  onApply,
  onSave,
  onCancel,
}: BatchExportSettingsDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Settings>(() => buildInitialDraft(format, effectiveSettings));
  const [busy, setBusy] = useState(false);

  const updateSection = <S extends BatchConfigurableExportFormat>(
    section: S,
    patch: Partial<NonNullable<Settings[S]>>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...patch },
    }));
  };

  const buildSectionPatch = (): BatchExportSettingsOverrides => {
    const rawSection = (draft as unknown as Record<string, unknown>)[format];
    if (!rawSection || typeof rawSection !== 'object') return {};
    // Clone the entire format section generically so any future parameter added to global export
    // settings is preserved and persisted automatically. Omit `zip`, which is managed by Batch
    // Converter's own Save-in-ZIP checkbox (`hideZip`).
    const cloned = cloneExportSettingsOverrides({
      [format]: rawSection as Record<string, unknown>,
    });
    const sectionObj = cloned[format];
    if (sectionObj && typeof sectionObj === 'object') {
      delete (sectionObj as Record<string, unknown>).zip;
    }
    return cloned;
  };

  const handleOk = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(buildSectionPatch());
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onApply(buildSectionPatch());
    } finally {
      setBusy(false);
    }
  };

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      disabled: busy,
      onClick: () => void handleOk(),
    },
    {
      id: 'cancel',
      label: t('dialog.buttons.cancel'),
      disabled: busy,
      onClick: onCancel,
    },
    {
      id: 'apply',
      label: t('dialog.settings.apply'),
      disabled: busy,
      onClick: () => void handleApply(),
    },
  ];

  const formatLabel = t(`exports.settings.formats.${format}`);

  return (
    <Dialog
      title={t('batch.export.settingsDialogTitle', { format: formatLabel })}
      buttons={buttons}
      defaultButtonId="ok"
      cancelButtonId="cancel"
      testId="dialog-batch-export-settings"
      className="mfbe-batch-export-settings-dialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-batch-info" data-testid="batch-export-settings-scope-note">
        {t('batch.export.settingsDialogNote')}
      </div>
      {format === 'pdf' ? (
        <PdfPage
          draft={draft}
          onChange={(patch) => updateSection('pdf', patch)}
          ctx={ctx}
          hideZip
        />
      ) : format === 'mobi' ? (
        <MobiPage draft={draft} onChange={(patch) => updateSection('mobi', patch)} hideZip />
      ) : format === 'txt' ? (
        <TxtPage
          draft={draft}
          onChange={(patch) => updateSection('txt', patch)}
          ctx={ctx}
          hideZip
        />
      ) : (
        <MarkdownPage draft={draft} onChange={(patch) => updateSection('markdown', patch)} />
      )}
    </Dialog>
  );
}
