// Engine of the quote-placing scripts of FictionBook Editor 2.7.9's group 12_Обработка кавычек
// (Sclex): 001 "Проставить елочки и лапки (от начала документа)", 004-006 "... (от позиции
// курсора ...)" and 007 "Проставить только елочки (во всем документе)". Converted from their
// 2.7beta1 versions first and brought up to 2.7.9 (versions 3.9 and 3.7) in feature 007. Each of
// the five packages carries an identical copy: the sandbox only loads modules from the script's
// own folder.
//
// The originals worked on the book as FictionBook Editor showed it (lib/nav-lib.js rebuilds that
// page: the book's annotation and its history first, then every body) between two markers: the
// selection when text is selected, otherwise the whole page (001, 007) or the caret to the end of
// the page (004-006). A first pass turns every «, », „, “ and ” of that range into a straight
// quote; the second decides each straight quote from up to four characters on either side within
// its paragraph (analyseSymbolOnTheLeft/Right, decideIsItLeftOrRightQuotes - the expressions are
// kept as written, \s with JScript's meaning) and replaces it by the quote of its nesting level
// (« » at level 0, „ “ at levels 1 and 2). 001-006 track the level from paragraph to paragraph:
// it must be 0 at the end of every section, of the book's annotation and of its history (2.7.9),
// unchanged at the end of every other block entered inside the range (a stanza aside), and 0 at
// the end of the range; a quote that would go deeper than level 2 or below 0, or that is neither
// clearly opening nor clearly closing, stops the script there. The script then selects the quote,
// or the last two characters of the block or range, and shows the error with the counts; what it
// changed up to there stays (one Undo reverts the run). 007 needs no levels: an undecided quote
// stays straight and is counted.
//
// Differences from 2.7.9 (docs/scripting/conversion-notes-279-b.md, group 12): quotes inside the
// text of a note link are left alone, in both passes; the editor scrolls the selection into view;
// a selected picture is refused by 004-006 (the original stopped with a script error there).
// The original's notice, kept as written (FR-029):
//Скрипт "Новые кавычки на елочки"
//Автор Sclex
//Подробности тут: http://www.fictionbook.org/forum/viewtopic.php?f=7&t=4412
//И тут: http://scripts.fictionbook.org

import { loadBook, locate, refusePicture, textOf, t } from './lib/nav-lib.js';
import { PageEdits } from './lib/page-paragraphs.js';

const NBSP = '\u00A0';
// 007's messages indent their lines with non-breaking spaces.
const IND2 = NBSP.repeat(2);
const IND3 = NBSP.repeat(3);
const LEFT_QUOTES = ['«', '„', '„', '‘'];
const RIGHT_QUOTES = ['»', '“', '“', '’'];
// JScript's \s: no U+00A0 and no other Unicode space.
const SPACE = '[\\t\\n\\v\\f\\r ]';

// The original's character classes, kept as written (re4's `w|` had lost the backslash of its
// \w inside a string literal).
const RE1 = new RegExp(`${SPACE}|[-–—(${NBSP}]`, 'i');
const RE2 = new RegExp(`\\w|[${"а-яёa-z?!)“,°ÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƏƒƠơƯưƷǤǥǦǧǨǩǪǫǮǯǺǻǼǽǾǿȘșȚțȨȩəʒΆΈΉΊΌΎΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѐђѓєѕіїјљњћќѝўџҐґҒғҖҗҚқҜҝҢңҮүҰұҲҳҸҹҺһӘәӨөḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼῂῃῄῆῇῈΈῊΉῌῐῑῒΐῖῗῘῙῚΊῠῡῢΰῤῥῦῧῨῩῪΎῬῲῳῴῶῷῸΌῺΏῼªº%‰©µ¶ℓ™℗⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉£¤¢¥€$¼½¾"}]`, 'i');
const RE3 = new RegExp(`[-?!,;–—)${NBSP}]|${SPACE}`, 'i');
const RE4 = new RegExp(`w|[${"а-яёa-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿĀāăĄąĆćĈĉĊċČčĎďĐđĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĦħĨĩĪīĬĭĮįİıĲĳĴĵĶķĸĹĺĻļĽľĿŀŁłŃńŅņŇňŉŊŋŌōŎŏŐőŒœŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŦŧŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƏƒƠơƯưƷǤǥǦǧǨǩǪǫǮǯǺǻǼǽǾǿȘșȚțȨȩəʒΆΈΉΊΌΎΐΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΪΫάέήίΰαβγδεζηθικλμνξοπρςστυφχψωϊϋόύώЀЁЂЃЄЅІЇЈЉЊЋЌЍЎЏѐђѓєѕіїјљњћќѝўџҐґҒғҖҗҚқҜҝҢңҮүҰұҲҳҸҹҺһӘәӨөḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẚẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹἀἁἂἃἄἅἆἇἈἉἊἋἌἍἎἏἐἑἒἓἔἕἘἙἚἛἜἝἠἡἢἣἤἥἦἧἨἩἪἫἬἭἮἯἰἱἲἳἴἵἶἷἸἹἺἻἼἽἾἿὀὁὂὃὄὅὈὉὊὋὌὍὐὑὒὓὔὕὖὗὙὛὝὟὠὡὢὣὤὥὦὧὨὩὪὫὬὭὮὯὰάὲέὴήὶίὸόὺύὼώᾀᾁᾂᾃᾄᾅᾆᾇᾈᾉᾊᾋᾌᾍᾎᾏᾐᾑᾒᾓᾔᾕᾖᾗᾘᾙᾚᾛᾜᾝᾞᾟᾠᾡᾢᾣᾤᾥᾦᾧᾨᾩᾪᾫᾬᾭᾮᾯᾰᾱᾲᾳᾴᾶᾷᾸᾹᾺΆᾼῂῃῄῆῇῈΈῊΉῌῐῑῒΐῖῗῘῙῚΊῠῡῢΰῤῥῦῧῨῩῪΎῬῲῳῴῶῷῸΌῺΏῼªº©µ¶ℓ⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉£¤¢¥€$¼½¾"}]`, 'i');
const RE5 = /[-–—]/i;

function analyseSymbolOnTheLeft(ch) {
  if (ch === undefined) return 'left quotes';
  if (ch.search(RE1) === 0) return 'left quotes';
  if (ch.search(RE2) === 0) return 'right quotes';
  return undefined;
}

function analyseSymbolOnTheRight(ch) {
  if (ch === undefined) return 'right quotes';
  if (ch.search(RE3) === 0) return 'right quotes';
  if (ch.search(RE4) === 0) return 'left quotes';
  return undefined;
}

const ellipsisAfter = (n) => (n[1] === '.' && n[2] === '.' && n[3] === '.') || n[1] === '…';
const ellipsisBefore = (n) => (n[-1] === '.' && n[-2] === '.' && n[-3] === '.') || n[-1] === '…';

/** `n[-4..-1]` and `n[1..4]` are the neighbours; returns { left, right } as the original decided. */
export function decideIsItLeftOrRightQuotes(n) {
  let left = false;
  let right = false;
  let anLeft;
  if (n[-1] === '.' && n[-2] === '.' && n[-3] !== '.') anLeft = analyseSymbolOnTheLeft(n[-3]);
  else if (n[-1] === '.' && n[-2] === '.' && n[-3] === '.') anLeft = analyseSymbolOnTheLeft(n[-4]);
  else if (n[-1] === '…') anLeft = analyseSymbolOnTheLeft(n[-2]);
  else anLeft = analyseSymbolOnTheLeft(n[-1]);
  if (anLeft === 'left quotes') left = true;
  else if (anLeft === 'right quotes') right = true;
  let anRight;
  if (n[1] === '.' && n[2] === '.' && n[3] === '.') anRight = analyseSymbolOnTheRight(n[4]);
  else if (n[1] === '…') anRight = analyseSymbolOnTheRight(n[2]);
  else anRight = analyseSymbolOnTheRight(n[1]);
  if (anRight === 'left quotes') left = true;
  else if (anRight === 'right quotes') right = true;
  if (n[-1] === '.' && n[1] === '.') right = true;
  if (n[-1] === '…' && n[1] === '…') right = true;
  if (n[1] === '.' && n[2] !== '.') right = true;
  if (n[-1] === '.' && n[-2] !== '.') right = true;
  // 2.7.9: an ellipsis after the quote makes it an opening one, and an ellipsis before it a
  // closing one, only when there is none on the other side.
  if (right && left && ellipsisAfter(n) && !ellipsisBefore(n)) return { left, right: false };
  if (right && left && ellipsisBefore(n) && !ellipsisAfter(n)) return { left: false, right };
  if (right && left && n[1] !== undefined && n[1].search(RE5) >= 0) return { left, right: false };
  return { left, right };
}

/* ------------------------------------------------------------------------------------------ */

const isNoteRun = (run) => (run.marks ?? []).some((m) => m.type === 'link' && m.attrs?.type === 'note');

class QuoteError extends Error {
  constructor(message, select) {
    super(message);
    this.select = select;
  }
}

/**
 * Runs one of the scripts. `options`: `version` {ru, en} (the script's line in every message),
 * `block` [ru, en] (the element named by the error at a block's end: 'блочного элемента' in 001,
 * 'элемента' in 004-006), `startLevel`, `fromCaret` (004-006), `skipDescriptionEnd` (005, 006),
 * `onlyGuillemets` (007).
 */
export async function placeQuotes(ctx, options) {
  const ru = ctx.uiLanguage === 'ru';
  const [blockRu, blockEn] = options.block ?? ['элемента', 'an element'];
  const only = !!options.onlyGuillemets;
  const versionStr = `${t(ctx, options.version.ru, options.version.en)}\n${t(ctx, 'Автор Sclex.', 'Author: Sclex.')}\n\n`;
  const leftCnt = [0, 0, 0, 0];
  const rightCnt = [0, 0, 0, 0];
  let notReplaced = 0;

  const infoStr = () => {
    if (only) {
      return t(
        ctx,
        `Проставлено елочек:\n\n${IND3}левых – « – ${leftCnt[0]}\n${IND3}правых – » – ${rightCnt[0]}\n${IND2}———————————\n${IND3}Всего: ${leftCnt[0] + rightCnt[0]}`,
        `Guillemets placed:\n\n${IND3}left – « – ${leftCnt[0]}\n${IND3}right – » – ${rightCnt[0]}\n${IND2}———————————\n${IND3}Total: ${leftCnt[0] + rightCnt[0]}`,
      );
    }
    const lines = [];
    for (let i = 0; i < 3; i += 1) {
      lines.push(ru ? `${i}-го уровня – ${LEFT_QUOTES[i]} – ${leftCnt[i]}` : `level ${i} – ${LEFT_QUOTES[i]} – ${leftCnt[i]}`);
      lines.push(ru ? `${i}-го уровня – ${RIGHT_QUOTES[i]} – ${rightCnt[i]}` : `level ${i} – ${RIGHT_QUOTES[i]} – ${rightCnt[i]}`);
    }
    const total = leftCnt.reduce((a, b) => a + b, 0) + rightCnt.reduce((a, b) => a + b, 0);
    return `${t(ctx, 'Проставлено кавычек:', 'Quotes placed:')}\n\n${lines.join('\n')}\n———————————\n${t(ctx, 'Всего', 'Total')}: ${total}`;
  };

  /* ---- the page and the range ---- */
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return;
  const ps = book.ps;
  if (!ps.length) return;
  if (where.picture && options.fromCaret) {
    await refusePicture(ctx);
    return;
  }
  const pageStart = { index: 0, offset: 0 };
  const pageEnd = { index: ps.length - 1, offset: textOf(ps[ps.length - 1]).length };
  // A point between paragraphs (in a container) counts from the next paragraph's start (a range
  // start) or up to the previous paragraph's end (a range end).
  const asStart = (p) =>
    Number.isInteger(p.index) ? { index: p.index, offset: p.offset } : { index: Math.ceil(p.index), offset: 0 };
  const asEnd = (p) => {
    if (Number.isInteger(p.index)) return { index: p.index, offset: p.offset };
    const index = Math.floor(p.index);
    return index < 0 ? { index: -1, offset: 0 } : { index, offset: textOf(ps[index]).length };
  };
  let start;
  let end;
  if (!where.collapsed && !where.picture) {
    start = asStart(where.start);
    end = asEnd(where.end);
  } else if (options.fromCaret) {
    start = asStart(where.start);
    end = pageEnd;
  } else {
    start = pageStart;
    end = pageEnd;
  }
  if (start.index >= ps.length || end.index < start.index) return;

  /* ---- the paragraphs' content, changed in place ---- */
  const contents = new Map(); // paragraph index -> runs (copies), once touched
  const changed = new Set();
  const runsOf = (index) => {
    if (!contents.has(index)) {
      const item = ps[index];
      const content = item.kind === 'p' && !item.isPlaceholder ? (item.node.content ?? []) : [];
      contents.set(
        index,
        content.map((run) => (run.type === 'text' ? { ...run, text: run.text ?? '' } : run)),
      );
    }
    return contents.get(index);
  };
  /** The characters the original saw: `{ ch, run, offset, pos }`, pictures and note links left out. */
  const charsOf = (index) => {
    const out = [];
    let pos = 0;
    runsOf(index).forEach((run, r) => {
      if (run.type !== 'text') {
        pos += 1;
        return;
      }
      if (!isNoteRun(run)) {
        for (let k = 0; k < run.text.length; k += 1) out.push({ ch: run.text[k], run: r, offset: k, pos: pos + k });
      }
      pos += run.text.length;
    });
    return out;
  };
  const put = (index, entry, ch) => {
    const run = runsOf(index)[entry.run];
    run.text = run.text.slice(0, entry.offset) + ch + run.text.slice(entry.offset + 1);
    entry.ch = ch;
    changed.add(index);
  };
  const rangeOf = (index, fromStart = true) => ({
    from: index === start.index && fromStart ? start.offset : 0,
    to: index === end.index ? end.offset : Infinity,
  });

  // The first pass: every typographic quote of the range becomes a straight one.
  for (let i = start.index; i <= end.index; i += 1) {
    if (ctx.cancelled) return;
    const { from, to } = rangeOf(i);
    for (const entry of charsOf(i)) {
      if (entry.pos >= from && entry.pos < to && '«»„“”'.includes(entry.ch)) put(i, entry, '"');
    }
  }

  /* ---- the second pass ---- */
  let level = options.startLevel ?? 0;
  const checks = !only;

  /** Selects the last `count` characters before a paragraph point (moveStart("character", -2)). */
  const lastChars = (index, offset, count = 2) => {
    let head = null;
    for (let i = index; i >= 0 && !head; i -= 1) {
      const length = textOf(ps[i]).length;
      const at = i === index ? Math.min(offset, length) : length;
      if (ps[i].nodeId && at > 0) head = { index: i, offset: at };
    }
    if (!head) return null;
    let left = count;
    let anchor = { index: head.index, offset: head.offset };
    while (left > 0) {
      if (anchor.offset >= left) {
        anchor = { index: anchor.index, offset: anchor.offset - left };
        break;
      }
      left -= anchor.offset;
      let i = anchor.index - 1;
      while (i >= 0 && !(ps[i].nodeId && textOf(ps[i]).length)) i -= 1;
      if (i < 0) {
        anchor = { index: anchor.index, offset: 0 };
        break;
      }
      anchor = { index: i, offset: textOf(ps[i]).length };
    }
    return { anchor, head };
  };
  const lastParagraphOf = (item) => {
    let last = null;
    const visit = (node) => {
      if (node.kind === 'p') last = node;
      else for (const child of node.children) visit(child);
    };
    visit(item);
    return last;
  };
  const endOf = (item) => {
    const p = lastParagraphOf(item);
    return p ? lastChars(p.index, textOf(p).length) : null;
  };

  const kindOf = (item) => {
    if (item.type === 'annotation-block') return 'annotation';
    if (item.type === 'history-block') return 'history';
    return item.type === 'section' ? 'section' : null;
  };
  const nonZeroAtEnd = (item) => {
    const kind = kindOf(item);
    const ruText = {
      annotation: ['аннотации документа', 'аннотации документа', 'ней', 'этой аннотации документа'],
      history: ['истории документа', 'истории документа', 'ней', 'этой истории документа'],
      section: ['раздела', 'разделе', 'нем', 'этого раздела'],
    }[kind];
    const enText = {
      annotation: ["the document's annotation", 'that annotation'],
      history: ["the document's history", 'that history'],
      section: ['the section', 'that section'],
    }[kind];
    return new QuoteError(
      t(
        ctx,
        `Ошибка:\n\nВ конце ${ruText[0]} получился ненулевой уровень вложенности кавычек.\nТо есть не все открытые в ${ruText[1]} кавычки были в ${ruText[2]} закрыты.\nВыделение установлено в конец ${ruText[3]}.`,
        `Error:\n\nThe quote nesting level is not zero at the end of ${enText[0]}.\nThat is, not every quote opened in it was closed in it.\nThe selection was placed at the end of ${enText[1]}.`,
      ),
      endOf(item),
    );
  };
  const levelChanged = (item) =>
    new QuoteError(
      t(
        ctx,
        `Ошибка:\n\nВ конце ${blockRu} получился не тот же уровень вложенности кавычек, что в начале.\nВыделение установлено в конец этого элемента.`,
        `Error:\n\nThe quote nesting level at the end of ${blockEn} differs from the level at its start.\nThe selection was placed at the end of that element.`,
      ),
      endOf(item),
    );

  const decideParagraph = (index, from, to) => {
    const chars = charsOf(index);
    for (let k = 0; k < chars.length; k += 1) {
      const entry = chars[k];
      if (entry.ch !== '"' || entry.pos < from || entry.pos >= to) continue;
      const n = {};
      for (let d = 1; d <= 4; d += 1) {
        if (chars[k - d]) n[-d] = chars[k - d].ch;
        if (chars[k + d]) n[d] = chars[k + d].ch;
      }
      const { left, right } = decideIsItLeftOrRightQuotes(n);
      const quote = { anchor: { index, offset: entry.pos }, head: { index, offset: entry.pos + 1 } };
      if (only) {
        if (left && !right) {
          put(index, entry, '«');
          leftCnt[0] += 1;
        } else if (!left && right) {
          put(index, entry, '»');
          rightCnt[0] += 1;
        } else notReplaced += 1;
        continue;
      }
      if (left && !right) {
        level += 1;
        if (level > 3) {
          throw new QuoteError(
            t(ctx, 'Ошибка:\n\nкавычка получается больше чем второго уровня вложения.', 'Error:\n\nthe quote would be nested deeper than level 2.'),
            quote,
          );
        }
        put(index, entry, LEFT_QUOTES[level - 1]);
        leftCnt[level - 1] += 1;
      } else if (!left && right) {
        if (level === 0) {
          throw new QuoteError(
            t(ctx, 'Ошибка:\n\nкавычка получается меньше чем нулевого уровня вложения.', 'Error:\n\nthe quote would close below level 0.'),
            quote,
          );
        }
        put(index, entry, RIGHT_QUOTES[level - 1]);
        rightCnt[level - 1] += 1;
        level -= 1;
      } else {
        throw new QuoteError(
          t(ctx, 'Не удалось определить, является кавычка открывающей или же закрывающей.', 'Could not tell whether the quote opens or closes.'),
          quote,
        );
      }
    }
  };

  // 005/006 (2.7.9): with the caret at the end of a paragraph that stands directly in the book's
  // annotation or history, the second pass starts with the block that follows that one.
  let jumpTarget = null;
  if (options.skipDescriptionEnd) {
    const p = ps[start.index];
    const block = p.parent;
    if (
      p.kind === 'p' &&
      block &&
      (block.type === 'annotation-block' || block.type === 'history-block') &&
      start.offset >= textOf(p).length
    ) {
      jumpTarget = block.parent.children[block.at + 1] ?? null;
    }
  }

  let started = false;
  let stopped = false;
  const visit = (item) => {
    if (stopped) return;
    if (item.kind === 'p') {
      if (!started) {
        if (options.skipDescriptionEnd && jumpTarget !== null) return;
        if (item.index !== start.index) return;
        started = true;
      }
      const { from, to } = rangeOf(item.index, jumpTarget === null);
      decideParagraph(item.index, from, to);
      if (item.index === end.index) stopped = true;
      return;
    }
    if (!started && item === jumpTarget) started = true;
    const entered = started;
    const levelAtStart = level;
    for (const child of item.children) {
      visit(child);
      if (stopped) return;
    }
    if (!started || !checks || item.type === 'root') return;
    if (kindOf(item) && level !== 0) throw nonZeroAtEnd(item);
    if (entered && item.type !== 'stanza' && level !== levelAtStart) throw levelChanged(item);
  };

  let failure = null;
  try {
    visit(book.root);
    if (checks && level !== 0) {
      throw new QuoteError(
        t(
          ctx,
          'Ошибка:\n\nВ конце области документа, заданной для обработки, получился ненулевой уровень вложенности кавычек.\nВыделение установлено в конец этой области.',
          'Error:\n\nThe quote nesting level is not zero at the end of the part of the document chosen for processing.\nThe selection was placed at the end of that part.',
        ),
        lastChars(end.index, end.offset),
      );
    }
  } catch (error) {
    if (!(error instanceof QuoteError)) throw error;
    failure = error;
  }
  if (ctx.cancelled) return;

  /* ---- writing back: the bodies' paragraphs one by one, the description's at once ---- */
  const edits = new PageEdits();
  const order = [...changed].sort((a, b) => a - b);
  for (let k = 0; k < order.length; k += 1) {
    if (ctx.cancelled) return;
    if (k % 50 === 0) await mfbe.ui.progress(k, order.length);
    const item = ps[order[k]];
    await edits.put(item, { ...item.node, content: contents.get(order[k]) });
  }
  await edits.commit();

  if (failure) {
    const at = failure.select;
    if (at && ps[at.anchor.index].nodeId && ps[at.head.index].nodeId) {
      await mfbe.selection.set(
        { nodeId: ps[at.anchor.index].nodeId, offset: at.anchor.offset },
        { nodeId: ps[at.head.index].nodeId, offset: at.head.offset },
      );
      await mfbe.selection.scrollIntoView();
    }
    await mfbe.ui.message(`${versionStr}${failure.message}\n\n${infoStr()}`, { caption: ctx.script.name, icon: 'warning' });
    return;
  }
  // The text kept its length: the selection is put back where it was.
  await mfbe.selection.set(where.selection.anchor, where.selection.head).catch(() => {});
  if (only && notReplaced > 0) {
    await mfbe.ui.message(
      `${versionStr}${t(
        ctx,
        `Елочки проставлены, но...\n\n...в некоторых случаях было непонятно,\nоткрывающие или закрывающие елочки нужно проставить,\nпоэтому скрипт оставлял прямые кавычки.\n\n${IND3}Осталось прямых кавычек – " – ${notReplaced}`,
        `Guillemets were placed, but...\n\n...in some places it was unclear\nwhether an opening or a closing guillemet was needed,\nso the script left the straight quotes.\n\n${IND3}Straight quotes left – " – ${notReplaced}`,
      )}\n\n${infoStr()}`,
      { caption: ctx.script.name, icon: 'warning' },
    );
    return;
  }
  await mfbe.ui.message(
    `${versionStr}${
      only
        ? t(ctx, 'Ура! Проставить елочки удалось без ошибок.', 'Hooray! The guillemets were placed without errors.')
        : t(ctx, 'Ура! Проставить кавычки удалось без ошибок.', 'Hooray! The quotes were placed without errors.')
    }\n\n${infoStr()}`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
