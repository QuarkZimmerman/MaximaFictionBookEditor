/**
 * Feature 017 (T060; D42): the corpus gate's TXT runs, driven by tests/corpus/txt-runs.py against the real core
 * and interface. `MFBE_CORPUS_MODE`: `export` (every word of each FB2 book in its TXT, in order - SC-002),
 * `round-trip` (the editor's own TXT in every encoding of the book's language read back with its title and notes -
 * SC-003, SC-004, SC-007), `import` (each text file of the list imports or is refused, never a crash or a hang -
 * SC-006, SC-008). `MFBE_CORPUS_LIST` names the files, `MFBE_CORPUS_OUT` the folder of results.json.
 * Skipped unless the mode is set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, shownDocId, test, waitForBook, type CoreHandle } from './fixtures/core';
import { bookXml, exportTxtTo, importTxtViaMenu, txtImportEnds } from './fixtures/txt';

const MODE = process.env.MFBE_CORPUS_MODE;
const LIST = process.env.MFBE_CORPUS_LIST;
const OUT = process.env.MFBE_CORPUS_OUT;

interface Result {
  file: string;
  ms: number;
  ok: boolean;
  detail?: string;
  /** Round trip: the encodings the import asked about (D26 asks when the judge cannot tell) - noted, no failure. */
  asked?: string[];
}

const files = (): string[] =>
  readFileSync(LIST!, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

/** The words of the book's text bodies (notes bodies aside), as the TXT must hold them (SC-002). */
function bodyWords(xml: string): string[] {
  const bodies = [
    ...xml.matchAll(/<body(?![^>]*name="(?:notes|comments)")[^>]*>([\s\S]*?)<\/body>/g),
  ]
    .map((m) => m[1]!)
    .join(' ');
  return (
    bodies
      .replace(/<binary[\s\S]*?<\/binary>/g, ' ')
      // Inline markup sits inside words ("H<sub>2</sub>O"); block elements part them.
      .replace(/<\/?(?:strong|emphasis|style|a|strikethrough|sub|sup|code)\b[^>]*>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
  );
}

/** True when `words` appear in `text` in order. */
function inOrder(words: string[], text: string): string | null {
  const found = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let at = 0;
  for (const word of words) {
    while (at < found.length && found[at] !== word) at++;
    if (at === found.length) return word;
    at++;
  }
  return null;
}

/** File > Open of `file`; the unsaved book an import left is not saved (its question answered No). */
async function openBook(core: CoreHandle, page: Page, file: string): Promise<void> {
  await core.enqueueDialog('dialog.openFile', { paths: [file] });
  await page.getByTestId('menu-file').click();
  await page.getByTestId('menu-file-open').click();
  const question = page.getByRole('dialog').filter({ hasText: 'Save changes to' });
  if (
    await question.waitFor({ state: 'visible', timeout: 2000 }).then(
      () => true,
      () => false,
    )
  )
    await question.getByRole('button', { name: 'No' }).click();
  await waitForBook(page, file, 120_000);
}

/** The encodings of each language the round trip writes: the dialog's label, and the name Node decodes with. */
const ENCODINGS: Record<string, { label: string; name: string }[]> = {
  ru: [
    { label: 'windows-1251 (Cyrillic)', name: 'windows-1251' },
    { label: 'KOI8-R (Russian)', name: 'koi8-r' },
    { label: 'IBM866 (DOS Cyrillic)', name: 'ibm866' },
  ],
  uk: [
    { label: 'windows-1251 (Cyrillic)', name: 'windows-1251' },
    { label: 'KOI8-U (Ukrainian)', name: 'koi8-u' },
  ],
  en: [
    { label: 'windows-1252 (Western European)', name: 'windows-1252' },
    { label: 'ISO-8859-1 (Western European, Latin-1)', name: 'iso-8859-1' },
  ],
};
const UTF8 = { label: 'UTF-8 (Unicode)', name: 'utf-8' };

/**
 * The encoding question, when the import asks it (D26): answered with `name` - else the first candidate - so
 * that it never stays open over the window. True when it was asked.
 */
async function answerEncoding(page: Page, name?: string): Promise<boolean> {
  const question = page.getByTestId('dialog-txt-import-encoding-question');
  const asked = await question.waitFor({ state: 'visible', timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (!asked) return false;
  if (name) await question.getByTestId('dialog-txt-import-encoding').selectOption(name);
  await question.getByRole('button', { name: 'OK' }).click();
  return true;
}

/** The title the exported TXT's record holds - in the encoding's plain forms where it lacks a character (D12). */
function recordTitle(file: string, encoding: string): string {
  const text = new TextDecoder(encoding).decode(readFileSync(file));
  const record = text.slice(text.lastIndexOf('='.repeat(40)));
  return /\r\nTitle: ([^\r\n]*)/.exec(record)?.[1] ?? '';
}

const xmlText = (value: string): string =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

test.describe('corpus gate - TXT (feature 017)', () => {
  // A step that cannot act - a dialog left over the window - fails within a minute, never waits for the
  // run's own limit: one book cannot hold up the gate.
  test.use({ actionTimeout: 60_000 });

  test.beforeEach(({ core }) => {
    test.skip(!MODE || !LIST || !OUT || !core.hasCore, 'the corpus gate sets MFBE_CORPUS_MODE');
  });

  test('the TXT runs', async ({ core, page }) => {
    test.setTimeout(6 * 60 * 60 * 1000);
    mkdirSync(OUT!, { recursive: true });
    await core.openApp(page);
    const results: Result[] = [];
    for (const [index, file] of files().entries()) {
      const started = Date.now();
      const asked: string[] = [];
      const record = (ok: boolean, detail?: string) =>
        results.push({
          file,
          ms: Date.now() - started,
          ok,
          ...(detail ? { detail } : {}),
          ...(asked.length ? { asked } : {}),
        });
      try {
        if (MODE === 'layouts') {
          // SC-005: a layout file of make-fixtures.py --sample, its paragraphs back (at least 99% of them).
          const expectedFile = file.replace(/\.[a-z-]+\.txt$/, '.expected.json');
          const { paragraphs } = JSON.parse(readFileSync(expectedFile, 'utf8')) as {
            paragraphs: string[];
          };
          const before = await importTxtViaMenu(core, page, file);
          await answerEncoding(page);
          const ended = await txtImportEnds(page, before, 300_000);
          if (ended.failed !== undefined) {
            record(false, ended.failed);
            continue;
          }
          const got = [...(await bookXml(page)).matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) =>
            m[1]!
              .replace(/<[^>]+>/g, '')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&amp;/g, '&'),
          );
          const back =
            paragraphs.filter((p, i) => got[i] === p).length / Math.max(1, paragraphs.length);
          record(
            back >= 0.99,
            back >= 0.99 ? undefined : `${(back * 100).toFixed(1)}% of paragraphs back`,
          );
          continue;
        }
        if (MODE === 'import') {
          const before = await importTxtViaMenu(core, page, file);
          await answerEncoding(page);
          const ended = await txtImportEnds(page, before, 300_000);
          if (ended.failed !== undefined) record(true, `refused: ${ended.failed}`);
          else record((await shownDocId(page)) !== before);
          continue;
        }
        await openBook(core, page, file);
        const original = await bookXml(page);
        const target = path.join(OUT!, `${index}.txt`);
        if (MODE === 'export') {
          await exportTxtTo(core, page, target);
          const missing = inOrder(bodyWords(original), readFileSync(target, 'utf8'));
          record(
            missing === null,
            missing === null ? undefined : `missing or out of order: ${missing}`,
          );
          continue;
        }
        // round-trip: UTF-8 and each encoding of the book's language, read back as the editor's own TXT.
        const lang = /<lang>([^<]*)<\/lang>/.exec(original)?.[1]?.slice(0, 2).toLowerCase() ?? '';
        const notes = (
          original.match(/<body[^>]*name="notes"[\s\S]*?<\/body>/)?.[0].match(/<section/g) ?? []
        ).length;
        const problems: string[] = [];
        for (const { label: encoding, name } of [UTF8, ...(ENCODINGS[lang] ?? [])]) {
          await openBook(core, page, file);
          await exportTxtTo(core, page, target, { encoding });
          const before = await importTxtViaMenu(core, page, target);
          // D26: when the judge cannot tell, the import asks - for the editor's own TXT too. The round trip
          // answers with the encoding written and notes the question (no failure: the spec allows it).
          if (await answerEncoding(page, name)) asked.push(encoding);
          const ended = await txtImportEnds(page, before, 300_000);
          if (ended.failed !== undefined) {
            problems.push(`${encoding}: ${ended.failed}`);
            continue;
          }
          // What the record holds comes back: the title in the encoding's plain forms where it lacks a
          // character (D12), which the export's summary named.
          const title = recordTitle(target, name);
          const back = /<book-title>([^<]*)<\/book-title>/.exec(await bookXml(page))?.[1] ?? '';
          if (xmlText(back) !== title)
            problems.push(`${encoding}: title "${xmlText(back)}" for "${title}"`);
          const backXml = await bookXml(page);
          const backNotes = (
            backXml.match(/<body[^>]*name="notes"[\s\S]*?<\/body>/)?.[0].match(/<section/g) ?? []
          ).length;
          if (backNotes < notes) problems.push(`${encoding}: notes ${backNotes} of ${notes}`);
        }
        record(problems.length === 0, problems.join('; ') || undefined);
      } catch (error) {
        record(false, String(error).split('\n')[0]);
        // The window starts the next book afresh: nothing a failed book left open stands in its way.
        await core.openApp(page).catch(() => undefined);
      }
      writeFileSync(path.join(OUT!, 'results.json'), JSON.stringify(results, null, 1));
    }
    writeFileSync(path.join(OUT!, 'results.json'), JSON.stringify(results, null, 1));
    expect(results.length).toBeGreaterThan(0);
  });
});
