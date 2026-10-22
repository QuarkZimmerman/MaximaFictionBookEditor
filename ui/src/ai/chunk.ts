/**
 * The entry module of the lazy `ai-assistant` chunk (feature 005; research R8.4, review B2):
 * the one module `ui/src/ai/index.ts` imports with `import()` on the first turn-on. It bundles
 * the assistant's surface (`assistant.ts` - the request loop, the on/off helpers, the popup
 * opener) with the panel component (`AiPanel.tsx`), so that the main bundle reaches the whole
 * chunk through a single dynamic import and nothing of it is requested while the assistant is
 * off or disabled (SC-013; `tests/unit/ai/chunk.test.ts` counts the imports).
 */

export * from './assistant';
export { AiPanel } from './AiPanel';
