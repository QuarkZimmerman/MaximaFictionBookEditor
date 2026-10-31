// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/35_Разметить курсивом буквы рядом со знаками подчеркивания.js
// (version 1.2 by its code; its header has no notice of its own). Throughout the book - the
// bodies, the book annotation and the history, which the original processed too - every
// paragraph whose text holds an underscore gets the original's expression applied to its
// inline HTML (lib/legacy-html.js renders the paragraph the way Internet Explorer did, so the
// expression runs verbatim): a run of letters spaced out with underscores ("т_е_к_с_т"), with
// the short words, the leading dash or guillemets and the trailing punctuation it takes, is
// wrapped in emphasis and loses its underscores. The message at the end gives the count and
// the time, with the original's credit line. A poem's date is left alone: FB2 allows no
// formatting in it (the original formatted it as the text-author paragraph it showed).
// Fix (FR-023): the expression was also matched inside the tags of the HTML - its look-ahead
// "not inside a tag" applied only to its last part - so a letter next to an underscore in an
// attribute was rewritten too: a footnote link to "#n_1" became "#<EM>n</EM>1", a picture
// "#pic_1.png" and a named style "my_style" broke the same way. Here a match never starts
// inside a tag (the tags are matched first and kept), and the count leaves those out.
// The original's Run() returned nothing, nor does run().
// The original's notice, kept as written (FR-029):
 //обрабатывать ли history
 //обрабатывать ли annotation
// if (PromptSnoska) {                                                                     // отключаю касательство к сноскам
//  Snoska=AskYesNo("    	      –=Jürgen Script=–\n\n	Обращать внимание [на] сноски?  		   \n");
// }
// М_ы _б

import {
  collectTextBlocks,
  legacyTimeString,
  parseInline,
  plainTextOf,
  serializeInline,
  TEXT_BLOCK_TYPES,
} from './lib/legacy-html.js';
import { t } from './lib/text-blocks.js';

const VERSION = '1.2';
const SHORT_WORDS =
  '(без|в|до|для|за|из|к|на|над|о|об|от|по|под|пред|при|про|с|у|через|а|и|чтобы|если|или|ни|не|как|также|тоже|но|то|либо|раз|что|будто|едва|ибо|хотя|ах|ой|ба|да|фу|тьфу|эй|эх|я)';

/** The original's regExp01; the tags alternative in front of it is the fix. */
function expression() {
  const nbspChar = mfbe.edit.nbsp;
  const nbspEntity = nbspChar.charCodeAt(0) === 160 ? '&nbsp;' : nbspChar;
  const spaces = `(${nbspChar}|${nbspEntity}| )`;
  const regExp01 =
    `(«+|^—${spaces}+|«…|«…${spaces}+)?(_+[-а-яёa-z]|[-а-яёa-z]_+)+[-а-яёa-z]?((${spaces}+(${SHORT_WORDS}${spaces}+)*` +
    `(_+[-а-яёa-z]|[-а-яёa-z]_+)+[а-яёa-z]?)*_*([.,…?!»]+)?(?=[^>]*(<|$)))*`;
  return new RegExp(`<[^>]*>|${regExp01}`, 'gi');
}

/** The text blocks of the book annotation and the history: { node, parent, index }. */
function descriptionBlocks(description) {
  const out = [];
  const visit = (parent) => {
    (parent.content ?? []).forEach((node, index) => {
      if (!node || node.type === 'text') return;
      if (TEXT_BLOCK_TYPES.includes(node.type)) out.push({ node, parent, index });
      else visit(node);
    });
  };
  for (const root of [description.titleInfo?.annotation, description.documentInfo?.history]) {
    if (root) visit(root);
  }
  return out;
}

export default async function run(ctx) {
  const started = Date.now();
  const re = expression();
  let replaceCount = 0;
  // The original's HandleP: nothing to do without an underscore in the text.
  const edit = (node) => {
    if (node.type === 'date' || plainTextOf(node).indexOf('_') === -1) return null;
    const extras = [];
    const html = serializeInline(node.content, extras);
    const edited = html.replace(re, (match) => {
      if (match[0] === '<') return match;
      replaceCount += 1;
      return '<EM>' + match.replace(/_/g, '') + '</EM>';
    });
    return edited === html ? null : { ...node, content: parseInline(edited, extras) };
  };

  const snapshot = await mfbe.doc.get();
  const blocks = collectTextBlocks(snapshot);
  for (let i = 0; i < blocks.length; i += 1) {
    if (ctx.cancelled) return;
    if (i % 200 === 0) await mfbe.ui.progress(i, blocks.length);
    const next = edit(blocks[i].node);
    if (next) await mfbe.doc.replaceNode(blocks[i].ref, next);
  }
  const { description } = snapshot;
  let changed = false;
  for (const { node, parent, index } of descriptionBlocks(description)) {
    const next = edit(node);
    if (!next) continue;
    parent.content[index] = next;
    changed = true;
  }
  if (changed) await mfbe.doc.setDescription(description);

  const time = legacyTimeString(started);
  await mfbe.ui.message(
    t(
      ctx,
      '                  –= Sclex Script =– \n' +
        ` «Разметить курсивом буквы рядом со знаками подчеркивания» v.${VERSION}\n\n` +
        ` Добавлено тегов курсива (emphasis): ${replaceCount}\n\n` +
        ` Время: ${time}.`,
      '                  –= Sclex Script =– \n' +
        ` «Mark letters next to underscores as italics» v.${VERSION}\n\n` +
        ` Emphasis tags added: ${replaceCount}\n\n` +
        ` Time: ${time.replace(/ сек$/, ' s').replace(/ мин /, ' min ').replace(/ ч /, ' h ').replace(/ с$/, ' s')}.`,
    ),
  );
}
