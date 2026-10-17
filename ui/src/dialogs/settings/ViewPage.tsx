/**
 * Settings > View (T129) after `IDD_SETTINGS_VIEW`: Common (interface language, theme), Body
 * (editor font, size, text colour, background, Fast Mode), XML source editor (font, wrap,
 * syntax highlighting, end-of-line marks, white spaces, line numbers, matched tags, tag
 * completion - feature 003) and Spellcheck (use, highlight, custom dictionary path with a
 * "Browse..." button through `dialog.openFile`). The theme (System / Light / Dark) is applied
 * as soon as the settings are saved (OK / Apply), like the other fields; the Body colours
 * follow the theme while they are the defaults (black on white).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { dictionaryFileTypes } from '@/dialogs/fileTypes';
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
  parseIntegerField,
  themeOf,
} from './model';

export interface ViewPageProps {
  draft: Settings;
  onChange: (patch: Partial<Settings['view']>) => void;
  ctx: CommandContext;
}

export function ViewPage({ draft, onChange, ctx }: ViewPageProps) {
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
      </GroupBox>
    </div>
  );
}

function unquote(family: string): string {
  return family.replace(/^["']|["']$/g, '');
}
