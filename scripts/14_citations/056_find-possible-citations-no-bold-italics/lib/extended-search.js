// The two searches of FictionBook Editor 2.7.9's "Поиск предположительных цитат" 1.42 (14/054
// and its variant 14/056 without the bold and italic lines), each package carrying an identical
// copy. The original's Run1 searched with the main list (engine '5' of regexp-search.js, inline
// pictures as "ǾǾǾ", soft hyphens as "&shy;"); every hit in a paragraph that looks like a line of
// dialogue (it starts with a dash, after a «, or holds punctuation followed by a dash) was an
// exception. A hit of a stop word at the end of a line ("Надпись гласила:") was not shown:
// the caret went to its end and Run2 searched on with the second list for the next paragraph
// of two characters or more. A paragraph inside a citation, a stanza, a poem, a title or an
// epigraph ("DIVs"), or one that looks like a line of dialogue, sent the caret to its end and
// Run1 searched on - Run1 and Run2 called each other until one of them found something or
// reached the end. That alternation is a loop here.

import {
  caretAt,
  createRegExpSet,
  notFoundMessage,
  prepareSearch,
  search,
  selectHit,
  t,
} from './regexp-search.js';

// "если строка содержит различные признаки не свойственные цитатам": rxDialog, rxZnPrep.
const rxDialog = new RegExp('^«?[-—–]', '');
const rxZnPrep = new RegExp('[.,:!?][□▫◦\\x20\\xA0]{0,2}[-—–]', '');

/** The original's test of a paragraph's text for a line of dialogue. */
export function dialogLike(s) {
  return rxDialog.test(s) || rxZnPrep.test(s);
}

async function listErrors(ctx, set) {
  await mfbe.ui.message(
    t(
      ctx,
      'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n',
      'These regular expression entries failed to compile:\n\n',
    ) +
      set.errors +
      t(
        ctx,
        '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.',
        '\n\nPlease fix them before using the script.',
      ),
    { icon: 'error' },
  );
}

/**
 * Runs the search: `init1` / `init2` fill the lists of Run1 and Run2, `english` gives the status
 * texts of their descriptions in the English interface.
 */
export async function runExtendedSearch(ctx, init1, init2, english) {
  const set1 = createRegExpSet();
  init1(set1);
  const set2 = createRegExpSet();
  init2(set2);
  const ready = await prepareSearch(ctx, set1);
  if (!ready) return;
  const { book } = ready;
  const options = {
    engine: '5',
    image: 'ǾǾǾ',
    decodeShy: false,
    finished: true,
    describe: (desc) => t(ctx, desc, english[desc] ?? desc),
  };
  let start = ready.start;
  for (;;) {
    const run1 = await search(ctx, set1, book, start, { ...options, exclude: dialogLike });
    if (run1.cancelled) return;
    if (!run1.found) {
      // Run1 collapsed its range where its last search started, then said so.
      await caretAt(book, run1.last);
      await notFoundMessage(ctx);
      return;
    }
    if (run1.found.desc?.indexOf('Стоп-слово') !== 0) {
      await selectHit(run1.found);
      return;
    }
    // A stop word: the caret at its end, and Run2 from there.
    await selectHit(run1.found, true);
    if (set2.errors !== '') {
      await listErrors(ctx, set2);
      return;
    }
    const after = { index: run1.found.item.index, offset: run1.found.to, collapsed: true };
    const run2 = await search(ctx, set2, book, after, options);
    if (run2.cancelled) return;
    if (!run2.found) {
      await notFoundMessage(ctx);
      return;
    }
    if (run2.found.desc?.indexOf('DIVs') === 0 || dialogLike(run2.found.text)) {
      // Not a citation's line: the caret at the end of that paragraph, and Run1 from there.
      await selectHit(run2.found, true);
      start = { index: run2.found.item.index, offset: run2.found.to, collapsed: true };
      continue;
    }
    await selectHit(run2.found);
    return;
  }
}
