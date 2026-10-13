/**
 * About dialog (T149, FR-126) after the original `IDD_ABOUTBOX`: product name and version,
 * build stamp, platform and browser engine (CEF / Chromium) from `app.info`, the repository
 * link, the licence (MIT) and "Open log folder" (FR-131, `app.openLogFolder`). No credits and
 * no personal names anywhere (requester decision, 2026-10-13).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type AppInfo } from '@/rpc/types';

import { Dialog, type DialogButton } from './Dialog';

import './about.css';

export const REPOSITORY_URL = 'https://github.com/QuarkZimmerman/MaximaFictionBookEditor';

export interface AboutDialogProps {
  ctx: CommandContext;
  onClose: () => void;
}

/** The optional engine fields the shell may add to `app.info` (not part of the typed contract). */
interface EngineInfo {
  cefVersion?: string;
  chromiumVersion?: string;
}

/** Chromium version from the user agent when the shell did not report one. */
function chromiumVersionFromUserAgent(userAgent: string): string | undefined {
  const match = /(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(userAgent);
  return match ? match[1] : undefined;
}

export function AboutDialog({ ctx, onClose }: AboutDialogProps) {
  const { t } = useTranslation();
  const { rpc } = ctx;
  const [info, setInfo] = useState<(AppInfo & EngineInfo) | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    rpc
      .call('app.info')
      .then((result) => {
        if (!cancelled) setInfo(result as AppInfo & EngineInfo);
      })
      .catch(() => {
        // the dialog shows what it knows locally
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const version = info?.version ?? ctx.version;
  const chromium =
    info?.chromiumVersion ??
    (typeof navigator !== 'undefined'
      ? chromiumVersionFromUserAgent(navigator.userAgent)
      : undefined);
  const engine = [
    info?.cefVersion ? `CEF ${info.cefVersion}` : null,
    chromium ? `Chromium ${chromium}` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  const openLogFolder = async () => {
    if (!rpc || opening) return;
    setOpening(true);
    try {
      await rpc.call('app.openLogFolder');
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.dialogUnavailable) {
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderUnavailable', {
            path: info?.logDir ?? t('dialog.about.logFolderUnknown'),
          }),
          caption: t('dialog.about.caption'),
          icon: 'info',
          testId: 'dialog-folder-unavailable',
        });
      } else if (error instanceof RpcError) {
        const data = error.data as { reason?: string } | undefined;
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderFailed', { reason: data?.reason ?? error.message }),
          caption: t('dialog.error.caption'),
          icon: 'error',
          testId: 'dialog-folder-failed',
        });
      } else {
        throw error;
      }
    } finally {
      setOpening(false);
    }
  };

  const buttons: DialogButton[] = [
    { id: 'close', label: t('dialog.buttons.close'), onClick: onClose },
  ];

  return (
    <Dialog
      title={t('dialog.about.caption')}
      buttons={buttons}
      defaultButtonId="close"
      cancelButtonId="close"
      testId="dialog-about"
      className="mfbe-aboutdialog"
      closeLabel={t('dialog.buttons.close')}
    >
      <div className="mfbe-about">
        <div className="mfbe-about-mark" aria-hidden="true">
          {t('app.shortName')}
        </div>
        <div className="mfbe-about-main">
          <h2 className="mfbe-about-name" data-testid="about-name">
            {t('app.name')}
          </h2>
          <div data-testid="about-version">
            {version ? t('dialog.about.version', { version }) : t('dialog.about.versionUnknown')}
          </div>
          <dl className="mfbe-about-facts">
            <dt>{t('dialog.about.build')}</dt>
            <dd data-testid="about-build">{info?.build || t('dialog.about.buildUnknown')}</dd>
            {info?.platform ? (
              <>
                <dt>{t('dialog.about.platform')}</dt>
                <dd data-testid="about-platform">{info.platform}</dd>
              </>
            ) : null}
            {engine ? (
              <>
                <dt>{t('dialog.about.engine')}</dt>
                <dd data-testid="about-engine">{engine}</dd>
              </>
            ) : null}
            {info?.apiVersion !== undefined ? (
              <>
                <dt>{t('dialog.about.apiVersion')}</dt>
                <dd data-testid="about-api-version">{String(info.apiVersion)}</dd>
              </>
            ) : null}
          </dl>
          <div className="mfbe-about-link">
            {t('dialog.about.repository')}{' '}
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="about-repository"
            >
              {REPOSITORY_URL}
            </a>
          </div>
          <div data-testid="about-licence">{t('dialog.about.licence')}</div>
        </div>
        <p className="mfbe-about-note">
          {t('dialog.about.licenceNote')} {t('dialog.about.dictionaryLicences')}
        </p>
        <div className="mfbe-about-log">
          <button
            type="button"
            className="mfbe-button"
            disabled={!rpc || opening}
            onClick={() => void openLogFolder()}
            data-testid="about-open-log-folder"
          >
            {t('dialog.about.openLogFolder')}
          </button>
          <span className="mfbe-settings-note" data-testid="about-log-folder">
            {t('dialog.about.logFolder')} {info?.logDir ?? t('dialog.about.logFolderUnknown')}
          </span>
        </div>
      </div>
    </Dialog>
  );
}
