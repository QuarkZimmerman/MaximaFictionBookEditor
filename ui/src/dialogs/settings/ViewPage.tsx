/**
 * Settings > View (T129) after `IDD_SETTINGS_VIEW`: Common (interface language, theme), Body
 * (editor font, size, text colour, background, Fast Mode), XML source editor (font, wrap,
 * syntax highlighting, end-of-line marks, white spaces, line numbers, matched tags, tag
 * completion - feature 003) and Spellcheck (use, highlight, custom dictionary path with a
 * "Browse..." button through `dialog.openFile`; feature 003 US4: the "Dictionaries folder"
 * choice - default / chosen folder with "..." through `dialog.pickFolder` - "Open dictionaries
 * folder", and the report of `spell.dictionaryReport`: the dictionaries in effect with their
 * origin, the files that cannot be used with the reason, a chosen folder that is missing or
 * unreadable). The theme (System / Light / Dark) is applied as soon as the settings are saved
 * (OK / Apply), like the other fields; the Body colours follow the theme while they are the
 * defaults (black on white).
 *
 * The dictionaries folder is the setting `other.dictionariesFolder`, although its controls sit
 * in the spell-check group of this page: the dialog passes `onChangeOther` for it, next to the
 * `onChange` of the `view` section. The report shows the saved state - refreshed when this page
 * opens and, through the settings runtime, after every applied change.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { dictionaryFileTypes } from '@/dialogs/fileTypes';
import { getSpellFeature } from '@/features/spell';
import { RpcError } from '@/rpc/client';
import {
  RpcErrorCode,
  type Settings,
  type ThemeSetting,
  type UiLanguageSetting,
} from '@/rpc/types';
import { parseSourceFont } from '@/views/source/extensions';

import { CheckField, ColorField, FieldRow, GroupBox, NumberField, SuggestInput } from './controls';
import {
  BODY_FONT_SIZE_RANGE,
  BODY_FONT_SUGGESTIONS,
  LANGUAGE_OPTIONS,
  SOURCE_FONT_SUGGESTIONS,
  THEME_OPTIONS,
  composeSourceFont,
  dictionariesFolderProblem,
  dictionaryOriginLabel,
  dictionaryRejectionText,
  parseIntegerField,
  themeOf,
} from './model';

export interface ViewPageProps {
  draft: Settings;
  onChange: (patch: Partial<Settings['view']>) => void;
  /**
   * Edits the `other` section of the draft: the dictionaries folder (`other.dictionariesFolder`,
   * feature 003 US4) is chosen on this page. Without it the folder choice is shown read-only.
   */
  onChangeOther?: (patch: Partial<Settings['other']>) => void;
  ctx: CommandContext;
}

export function ViewPage({ draft, onChange, onChangeOther, ctx }: ViewPageProps) {
  const { t } = useTranslation();
  const view = draft.view;
  const [fontSizeText, setFontSizeText] = useState(String(view.bodyFontSize));
  const sourceFont = parseSourceFont(view.sourceFont);
  const [sourceFamily, setSourceFamily] = useState(unquote(sourceFont.family ?? ''));
  const [sourceSizeText, setSourceSizeText] = useState(
    sourceFont.size === null ? '' : String(sourceFont.size),
  );

  const updateSourceFont = (family: string, sizeText: string) => {
    const size = sizeText.trim() === '' ? null : parseIntegerField(sizeText);
    onChange({
      sourceFont: composeSourceFont(family, size !== null && Number.isFinite(size) ? size : null),
    });
  };

  const browseDictionary = async () => {
    if (!ctx.rpc) return;
    try {
      // The current dictionary is proposed, as in the original.
      const current = view.customDictionaryPath.trim();
      const { paths } = await ctx.rpc.call('dialog.openFile', {
        title: t('dialog.settings.view.chooseDictionary'),
        filters: dictionaryFileTypes(t),
        selectedFilter: 0,
        ...(current ? { defaultPath: current } : {}),
      });
      if (paths[0]) onChange({ customDictionaryPath: paths[0] });
    } catch (error) {
      if (error instanceof RpcError && error.code === RpcErrorCode.dialogUnavailable) {
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderUnavailable', { path: view.customDictionaryPath || '—' }),
          caption: t('app.name'),
          icon: 'info',
          testId: 'dialog-folder-unavailable',
        });
        return;
      }
      throw error;
    }
  };

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-view">
      <GroupBox title={t('dialog.settings.view.common')}>
        <FieldRow label={t('dialog.settings.view.language')} htmlFor="settings-view-language">
          <select
            id="settings-view-language"
            value={view.uiLanguage}
            onChange={(event) => onChange({ uiLanguage: event.target.value as UiLanguageSetting })}
            data-testid="settings-view-language"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label={t('dialog.settings.view.theme')} htmlFor="settings-view-theme">
          <select
            id="settings-view-theme"
            value={themeOf(view)}
            onChange={(event) => onChange({ theme: event.target.value as ThemeSetting })}
            data-testid="settings-view-theme"
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </FieldRow>
      </GroupBox>

      <GroupBox title={t('dialog.settings.view.body')}>
        <FieldRow label={t('dialog.settings.view.editorFont')} htmlFor="settings-view-body-font">
          <SuggestInput
            id="settings-view-body-font"
            listId="settings-view-body-font-list"
            value={view.bodyFont}
            suggestions={BODY_FONT_SUGGESTIONS}
            placeholder={t('dialog.settings.view.fontDefault')}
            onChange={(value) => onChange({ bodyFont: value })}
            testId="settings-view-body-font"
          />
        </FieldRow>
        <FieldRow label={t('dialog.settings.view.fontSize')} htmlFor="settings-view-body-font-size">
          <NumberField
            id="settings-view-body-font-size"
            value={fontSizeText}
            min={BODY_FONT_SIZE_RANGE.min}
            max={BODY_FONT_SIZE_RANGE.max}
            onChange={(text) => {
              setFontSizeText(text);
              onChange({ bodyFontSize: parseIntegerField(text) });
            }}
            testId="settings-view-body-font-size"
          />
          <span className="mfbe-settings-note">{t('dialog.settings.view.fontSizeHint')}</span>
        </FieldRow>
        <div className="mfbe-settings-columns">
          <FieldRow label={t('dialog.settings.view.textColor')} htmlFor="settings-view-text-color">
            <ColorField
              id="settings-view-text-color"
              value={view.bodyTextColor}
              onChange={(value) => onChange({ bodyTextColor: value })}
              testId="settings-view-text-color"
            />
          </FieldRow>
          <FieldRow label={t('dialog.settings.view.background')} htmlFor="settings-view-background">
            <ColorField
              id="settings-view-background"
              value={view.bodyBackground}
              onChange={(value) => onChange({ bodyBackground: value })}
              testId="settings-view-background"
            />
          </FieldRow>
        </div>
        <span className="mfbe-settings-note" data-testid="settings-view-colors-hint">
          {t('dialog.settings.view.themeColorsHint')}
        </span>
        <CheckField
          label={t('dialog.settings.view.fastMode')}
          checked={view.fastMode}
          onChange={(checked) => onChange({ fastMode: checked })}
          testId="settings-view-fast-mode"
        />
      </GroupBox>

      <GroupBox title={t('dialog.settings.view.sourceEditor')}>
        <FieldRow label={t('dialog.settings.view.editorFont')} htmlFor="settings-view-source-font">
          <SuggestInput
            id="settings-view-source-font"
            listId="settings-view-source-font-list"
            value={sourceFamily}
            suggestions={SOURCE_FONT_SUGGESTIONS}
            placeholder={t('dialog.settings.view.fontDefault')}
            onChange={(value) => {
              setSourceFamily(value);
              updateSourceFont(value, sourceSizeText);
            }}
            testId="settings-view-source-font"
          />
          <label className="mfbe-settings-label" htmlFor="settings-view-source-font-size">
            {t('dialog.settings.view.sourceFontSize')}
          </label>
          <NumberField
            id="settings-view-source-font-size"
            value={sourceSizeText}
            min={BODY_FONT_SIZE_RANGE.min}
            max={BODY_FONT_SIZE_RANGE.max}
            onChange={(text) => {
              setSourceSizeText(text);
              updateSourceFont(sourceFamily, text);
            }}
            testId="settings-view-source-font-size"
            allowEmpty
          />
        </FieldRow>
        <div className="mfbe-settings-checks">
          <CheckField
            label={t('dialog.settings.view.wrap')}
            checked={view.sourceWrap}
            onChange={(checked) => onChange({ sourceWrap: checked })}
            testId="settings-view-source-wrap"
          />
          <CheckField
            label={t('dialog.settings.view.showWhitespace')}
            checked={view.sourceShowWhitespace}
            onChange={(checked) => onChange({ sourceShowWhitespace: checked })}
            testId="settings-view-source-whitespace"
          />
          <CheckField
            label={t('dialog.settings.view.syntaxHighlight')}
            checked={view.sourceSyntaxHighlight}
            onChange={(checked) => onChange({ sourceSyntaxHighlight: checked })}
            testId="settings-view-source-highlight"
          />
          <CheckField
            label={t('dialog.settings.view.lineNumbers')}
            checked={view.sourceLineNumbers}
            onChange={(checked) => onChange({ sourceLineNumbers: checked })}
            testId="settings-view-source-line-numbers"
          />
          <CheckField
            label={t('dialog.settings.view.showEol')}
            checked={view.sourceShowEol}
            onChange={(checked) => onChange({ sourceShowEol: checked })}
            testId="settings-view-source-eol"
          />
          <CheckField
            label={t('dialog.settings.view.matchTags')}
            checked={view.sourceMatchTags}
            onChange={(checked) => onChange({ sourceMatchTags: checked })}
            testId="settings-view-source-match-tags"
          />
          <CheckField
            label={t('dialog.settings.view.tagCompletion')}
            checked={view.sourceTagCompletion ?? true}
            onChange={(checked) => onChange({ sourceTagCompletion: checked })}
            testId="settings-view-source-tag-completion"
          />
        </div>
      </GroupBox>

      <GroupBox title={t('dialog.settings.view.spellcheck')}>
        <div className="mfbe-settings-checks">
          <CheckField
            label={t('dialog.settings.view.useSpellchecker')}
            checked={view.spellEnabled}
            onChange={(checked) => onChange({ spellEnabled: checked })}
            testId="settings-view-spell-enabled"
          />
          <CheckField
            label={t('dialog.settings.view.highlightMisspelled')}
            checked={view.spellHighlight}
            disabled={!view.spellEnabled}
            onChange={(checked) => onChange({ spellHighlight: checked })}
            testId="settings-view-spell-highlight"
          />
        </div>
        <FieldRow
          label={t('dialog.settings.view.customDictionary')}
          htmlFor="settings-view-custom-dictionary"
        >
          <input
            id="settings-view-custom-dictionary"
            className="mfbe-inputdialog-input"
            type="text"
            value={view.customDictionaryPath}
            spellCheck={false}
            onChange={(event) => onChange({ customDictionaryPath: event.target.value })}
            data-testid="settings-view-custom-dictionary"
          />
          <button
            type="button"
            className="mfbe-button mfbe-settings-browse"
            disabled={!ctx.rpc}
            title={t('dialog.settings.browse')}
            onClick={() => void browseDictionary()}
            data-testid="settings-view-custom-dictionary-browse"
          >
            ...
          </button>
        </FieldRow>
        <DictionariesSection
          value={draft.other.dictionariesFolder ?? ''}
          onApply={onChangeOther ? (path) => onChangeOther({ dictionariesFolder: path }) : null}
          ctx={ctx}
        />
      </GroupBox>
    </div>
  );
}

function unquote(family: string): string {
  return family.replace(/^["']|["']$/g, '');
}

/* ------------------------------------------------------------------------ */
/* Dictionaries folder and report (feature 003 US4)                        */
/* ------------------------------------------------------------------------ */

/**
 * "Dictionaries folder" (default / chosen, "...", "Open dictionaries folder") and the report:
 * the dictionaries in effect with their origin, the files that cannot be used, a chosen folder
 * that is missing or unreadable. `onApply` is null when the dialog gave no way to edit the
 * `other` section (the choice is then read-only). The report is the spell feature's: fetched
 * when the section mounts and whenever the settings runtime refreshes it after Apply.
 */
function DictionariesSection({
  value,
  onApply,
  ctx,
}: {
  /** The draft setting `other.dictionariesFolder`: '' = default folder. */
  value: string;
  onApply: ((path: string) => void) | null;
  ctx: CommandContext;
}) {
  const { t } = useTranslation();
  const rpc = ctx.rpc;
  const editable = onApply !== null;
  // A chosen folder whose path is still empty is kept as a UI state (saved as the default).
  const [custom, setCustom] = useState(value !== '');
  const useDefault = !custom && value === '';
  const [reportKnown, setReportKnown] = useState(false);

  // The spell feature owns the report (one per store); this section follows it.
  const feature = getSpellFeature(ctx.store);
  const subscribeReport = useCallback(
    (listener: () => void) =>
      feature.checker.subscribe((event) => {
        if (event === 'report') listener();
      }),
    [feature],
  );
  const report = useSyncExternalStore(subscribeReport, () => feature.checker.report);

  useEffect(() => {
    let cancelled = false;
    void feature.refreshDictionaries(rpc).then(() => {
      if (!cancelled) setReportKnown(true);
    });
    return () => {
      cancelled = true;
    };
  }, [feature, rpc]);

  const reportFolderError = async (error: unknown) => {
    if (error instanceof RpcError) {
      if (error.code === RpcErrorCode.dialogUnavailable) {
        await ctx.dialogs.showMessage({
          text: t('msg.openFolderUnavailable', { path: value || '—' }),
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

  const browse = async () => {
    if (!rpc || !onApply) return;
    try {
      const { path } = await rpc.call('dialog.pickFolder', {
        title: t('dialog.settings.view.chooseDictionariesFolder'),
      });
      if (path) {
        setCustom(true);
        onApply(path);
      }
    } catch (error) {
      await reportFolderError(error);
    }
  };

  const openFolder = async () => {
    if (!rpc) return;
    try {
      await rpc.call('resources.openDictionariesFolder');
    } catch (error) {
      await reportFolderError(error);
    }
  };

  // The chosen folder of the saved settings, when it cannot be used (the default is used then).
  const folderProblem = report ? dictionariesFolderProblem(report.folders, t) : null;

  return (
    <div className="mfbe-settings-dictionaries" data-testid="settings-view-dictionaries">
      <FieldRow label={t('dialog.settings.view.dictionariesFolder')}>
        <label className="mfbe-check-field" htmlFor="settings-view-dictionaries-default">
          <input
            id="settings-view-dictionaries-default"
            type="radio"
            name="settings-view-dictionaries-folder"
            checked={useDefault}
            disabled={!editable}
            onChange={() => {
              setCustom(false);
              onApply?.('');
            }}
            data-testid="settings-view-dictionaries-default"
          />
          <span>{t('dialog.settings.view.dictionariesFolderDefault')}</span>
        </label>
        <label className="mfbe-check-field" htmlFor="settings-view-dictionaries-custom">
          <input
            id="settings-view-dictionaries-custom"
            type="radio"
            name="settings-view-dictionaries-folder"
            checked={!useDefault}
            disabled={!editable}
            onChange={() => setCustom(true)}
            data-testid="settings-view-dictionaries-custom"
          />
          <span>{t('dialog.settings.view.dictionariesFolderCustom')}</span>
        </label>
      </FieldRow>
      <div className="mfbe-settings-row">
        <input
          id="settings-view-dictionaries-path"
          className="mfbe-inputdialog-input"
          type="text"
          value={value}
          disabled={useDefault || !editable}
          spellCheck={false}
          aria-label={t('dialog.settings.view.dictionariesFolderCustom')}
          onChange={(event) => onApply?.(event.target.value)}
          data-testid="settings-view-dictionaries-path"
        />
        <button
          type="button"
          className="mfbe-button mfbe-settings-browse"
          disabled={!rpc || useDefault || !editable}
          title={t('dialog.settings.browse')}
          onClick={() => void browse()}
          data-testid="settings-view-dictionaries-browse"
        >
          ...
        </button>
        <button
          type="button"
          className="mfbe-button"
          disabled={!rpc}
          onClick={() => void openFolder()}
          data-testid="settings-view-dictionaries-open"
        >
          {t('dialog.settings.view.openDictionariesFolder')}
        </button>
      </div>
      {folderProblem ? (
        <div className="mfbe-settings-note" data-testid="settings-view-dictionaries-folder-problem">
          {folderProblem}
        </div>
      ) : null}
      {report ? (
        <>
          <div className="mfbe-settings-note">{t('dialog.settings.view.dictionariesInEffect')}</div>
          {report.dictionaries.length > 0 ? (
            <ul className="mfbe-settings-list" data-testid="settings-view-dictionaries-list">
              {report.dictionaries.map((dictionary, index) => {
                const tag = dictionary.tag ?? dictionary.name;
                return (
                  <li key={`${tag}-${index}`} data-testid={`settings-view-dictionary-${tag}`}>
                    <span data-role="tag">{tag}</span>{' '}
                    <span className="mfbe-settings-note" data-role="origin">
                      {dictionaryOriginLabel(dictionary.source, t)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mfbe-settings-note" data-testid="settings-view-dictionaries-list">
              {t('spell.dialog.noDictionaries')}
            </div>
          )}
          {report.rejected.length > 0 ? (
            <>
              <div className="mfbe-settings-note">
                {t('dialog.settings.view.dictionariesRejected')}
              </div>
              <ul className="mfbe-settings-list" data-testid="settings-view-dictionaries-rejected">
                {report.rejected.map((rejected) => (
                  <li key={rejected.path}>
                    <span data-role="path">{rejected.path}</span>
                    {' \u2014 '}
                    <span data-role="reason">{dictionaryRejectionText(rejected, t)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : (
        <div className="mfbe-settings-note" data-testid="settings-view-dictionaries-unknown">
          {reportKnown || !rpc
            ? t('dialog.settings.view.dictionariesUnknown')
            : t('dialog.settings.loading')}
        </div>
      )}
    </div>
  );
}
