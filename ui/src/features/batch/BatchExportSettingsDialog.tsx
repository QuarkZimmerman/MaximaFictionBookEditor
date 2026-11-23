/**
 * Batch-only export options modal for the selected format (PDF, MOBI / KF8, TXT, Markdown).
 * Reuses the Settings -> Exports page components against a local draft copy so edits apply
 * solely to Batch Converter in this session and never modify global settings.json.
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

import { mergeBatchExportSettings } from './engine/configState';
import type { BatchConfigurableExportFormat, BatchExportSettingsOverrides } from './engine/types';

export interface BatchExportSettingsDialogProps {
  ctx: CommandContext;
  format: BatchConfigurableExportFormat;
  effectiveSettings: Settings | null;
  onSave: (patch: BatchExportSettingsOverrides) => void;
  onCancel: () => void;
}

function buildInitialDraft(
  format: BatchConfigurableExportFormat,
  effectiveSettings: Settings | null,
): Settings {
  const seed: BatchExportSettingsOverrides = {};
  switch (format) {
    case 'pdf':
      seed.pdf = {};
      break;
    case 'txt':
      seed.txt = {};
      break;
    case 'mobi':
      seed.mobi = {};
      break;
    case 'markdown':
      seed.markdown = {};
      break;
  }
  return mergeBatchExportSettings(effectiveSettings, seed)!;
}

export function BatchExportSettingsDialog({
  ctx,
  format,
  effectiveSettings,
  onSave,
  onCancel,
}: BatchExportSettingsDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Settings>(() => buildInitialDraft(format, effectiveSettings));

  const updateSection = <S extends BatchConfigurableExportFormat>(
    section: S,
    patch: Partial<NonNullable<Settings[S]>>,
  ) => {
    setDraft((prev) => ({
      ...prev,
      [section]: { ...prev[section], ...patch },
    }));
  };

  const handleOk = () => {
    // ZIP output is controlled by the single checkbox beside Target format in BatchConverterDialog;
    // omit `zip` here so per-format options never fight with that checkbox.
    switch (format) {
      case 'pdf':
        if (draft.pdf) {
          onSave({
            pdf: {
              defaultPageSize: draft.pdf.defaultPageSize,
              textFont: draft.pdf.textFont,
              textSize: draft.pdf.textSize,
              margins: draft.pdf.margins,
              customTextSize: draft.pdf.customTextSize,
              customMargin: draft.pdf.customMargin,
            },
          });
        }
        break;
      case 'txt':
        if (draft.txt) {
          onSave({
            txt: {
              encodingMode: draft.txt.encodingMode,
              encodings: { ...draft.txt.encodings },
              bom: draft.txt.bom,
            },
          });
        }
        break;
      case 'mobi':
        if (draft.mobi) {
          onSave({
            mobi: {
              format: draft.mobi.format,
              tocPlacement: draft.mobi.tocPlacement,
              seriesInTitle: draft.mobi.seriesInTitle,
              openAt: draft.mobi.openAt,
              kf8PopupFootnotes: draft.mobi.kf8PopupFootnotes,
            },
          });
        }
        break;
      case 'markdown':
        if (draft.markdown) {
          onSave({ markdown: { includePictures: draft.markdown.includePictures } });
        }
        break;
    }
  };

  const buttons: DialogButton[] = [
    {
      id: 'ok',
      label: t('dialog.buttons.ok'),
      onClick: handleOk,
    },
    {
      id: 'cancel',
      label: t('dialog.buttons.cancel'),
      onClick: onCancel,
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
