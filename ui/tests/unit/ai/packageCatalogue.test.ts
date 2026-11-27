// @vitest-environment node
/**
 * Feature 022 (T033): Package editing mode description-only AI catalogue verification
 * (contracts/ai-catalogue.md, FR-021).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { PACKAGE_MODE_TOOL_NAMES, TOOL_NAMES } from '@/ai/catalogue';
import { buildWorkingContext, systemPrompt } from '@/ai/context';

import { book, harness, type Harness } from './catalogueHarness';

let activeHarness: Harness | null = null;

afterEach(async () => {
  if (activeHarness) {
    await activeHarness.catalogue.close();
    activeHarness = null;
  }
});

function packageContext(doc: ReturnType<typeof book>, packageFileName: string) {
  return buildWorkingContext({
    document: doc,
    version: '0.0.15',
    activeView: 'description',
    uiLanguage: 'en',
    modified: false,
    selection: null,
    caret: null,
    request: { kind: 'general', source: 'panel' },
    preExistingErrors: 0,
    mode: 'package',
    packageFileName,
  });
}

describe('Package mode AI catalogue (FR-021)', () => {
  it('exposes strictly the 5 description-only tools and rejects all 21 excluded tools', async () => {
    const doc = book();
    doc.description.titleInfo.coverpage = [{ href: '#cover.png' }];
    const ctx = packageContext(doc, 'Sample Book.pdf');
    activeHarness = await harness({
      document: doc,
      mode: 'package',
      context: () => ctx as unknown as Record<string, unknown>,
    });

    const listedNames = activeHarness.catalogue.listed().map((t) => t.name);
    expect(listedNames).toEqual([...PACKAGE_MODE_TOOL_NAMES]);
    expect(listedNames).toHaveLength(5);

    const openAiNames = activeHarness.catalogue.tools().map((t) => t.function.name);
    expect(openAiNames).toEqual([...PACKAGE_MODE_TOOL_NAMES]);

    // Every one of the 21 excluded FB2/body/table/script tools must be rejected.
    const allowedSet = new Set<string>(PACKAGE_MODE_TOOL_NAMES);
    const excluded = TOOL_NAMES.filter((name) => !allowedSet.has(name));
    expect(excluded).toHaveLength(21);

    for (const toolName of excluded) {
      const outcome = await activeHarness.catalogue.call(toolName, {});
      expect(outcome.isError, `expected excluded tool ${toolName} to fail`).toBe(true);
    }
  });

  it('returns package mode context fields and scopes systemPrompt to description-only editing', async () => {
    const doc = book();
    const ctx = packageContext(doc, 'Dune.epub');

    expect(ctx.mode).toBe('package');
    expect(ctx.packageFileName).toBe('Dune.epub');
    expect(ctx.fileKind).toBe('fbd');
    expect(ctx.outline).toEqual([]);
    expect(ctx.scriptsAvailable).toBe(false);

    const prompt = systemPrompt(ctx);
    expect(prompt).toContain('FBD ZIP Package mode');
    expect(prompt).toContain('Dune.epub');
    expect(prompt).toContain('set_description');
    expect(prompt).toContain('coverpage');

    activeHarness = await harness({
      document: doc,
      mode: 'package',
      context: () => ctx as unknown as Record<string, unknown>,
    });
    const ctxRes = await activeHarness.catalogue.call('get_context', {});
    expect(ctxRes.isError).toBe(false);
    expect(ctxRes.result.mode).toBe('package');
    expect(ctxRes.result.packageFileName).toBe('Dune.epub');
  });

  it('allows set_description metadata edits while refusing coverpage mutations', async () => {
    const doc = book();
    doc.description.titleInfo.coverpage = [{ href: '#cover.jpg' }];
    const ctx = packageContext(doc, 'Foundation.pdf');
    activeHarness = await harness({
      document: doc,
      mode: 'package',
      context: () => ctx as unknown as Record<string, unknown>,
    });

    // Updating title succeeds and preserves existing coverpage.
    const okRes = await activeHarness.catalogue.call('set_description', {
      description: { titleInfo: { bookTitle: 'Foundation and Empire' } },
    });
    expect(okRes.isError).toBe(false);
    expect(activeHarness.copy.document.description.titleInfo.bookTitle).toBe(
      'Foundation and Empire',
    );
    expect(activeHarness.copy.document.description.titleInfo.coverpage).toEqual([
      { href: '#cover.jpg' },
    ]);

    // Attempting to mutate titleInfo.coverpage is refused cleanly.
    const badRes = await activeHarness.catalogue.call('set_description', {
      description: { titleInfo: { coverpage: [{ href: '#hack.png' }] } },
    });
    expect(badRes.isError).toBe(true);
    expect(activeHarness.copy.document.description.titleInfo.coverpage).toEqual([
      { href: '#cover.jpg' },
    ]);

    // Attempting to mutate srcTitleInfo.coverpage is also refused cleanly.
    const badSrcRes = await activeHarness.catalogue.call('set_description', {
      description: { srcTitleInfo: { coverpage: [{ href: '#hack2.png' }] } },
    });
    expect(badSrcRes.isError).toBe(true);
  });
});
