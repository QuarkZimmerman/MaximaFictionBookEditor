/**
 * Settings > Other (T130) after `IDD_SETTINGS_OTHER`: Save File (default encoding, Keep
 * Encoding), Open File (Restore Position), Scripts folder (default / custom with "..." through
 * `dialog.pickFolder` and "Open scripts folder"), Genres folder (default / custom, "Open genres
 * folder", the sources of the effective genre list), Dialogs (ask for non-clear image
 * insertion), Images (insert clear images), Paste images as (format, JPEG quality 1-100) and
 * Non-breaking space (display character).
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode, type ImageFormat, type Settings } from '@/rpc/types';

import { CheckField, FieldRow, GroupBox, NumberField } from './controls';
import {
  ENCODING_CHOICES,
  IMAGE_FORMATS,
  JPEG_QUALITY_RANGE,
  NBSP_DISPLAY_CHOICES,
  describeGenreSources,
  genresInfoFrom,
  parseIntegerField,
  type GenresInfo,
} from './model';

export interface OtherPageProps {
  draft: Settings;
  onChange: (patch: Partial<Settings['other']>) => void;
  ctx: CommandContext;
}

export function OtherPage({ draft, onChange, ctx }: OtherPageProps) {
  const { t } = useTranslation();
  const other = draft.other;
  const [qualityText, setQualityText] = useState(String(other.jpegQuality));
  const [genres, setGenres] = useState<GenresInfo | null>(null);
  const rpc = ctx.rpc;

  // The effective genre-list sources (rebuilt by the core on every call).
  useEffect(() => {
    if (!rpc) return;
    let cancelled = false;
    rpc
      .call('resources.genres')
      .then((result) => {
        if (!cancelled) setGenres(genresInfoFrom(result));
      })
      .catch(() => {
        if (!cancelled) setGenres(null);
      });
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const reportFolderError = async (error: unknown, path: string) => {
    if (error instanceof RpcError) {
      if (error.code === RpcErrorCode.dialogUnavailable) {
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderUnavailable', { path: path || '—' }),
          caption: t('app.name'),
          icon: 'info',
          testId: 'dialog-folder-unavailable',
        });
        return;
      }
      if (error.code === RpcErrorCode.methodNotFound || error.code === RpcErrorCode.docIoError) {
        const data = error.data as { reason?: string; path?: string } | undefined;
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

  const pickFolder = async (title: string, apply: (path: string) => void, current: string) => {
    if (!rpc) return;
    try {
      const { path } = await rpc.call('dialog.pickFolder', { title });
      if (path) apply(path);
    } catch (error) {
      await reportFolderError(error, current);
    }
  };

  const openScriptsFolder = async () => {
    if (!rpc) return;
    try {
      // Added by the scripting story; a core without it answers -32601 (reported as a message).
      await rpc.request('resources.openScriptsFolder');
    } catch (error) {
      await reportFolderError(error, other.scriptsFolder);
    }
  };

  const openGenresFolder = async () => {
    if (!rpc) return;
    try {
      await rpc.call('resources.openGenresFolder');
    } catch (error) {
      await reportFolderError(error, other.genresFolder);
    }
  };

  const nbspValue = other.nbspDisplayChar;
  const nbspKnown = NBSP_DISPLAY_CHOICES.some((choice) => choice.value === nbspValue);

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-other">
      <div className="mfbe-settings-columns">
        <GroupBox title={t('dialog.settings.other.saveFile')}>
          <FieldRow
            label={t('dialog.settings.other.defaultEncoding')}
            htmlFor="settings-other-encoding"
          >
            <select
              id="settings-other-encoding"
              value={other.defaultEncoding}
              onChange={(event) => onChange({ defaultEncoding: event.target.value })}
              data-testid="settings-other-encoding"
            >
              {ENCODING_CHOICES.map((encoding) => (
                <option key={encoding} value={encoding}>
                  {encoding}
                </option>
              ))}
            </select>
          </FieldRow>
          <CheckField
            label={t('dialog.settings.other.keepEncoding')}
            checked={other.keepEncoding}
            onChange={(checked) => onChange({ keepEncoding: checked })}
            testId="settings-other-keep-encoding"
          />
        </GroupBox>
        <GroupBox title={t('dialog.settings.other.openFile')}>
          <CheckField
            label={t('dialog.settings.other.restorePosition')}
            checked={other.restorePosition}
            onChange={(checked) => onChange({ restorePosition: checked })}
            testId="settings-other-restore-position"
          />
        </GroupBox>
      </div>

      <FolderGroup
        kind="scripts"
        title={t('dialog.settings.other.scriptsFolder')}
        value={other.scriptsFolder}
        onApply={(path) => onChange({ scriptsFolder: path })}
        onBrowse={(apply) =>
          void pickFolder(t('dialog.chooseScriptsFolder'), apply, other.scriptsFolder)
        }
        openLabel={t('dialog.settings.other.openScriptsFolder')}
        onOpen={() => void openScriptsFolder()}
        connected={rpc !== null}
      />

      <FolderGroup
        kind="genres"
        title={t('dialog.settings.other.genresFolder')}
        value={other.genresFolder}
        onApply={(path) => onChange({ genresFolder: path })}
        onBrowse={(apply) =>
          void pickFolder(t('dialog.settings.other.chooseGenresFolder'), apply, other.genresFolder)
        }
        openLabel={t('dialog.settings.other.openGenresFolder')}
        onOpen={() => void openGenresFolder()}
        connected={rpc !== null}
      />
      <div className="mfbe-settings-note" data-testid="settings-other-genre-sources">
        {genres
          ? t('dialog.settings.other.genreSources', {
              sources: describeGenreSources(genres.effectiveSources, t),
            })
          : t('dialog.settings.other.genreSourcesUnknown')}
        {genres && genres.issues.length > 0 ? (
          <div data-testid="settings-other-genre-issues">
            {t('dialog.settings.other.genreIssues', { count: genres.issues.length })}
          </div>
        ) : null}
      </div>

      <div className="mfbe-settings-columns">
        <GroupBox title={t('dialog.settings.other.dialogs')}>
          <CheckField
            label={t('dialog.settings.other.askNonClearImage')}
            checked={other.askOnNonClearImage}
            onChange={(checked) => onChange({ askOnNonClearImage: checked })}
            testId="settings-other-ask-non-clear"
          />
        </GroupBox>
        <GroupBox title={t('dialog.settings.other.images')}>
          <CheckField
            label={t('dialog.settings.other.insertClearImages')}
            checked={other.insertClearImages}
            onChange={(checked) => onChange({ insertClearImages: checked })}
            testId="settings-other-insert-clear"
          />
        </GroupBox>
      </div>

      <GroupBox title={t('dialog.settings.other.pasteImagesAs')}>
        <div className="mfbe-settings-row">
          <label className="mfbe-settings-label" htmlFor="settings-other-image-format">
            {t('dialog.settings.other.imageFormat')}
          </label>
          <select
            id="settings-other-image-format"
            value={other.pasteImageFormat}
            onChange={(event) => onChange({ pasteImageFormat: event.target.value as ImageFormat })}
            data-testid="settings-other-image-format"
          >
            {IMAGE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))}
          </select>
          <label className="mfbe-settings-label" htmlFor="settings-other-jpeg-quality">
            {t('dialog.settings.other.jpegQuality')}
          </label>
          <NumberField
            id="settings-other-jpeg-quality"
            value={qualityText}
            min={JPEG_QUALITY_RANGE.min}
            max={JPEG_QUALITY_RANGE.max}
            onChange={(text) => {
              setQualityText(text);
              onChange({ jpegQuality: parseIntegerField(text) });
            }}
            testId="settings-other-jpeg-quality"
          />
        </div>
      </GroupBox>

      <GroupBox title={t('dialog.settings.other.nbsp')}>
        <FieldRow label={t('dialog.settings.other.displayChar')} htmlFor="settings-other-nbsp">
          <select
            id="settings-other-nbsp"
            value={nbspValue}
            onChange={(event) => onChange({ nbspDisplayChar: event.target.value })}
            data-testid="settings-other-nbsp"
          >
            {NBSP_DISPLAY_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {t(choice.labelKey)}
              </option>
            ))}
            {nbspKnown ? null : (
              <option value={nbspValue}>{`${nbspValue} (U+${codePointHex(nbspValue)})`}</option>
            )}
          </select>
        </FieldRow>
      </GroupBox>
    </div>
  );
}

function codePointHex(text: string): string {
  const cp = text.codePointAt(0);
  return cp === undefined ? '0000' : cp.toString(16).toUpperCase().padStart(4, '0');
}

/** "Default folder" checkbox + custom path + "..." + "Open ... folder" (scripts and genres). */
function FolderGroup({
  kind,
  title,
  value,
  onApply,
  onBrowse,
  openLabel,
  onOpen,
  connected,
}: {
  kind: 'scripts' | 'genres';
  title: string;
  /** The setting: '' = default folder. */
  value: string;
  onApply: (path: string) => void;
  onBrowse: (apply: (path: string) => void) => void;
  openLabel: string;
  onOpen: () => void;
  connected: boolean;
}) {
  const { t } = useTranslation();
  // A custom folder whose path is still empty is kept as a UI state (saved as the default).
  const [custom, setCustom] = useState(value !== '');
  const useDefault = !custom && value === '';
  return (
    <GroupBox title={title} testId={`settings-other-${kind}-folder`}>
      <CheckField
        label={t('dialog.settings.other.defaultFolder')}
        checked={useDefault}
        onChange={(checked) => {
          setCustom(!checked);
          if (checked) onApply('');
        }}
        testId={`settings-other-${kind}-default`}
      />
      <FieldRow
        label={t('dialog.settings.other.customFolder')}
        htmlFor={`settings-other-${kind}-path`}
      >
        <input
          id={`settings-other-${kind}-path`}
          className="mfbe-inputdialog-input"
          type="text"
          value={value}
          disabled={useDefault}
          spellCheck={false}
          onChange={(event) => onApply(event.target.value)}
          data-testid={`settings-other-${kind}-path`}
        />
        <button
          type="button"
          className="mfbe-button mfbe-settings-browse"
          disabled={!connected || useDefault}
          title={t('dialog.settings.browse')}
          onClick={() =>
            onBrowse((path) => {
              setCustom(true);
              onApply(path);
            })
          }
          data-testid={`settings-other-${kind}-browse`}
        >
          ...
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={!connected}
          onClick={onOpen}
          data-testid={`settings-other-${kind}-open`}
        >
          {openLabel}
        </button>
      </FieldRow>
    </GroupBox>
  );
}
