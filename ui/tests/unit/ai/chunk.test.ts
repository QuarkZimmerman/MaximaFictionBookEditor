// @vitest-environment node
/**
 * The lazy `ai-assistant` chunk (feature 005 T004 / T031; research R8.4, review B2; SC-013):
 * the folder rule of vite.config.ts and the two outputs of a production build - `index-*.js`
 * and `ai-assistant-*.js` - where the main bundle reaches the chunk through one dynamic
 * `import()` only and the chunk imports the shared code (the store, React) from the main
 * bundle, never the other way round. The build goes to a temporary folder; `dist/` is untouched.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';

import { isAiAssistantModule } from '../../../vite.config';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const AI = path.join(UI_ROOT, 'src', 'ai');
const NODE_MODULES = path.join(UI_ROOT, 'node_modules');

describe('the ai-assistant chunk rule', () => {
  it('captures every module under src/ai/ but the static set, and the MCP SDK packages', () => {
    for (const file of ['index.ts', 'address.ts', 'agreements.ts', 'testHooks.ts']) {
      expect(isAiAssistantModule(path.join(AI, file)), file).toBe(false);
    }
    for (const file of [
      'assistant.ts',
      'catalogue.ts',
      'AiPanel.tsx',
      'notice.tsx',
      'tools/find.ts',
    ]) {
      expect(isAiAssistantModule(path.join(AI, file)), file).toBe(true);
    }
    // A query suffix and Windows separators do not change the answer.
    expect(isAiAssistantModule(`${path.join(AI, 'assistant.ts')}?v=1`)).toBe(true);
    expect(isAiAssistantModule(path.join(AI, 'index.ts').replace(/\//g, '\\'))).toBe(false);
    // The SDK, zod and their transitives; nothing else of node_modules.
    for (const pkg of [
      '@modelcontextprotocol/server/dist/index.js',
      '@modelcontextprotocol/client/dist/index.js',
      'zod/index.js',
      'jose/dist/index.js',
      'eventsource-parser/dist/index.js',
    ]) {
      expect(isAiAssistantModule(path.join(NODE_MODULES, pkg)), pkg).toBe(true);
    }
    for (const pkg of [
      'react/index.js',
      'react-dom/client.js',
      'i18next/dist/esm/i18next.js',
      'zod-like/index.js',
    ]) {
      expect(isAiAssistantModule(path.join(NODE_MODULES, pkg)), pkg).toBe(false);
    }
    // The rest of the UI stays in the main bundle - the settings page included.
    expect(
      isAiAssistantModule(path.join(UI_ROOT, 'src', 'dialogs', 'settings', 'AiPage.tsx')),
    ).toBe(false);
    expect(isAiAssistantModule(path.join(UI_ROOT, 'src', 'model', 'store.ts'))).toBe(false);
  });
});

describe('the production build', () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-chunk-'));
    await build({
      root: UI_ROOT,
      configFile: path.join(UI_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false, write: true },
    });
  }, 120_000);

  afterAll(() => {
    if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  });

  it('emits index-*.js and one ai-assistant-*.js that the main bundle imports lazily only', () => {
    const assets = readdirSync(path.join(outDir, 'assets'));
    const scripts = assets.filter((name) => name.endsWith('.js'));
    const index = scripts.filter((name) => /^index-[\w-]+\.js$/.test(name));
    const chunk = scripts.filter((name) => /^ai-assistant-[\w-]+\.js$/.test(name));
    expect(index).toHaveLength(1);
    expect(chunk).toHaveLength(1);

    const indexSource = readFileSync(path.join(outDir, 'assets', index[0]!), 'utf8');
    const chunkSource = readFileSync(path.join(outDir, 'assets', chunk[0]!), 'utf8');
    const chunkRef = `./${chunk[0]}`;
    // The main bundle reaches the chunk through dynamic imports only - the registrar's
    // `import('./assistant')` on the first turn-on and the settings page's `import('@/ai/notice')`
    // when a first-use notice is due (T035) - every one of them naming the one chunk; never a
    // static import.
    const dynamicImports =
      indexSource.match(/import\((["'`])\.\/ai-assistant-[\w-]+\.js\1\)/g) ?? [];
    expect(dynamicImports).toHaveLength(2);
    for (const dynamicImport of dynamicImports) expect(dynamicImport).toContain(chunkRef);
    expect(indexSource).not.toMatch(/from\s*["'`]\.\/ai-assistant-/);
    expect(indexSource).not.toMatch(/import\s*["'`]\.\/ai-assistant-/);
    // The chunk imports the shared code from the main bundle - no store, no React - and holds
    // the request loop, the catalogue with the MCP SDK and zod, the popup and the notice:
    // about 515 kB minified (T046/T047); the bound catches a second copy of the main bundle.
    expect(chunkSource).toMatch(
      new RegExp(`from\\s*["'\`]\\./${index[0]!.replace('.', '\\.')}["'\`]`),
    );
    expect(chunkSource).not.toContain('react.transitional.element');
    expect(chunkSource).not.toContain('setTreeWidth');
    expect(chunkSource.length).toBeLessThan(600_000);
    // The page loads the main bundle only: no script tag and no modulepreload for the chunk.
    const html = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(html).toContain(index[0]);
    expect(html).not.toContain('ai-assistant-');
  }, 30_000);
});
