/**
 * About dialog (T149, FR-126) after the original `IDD_ABOUTBOX`: product name and version,
 * build stamp, platform and browser engine (CEF / Chromium) from `app.info`, the repository
 * and Maxima Library links (opened in the system browser), "Open log folder" (FR-131, `app.openLogFolder`), and the notices of the GNU GPL
 * version 3 (feature 002, FR-095 to FR-098): the licence, the copyright line, no warranty,
 * where to read the licence, and - in a scrollable read-only box, as the original showed its
 * `contributors.txt` (`IDC_CONTRIBS`) - the original's contributor notice word for word.
 *
 * Spelling dictionaries (feature 003, FR-004 / FR-033): every dictionary of
 * `spell.dictionaries()` - built in or found in the user, portable or chosen folder - is listed
 * with its tag and origin, and its `<tag>.txt` notice (`spell.dictionaryLicense`) is shown in a
 * second scrollable box, one section per dictionary (`about-dictionary-<tag>`).
 */

import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { RpcError, type RpcClient } from '@/rpc/client';
import { RpcErrorCode, type AppInfo } from '@/rpc/types';

import { Dialog, type DialogButton } from './Dialog';

import './about.css';

import contributorsNotice from '../../../CONTRIBUTORS.txt?raw';

export const REPOSITORY_URL = 'https://github.com/QuarkZimmerman/MaximaFictionBookEditor';
export const MAXIMA_LIBRARY_URL = 'https://www.maxima-library.com';
export const LICENCE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html';

/** The original's contributor notice as its About dialog showed it (without the final newline). */
const CONTRIBUTORS_TEXT = contributorsNotice.replace(/\r?\n$/, '');

export interface AboutDialogProps {
  ctx: CommandContext;
  onClose: () => void;
}

/** The optional engine fields the shell may add to `app.info` (not part of the typed contract). */
interface EngineInfo {
  cefVersion?: string;
  chromiumVersion?: string;
}

/** A dictionary of `spell.dictionaries()` with the text of its notice file. */
interface DictionaryNotice {
  /** `uk_UA` - the file stem of the `.aff`/`.dic` pair. */
  tag: string;
  /** Resource layer: `bundled`, `user`, `portable` or `settings` (the chosen folder). */
  source: string;
  /** The `<tag>.txt` text without the final newline; empty when the dictionary has none. */
  text: string;
}

/**
 * Origin labels by resource layer (core `resources::LayerName`, `spell.dictionaries().source`);
 * an unknown layer name of a newer core is shown as it is.
 */
const DICTIONARY_SOURCE_KEYS: Readonly<Record<string, string>> = {
  bundled: 'dialog.about.dictionarySource.bundled',
  user: 'dialog.about.dictionarySource.user',
  portable: 'dialog.about.dictionarySource.portable',
  settings: 'dialog.about.dictionarySource.settings',
};

/** Chromium version from the user agent when the shell did not report one. */
function chromiumVersionFromUserAgent(userAgent: string): string | undefined {
  const match = /(?:Chrome|Chromium)\/(\d+(?:\.\d+)*)/.exec(userAgent);
  return match ? match[1] : undefined;
}

/**
 * The dictionaries in effect with their notices, in the core's order (built in first, then the
 * other folders, alphabetically by tag). A notice that cannot be read is shown as absent; a
 * dictionary list the core cannot give rejects (the dialog then says "unknown"). An entry of an
 * older core without `tag` is listed under its `name` (the tag as well, rpc-api.md §3.4).
 */
async function loadDictionaryNotices(rpc: RpcClient): Promise<DictionaryNotice[]> {
  const dictionaries = await rpc.call('spell.dictionaries');
  return Promise.all(
    dictionaries.map(async (dictionary) => {
      const tag = dictionary.tag || dictionary.name;
      let text = '';
      try {
        text = (await rpc.call('spell.dictionaryLicense', { tag })).text ?? '';
      } catch {
        // no notice file (or an older core without the method): the dictionary is still listed
      }
      return { tag, source: dictionary.source, text: text.replace(/\r?\n$/, '') };
    }),
  );
}

export function AboutDialog({ ctx, onClose }: AboutDialogProps) {
  const { t } = useTranslation();
  const { rpc } = ctx;
  const [info, setInfo] = useState<(AppInfo & EngineInfo) | null>(null);
  /** `unknown`: no core, or the core could not list the dictionaries. */
  const [dictionaries, setDictionaries] = useState<DictionaryNotice[] | 'loading' | 'unknown'>(
    rpc ? 'loading' : 'unknown',
  );
  const [opening, setOpening] = useState(false);
  const dictionariesCaptionId = useId();

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
    loadDictionaryNotices(rpc)
      .then((list) => {
        if (!cancelled) setDictionaries(list);
      })
      .catch(() => {
        if (!cancelled) setDictionaries('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const dictionarySource = (source: string): string => {
    const key = DICTIONARY_SOURCE_KEYS[source];
    return key ? t(key) : source;
  };

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
          <div className="mfbe-about-link">
            {t('dialog.about.maximaLibrary')}{' '}
            <a
              href={MAXIMA_LIBRARY_URL}
              target="_blank"
              rel="noreferrer"
              data-testid="about-maxima-library"
            >
              {MAXIMA_LIBRARY_URL}
            </a>
          </div>
          <div data-testid="about-licence">{t('dialog.about.licence')}</div>
          <div data-testid="about-copyright">{t('dialog.about.copyright')}</div>
        </div>
        <p className="mfbe-about-note" data-testid="about-based-on">
          {t('dialog.about.basedOn')}
        </p>
        <textarea
          className="mfbe-about-contributors"
          readOnly
          rows={7}
          value={CONTRIBUTORS_TEXT}
          aria-label={t('dialog.about.contributors')}
          data-testid="about-contributors"
        />
        <p className="mfbe-about-note" data-testid="about-gpl-notice">
          {t('dialog.about.gplNotice')}
        </p>
        <p className="mfbe-about-note" data-testid="about-licence-where">
          {t('dialog.about.licenceWhere')}{' '}
          <a href={LICENCE_URL} target="_blank" rel="noreferrer" data-testid="about-licence-link">
            {LICENCE_URL}
          </a>
          . {t('dialog.about.thirdParty')}
        </p>
        <p
          className="mfbe-about-note"
          id={dictionariesCaptionId}
          data-testid="about-dictionaries-caption"
        >
          {t('dialog.about.dictionaries')}
          {dictionaries === 'unknown' ? ` ${t('dialog.about.dictionariesUnknown')}` : null}
          {Array.isArray(dictionaries) && dictionaries.length === 0
            ? ` ${t('dialog.about.dictionariesNone')}`
            : null}
        </p>
        {Array.isArray(dictionaries) && dictionaries.length > 0 ? (
          <div
            className="mfbe-about-notices"
            role="region"
            tabIndex={0}
            aria-labelledby={dictionariesCaptionId}
            data-testid="about-dictionaries"
          >
            {dictionaries.map((dictionary) => (
              <section
                key={dictionary.tag}
                className="mfbe-about-dictionary"
                data-testid={`about-dictionary-${dictionary.tag}`}
              >
                <h3 className="mfbe-about-dictionary-title">
                  <span data-testid={`about-dictionary-${dictionary.tag}-tag`}>
                    {dictionary.tag}
                  </span>
                  {' ('}
                  <span
                    className="mfbe-about-dictionary-source"
                    data-testid={`about-dictionary-${dictionary.tag}-source`}
                  >
                    {dictionarySource(dictionary.source)}
                  </span>
                  {')'}
                </h3>
                {dictionary.text ? (
                  <pre
                    className="mfbe-about-dictionary-text"
                    data-testid={`about-dictionary-${dictionary.tag}-notice`}
                  >
                    {dictionary.text}
                  </pre>
                ) : (
                  <p
                    className="mfbe-about-dictionary-text mfbe-about-dictionary-none"
                    data-testid={`about-dictionary-${dictionary.tag}-notice`}
                  >
                    {t('dialog.about.dictionaryNoNotice')}
                  </p>
                )}
              </section>
            ))}
          </div>
        ) : null}
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
