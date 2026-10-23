/**
 * The inert AI assistant panel (feature 005 T100; FR-040 and FR-096 as amended by the requester
 * on 2026-10-23): what the right-hand pane shows while the panel is visible and *Disabled* is
 * chosen in Settings. Part of the **static** set of `src/ai/` (vite.config.ts) - the main bundle
 * renders it without the `ai-assistant` chunk, so nothing of the assistant is loaded while it is
 * disabled (SC-013). Its look follows the live panel (`AiPanel.tsx`) with every control disabled
 * and greyed: the header with the title and the service line, no conversation, the instruction
 * field and Send / Clear / Undo disabled, and a centred notice (`ai-panel-disabled-notice`) that
 * the assistant is disabled and is enabled on the settings page, with a link
 * (`ai-panel-disabled-settings`) that opens Settings → AI assistant. The close button
 * (`ai-panel-close`) hides the panel like the View entry does (FR-040: the visibility is the
 * user's in every mode). The assistant's controls carry `disabled` themselves (no
 * `aria-disabled` on the root: the notice's link and the close button are live). Its styles
 * live in `app/layout.css` (`.mfbe-ai-inert*`), not in the chunk's `ai.css`.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useCommandContext } from '@/app/services';
import { getSettingsFeature } from '@/features/settings/apply';
import { openSettingsDialog } from '@/features/settings/index';
import { actions } from '@/model/store';

import { getAiFeature } from './index';

export function DisabledPanel() {
  const { t } = useTranslation();
  const ctx = useCommandContext();
  const { store } = ctx;

  const openSettings = useCallback(() => {
    const feature = getSettingsFeature(store);
    if (feature) void openSettingsDialog(ctx, feature, { initialPage: 'ai' });
  }, [ctx, store]);

  const close = useCallback(() => {
    const feature = getAiFeature(store);
    if (feature) {
      void feature.close(ctx);
      return;
    }
    actions.setAiPanelVisible(store, false); // a bare render: hidden at once
  }, [ctx, store]);

  return (
    <div className="mfbe-ai-inert" data-testid="ai-panel-disabled" data-inert="true">
      <header className="mfbe-ai-inert-header">
        <div className="mfbe-ai-inert-title">{t('ai.panel.title')}</div>
        <div className="mfbe-ai-inert-service" data-testid="ai-service">
          {t('ai.panel.disabledService')}
        </div>
      </header>
      <div className="mfbe-ai-inert-body" role="status">
        <p className="mfbe-ai-inert-notice" data-testid="ai-panel-disabled-notice">
          <span>{t('ai.panel.disabledNotice')}</span>
          <button
            type="button"
            className="mfbe-ai-inert-link"
            data-testid="ai-panel-disabled-settings"
            onClick={openSettings}
          >
            {t('ai.panel.disabledSettingsLink')}
          </button>
        </p>
      </div>
      <div className="mfbe-ai-inert-composer">
        <textarea
          className="mfbe-ai-inert-input"
          data-testid="ai-input"
          rows={3}
          disabled
          value=""
          readOnly
          aria-label={t('ai.panel.inputLabel')}
          placeholder={t('ai.panel.placeholder')}
        />
        <div className="mfbe-ai-inert-buttons">
          <button type="button" className="mfbe-button" data-testid="ai-send" disabled>
            {t('ai.panel.send')}
          </button>
          <button type="button" className="mfbe-button" data-testid="ai-clear" disabled>
            {t('ai.panel.clear')}
          </button>
          <button type="button" className="mfbe-button" data-testid="ai-undo" disabled>
            {t('ai.panel.undo')}
          </button>
        </div>
      </div>
      <button
        type="button"
        className="mfbe-ai-inert-close"
        data-testid="ai-panel-close"
        aria-label={t('ai.panel.close')}
        title={t('ai.panel.close')}
        onClick={close}
      >
        {'\u00D7'}
      </button>
    </div>
  );
}
