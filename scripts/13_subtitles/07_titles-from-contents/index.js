// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/07_Разметить заголовки разделов согласно оглавлению документа....js
// with its dialog HTML/Разметить заголовки разделов согласно оглавлению документа - основной
// диалог.htm, which held the logic.
// Marks up section titles from the book's table of contents: the user selects the paragraphs of
// the contents; their lines fill the dialog's list, which can be cleaned of page numbers and dot
// leaders ("Удалить из оглавления лишние символы") and edited. Marking up then turns every
// paragraph or subtitle of a section (in every body, outside the selected contents) whose text
// equals a line of the list - exactly, or ignoring punctuation, numbers and note marks after it -
// into the title of a new section that starts there; optionally it takes the letter case of the
// list's line and joins titles that touch into one. The list keeps the lines no title matched,
// for another run. The engine that cuts the sections is in section-split.js (shared with 06,
// identical copies); this file holds the dialog's code, as written, on the legacy inline-HTML
// notation of lib/legacy-html.js.
//
// Differences from the original (docs/scripting/notes-279-drafts/13.md):
// - the dialog is a form shown again after each action until it is closed; its two buttons are
//   the choice "Действие" and OK;
// - fix: the selected contents are skipped wherever the selection starts and ends; 2.7.9
//   recognised the contents only when their first paragraph was a paragraph of a section itself
//   (a selection starting in the contents' title turned the contents into titles, one ending in
//   a cite or a poem skipped the rest of the book);
// - fix: an empty list gives the message the original meant to show ("Список не содержит ни
//   одного заголовка..."); 2.7.9 stopped with a script error there;
// - a part of a section left with its title only, and a new section with nothing after its
//   title, get an <empty-line/>; the first new section keeps the section's id when nothing
//   precedes it (section-split.js).
// The original's notice, kept as written (FR-029):
//Скрипт «Разметить заголовки разделов согласно оглавлению документа»
//Автор Sclex
 // Нижеследующая команда задает список необычных пробелов,
 // которые в заголовках должны обрабатываться наравне
 // с обычными пробелами:
import { parseInline, serializeInline } from './lib/legacy-html.js';
import { applyToBodies, className, isMarker, isP, markerItem, splitAtMarkers } from './section-split.js';

const VERSION_NUM = '4.4';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// FictionBook Editor showed the non-breaking space as a configurable character (GetNBSP); the
// document model holds the real U+00A0 and the legacy notation writes it as &nbsp;.
const nbspChar = ' ';
const nbspEntity = '&nbsp;';

// The unusual spaces the original treated as ordinary spaces.
const unusualSpaces =
  String.fromCharCode(160) +
  String.fromCharCode(8194) +
  String.fromCharCode(8195) +
  String.fromCharCode(8196) +
  String.fromCharCode(8197) +
  String.fromCharCode(8198) +
  String.fromCharCode(8239) +
  String.fromCharCode(8201) +
  String.fromCharCode(8202) +
  nbspChar;
const unusualSpacesRegExp = new RegExp(`[${unusualSpaces}]`, 'g');

/** The dialog's removeSymbols, as written: page numbers, dot leaders and the like go. */
function removeSymbols(value) {
  const crLfRegExp = new RegExp('[\\r\\n]+', 'gm');
  const nbspRegExp = new RegExp(nbspChar, 'g');
  const emptySpaceRegExp = new RegExp(`[ ${nbspChar}\\t]+`, 'gm');
  const spacesAtTheBeginRegExp = new RegExp(`^[ ${nbspChar}]+`, 'gm');
  const spacesAndNumberOnTheEndRegExp = new RegExp(`[ ${nbspChar}]*\\d+[ ${nbspChar}]*$`, 'gm');
  const trashRegExp = new RegExp(`[ ${nbspChar}'\\*.,’\\-–—_]+$`, 'gm');
  const trashRegExp2 = new RegExp(`[ ${nbspChar}'\\*.,’\\-–—_]*(\\.\\.\\.\\.|---|–––|———|___).*$`, 'gm');
  return value
    .replace(crLfRegExp, '\n')
    .replace(nbspRegExp, ' ')
    .replace(emptySpaceRegExp, ' ')
    .replace(spacesAtTheBeginRegExp, '')
    .replace(/…/g, '...')
    .replace(spacesAndNumberOnTheEndRegExp, '')
    .replace(trashRegExp, '')
    .replace(trashRegExp2, '')
    .replace(crLfRegExp, '\n');
}

/** The dialog's getReadyTitlesArray: Arr (the lines as written) and titlesArr (to compare). */
function readyTitles(value) {
  const crLfRegExp2 = new RegExp(`^([ ${nbspChar}]*[\\r\\n]+)+`, 'gm');
  let contentsText = value.replace(crLfRegExp2, '\n').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(unusualSpacesRegExp, ' ');
  const Arr = contentsText.match(/^[^\r\n]+/gm);
  if (!Arr) return null;
  contentsText = contentsText.replace(/[–—]/g, '-').replace(/[«„“»]/g, '"').replace(/…/g, '...').replace(/’/g, "'");
  contentsText = contentsText.toLowerCase();
  return { Arr, Arr2: Arr.map(() => true), titlesArr: contentsText.match(/^[^\r\n]+$/gm) };
}

const myRegExp1 = new RegExp(`^[ ${nbspChar}]+`, '');
const myRegExp2 = new RegExp(`[ ${nbspChar}]+`, 'g');
const myRegExp3 = new RegExp(`[ ${nbspChar}]+$`, '');
const strEnding2 = new RegExp(`^(\\.\\.\\.|[.,"'<>«»„“:?!;\\)]){0,7}([ ${nbspChar}]+\\d+(\\.\\.\\.|[.,"'<>«»„“:?!;\\)]){0,7})?$`, 'g');
const emptySpaceRegExp2 = new RegExp(`([\\r\\n\\t ${nbspChar}]|${nbspEntity})+`, 'gi');

/** The dialog's detectIfTitleFits on a paragraph's innerHTML; marks the matching line used. */
function detectIfTitleFits(titleHTML, st) {
  const titleTextNew = titleHTML
    .replace(unusualSpacesRegExp, ' ')
    .replace(emptySpaceRegExp2, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/gm, '')
    .toLowerCase()
    .replace(myRegExp1, '')
    .replace(myRegExp2, ' ')
    .replace(myRegExp3, '')
    .replace(/[–—]/g, '-')
    .replace(/[«„“»]/g, '"')
    .replace(/…/g, '...')
    .replace(/’/g, "'");
  const titleTextNew2 = titleHTML
    .replace(unusualSpacesRegExp, ' ')
    .replace(emptySpaceRegExp2, ' ')
    .replace(/<A( [^<>]+)? href=("[^"]*"|'[^']*')( [^<>]+)?>.*?<\/A>/gim, '')
    .replace(/&amp;/gi, '&')
    .replace(/<[^>]+>/gm, '')
    .toLowerCase()
    .replace(myRegExp1, '')
    .replace(myRegExp2, ' ')
    .replace(myRegExp3, '')
    .replace(/[–—]/g, '-')
    .replace(/[«„“»]/g, '"')
    .replace(/…/g, '...')
    .replace(/’/g, "'")
    .replace(/\[\d+\]|\{\d+\}|\*+/gim, '')
    .replace(/([a-zа-яё.,:;!?»"\)])\d+/gi, '$1');
  const { Arr, Arr2, titlesArr } = st.list;
  for (let i = 0; i < titlesArr.length; i += 1) {
    if (st.processingType === 'FullMatch') {
      if (titleTextNew === titlesArr[i]) {
        st.savedPThatFits = Arr[i];
        Arr2[i] = false;
        return true;
      }
    } else if (st.processingType === 'MatchWithIgnoring') {
      if (titleTextNew2 === titlesArr[i] ||
          (titleTextNew2.indexOf(titlesArr[i]) === 0 && titleTextNew2.slice(titlesArr[i].length).search(strEnding2) !== -1)) {
        st.savedPThatFits = Arr[i];
        Arr2[i] = false;
        return true;
      }
    }
  }
  return false;
}

/** The dialog's adaptCase: the letters of the paragraph take the case of the list's line. */
function adaptCase(htmlStr1, textStr2) {
  let s4 = '';
  let ch2;
  let insideEntity = false;
  const text = textStr2.replace(/&(?!lt;|gt;|nbsp;)/g, '&amp;');
  for (let i2 = 0; i2 < text.length; i2 += 1) {
    ch2 = text.charAt(i2);
    if (ch2 === '&') insideEntity = true;
    if (!insideEntity && ch2.toLowerCase() !== ch2.toUpperCase()) s4 += ch2;
    if (ch2 === ';') insideEntity = false;
  }
  let i3 = 0;
  let insideTag = false;
  insideEntity = false;
  let s3 = '';
  for (let i2 = 0; i2 < htmlStr1.length; i2 += 1) {
    ch2 = htmlStr1.charAt(i2);
    if (ch2 === '<') insideTag = true;
    if (ch2 === '&') insideEntity = true;
    if (!insideTag && !insideEntity && ch2.toLowerCase() !== ch2.toUpperCase()) {
      ch2 = s4.charAt(i3);
      i3 += 1;
    }
    s3 += ch2;
    if (ch2 === '>') insideTag = false;
    if (ch2 === ';') insideEntity = false;
  }
  return s3;
}

/** innerHTML of a paragraph; an empty one got a non-breaking space first, as in the original. */
function innerHTML(item) {
  const html = item.type === 'empty-line' ? '' : serializeInline(item.content ?? [], []);
  return html === '' ? nbspEntity : html;
}

function processTitle(title, st) {
  for (const p of title.content ?? []) if (p.type === 'p' || p.type === 'empty-line') detectIfTitleFits(innerHTML(p), st);
}

/**
 * processSectionAndSubsections of the dialog: the sub-sections and the section's title first,
 * then the section's own paragraphs. Returns the sections that replace `section`.
 */
function processSection(section, st) {
  const content = section.content ?? [];
  let changed = false;
  const next = [];
  for (const child of content) {
    if (child.type === 'section') {
      const pieces = processSection(child, st);
      if (pieces.length !== 1 || pieces[0] !== child) changed = true;
      next.push(...pieces);
      continue;
    }
    if (child.type === 'title') processTitle(child, st);
    next.push(child);
  }
  if (content.some((c) => c.type === 'section')) return changed ? [{ ...section, content: next }] : [section];
  const items = [...content];
  let i = 0;
  while (i < items.length) {
    const ptr = items[i];
    if (!isP(ptr) || isMarker(ptr) || st.block.has(ptr.attrs?.nodeId) || !detectIfTitleFits(innerHTML(ptr), st)) {
      i += 1;
      continue;
    }
    let item = ptr;
    if (st.adaptCase && st.savedPThatFits && ptr.type !== 'empty-line') {
      const extras = [];
      const html = serializeInline(ptr.content ?? [], extras);
      item = { ...ptr, content: parseInline(adaptCase(html, st.savedPThatFits), extras) };
    }
    st.newTitleCnt += 1;
    if (className(ptr) === '') st.newTitleFromPCnt += 1;
    if (className(ptr) === 'subtitle') st.newTitleFromSubtitleCnt += 1;
    items[i] = item;
    items.splice(i, 0, markerItem('begin', st.newTitleCnt));
    items.splice(i + 2, 0, markerItem('end', st.newTitleCnt));
    i += 3;
    changed = true;
  }
  return changed ? splitAtMarkers(section, items, st.mergeAdjacent) : [section];
}

/** Text blocks of the bodies in document order. */
function textBlocks(doc) {
  const out = [];
  const types = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (types.has(node.type)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of doc.bodies ?? []) visit(body);
  return out;
}

function plainText(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
}

function resultMessage(ctx, st) {
  const head = t(
    ctx,
    `Скрипт «Разметить заголовки разделов согласно оглавлению документа» v${VERSION_NUM}.\nАвтор Sclex.\n\nОбработка завершена.\n\n`,
    `The script "Mark up section titles from the document's table of contents" v${VERSION_NUM}.\nAuthor: Sclex.\n\nFinished.\n\n`,
  );
  if (st.newTitleCnt === 0) return head + t(ctx, 'Не было размечено ни одного заголовка', 'No title was marked up');
  const fromP = t(ctx, `Было превращено простых абзацев в заголовки: ${st.newTitleFromPCnt}\n`, `Paragraphs turned into titles: ${st.newTitleFromPCnt}\n`);
  const fromSub = t(ctx, `Было превращено подзаголовков в заголовки: ${st.newTitleFromSubtitleCnt}\n`, `Subtitles turned into titles: ${st.newTitleFromSubtitleCnt}\n`);
  if (st.newTitleFromSubtitleCnt === 0) return head + fromP;
  if (st.newTitleFromPCnt === 0) return head + fromSub;
  return `${head}${fromP}${fromSub}——————————————————————————\n${t(ctx, `Было размечено заголовков всего: ${st.newTitleCnt}.`, `Titles marked up in all: ${st.newTitleCnt}.`)}`;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  const doc = await mfbe.doc.get();
  const blocks = textBlocks(doc);
  const a = selection ? blocks.findIndex((b) => b.attrs.nodeId === selection.anchor.nodeId) : -1;
  const h = selection ? blocks.findIndex((b) => b.attrs.nodeId === selection.head.nodeId) : -1;
  if (!selection || selection.text === '' || a < 0 || h < 0) {
    await mfbe.ui.message(
      t(ctx, 'Вы ничего не выделили.\n\nПеред запуском данного скрипта, пожалуйста, выделите абзацы оглавления.', 'Nothing is selected.\n\nPlease select the paragraphs of the table of contents before running this script.'),
    );
    return;
  }
  // The contents: the selected paragraphs, whole (makeSelection), and their text (main()).
  const first = Math.min(a, h);
  const last = Math.max(a, h);
  const blockNodes = blocks.slice(first, last + 1);
  const block = new Set(blockNodes.map((b) => b.attrs.nodeId));
  let contents = blockNodes
    .map(plainText)
    .join('\n')
    .replace(/[\r\n]+/gm, '\n')
    .replace(new RegExp(`^([ ${nbspChar}]*[\\r\\n]+)+`, 'gm'), '\n');
  const options = { processingType: 'full', adaptCase: true, mergeAdjacent: true };
  for (;;) {
    const answer = await mfbe.ui.form({
      title: t(ctx, `Разметить заголовки разделов согласно оглавлению документа v${VERSION_NUM}. Автор Sclex.`, `Mark up section titles from the document's table of contents v${VERSION_NUM}. Author: Sclex.`),
      width: 700,
      fields: [
        {
          kind: 'radio',
          id: 'action',
          label: t(ctx, 'Действие', 'Action'),
          value: 'markup',
          options: [
            { value: 'removeSymbols', label: t(ctx, 'Удалить из оглавления лишние символы', 'Remove the extra characters from the contents') },
            { value: 'markup', label: t(ctx, 'Разметить заголовки разделов согласно списку', 'Mark up the section titles from the list') },
          ],
        },
        {
          kind: 'radio',
          id: 'processingType',
          label: t(ctx, 'Сравнение', 'Comparison'),
          value: options.processingType,
          options: [
            { value: 'full', label: t(ctx, 'Размечать заголовок при точном совпадении с абзацем документа', 'Mark up a title when a paragraph of the document matches it exactly') },
            { value: 'ignoring', label: t(ctx, 'Размечать заголовок, игнорируя знаки препинания, числа и знаки сносок', 'Mark up a title ignoring punctuation, numbers and note marks') },
          ],
        },
        { kind: 'checkbox', id: 'adaptCase', value: options.adaptCase, label: t(ctx, 'Регистр символов размечаемых заголовков делать такой же, как в оглавлении', 'Give the new titles the letter case of the contents') },
        { kind: 'checkbox', id: 'mergeAdjacent', value: options.mergeAdjacent, label: t(ctx, 'Примыкающие вплотную заголовки объединять в один заголовок', 'Join titles that follow each other directly into one title') },
        { kind: 'text', id: 'contents', multiline: true, value: contents, label: t(ctx, 'Оглавление', 'Contents') },
      ],
      okLabel: t(ctx, 'Выполнить', 'Run'),
      cancelLabel: t(ctx, 'Закрыть', 'Close'),
    });
    if (!answer) return;
    contents = String(answer.contents ?? '');
    options.processingType = answer.processingType === 'ignoring' ? 'ignoring' : 'full';
    options.adaptCase = Boolean(answer.adaptCase);
    options.mergeAdjacent = Boolean(answer.mergeAdjacent);
    if (answer.action === 'removeSymbols') {
      contents = removeSymbols(contents);
      continue;
    }
    const list = readyTitles(contents);
    if (!list) {
      await mfbe.ui.message(t(ctx, 'Список не содержит ни одного заголовка, поэтому заголовки в этот раз не были размечены.', 'The list holds no title, so no title was marked up this time.'));
      continue;
    }
    const st = {
      list,
      block,
      processingType: options.processingType === 'ignoring' ? 'MatchWithIgnoring' : 'FullMatch',
      adaptCase: options.adaptCase,
      mergeAdjacent: options.mergeAdjacent,
      savedPThatFits: undefined,
      newTitleCnt: 0,
      newTitleFromPCnt: 0,
      newTitleFromSubtitleCnt: 0,
    };
    const current = await mfbe.doc.get();
    if (!(await applyToBodies(current.bodies ?? [], (section) => processSection(section, st), ctx))) return;
    contents = list.Arr.filter((_, i) => list.Arr2[i]).join('\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // The contents are selected again, as the original did.
    const lastNode = blockNodes[blockNodes.length - 1];
    try {
      const end = (lastNode.content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('').length;
      await mfbe.selection.set({ nodeId: blockNodes[0].attrs.nodeId, offset: 0 }, { nodeId: lastNode.attrs.nodeId, offset: end });
    } catch {
      // the contents were moved into a new section with fresh node ids: the selection stays
    }
    await mfbe.ui.message(resultMessage(ctx, st));
  }
}
