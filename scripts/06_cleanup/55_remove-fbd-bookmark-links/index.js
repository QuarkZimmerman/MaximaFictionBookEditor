// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/55_Удалить ссылки 'bookmark', созданные FBD.js
// FictionBook Designer put a link at the start of the paragraphs of the notes it made. In every text
// block of the notes body (the body named "notes") that starts - formatting aside, spaces and
// non-breaking spaces before it allowed - with a link, the script deletes that first link with its
// text and the spaces around it. Other bodies, and links further in a paragraph, are not touched.
// Reports the number of deleted links in the status bar.
// Converted on the block's inline content in the original's HTML notation (lib/legacy-html.js), so
// the original's expressions and its removeSymbolsBeyondTags() run as written; lib/jscript-regexp.js
// gives "." the meaning it had in JScript.
// Differences: a paragraph that held only the link is left empty, which FictionBook Editor saved as
// <empty-line/>: such a paragraph becomes an empty line here (other emptied blocks stay empty); an
// emphasis the link alone filled, left empty, disappears (2.7.9 kept an empty element). The run is one
// undo step.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить ссылки "bookmark", созданные FBD"
// Автор скрипта Sclex
// Версия скрипта 1.0

import { t, units } from './lib/book.js';
import { jscriptRegExp } from './lib/jscript-regexp.js';
import { collectTextBlocks, parseInline, serializeInline } from './lib/legacy-html.js';

// The editor's non-breaking space is U+00A0 itself (the original's GetNBSP() display character).
const nbspChar = String.fromCharCode(160);

const tagsRegExp = jscriptRegExp('<(?!/?(IMG|A))[^>]+>', 'gi');
const tagsRegExp_ = '';
const checkRegExp = jscriptRegExp('^((?: |\\xA0)*)(<A\\b[^>]+>.+?</A>)((?: |\\xA0)*)', 'i');
const refRegExp = jscriptRegExp('(<A\\b[^>]+>.+?</A>)', 'i');
const refRegExp_ = '';
const nbspCharRegExp = new RegExp(nbspChar, 'g');

function removeSymbolsBeyondTags(str, beginIndex, howManySymbolsToRemove, substrToInsert) {
  let i = 0;
  let removedSymbolsCnt = 0;
  let insideTag = false;
  const len = str.length;
  let symbolBeyondTagsCnt = 0;
  let str2 = '';
  let ch;
  while (i < len) {
    ch = str.charAt(i);
    if (ch === '<') {
      insideTag = true;
      str2 += ch;
    }
    if (!insideTag && ch !== '<' && ch !== '>') {
      symbolBeyondTagsCnt++;
      if (symbolBeyondTagsCnt < beginIndex || symbolBeyondTagsCnt + 1 > beginIndex + howManySymbolsToRemove) str2 += ch;
      else {
        if (removedSymbolsCnt === 0) str2 += substrToInsert;
        removedSymbolsCnt++;
      }
    }
    if (insideTag && ch !== '<' && ch !== '>') str2 += ch;
    if (ch === '>') {
      insideTag = false;
      str2 += ch;
    }
    i++;
  }
  return str2;
}

/** processP(): the block's new HTML, or null when it does not start with a link. */
function processP(innerHTML) {
  let s = innerHTML.replace(/&nbsp;/g, String.fromCharCode(160)).replace(nbspCharRegExp, String.fromCharCode(160));
  const s2 = s.replace(tagsRegExp, tagsRegExp_);
  if (!checkRegExp.test(s2)) return null;
  const result = checkRegExp.exec(s2);
  const spacesCnt = result[1].length + result[3].length;
  s = s.replace(refRegExp, refRegExp_);
  return removeSymbolsBeyondTags(s, 1, spacesCnt, '').replace(String.fromCharCode(160), nbspChar);
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  // The text blocks of the body named "notes" (the div.body with fbname "notes").
  const blocks = collectTextBlocks(snapshot).filter((block) => block.ancestors[block.ancestors.length - 1]?.attrs?.name === 'notes');
  let replacesCnt = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const extras = [];
    const html = processP(serializeInline(block.node.content, extras));
    if (html !== null) {
      const content = parseInline(html, extras);
      // An emptied <P> was saved as <empty-line/>.
      const node = content.length === 0 && block.node.type === 'p' ? { type: 'empty-line', attrs: {} } : { type: block.node.type, attrs: { ...block.node.attrs }, content };
      await mfbe.doc.replaceNode(block.ref, node);
      replacesCnt++;
    }
    if (i % 50 === 0) await mfbe.ui.progress(i, blocks.length, ctx.script.name);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(
    t(
      ctx,
      `${units(replacesCnt, { nom: 'Была удалена', gen: 'Были удалены', plu: 'Было удалено' })} ${replacesCnt} ${units(replacesCnt, { nom: 'ссылка', gen: 'ссылки', plu: 'ссылок' })}.`,
      replacesCnt === 1 ? '1 link was deleted.' : `${replacesCnt} links were deleted.`,
    ),
    { sticky: true },
  );
}
