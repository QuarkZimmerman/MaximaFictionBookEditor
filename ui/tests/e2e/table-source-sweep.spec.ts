/**
 * Feature 006, User Story 1 - SC-002 (Source): *Add → Table* in the Source view matches the
 * schema at every position (T050; FR-061; SC-002; U18; C3, C37, C79; I27; quickstart §1;
 * research R4.8).
 *
 * Runs against the real core (`MFBE_CORE_BIN=../build/linux-core-debug/bin/mfbe-core`);
 * skipped in core-less mode. The Linux leg only: no `@platform` tag, and not in the language
 * projects (the verdicts are codes, not texts).
 *
 * `tables-placement.fb2` (every container, no comment, CDATA section or processing instruction
 * besides the XML declaration, 0 errors from `doc.validate`) is shown in the Source view. The
 * candidate offsets come from a plain string scan of the Source text in the test process,
 * independent of the rule under test: every offset next to a `<` or a `>`; the first, middle
 * and last offset of every white-space run between `>` and `<` (the run's other offsets would
 * only repeat those verdicts); one offset inside every tag and every text run. `<?…?>`, `<!--`,
 * `<![CDATA[` and `<!DOCTYPE` count as markup, not as tags. The verdicts come in one round trip,
 * `__mfbeTest.sourceTable.sweep(offsets) → [{offset, enabled, code}]`, whose `enabled` is the
 * registry's state of `insert.table`. The oracle is libxml2 alone: in a second session of the
 * fixture (`doc.open`), `<table><tr><td>x</td></tr></table>` is inserted into the Source text at
 * each offset and the text goes to `doc.validate({docId, text})` - the validator blanks the
 * elided `<binary>` placeholders and resolves the binaries against that session - in parallel
 * batches. Because the blanking empties a whole `<binary>` element, a table inserted into a
 * placeholder can vanish with it: the offsets in a binary's content are judged by the scan
 * alone (`inText`, refused) and every other offset by libxml2.
 */

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook, type CoreHandle } from './fixtures/core';

const BOOK = fixtureBook('tables-placement.fb2');
/** What the oracle inserts at each offset: the smallest valid table. */
const TABLE = '<table><tr><td>x</td></tr></table>';
/** `doc.validate` calls in flight at once. */
const BATCH = 24;

interface SweepVerdict {
  offset: number;
  enabled: boolean;
  code: string;
}

interface SourceTableHooks {
  sweep(offsets: number[]): SweepVerdict[];
}

declare const window: {
  __mfbeTest?: {
    sourceTable?: SourceTableHooks;
    sourceMapping?: { sourceText(): string | null };
  };
};

interface ValidationJson {
  errorCount: number;
  issues: { severity: string; code: string; message?: string; line?: number }[];
}

/** The class of an offset by the string scan: the rule's refusals it must reproduce. */
type ScanClass = 'inTag' | 'inMarkup' | 'outsideRoot' | 'inText' | 'between';

interface Span {
  /** Offset of the `<`. */
  from: number;
  /** Offset after the closing `>`. */
  to: number;
  kind: 'tag' | 'markup';
}

/**
 * The tags and markup of `text` in order. A tag ends at the first `>` outside a quoted
 * attribute value; a comment at `-->`, a CDATA section at `]]>`, a processing instruction at
 * `?>` and a doctype at its `>`.
 */
function scanSpans(text: string): Span[] {
  const spans: Span[] = [];
  const endOf = (from: number, close: string) => {
    const at = text.indexOf(close, from);
    if (at < 0) throw new Error(`unterminated markup at ${from}`);
    return at + close.length;
  };
  let i = text.indexOf('<');
  while (i >= 0) {
    let to: number;
    let kind: Span['kind'] = 'markup';
    if (text.startsWith('<!--', i)) to = endOf(i + 4, '-->');
    else if (text.startsWith('<![CDATA[', i)) to = endOf(i + 9, ']]>');
    else if (text.startsWith('<?', i)) to = endOf(i + 2, '?>');
    else if (/^<!doctype/i.test(text.slice(i, i + 9))) to = endOf(i + 9, '>');
    else {
      kind = 'tag';
      let quote: string | null = null;
      let j = i + 1;
      for (; j < text.length; j += 1) {
        const ch = text[j]!;
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '>') {
          break;
        }
      }
      if (j >= text.length) throw new Error(`unterminated tag at ${i}`);
      to = j + 1;
    }
    spans.push({ from: i, to, kind });
    i = text.indexOf('<', to);
  }
  return spans;
}

/**
 * The candidate offsets of the scan (sorted, each once), the class of each, and the offsets in
 * the content of a `<binary>` element - its elided `…N bytes…` placeholder, which the validator
 * empties before validating (`blank_binary_placeholders`, `core/src/xml/validator.cpp`): a
 * table inserted there can vanish with the placeholder, so libxml2 cannot judge those offsets
 * and the scan's class (`inText`) does.
 */
function candidates(text: string): {
  offsets: number[];
  classOf: Map<number, ScanClass>;
  inBinary: Set<number>;
} {
  const spans = scanSpans(text);
  const offsets = new Set<number>();
  // Every offset next to a `<` or a `>`, wherever the character stands.
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '<' || text[i] === '>') {
      offsets.add(i);
      offsets.add(i + 1);
    }
  }
  // One offset inside every tag and every piece of markup.
  for (const span of spans) offsets.add(span.from + Math.floor((span.to - span.from) / 2));
  // The gaps between spans: white-space runs (first, middle, last) and text runs (one inside).
  for (let k = 0; k + 1 < spans.length; k += 1) {
    const a = spans[k]!.to;
    const b = spans[k + 1]!.from;
    offsets.add(a);
    offsets.add(b);
    offsets.add(a + Math.floor((b - a) / 2));
  }

  const firstTag = spans.find((span) => span.kind === 'tag');
  const lastTag = [...spans].reverse().find((span) => span.kind === 'tag');
  if (!firstTag || !lastTag) throw new Error('no root element in the Source text');
  const rootFrom = firstTag.from;
  const rootTo = lastTag.to;

  const classOf = new Map<number, ScanClass>();
  const inBinary = new Set<number>();
  const sorted = [...offsets].filter((o) => o >= 0 && o <= text.length).sort((x, y) => x - y);
  let s = 0;
  for (const offset of sorted) {
    while (s < spans.length && spans[s]!.to <= offset) s += 1;
    const span = spans[s];
    if (span && span.from < offset && offset < span.to) {
      classOf.set(offset, span.kind === 'tag' ? 'inTag' : 'inMarkup');
      continue;
    }
    if (offset <= rootFrom || offset >= rootTo) {
      classOf.set(offset, 'outsideRoot');
      continue;
    }
    // Between the span that ends at or before the offset and the one that starts at or after.
    const before = s > 0 ? spans[s - 1] : undefined;
    const gapFrom = before ? before.to : 0;
    const gapTo = span ? span.from : text.length;
    classOf.set(offset, /[^ \t\r\n]/.test(text.slice(gapFrom, gapTo)) ? 'inText' : 'between');
    if (
      before &&
      span &&
      /^<binary\b/.test(text.slice(before.from, before.to)) &&
      text.startsWith('</binary>', span.from)
    ) {
      inBinary.add(offset);
    }
  }
  return { offsets: sorted, classOf, inBinary };
}

/** 1-based line and column of an offset, for the failure messages. */
function lineColumn(text: string, offset: number): string {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `${line}:${column}`;
}

/** The text around an offset with a `|` at it, on one line. */
function around(text: string, offset: number): string {
  const show = (part: string) => JSON.stringify(part).slice(1, -1);
  return `${show(text.slice(Math.max(0, offset - 24), offset))}|${show(text.slice(offset, offset + 24))}`;
}

async function openBook(core: CoreHandle, page: Page): Promise<void> {
  await core.openApp(page);
  await expect(page.getByTestId('status-message')).toHaveText('Ready');
  await core.enqueueDialog('dialog.openFile', { paths: [BOOK] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  await waitForBook(page, BOOK);
  await expect(page.getByTestId('body-view')).toBeVisible();
}

function sourceText(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__mfbeTest?.sourceMapping?.sourceText() ?? null);
}

function sweep(page: Page, offsets: number[]): Promise<SweepVerdict[]> {
  return page.evaluate((list) => window.__mfbeTest!.sourceTable!.sweep(list), offsets);
}

test.describe('US1 (feature 006) - the Source view’s table rule against the schema', () => {
  test.beforeEach(async ({ core }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
  });

  test('SC-002 (Source): Add → Table matches the schema at every position', async ({
    core,
    page,
  }) => {
    // About 1,800 validations of a 5 KB book, 24 at a time: 3.4 to 4.3 s in the Linux e2e leg of
    // the CI runs since user story 1 (40280949388 to 40373286236), 1.7 s on the development
    // host; the time-out is twice the slowest, rounded up to the next minute (T187; quickstart
    // open point 8; research R8.19).
    test.setTimeout(60_000);
    await openBook(core, page);
    await page.getByTestId('view-source').click();
    await expect(page.getByTestId('source-view')).toHaveAttribute('data-status', 'ready');
    await expect
      .poll(() => page.evaluate(() => typeof window.__mfbeTest?.sourceTable?.sweep))
      .toBe('function');
    // The rule judges a complete syntax tree: until the idle parse reaches the end of the
    // text the verdict is `analysing`.
    await expect
      .poll(async () => (await sweep(page, [0]))[0]?.code, { timeout: 30_000 })
      .not.toBe('analysing');

    const text = await sourceText(page);
    expect(text, 'the Source text').toBeTruthy();
    const source = text!;
    const { offsets, classOf, inBinary } = candidates(source);
    expect(offsets.length).toBeGreaterThan(500);
    // The fixture's two binaries give elided placeholders: a few offsets in their content.
    expect(inBinary.size).toBeGreaterThan(0);
    const judged = offsets.filter((offset) => !inBinary.has(offset));

    // The verdicts, in one round trip.
    const verdicts = await sweep(page, offsets);
    expect(verdicts.map((v) => v.offset)).toEqual(offsets);

    // The oracle: libxml2 on the text with a table inserted at each offset, in a second session.
    const opened = await core.rpcJob<{ document: { docId: string } }>('doc.open', { path: BOOK });
    const docId = opened.document.docId;
    const errors = new Map<number, number>();
    try {
      const clean = await core.rpcJob<ValidationJson>('doc.validate', { docId, text: source });
      expect(clean.errorCount, JSON.stringify(clean.issues)).toBe(0);
      for (let i = 0; i < judged.length; i += BATCH) {
        const batch = judged.slice(i, i + BATCH);
        const reports = await Promise.all(
          batch.map((offset) =>
            core.rpcJob<ValidationJson>(
              'doc.validate',
              { docId, text: source.slice(0, offset) + TABLE + source.slice(offset) },
              120_000,
            ),
          ),
        );
        batch.forEach((offset, k) => errors.set(offset, reports[k]!.errorCount));
      }
    } finally {
      await core.rpc('doc.close', { docId }).catch(() => {});
    }

    const mismatches: string[] = [];
    const classMismatches: string[] = [];
    let enabledCount = 0;
    for (const verdict of verdicts) {
      const where = `${lineColumn(source, verdict.offset)} (${verdict.offset}) ${around(source, verdict.offset)}`;
      if (verdict.enabled) enabledCount += 1;
      if (inBinary.has(verdict.offset)) {
        // In a binary's placeholder: refused as text, whatever the emptied element validates to.
        if (verdict.enabled || verdict.code !== 'inText') {
          mismatches.push(
            `${where}: in a binary's content, enabled ${verdict.enabled} (${verdict.code})`,
          );
        }
      } else {
        const errorCount = errors.get(verdict.offset)!;
        if (verdict.enabled !== (errorCount === 0)) {
          mismatches.push(
            `${where}: enabled ${verdict.enabled} (${verdict.code}), libxml2 ${errorCount} error(s)`,
          );
        }
      }
      // Enabled exactly for `ok`; every refusal has a code of its own.
      if (verdict.enabled !== (verdict.code === 'ok') || !verdict.code) {
        classMismatches.push(`${where}: enabled ${verdict.enabled} with code "${verdict.code}"`);
      }
      const scanned = classOf.get(verdict.offset)!;
      if (scanned !== 'between' && verdict.code !== scanned) {
        classMismatches.push(`${where}: code ${verdict.code}, the scan says ${scanned}`);
      }
    }
    expect(mismatches, `verdicts that differ from libxml2:\n${mismatches.join('\n')}`).toEqual([]);
    expect(classMismatches, classMismatches.join('\n')).toEqual([]);
    // The fixture has allowed points (sections, cites, annotations, the history) and refused
    // ones between elements (titles, epigraphs, poems, tables, the description).
    expect(enabledCount).toBeGreaterThan(20);
    expect(
      verdicts.filter((v) => v.code === 'notAllowed').length,
      'refusals between elements',
    ).toBeGreaterThan(20);
    for (const code of ['inTag', 'inText', 'inMarkup', 'outsideRoot']) {
      expect(
        verdicts.some((v) => v.code === code),
        code,
      ).toBe(true);
    }

    // C3: right after a section's `</title>` followed by its heading `<image>` (section 3, a
    // heading image without an annotation) the table is allowed - as the schema reads it, the
    // image then becomes the first content image.
    const heading = /<\/title>(\s*)<image\b[^>]*\/>\s*<p>The text of section 3\./.exec(source);
    expect(heading, 'section 3: </title> before its heading image').not.toBeNull();
    const afterTitle = heading!.index + '</title>'.length;
    const [atHeading] = await sweep(page, [afterTitle]);
    expect(atHeading).toEqual({ offset: afterTitle, enabled: true, code: 'ok' });

    // The sweep moved only the selection: the text is unchanged.
    expect(await sourceText(page)).toBe(source);
  });
});
