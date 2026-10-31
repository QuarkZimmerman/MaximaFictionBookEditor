// Converted from FictionBook Editor 2.7.9: Scripts/09_Стихи/35_Поиск неразмеченных стихов.js
// Searches, from the end of the selection, for the next unmarked poem: a paragraph outside
// titles, subtitles, cites, poems, stanzas, text authors, epigraphs and annotations that the
// rules of Sclex's «Поиск по регекспам» engine take for a poem line (3 to 70 characters, not
// starting with a dash, an asterisk, a digit...; after the exceptions: enumerations, «++» lines,
// initials, addresses, lines without lower-case letters, abbreviations, publishing data,
// captions), then selects the fragment of the following paragraphs of its section that may be
// the poem (the original's cuts at long lines, other formats, a change between italic or bold
// and plain lines, a date, non-poetic lines). One line, two or more sentences ending with a full
// stop, two lines with a colon, or three lines with an empty one between are passed over and the
// search goes on; otherwise the script stops with the fragment selected. When nothing is left it
// says so. run() returns nothing, as Run() did. The original's code runs on the emulation of its
// page (lib/fbe-dom.js); the fragment's text is cut by the original's expressions, as written,
// from the section's HTML as IE wrote it; selection.set selects it.
// Differences: the place is not flashed while the search passes over candidates; after a fruitless
// search the caret stays where the last skipped paragraph ended or where the search started, as
// in the original, but a table cell, which the original found and always passed over, is not
// looked at.
// Fixes: the document history is not searched (the engine's conditions could not exclude it, so
// a search from the start of the document took its short lines for a poem); a fragment that ends
// its section is selected to its end (the original subtracted one character for a line break
// that such a fragment does not have).
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск неразмеченных стихов» для редактора Fiction Book Editor (FBE).
// stokber, 2024, июнь.
// Версия 1.2 (2025, январь?)
// Надстройка к скрипту Sclex-а «Поиск по регекспам…»
		// чтобы сразу отсечь длинные строки.
		// alert("до\n"+txtBezTags);

import { FbePage } from './lib/fbe-dom.js';
import { jscriptRegExp as jre } from './lib/jscript-regexp.js';
import { decodeEntities } from './lib/legacy-html.js';

const nbspChar = ' ';

function tr(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The rules of the engine (init()): pattern, flags, description in Russian and English. */
const RULES = [
  ['^[a-zа-яё]\\)[.]?[\\x20\\xA0]', 'i', 'Пропустить:  перечисление.', 'Skip: an enumeration.'],
  ['^\\+\\+', '', 'Пропустить:  добавочный абзац текста сноски.', 'Skip: a further paragraph of a note.'],
  ['^.*[A-ZА-ЯЁ][.].*$', '', 'Пропустить:  Инициалы.', 'Skip: initials.'],
  ['^.*(@|https?|ftp|www\\.).*$', '', 'Пропустить: URL-ы и E-MAIL-ы.', 'Skip: URLs and e-mail addresses.'],
  ['^[^a-zа-яё]*[A-ZА-ЯЁ]+[^a-zа-яё]*$', '', 'Пропустить: строки без маленьких букв.', 'Skip: a line without lower-case letters.'],
  ['^.*[а-яё][.] ?[а-яё].*$', '', 'Пропустить: строка с сокращением.', 'Skip: a line with an abbreviation.'],
  ['^(УДК|ББК|ISBN)', '', 'Пропустить:  издательские  данные.', 'Skip: publishing data.'],
  ['^(Рис|Табл)[.]?[\\x20\\xA0]\\d', '', 'Пропустить: подпись рисунка или таблицы.', 'Skip: a caption of a picture or table.'],
  ['^(?=[^-–—*♠♣♦♥•■∙▶~©0-9].{2,69}$)', '', 'Найдено: неразмеченные стихи?', 'Found: unmarked poems?'],
];

/** addRegExp(): a space of a rule is a non-breaking space, and so is \xA0. */
function compileRule(source, keys) {
  const find_xA0 = /((\\)+?)xA0/gi;
  const replaceA0 = (all, brackets1) => (brackets1.length % 2 == 1 ? nbspChar : all);
  return jre(source.replace(/ /g, nbspChar).replace(find_xA0, replaceA0), 'g' + keys);
}

/** The containers (and paragraph classes) the rules' conditions exclude. */
const EXCLUDED = new Set(['title', 'subtitle', 'cite', 'poem', 'stanza', 'text-author', 'epigraph', 'annotation']);

/** The paragraph's text as searchNext() made it (tags removed, a picture as ǾǾǾ, entities decoded). */
function searchText(el) {
  return el.innerHTML
    .replace(/<(?!IMG\b).*?(>|$)/gi, '')
    .replace(/<IMG\b.*?>/gi, 'ǾǾǾ')
    .replace(/&shy;/g, '­')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** The length of a paragraph in selection offsets: characters, a picture counts as one. */
function blockLength(el) {
  const source = el.source;
  if (source && el.html === el.initial?.html) {
    return (source.content ?? []).reduce((n, item) => n + (item.type === 'text' ? (item.text ?? '').length : 1), 0);
  }
  return decodeEntities(el.html.replace(/<IMG\b[^>]*>/gi, '￼').replace(/<[^>]*>/g, '')).length;
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  const fbwBody = page.fbwBody;
  const paragraphs = fbwBody.getElementsByTagName('P');
  const firstBodyIndex = paragraphs.findIndex((p) => p.parentNode && !page.annotation.contains(p) && !page.history.contains(p));
  const rules = RULES.map(([source, keys, ru, en]) => ({ re: compileRule(source, keys), desc: ru, descEn: en }));

  const sel = await mfbe.selection.get();
  if (sel && sel.nodes.length === 0 && sel.text === '￼') {
    await MsgBox(tr(ctx, 'Не обрабатываемый тип выделения: sel.type', 'Unsupported kind of selection.'));
    return;
  }

  /** The place of the end of the selection (tr.collapse(false)): {index, offset} in `paragraphs`. */
  const placeOf = (position) => {
    if (!position) return null;
    const index = paragraphs.findIndex((p) => p.model?.attrs?.nodeId === position.nodeId);
    if (index >= 0) return { index, offset: position.offset };
    // A caret outside text (a section): the first paragraph from that place on.
    const div = fbwBody.getElementsByTagName('DIV').find((d) => d.model?.attrs?.nodeId === position.nodeId);
    if (!div) return null;
    const after = div.childNodes.slice(position.offset);
    for (const child of after) {
      const p = child.nodeName === 'P' ? child : child.getElementsByTagName('P')[0];
      if (p) return { index: paragraphs.indexOf(p), offset: 0 };
    }
    return null;
  };
  let start = { index: firstBodyIndex, offset: 0 };
  if (sel) {
    const a = placeOf(sel.anchor);
    const h = placeOf(sel.head);
    const later = a && h ? (a.index > h.index || (a.index === h.index && a.offset > h.offset) ? a : h) : a ?? h;
    if (later) start = later;
  }
  // Fix: the book annotation and the history are not searched (they come before the bodies).
  if (start.index < firstBodyIndex) start = { index: firstBodyIndex, offset: 0 };

  let status = '';
  let selection = null;

  /** searchNext() until a "found" rule matches: the paragraph's index, or null. */
  const search = (from) => {
    let lastSkip = null;
    for (let i = Math.max(from.index, 0); i < paragraphs.length; i++) {
      const el = paragraphs[i];
      if (i < firstBodyIndex || !el.parentNode) continue;
      const s = searchText(el);
      const s_len = s.length;
      const s1_len = i === from.index ? from.offset : 0;
      if (!(s1_len < s_len || s_len == 0)) continue;
      // getTags() / checkAreWeInRightTags(): -title -subtitle -cite -poem -stanza -text-author -epigraph -annotation
      if (EXCLUDED.has(el.className) || el.className === 'td' || el.className === 'th') continue;
      let excluded = false;
      for (let a = el.parentNode; a && a !== fbwBody; a = a.parentNode) if (EXCLUDED.has(a.className)) excluded = true;
      if (excluded) continue;
      const founds = [];
      rules.forEach((rule, index) => {
        rule.re.lastIndex = s1_len;
        const rslt = rule.re.exec(s);
        if (rslt) founds.push({ pos: rslt.index, len: rslt[0].length, re: index });
      });
      founds.sort((x, y) => x.pos - y.pos);
      if (!founds.length) continue;
      const first = founds[0];
      const rule = rules[first.re];
      status = tr(ctx, rule.desc, rule.descEn);
      if (rule.desc.indexOf('Пропустить') == 0) {
        lastSkip = { index: i, offset: first.pos + first.len };
        continue;
      }
      return { index: i, lastSkip };
    }
    return { index: -1, lastSkip };
  };

  /** selPoem(): the fragment from the found paragraph, selected; whether to stop there. */
  const selPoem = (index) => {
    const found = paragraphs[index];
    const pe = found.parentNode;
    // pe.outerHTML from the cursor mark, the mark moved before a bare <P> and the top cut off.
    const own = found.outerHTML;
    let txt = own.startsWith('<P>') ? own : `${found.html}</P>`;
    const siblings = pe.childNodes.slice(pe.childNodes.indexOf(found) + 1);
    for (const sibling of siblings) txt += `\r\n${sibling.outerHTML}`;
    txt += '</DIV>';

    let txtBezTags = txt.replace(/<[^>]*>/g, '');
    txtBezTags = txtBezTags.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&shy;/g, String.fromCharCode(173)).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    const lines = txtBezTags.split('\n');
    let i;
    for (i = 0; i < lines.length; i++) {
      if (!(lines[i].length <= 67)) break;
    }
    txt = txt.replace(jre('<(P|DIV) (class=|onresiz).+?>\\r\\n((.+\\r?\\n?)*)', 'mi'), '');
    txt = txt.replace(jre('(([^\\r\\n]+\\r\\n){' + i + '})((.+\\r?\\n?)*)', 'mi'), '$1');
    txt = txt.replace(jre('<SUP>[^>]*<\\/SUP>|\\[\\d+\\]|\\{\\d+\\}', 'gi'), (match) => match.replace(/\d/g, '*'));
    txt = txt.replace(jre('<(?!\\/?(STRONG|EM)(?=>|\\s.*>))\\/?.*?>', 'gi'), '');
    txt = txt.replace(/<\/EM><EM>/gi, '');
    txt = txt.replace(/<(EM)><\/EM>/gi, '');
    txt = txt.replace(/<\/STRONG><STRONG>/gi, '');
    txt = txt.replace(/<STRONG><\/STRONG>/gi, '');
    txt = txt.replace(jre('^(?:<(?:EM|STRONG)>){1,2}([^<\\r\\n]+)(?:<\\/(?:EM|STRONG)>){1,2}(?!$)', 'img'), '$1');
    txt = txt.replace(jre('^([^<\\r\\n]+?)(?:<(?:EM|STRONG)>){1,2}([^<\\r\\n]+?)(?:<\\/(?:EM|STRONG)>){1,2}(?=$)', 'img'), '$1$2');
    txt = txt.replace(/<EM><STRONG>|<STRONG><EM>/g, '<ES>');
    txt = txt.replace(/<\/EM><\/STRONG>|<\/STRONG><\/EM>/g, '</ES>');
    txt = txt.replace(/<\/ES><ES>/gi, '');
    txt = txt.replace(/<ES><\/ES>/gi, '');
    txt = txt.replace(jre('(<\\/(EM|ES|STRONG)>\\r\\n)&nbsp;$', 'gmi'), '$1<$2>&nbsp;</$2>');
    txt = txt.replace(jre('(<\\/(EM|ES|STRONG)>\\r\\n)(?!<\\2>)', 'mi'), '$1<stuk/>');
    txt = txt.replace(jre('([^>]+?\\r\\n)(?=<(STRONG|EM|ES)>)', 'mi'), '$1<stuk/>');
    txt = txt.replace(/<\/?[^>/]+>/gi, '');
    txt = txt.replace(jre('(<stuk/>.+?)\\r\\n((.+\\r?\\n?)*)', 'mi'), '$1');
    const data = '(.* )?(1[789][0-9][0-9]|20[0-2][0-9])(?!([0-9]| год[а-я]|[-](й|е|х|м|го)))(.*[^.])?';
    txt = txt.replace(jre('^(?:<stuk/>)?(' + data + ')$', 'gmi'), '$1');
    txt = txt.replace(/☺/g, '☻');
    txt = txt.replace(jre('^(.* )?(1[789][0-9][0-9]|20[0-2][0-9])(?!([0-9]| год[а-я]|[-](й|е|х|м|го)))(.*[^.])?$', 'mg'), (match) => match.replace(/[0-9]/g, '☺'));
    txt = txt.replace(jre('<stuk/>.+?$', 'mi'), '');
    txt = txt.replace(/<\/?[^>/]+>/gi, '');
    txt = txt.replace(/<\/?[^>]+>/g, '');
    txt = txt.replace(/&lt;/g, '<');
    txt = txt.replace(/&gt;/g, '>');
    txt = txt.replace(/&shy;/g, String.fromCharCode(173));
    txt = txt.replace(/\r\n/gm, '\n');
    txt = txt.replace(/^&nbsp;\n/gm, '\n');
    txt = txt.replace(/&nbsp;/g, ' ');
    txt = txt.replace(/&amp;/g, '&');
    txt = txt.replace(jre('^([*♠♣♦♥•■▶~©+].*\\r?\\n?)((.*\\r?\\n?)*)', 'm'), '');
    txt = txt.replace(jre('^(.*☺.*\\n)((.*\\n?)*)', 'm'), '$1');
    txt = txt.replace(jre('^([a-zа-яё]\\)[.]?[\\x20\\xA0].*\\r?\\n?)((.*\\r?\\n?)*)', 'm'), '');
    txt = txt.replace(jre('^((Рис|Табл)[.]?[\\x20\\xA0]\\d+.*\\r?\\n?)((.*\\r?\\n?)*)', 'm'), '');
    txt = txt.replace(jre('^(.*(@|https?|ftp|www\\.).*\\n)((.*\\n?)*)', 'm'), '');
    txt = txt.replace(jre('^(.*[а-яё][.] ?[а-яё].*\\n)((.*\\n?)*)', 'm'), '');
    txt = txt.replace(jre('^([^a-zа-яё☺]*[A-ZА-ЯЁ]+[^a-zа-яё☺]*\\n)((.*\\n?)*)', 'm'), '');
    txt = txt.replace(jre('^\\n\\n+((.*\\n?)*)', 'm'), '');
    if (txt.split('\n').length <= 10) {
      txt = txt.replace(jre('^([-—–].*\\r?\\n?)((.*\\r?\\n?)*)', 'm'), '');
      txt = txt.replace(jre('^(.*[0-9].*\\n)((.*\\n?)*)', 'm'), '');
    }
    txt = txt.replace(jre('^\\n*$', 'm'), '');

    let characterCount = txt.length;
    // characterCount-- in the original, meant for the line break after the last line; a fragment
    // that ends its section has none (fix: it was selected one character short).
    if (txt.endsWith('\n')) characterCount--;
    const anchor = { nodeId: found.model?.attrs?.nodeId, offset: 0 };
    if (characterCount <= 0) {
      // ttr1.moveEnd("character", 2): the next search starts two characters on.
      return { anchor, head: anchor, nonStop: 0, next: { index, offset: 2 } };
    }
    // ttr1.moveEnd("character", characterCount): a paragraph break counts as one character.
    let rest = characterCount;
    const chain = [found];
    for (const sibling of siblings) {
      if (sibling.nodeName !== 'P') break;
      chain.push(sibling);
    }
    let c = 0;
    let end = { index, offset: 0 };
    while (c < chain.length) {
      const len = blockLength(chain[c]);
      if (rest <= len || c === chain.length - 1) {
        end = { index: paragraphs.indexOf(chain[c]), offset: Math.min(rest, len) };
        break;
      }
      rest -= len + 1;
      c += 1;
    }
    const k = end.index;
    const touched = paragraphs.slice(index, k + 1);
    const result = touched.filter((p) => p.outerHTML.startsWith('<P>')).length;
    const emptyLinesS = txt.match(/\n\s*\n(?!$)/gm) || [];
    const dotEnd = txt.match(/^«?[А-ЯЁ].+[.]$/gm) || [];
    const dot2End = txt.match(/:\n/m) || [];
    const head = { nodeId: paragraphs[k].model?.attrs?.nodeId ?? anchor.nodeId, offset: end.offset };
    let nonStop;
    if (result <= 1) nonStop = 0;
    else if (result >= 2 && dotEnd.length >= 2 && result == dotEnd.length) nonStop = 0;
    else if (result == 2 && dot2End.length >= 1) nonStop = 0;
    else if (emptyLinesS.length == 1 && result == 3) nonStop = 0;
    else nonStop = 1;
    return { anchor, head, nonStop, next: end };
  };

  let nonStop;
  let from = start;
  do {
    const { index, lastSkip } = search(from);
    if (index < 0) {
      // "Поиск завершен!": the caret where the last searchNext() started.
      const at = lastSkip ?? from;
      const el = paragraphs[Math.min(Math.max(at.index, 0), paragraphs.length - 1)];
      if (el?.model?.attrs?.nodeId) {
        const offset = Math.min(at.offset, blockLength(el));
        selection = { anchor: { nodeId: el.model.attrs.nodeId, offset }, head: { nodeId: el.model.attrs.nodeId, offset } };
      }
      if (selection) await mfbe.selection.set(selection.anchor, selection.head);
      await mfbe.ui.status(tr(ctx, 'Поиск завершен!', 'Search finished!'), { sticky: true });
      await MsgBox(tr(ctx, 'От позиции курсора до конца документа ничего не найдено.', 'Nothing was found from the caret to the end of the document.'));
      return;
    }
    const res = selPoem(index);
    selection = res;
    nonStop = res.nonStop;
    from = res.next;
    if (ctx.cancelled) return;
  } while (nonStop == 0);

  await mfbe.selection.set(selection.anchor, selection.head);
  await mfbe.selection.scrollIntoView();
  if (status) await mfbe.ui.status(status, { sticky: true });
}
