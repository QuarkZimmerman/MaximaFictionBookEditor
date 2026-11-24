/**
 * Feature 020 (T043, US3): Settings -> OCR page. Manages custom OCR language-files folder
 * (`Settings.ocr.folder`), *Open OCR folder* (`resources.openOcrFolder`), download note with
 * clickable `ExternalLink` to Tesseract tessdata files, *Auto-detect language* (`Settings.ocr.autoDetect`),
 * enabled-languages checklist (`Settings.ocr.enabledLanguages`) with layer/size/`overridesBundled`
 * badges, and `passedOver` / missing-folder diagnostics.
 */
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { ExternalLink } from '@/dialogs/ExternalLink';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type OcrCatalogReport, type Settings } from '@/rpc/types';

import { CheckField, GroupBox } from './controls';

export const OCR_DOWNLOAD_URL = 'https://tesseract-ocr.github.io/tessdoc/Data-Files.html';

export interface OcrPageProps {
  draft: Settings;
  onChange: (patch: Partial<NonNullable<Settings['ocr']>>) => void;
  ctx: CommandContext;
  report: OcrCatalogReport | null;
  reportKnown: boolean;
}

function fileNameOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function formatPackSize(bytes: number, t: TFunction): string {
  if (bytes >= 1024 * 1024) {
    return t('ocr.settings.packSizeMb', { size: (bytes / (1024 * 1024)).toFixed(1) });
  }
  if (bytes >= 1024) {
    return t('ocr.settings.packSizeKb', { size: String(Math.round(bytes / 1024)) });
  }
  return t('ocr.settings.packSizeB', { size: String(bytes) });
}

export function OcrPage({ draft, onChange, ctx, report, reportKnown }: OcrPageProps) {
  const { t } = useTranslation();
  const rpc = ctx.rpc;
  const folder = draft.ocr?.folder ?? '';
  const autoDetect = draft.ocr?.autoDetect ?? true;
  const enabledLanguages = draft.ocr?.enabledLanguages ?? ['eng', 'rus'];

  const [custom, setCustom] = useState(folder !== '');
  const useDefault = !custom && folder === '';

  const reportFolderError = async (error: unknown) => {
    if (error instanceof RpcError) {
      if (error.code === RpcErrorCode.dialogUnavailable) {
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderUnavailable', { path: folder || '—' }),
          caption: t('app.name'),
          icon: 'info',
          testId: 'dialog-folder-unavailable',
        });
        return;
      }
      if (error.code === RpcErrorCode.methodNotFound || error.code === RpcErrorCode.docIoError) {
        const data = error.data as { reason?: string } | undefined;
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderFailed', { reason: data?.reason ?? error.message }),
          caption: t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-folder-failed',
        });
        return;
      }
    }
    throw error;
  };

  const browseFolder = async () => {
    if (!rpc) return;
    try {
      const { path } = await rpc.call('dialog.pickFolder', {
        title: t('ocr.settings.chooseFolder'),
      });
      if (path) {
        setCustom(true);
        onChange({ folder: path });
      }
    } catch (error) {
      await reportFolderError(error);
    }
  };

  const openOcrFolder = async () => {
    if (!rpc) return;
    try {
      await rpc.call('resources.openOcrFolder');
    } catch (error) {
      await reportFolderError(error);
    }
  };

  const toggleLanguage = (code: string, checked: boolean) => {
    const next = checked
      ? [...enabledLanguages.filter((c) => c !== code), code]
      : enabledLanguages.filter((c) => c !== code);
    onChange({ enabledLanguages: next });
  };

  const folderProblem =
    report?.customFolderIssue === 'missing'
      ? t('ocr.settings.folderMissing', { path: folder })
      : report?.customFolderIssue === 'unreadable'
        ? t('ocr.settings.folderUnreadable', { path: folder })
        : null;

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-ocr">
      <GroupBox title={t('ocr.settings.folderGroup')}>
        <div className="mfbe-settings-row">
          <label className="mfbe-check-field" htmlFor="settings-ocr-folder-default">
            <input
              id="settings-ocr-folder-default"
              type="radio"
              name="settings-ocr-folder-mode"
              checked={useDefault}
              onChange={() => {
                setCustom(false);
                onChange({ folder: '' });
              }}
              data-testid="settings-ocr-folder-default"
            />
            <span>{t('ocr.settings.folderDefault')}</span>
          </label>
          <label className="mfbe-check-field" htmlFor="settings-ocr-folder-custom">
            <input
              id="settings-ocr-folder-custom"
              type="radio"
              name="settings-ocr-folder-mode"
              checked={!useDefault}
              onChange={() => setCustom(true)}
              data-testid="settings-ocr-folder-custom"
            />
            <span>{t('ocr.settings.folderCustom')}</span>
          </label>
        </div>
        <div className="mfbe-settings-row">
          <input
            id="settings-ocr-folder-path"
            className="mfbe-inputdialog-input"
            type="text"
            value={folder}
            disabled={useDefault}
            spellCheck={false}
            aria-label={t('ocr.settings.folderCustom')}
            onChange={(event) => onChange({ folder: event.target.value })}
            data-testid="settings-ocr-folder-path"
          />
          <button
            type="button"
            className="mfbe-button mfbe-settings-browse"
            disabled={!rpc || useDefault}
            title={t('dialog.settings.browse')}
            onClick={() => void browseFolder()}
            data-testid="settings-ocr-folder-browse"
          >
            ...
          </button>
          <button
            type="button"
            className="mfbe-button"
            disabled={!rpc}
            onClick={() => void openOcrFolder()}
            data-testid="settings-ocr-open-folder"
          >
            {t('ocr.settings.openFolder')}
          </button>
        </div>
        {folderProblem ? (
          <div className="mfbe-settings-ai-warning" data-testid="settings-ocr-folder-problem">
            {folderProblem}
          </div>
        ) : null}
        <div className="mfbe-settings-note">
          {t('ocr.settings.downloadNote')}{' '}
          <ExternalLink url={OCR_DOWNLOAD_URL} rpc={rpc} testId="settings-ocr-download-link">
            {t('ocr.settings.downloadLink')}
          </ExternalLink>
        </div>
      </GroupBox>

      <GroupBox title={t('ocr.settings.recognitionGroup')}>
        <CheckField
          label={t('ocr.settings.autoDetect')}
          tooltip={t('ocr.settings.autoDetectHint')}
          checked={autoDetect}
          onChange={(checked) => onChange({ autoDetect: checked })}
          testId="settings-ocr-auto-detect"
        />
        <div className="mfbe-settings-note">{t('ocr.settings.autoDetectHint')}</div>
        <div className="mfbe-settings-note">{t('ocr.settings.languagesLabel')}</div>
        <div className="mfbe-settings-note">{t('ocr.settings.languagesHint')}</div>

        {report ? (
          <>
            {report.packs.length > 0 ? (
              <ul className="mfbe-settings-ocr-list" data-testid="settings-ocr-languages-list">
                {report.packs.map((pack) => {
                  const label = t(`ocr.languages.${pack.code}`, {
                    defaultValue: pack.code.toUpperCase(),
                  });
                  const checked = enabledLanguages.includes(pack.code);
                  return (
                    <li
                      key={pack.code}
                      className="mfbe-settings-ocr-item"
                      data-testid={`settings-ocr-lang-row-${pack.code}`}
                    >
                      <label className="mfbe-check-field">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => toggleLanguage(pack.code, event.target.checked)}
                          data-testid={`settings-ocr-lang-${pack.code}`}
                        />
                        <span>
                          {label} ({pack.code})
                        </span>
                      </label>
                      <span className="mfbe-settings-ocr-meta">
                        <span className="mfbe-settings-note" data-role="layer">
                          {t(`ocr.settings.layer.${pack.layer}`, { defaultValue: pack.layer })}
                        </span>
                        <span className="mfbe-settings-note" data-role="size">
                          {formatPackSize(pack.sizeBytes, t)}
                        </span>
                        {pack.overridesBundled ? (
                          <span
                            className="mfbe-settings-ocr-override"
                            data-role="override"
                            data-testid={`settings-ocr-override-${pack.code}`}
                          >
                            {t('ocr.settings.overridesBundled')}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mfbe-settings-note" data-testid="settings-ocr-empty">
                {t('ocr.settings.noPacksInstalled')}
              </div>
            )}
            {!report.osdAvailable ? (
              <div className="mfbe-settings-ai-warning" data-testid="settings-ocr-osd-missing">
                {t('ocr.settings.osdMissing')}
              </div>
            ) : null}
            {report.passedOver.length > 0 ? (
              <>
                <div className="mfbe-settings-note">{t('ocr.settings.passedOverHeading')}</div>
                <ul className="mfbe-settings-list" data-testid="settings-ocr-passed-over">
                  {report.passedOver.map((item) => (
                    <li key={`${item.layer}:${item.path}`}>
                      {t('ocr.settings.passedOverItem', {
                        name: fileNameOf(item.path),
                        reason: t(`ocr.settings.passedOverReason.${item.reason}`, {
                          defaultValue: item.reason,
                        }),
                      })}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        ) : (
          <div className="mfbe-settings-note" data-testid="settings-ocr-unavailable">
            {reportKnown || !rpc ? t('ocr.settings.unavailable') : t('dialog.settings.loading')}
          </div>
        )}
      </GroupBox>
    </div>
  );
}
