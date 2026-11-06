/**
 * The requester's smoke test of 0.0.7-rc.6: the custom service's address offers the well-known
 * services under a button beside the field. A choice fills the address in, the field stays
 * editable, and a typed address is what Save keeps.
 */
import { expect, test } from './fixtures/core';
import { pageText } from './fixtures/i18n';

test.describe('the AI assistant: well-known service addresses', () => {
  test('a preset fills the address; a typed address is saved and the presets stay', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    await core.openApp(page);
    await expect(page.getByTestId('status-message')).toHaveText(
      await pageText(page, 'status.ready'),
    );
    const openAiPage = async () => {
      await page.getByTestId('menu-tools').click();
      await page.getByTestId('menu-tools-settings').click();
      await expect(page.getByTestId('dialog-settings')).toBeVisible();
      await page.getByTestId('settings-tab-ai').click();
      await expect(page.getByTestId('settings-page-ai')).toBeVisible();
    };
    await openAiPage();
    await page.getByTestId('settings-ai-mode-custom').check();
    const address = page.getByTestId('settings-ai-address');
    await page.getByTestId('settings-ai-address-presets').click();
    const menu = page.getByTestId('settings-ai-address-presets-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('OpenAI');
    await expect(menu).toContainText('Google Gemini');
    await expect(menu).toContainText('xAI Grok');
    await expect(menu).toContainText('OpenRouter');
    await menu.getByText('Anthropic', { exact: false }).click();
    await expect(address).toHaveValue('https://api.anthropic.com/v1');

    // Edited by hand and saved: the typed address is kept, and the presets are still offered.
    await address.fill('https://llm.example.org/v1');
    await page.getByTestId('settings-ai-model').fill('example-model');
    await page.getByTestId('dialog-settings-button-ok').click();
    await expect(page.getByTestId('dialog-settings')).toHaveCount(0);
    await openAiPage();
    await expect(address).toHaveValue('https://llm.example.org/v1');
    await page.getByTestId('settings-ai-address-presets').click();
    await expect(page.getByTestId('settings-ai-address-presets-menu')).toContainText('OpenAI');
  });
});
