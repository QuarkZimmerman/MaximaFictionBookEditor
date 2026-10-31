// Converted from FictionBook Editor 2.7.9: Scripts/10_Статистика/07_Общая статистика.js
// The fullest statistics of the book: lines, words and characters; per part of the book (the
// book's annotation and the history, the main bodies, the notes and comments bodies, unknown root
// parts) the sections of each level with their titles, epigraphs and annotations, the poems with
// their titles, epigraphs, stanzas and text authors, cites, subtitles, text authors, tables,
// ordinary lines and empty lines; the attached files (unused ones, copies, sizes); the covers and
// pictures by format, repeated and empty ones; the inline formatting (italics, bold, both, super-
// and subscripts, strikethrough, code, styles, note and comment links, hyperlinks); and likely
// errors (the version missing from the history, unbalanced quotes, straight quotes, s p a c e d
// words, Latin letters inside Cyrillic words, a lower-case letter at the start of a line, large
// numbers without separators, a line starting with an asterisk, text or numbers in brackets,
// a number glued to a word). The results are shown page by page (at most Vysota_teksta lines).
// Then it offers to copy the text of the statistics to the clipboard and to save it in a TXT file
// (UTF-16 LE, through the editor's Save dialog).
// Differences from the original (docs/scripting/notes-279-drafts/10.md):
// - the original saved its text only when its setting SaveStat said so (0, the default: never;
//   1: the clipboard; 2: a TXT file, each after a question); a bundled script cannot be edited,
//   so both questions are asked, one after the other, after the results;
// - the result message shows no proverb: left out pending the requester's decision;
// - formatting is counted in the editor's terms: an element is a run of text with one mark, so
//   two adjacent elements of one kind count once, and formatting inside a link is taken as
//   inside it (2.7.9 counted the elements of the page as the file nested them).
// The original's notice, kept as written (FR-029):
//======================================
//             «Общая статистика»
// Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//======================================
// Скрипт предназначен для наиболее полного отображения статистических данных о файле FB2
// * История изменений в конце скрипта
//======================================
import { serializeInline } from './lib/legacy-html.js';

const ScriptName = '«Общая статистика»';
const NumerusVersion = '1.4';

// ---------------------------------------------------------------
///  НАСТРОЙКИ (settings)
// ---------------------------------------------------------------
//   •  Максимум строк в окне результатов (0-50, примерно)
//  * Скрипт постарается не превышать это значение.
const VYSOTA_TEKSTA = 50;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// JScript's \s (the ASCII white space only) and the non-breaking space of the editor.
const S = '[\\t\\n\\v\\f\\r ]';
const nbspChar = ' ';
const nbspEntity = '&nbsp;';
const jscript = (source, flags) => new RegExp(source.replace(/\\s/g, S), flags);

/// ПОИСК И ПОДСЧЕТ (регулярные выражения), as the original wrote them
const reSp = jscript(`^(\\s|${nbspEntity}|&nbsp;){0,}$`, 'g'); // Пустые строки
const reA30 = /[\[]/g; // Квадратные скобки
const reA32 = /[\{]/g; // Фигурные скобки
const reA41 = /(«)/g; //   Угловая кавычка (левая)
const reA42 = /(»)/g; //   Угловая кавычка (правая)
const reA43 = /„/g; // Внутренняя кавычка (левая)
const reA44 = /“/g; // Внутренняя кавычка (правая)
const reA45 = /(\")/g; // Простые кавычки
const reA80 = jscript(`(\\s|${nbspChar})([А-яA-Za-zЁё0-9](\\s|${nbspChar})){4,}`, 'g'); // Выделение разрядкой
const reA81 = /([a-z][а-яё]|[а-яё][a-z])/gi; // Латиница в кириллице
const reA83 = jscript(`^(\\s|${nbspChar}){0,}\\*.{0,10}[А-яA-Za-zЁё]`, 'g'); // Звездочка в начале строки
const reA91 = /\[[^\]]{0,10}[А-яA-Za-zЁё]/g; // [ + буква
const reA92 = /\{[^\}]{0,10}[А-яA-Za-zЁё]/g; // Фигурная скобка + буква
const reA93 = /\[[0-9]{1,4}\]/g; // [число]
const reA93a = /\[[0-9]{1,4}\]<\/A>/g; // [число]  в сноске
const reA94 = /\{[0-9]{1,4}\}/g; // {число}
const reA94a = /\{[0-9]{1,4}\}<\/SUP><\/A>/g; // {число}  в сноске
// Большие числа (* Почти точная формула из соответствующего скрипта)
const reA95 = jscript('(^|[^\\d\\-N№/])(\\d{2,3}(\\s|\\.){0,2}\\d{3}|\\d{1,3}((\\s|\\.){0,2}\\d{3}){2,5})([^0-9/]|$)', 'g');
// Слово + число  (с учетом пунктуации)
const reA96 = jscript(`[а-яa-zё]{3,}[…\\.,:;\\?!»“”\\"]{0,4}\\d{1,4}([…\\.,:;\\?!\\)\\]»“”\\"'—–\\-]|\\s|${nbspChar}|$)`, 'g');
const reA97 = /^[а-яa-zё]{2}/g; // Строчные буквы в начале строки
const reCom = /#c_\d{1,3}\">[^A]{1,}?<\/A>/g; // Сноски на комментарии
const reWord = jscript(`(^|\\s|${nbspChar}).{0,}?[А-яA-Za-zЁё].{0,}?(?=\\s|${nbspChar}|$)`, 'g'); // все слова

const count = (text, re) => {
  const m = text.match(re);
  return m ? m.length : 0;
};

/* ------------------------------------------------------------------------------------------ */
/* FictionBook Editor's page (fbw_body) rebuilt from the document model                        */
/* ------------------------------------------------------------------------------------------ */

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);
// The class of each element on the page (files/fb2.xsl of 2.7.9): paragraphs and containers.
const P_CLASS = { p: '', v: '', 'empty-line': '', subtitle: 'subtitle', 'text-author': 'text-author', date: 'text-author', td: 'td', th: 'th' };

function buildPage(snapshot) {
  const build = (node, parent) => {
    const isP = node.type in P_CLASS;
    const item = { node, parent, p: isP, cls: isP ? P_CLASS[node.type] : node.type, children: [] };
    if (!isP && node.type !== 'image') {
      for (const child of node.content ?? []) {
        // Unknown elements (raw XML) were SPANs on the page: neither a P nor a DIV.
        if (child && typeof child === 'object' && child.type !== 'text' && child.type !== 'raw-xml') {
          item.children.push(build(child, item));
        }
      }
    }
    return item;
  };
  const root = { cls: 'root', p: false, children: [] };
  const block = (cls, node) => {
    const item = { node: node ?? { type: cls, content: [] }, parent: root, p: false, cls, top: true, children: [] };
    for (const child of node?.content ?? []) if (child.type !== 'raw-xml') item.children.push(build(child, item));
    // The book's annotation and history were always shown, with one empty paragraph if empty.
    if (item.children.length === 0) item.children.push({ node: { type: 'p', content: [] }, parent: item, p: true, cls: '', children: [] });
    root.children.push(item);
  };
  block('annotation', snapshot.description?.titleInfo?.annotation);
  block('history', snapshot.description?.documentInfo?.history);
  for (const body of snapshot.bodies ?? []) {
    const item = build(body, root);
    item.top = true;
    item.fbname = body.attrs?.name ?? '';
    root.children.push(item);
  }
  return root;
}

function descendants(item, wantP) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.p === wantP) out.push(child);
      if (!child.p) visit(child);
    }
  };
  visit(item);
  return out;
}

function nextSibling(item) {
  const siblings = item.parent?.children ?? [];
  return siblings[siblings.indexOf(item) + 1] ?? null;
}

/** innerText of a paragraph: its text without the pictures. */
function innerText(item) {
  return (item.node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
}

/** innerHTML of a paragraph as 2.7.9 rendered it: no languages, no xlink:type on links. */
function innerHTML(item) {
  if (item.node.type === 'empty-line') return '';
  const plain = (marks) =>
    marks?.map((mark) => {
      if (mark.type === 'link') return { type: 'link', attrs: { href: mark.attrs?.href ?? '', ...(mark.attrs?.type ? { type: mark.attrs.type } : {}) } };
      if (mark.type === 'style') return { type: 'style', attrs: { name: mark.attrs?.name ?? '' } };
      return { type: mark.type };
    });
  const content = (item.node.content ?? []).map((c) => (c.marks ? { ...c, marks: plain(c.marks) } : c));
  return serializeInline(content, []);
}

function divText(item) {
  return descendants(item, true).map(innerText).join('\r\n');
}

/**
 * The number of elements of a kind in a paragraph: runs of the inline content that carry one
 * mark (a mark of the kind with the same attributes).
 */
function runs(item, kind, rawXmlToo = false) {
  let total = 0;
  let previous = new Set();
  let raw = 0;
  for (const c of item.node.content ?? []) {
    const keys = new Set();
    // An unknown inline element was a SPAN of its own on the page, counted with the styles.
    if (c.type === 'raw-xml' && rawXmlToo) keys.add(`raw-xml ${(raw += 1)}`);
    for (const mark of c.marks ?? []) if (kind(mark)) keys.add(JSON.stringify(mark));
    for (const key of keys) if (!previous.has(key)) total += 1;
    previous = keys;
  }
  return total;
}

/** Bold italics: the parts of a paragraph that are both italic and bold. */
function boldItalicParts(item) {
  let total = 0;
  let previous = false;
  for (const c of item.node.content ?? []) {
    const types = new Set((c.marks ?? []).map((m) => m.type));
    const both = types.has('emphasis') && types.has('strong');
    if (both && !previous) total += 1;
    previous = both;
  }
  return total;
}

/* ------------------------------------------------------------------------------------------ */
/* Numbers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Функция округления до четырех знаков (включая точку) */
function okruglenie(ctx, num) {
  const a = `${num}`.replace(/^(.{1,4}).*/g, '$1').replace(/\.$/g, '');
  const b = +`1${a.replace(/\d/g, '0').replace(/^0+?(\.|$)/g, '')}`;
  const d = Math.round(num * b) / b;
  return t(ctx, `${d}`.replace(/\./g, ','), `${d}`);
}

/** Функция подсчета байт, килобайт, мегабайт */
function kilobytes(ctx, num0) {
  let num = num0;
  if (num === 0) return 0;
  if (num < 1024) return `${num}${t(ctx, ' Б', ' B')}`;
  num /= 1024;
  if (num < 1024) return `${okruglenie(ctx, num)}${t(ctx, ' кБ', ' KB')}`;
  num /= 1024;
  return `${okruglenie(ctx, num)}${t(ctx, ' МБ', ' MB')}`;
}

/** Thousands apart, when there are more than four digits (a non-breaking space in Russian). */
function grouped(ctx, value) {
  const text = `${value}`;
  if (text.length <= 4) return text;
  return text.replace(/(\d)(?=(\d{3})+$)/g, t(ctx, `$1${nbspChar}`, '$1,'));
}

/* ------------------------------------------------------------------------------------------ */
/* The run                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export default async function run(ctx) {
  const Ts = Date.now();
  const snapshot = await mfbe.doc.get();
  const binaries = await mfbe.doc.binaries();
  const fbwBody = buildPage(snapshot);
  const L = (ru, en) => t(ctx, ru, en);

  // Разделы
  const z4 = () => [0, 0, 0, 0];
  const z46 = () => [0, 1, 2, 3].map(() => [0, 0, 0, 0, 0, 0]);
  const count_subt = z4();
  const count_subt_p = z4();
  const count_subtSp = z4();
  const count_tAut = z4();
  const count_tAut_p = z4();
  const count_tAutPoem = z4();
  const count_tAutPoem_p = z4();
  const count_tAutCite = z4();
  const count_tAutCite_p = z4();
  const count_tAutEpig = z4();
  const count_tAutEpig_p = z4();
  const count_titleSp = z4();
  const count_epigSp = z4();
  const count_poemSp = z4();
  const count_txt = z4();
  const count_Sp = z4();
  let count_Em = 0;
  let count_St = 0;
  let count_EmSt = 0;
  let count_A10 = 0;
  let count_A11 = 0;
  let count_A12 = 0;
  let count_A13 = 0;
  let count_A14 = 0;
  let count_Not = 0;
  let count_Com = 0;
  let count_A15 = 0;
  let count_A41 = 0;
  let count_A42 = 0;
  let count_A43 = 0;
  let count_A44 = 0;
  let count_A45 = 0;
  let count_A80 = 0;
  let count_A81 = 0;
  let count_A83 = 0;
  let count_A91 = 0;
  let count_A92 = 0;
  let count_A93 = 0;
  let count_A93a = 0;
  let count_A94 = 0;
  let count_A94a = 0;
  let count_A95 = 0;
  let count_A96 = 0;
  let count_A97 = 0;
  let count_littera = 0;
  let count_Word = 0;

  /// ПОИСК И ПОДСЧЕТ  :  Параграфы <P> (функция "HandleP")
  const handleP = (ptr, tip, divUp) => {
    const s = innerHTML(ptr);
    const sct = innerText(ptr);
    const parentCls = ptr.parent.cls;
    const Ttl_ = parentCls === 'title';
    const subt_ = ptr.cls === 'subtitle';
    const poem_ = parentCls === 'stanza';
    const epig_ = parentCls === 'epigraph';
    const textAuthor_ = ptr.cls === 'text-author';
    const next = nextSibling(ptr);
    if (subt_) {
      count_subt_p[tip] += 1;
      if (!next || next.cls !== 'subtitle') count_subt[tip] += 1;
    }
    if (textAuthor_) {
      const lastOfGroup = !next || next.cls !== 'text-author';
      switch (parentCls) {
        case 'poem':
          count_tAutPoem_p[tip] += 1;
          if (lastOfGroup) count_tAutPoem[tip] += 1;
          break;
        case 'cite':
          count_tAutCite_p[tip] += 1;
          if (lastOfGroup) count_tAutCite[tip] += 1;
          break;
        case 'epigraph':
          count_tAutEpig_p[tip] += 1;
          if (lastOfGroup) count_tAutEpig[tip] += 1;
          break;
        default:
          count_tAut_p[tip] += 1;
          if (lastOfGroup) count_tAut[tip] += 1;
          break;
      }
    }
    if (!subt_ && !textAuthor_ && parentCls === 'section') count_txt[tip] += 1; //   Обычный текст
    // Поиск и подсчет пустых строк
    if (s.search(reSp) !== -1) {
      count_Sp[tip] += 1;
      if (Ttl_) count_titleSp[tip] += 1;
      if (subt_) count_subtSp[tip] += 1;
      if (poem_) count_poemSp[tip] += 1;
      if (epig_) count_epigSp[tip] += 1;
    }
    count_littera += sct.length; //   Все символы
    count_Word += count(sct, reWord); //   Все слова
    if (divUp.search(/h/) !== -1) return; //  Выход из функции если это раздел истории
    // Внутренние теги
    count_Em += runs(ptr, (m) => m.type === 'emphasis');
    count_St += runs(ptr, (m) => m.type === 'strong');
    count_EmSt += boldItalicParts(ptr);
    count_A10 += runs(ptr, (m) => m.type === 'sup');
    count_A11 += runs(ptr, (m) => m.type === 'sub');
    count_A12 += runs(ptr, (m) => m.type === 'strikethrough');
    count_A13 += runs(ptr, (m) => m.type === 'code');
    count_A14 += runs(ptr, (m) => m.type === 'style', true);
    count_Not += runs(ptr, (m) => m.type === 'link' && m.attrs?.type === 'note');
    if (s.search('<') !== -1) count_Com += count(s, reCom);
    count_A15 += runs(ptr, (m) => m.type === 'link');
    count_A41 += count(sct, reA41);
    count_A42 += count(sct, reA42);
    count_A43 += count(sct, reA43);
    count_A44 += count(sct, reA44);
    count_A45 += count(sct, reA45);
    count_A80 += count(sct, reA80); // Выделение разрядкой
    count_A81 += count(sct, reA81); // Латиница в кириллице
    if (!subt_ && !Ttl_ && sct.search(reA83) !== -1) count_A83 += 1; // *  в начале строки
    const A30_ = sct.search(reA30) !== -1;
    const A32_ = sct.search(reA32) !== -1;
    if (A30_) count_A91 += count(sct, reA91);
    if (A32_) count_A92 += count(sct, reA92);
    if (A30_ && sct.search(reA93) !== -1) {
      count_A93 += count(sct, reA93);
      count_A93a += count(s, reA93a);
    }
    if (A32_ && sct.search(reA94) !== -1) {
      count_A94 += count(sct, reA94);
      count_A94a += count(s, reA94a);
    }
    count_A95 += count(s, reA95); // Большие числа
    count_A96 += count(sct, reA96); // Строчная бука + число
    if (!poem_) count_A97 += count(sct, reA97); // Строчная буква в начале строки
  };

  /// ПОИСК И ПОДСЧЕТ  :  Разделы "DIV"
  const VersionFile = snapshot.description?.documentInfo?.version ?? '';
  let VersionH = false;
  let count_body = 0;
  let count_body_p = 0;
  let count_boNC = 0;
  let count_boNC_p = 0;
  let count_hist = 0;
  let count_hist_p = 0;
  let count_anotFB = 0;
  let count_anotFB_p = 0;
  let count_X = 0;
  let count_X_p = 0;
  const count_sect = z46();
  const count_titl = z46();
  const count_titl_p = z46();
  const count_titlPoem = z4();
  const count_titlPoem_p = z4();
  const count_epig = z46();
  const count_epig_p = z46();
  const count_epigPoem = z4();
  const count_epigPoem_p = z4();
  const count_anot = z46();
  const count_anot_p = z46();
  const count_xxx = z4();
  const count_xxx_p = z4();
  const count_poem = z4();
  const count_poem_p = z4();
  const count_stan = z4();
  const count_stan_p = z4();
  const count_cite = z4();
  const count_cite_p = z4();
  const count_tabl = z4();
  const count_tr = z4();
  const count_tabl_p = z4();

  //  Создание краткой записи дерева разделов над любым узлом DIV
  const letter = (div) => {
    switch (div.cls) {
      case 'stanza':
        return 's';
      case 'poem':
        return 'p';
      case 'cite':
        return 'c';
      case 'section':
        return 'S';
      case 'title':
        return 'T';
      case 'epigraph':
        return 'e';
      case 'image':
        return 'i';
      case 'table':
        return 't';
      case 'tr':
        return 'r';
      case 'annotation':
        return div.top ? 'A' : 'a';
      case 'body':
        if (!div.top) return 'x';
        return div.fbname === 'notes' || div.fbname === 'comments' ? 'b' : 'B';
      case 'history':
        return div.top ? 'h' : 'x';
      default:
        return 'x';
    }
  };
  const allDivs = descendants(fbwBody, false);
  for (let n = 0; n < allDivs.length; n += 1) {
    if (n % 200 === 199) {
      if (ctx.cancelled) return;
      await mfbe.ui.progress(n, allDivs.length, ctx.script.name);
    }
    const div = allDivs[n];
    let divUp = '';
    for (let d = div; d !== fbwBody; d = d.parent) divUp += letter(d);
    let tip;
    if (divUp.search(/[Ah]/) !== -1) tip = 0;
    else if (divUp.search(/B/) !== -1) tip = 1;
    else if (divUp.search(/b/) !== -1) tip = 2;
    else tip = 3;
    if (divUp.length === 1) {
      const mP = descendants(div, true);
      for (const p of mP) handleP(p, tip, divUp);
      switch (divUp) {
        case 'A':
          count_anotFB += 1;
          count_anotFB_p += mP.length;
          break;
        case 'h':
          count_hist += 1;
          count_hist_p += mP.length;
          VersionH = divText(div).search(VersionFile) !== -1;
          break;
        case 'B':
          count_body += 1;
          count_body_p += mP.length;
          break;
        case 'b':
          count_boNC += 1;
          count_boNC_p += mP.length;
          break;
        default:
          count_X += 1;
          count_X_p += mP.length;
          break;
      }
    }
    if (divUp.length > 1) {
      let k;
      if (divUp.search(/S./g) === -1) k = 0;
      else {
        k = divUp.match(/S(?=.)/g).length;
        if (k > 5) k = 5;
      }
      const ps = () => descendants(div, true).length;
      switch (divUp.replace(/(^.).+$/g, '$1')) {
        case 'S':
          count_sect[tip][k] += 1;
          break;
        case 'T':
          if (divUp.search(/p/g) !== -1) {
            count_titlPoem[tip] += 1;
            count_titlPoem_p[tip] += ps();
          } else {
            count_titl[tip][k] += 1;
            count_titl_p[tip][k] += ps();
          }
          break;
        case 'e':
          if (divUp.search(/p/g) !== -1) {
            count_epigPoem[tip] += 1;
            count_epigPoem_p[tip] += ps();
          } else {
            count_epig[tip][k] += 1;
            count_epig_p[tip][k] += ps();
          }
          break;
        case 'a':
          count_anot[tip][k] += 1;
          count_anot_p[tip][k] += ps();
          break;
        case 'x':
          count_xxx[tip] += 1;
          count_xxx_p[tip] += ps();
          break;
        case 'p':
          count_poem[tip] += 1;
          count_poem_p[tip] += ps();
          break;
        case 's':
          count_stan[tip] += 1;
          count_stan_p[tip] += ps();
          break;
        case 'c':
          count_cite[tip] += 1;
          count_cite_p[tip] += ps();
          break;
        case 't':
          count_tabl[tip] += 1;
          count_tabl_p[tip] += ps();
          break;
        case 'r':
          count_tr[tip] += 1;
          break;
        default:
          break;
      }
    }
  }
  // Paragraphs directly in fbw_body: the page never had any.
  const count_no_p = 0;

  /// ПОИСК И ПОДСЧЕТ  :  Вложенные файлы (бинарные объекты)
  const count_Bin = binaries.length;
  const mBinName = binaries.map((b) => b.id);
  const mBinType = binaries.map((b) => b.contentType ?? '');
  const mBinSize = binaries.map((b) => b.size);
  // "w*h" was shown for the pictures FictionBook Editor could read; "х" (Cyrillic) otherwise.
  const mBinDims = binaries.map((b) => (`${b.contentType ?? ''}`.search('image') !== -1 && b.width && b.height ? `${b.width}x${b.height}` : 'х'));

  /// ПОИСК И ПОДСЧЕТ  :  Совпадения в файлах
  let count_BinRepit = 0;
  for (let n = 0; n < count_Bin; n += 1) {
    for (let k = n + 1; k < count_Bin; k += 1) {
      if (mBinDims[n] !== 'х' && mBinDims[n] === mBinDims[k] && mBinSize[n] === mBinSize[k]) {
        count_BinRepit += 1;
        break;
      }
    }
  }

  /// Функция подсчета изображений по расширению (jpg, png, невалидный формат)
  const raspredelenie = (massiv, tipF) => {
    massiv[0] += 1;
    if (tipF === 'image/jpeg') massiv[1] += 1;
    else if (tipF === 'image/png') massiv[2] += 1;
    else massiv[3] += 1;
  };

  /// ПОИСК И ПОДСЧЕТ  :  Разделы "IMG"
  const images = [];
  const visitImages = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.type === 'image') images.push({ inline: false, node });
    if (node.type === 'inline-image') images.push({ inline: true, node });
    for (const child of node.content ?? []) visitImages(child);
  };
  visitImages(snapshot.description?.titleInfo?.annotation);
  visitImages(snapshot.description?.documentInfo?.history);
  for (const body of snapshot.bodies ?? []) visitImages(body);
  const mImgHref = [];
  const count_divImg = [0, 0, 0, 0];
  const count_spanImg = [0, 0, 0, 0];
  let count_zeroImg = 0;
  let count_titleImg = 0;
  let count_BinImg = 0;
  let count_BinCov = 0;
  const mBinLabel = mBinName.map(() => 'не исп');
  aaa: for (const image of images) {
    const imgName = (image.node.attrs?.href ?? '').replace(/^#/, '');
    for (let k = 0; k < count_Bin; k += 1) {
      if (imgName === mBinName[k]) {
        mBinLabel[k] = 'илл';
        count_BinImg += 1;
        mImgHref.push(imgName);
        raspredelenie(image.inline ? count_spanImg : count_divImg, mBinType[k]);
        // Inline pictures had no title on the page; a block picture showed its own.
        if (!image.inline && (image.node.attrs?.title ?? '') !== '') count_titleImg += 1;
        continue aaa;
      }
    }
    count_zeroImg += 1;
  }

  /// ПОИСК И ПОДСЧЕТ  :  Обложки
  const mCovValue = [];
  const covers = (list, counter) => {
    ccc: for (const cover of list ?? []) {
      const imgName = (cover.href ?? '').replace(/^#/, '');
      if (imgName === '') continue;
      for (let k = 0; k < count_Bin; k += 1) {
        if (imgName === mBinName[k]) {
          mBinLabel[k] = 'обл';
          count_BinCov += 1;
          mCovValue.push(imgName);
          raspredelenie(counter, mBinType[k]);
          continue ccc;
        }
      }
      count_zeroImg += 1;
    }
  };
  const count_tiCover = [0, 0, 0, 0];
  const count_stiCover = [0, 0, 0, 0];
  covers(snapshot.description?.titleInfo?.coverpage, count_tiCover);
  covers(snapshot.description?.srcTitleInfo?.coverpage, count_stiCover);

  /// ПОИСК И ПОДСЧЕТ  :  совпадения в иллюстрациях и обложках
  let count_CovRepit = 0;
  let count_ImgRepit = 0;
  const mImgAll = mCovValue.concat(mImgHref);
  for (let n = 0; n < mCovValue.length; n += 1) {
    for (let k = n + 1; k < mImgAll.length; k += 1) {
      if (mCovValue[n] === mImgAll[k]) {
        count_CovRepit += 1;
        if (k < mCovValue.length) break;
      }
    }
  }
  for (let n = 0; n < mImgHref.length; n += 1) {
    for (let k = n + 1; k < mImgHref.length; k += 1) {
      if (mImgHref[n] === mImgHref[k]) {
        count_ImgRepit += 1;
        break;
      }
    }
  }

  /// ПОДСЧЕТ  :  Вложенные файлы.  Часть 2
  let count_BinSizeAll = 0;
  let count_BinUnused = 0;
  let count_BinSizeCovMax = 0;
  let count_BinSizeImgMax = 0;
  let count_BinSizeMedi = 0;
  for (let k = 0; k < count_Bin; k += 1) {
    count_BinSizeAll += mBinSize[k];
    if (mBinLabel[k] === 'обл' && count_BinSizeCovMax < mBinSize[k]) count_BinSizeCovMax = mBinSize[k];
    if (mBinLabel[k] === 'илл' && count_BinSizeImgMax < mBinSize[k]) count_BinSizeImgMax = mBinSize[k];
    if (mBinLabel[k] === 'не исп') count_BinUnused += 1;
  }
  if (count_Bin !== 0) count_BinSizeMedi = count_BinSizeAll / count_Bin;
  count_BinSizeAll = kilobytes(ctx, count_BinSizeAll);
  count_BinSizeCovMax = kilobytes(ctx, count_BinSizeCovMax);
  count_BinSizeImgMax = kilobytes(ctx, count_BinSizeImgMax);
  count_BinSizeMedi = kilobytes(ctx, count_BinSizeMedi);

  /// ОКНО РЕЗУЛЬТАТОВ  :  Текущее время и дата
  const now = new Date();
  const currentHours = now.getHours();
  const currentMinutes = `${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
  const currentSeconds = `${now.getSeconds() < 10 ? '0' : ''}${now.getSeconds()}`;
  const currentMonth = `${1 + now.getMonth() < 10 ? '0' : ''}${1 + now.getMonth()}`;
  const currentYear = `${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const currentTime = `${currentHours}:${currentMinutes}:${currentSeconds}`;
  const currentDate = `${now.getDate()}.${currentMonth}.${currentYear}`;

  /// Предварительная подготовка данных для вывода результатов
  const count_P = count_body_p + count_boNC_p + count_hist_p + count_anotFB_p + count_X_p + count_no_p;
  const count_A41_42 = count_A41 - count_A42;
  const count_A43_44 = count_A43 - count_A44;
  const wordsText = grouped(ctx, count_Word);
  const letterText = grouped(ctx, count_littera);
  count_A93 -= count_A93a;
  count_A94 -= count_A94a;
  count_A15 = count_A15 - count_Not - count_Com; //  Гиперссылка = все ссылки – ссылки на комментарии и примечания
  count_A10 -= count_Com; //  Верхний регистр уменьшается на количество сносок на комментарии

  /// Подсчет чистого компьютерного времени, потраченного на обработку текста
  const T2 = Date.now() - Ts;
  const Tmin = Math.floor(T2 / 60000);
  const TsecD = (T2 % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  let tempus;
  if (Tmin === 0) {
    const seconds = `${+`${TsecD}`.replace(/(.{1,5}).*/g, '$1')}`;
    tempus = L(`${seconds.replace('.', ',')} сек`, `${seconds} s`);
  } else {
    tempus = `${Tmin}${L(' мин', ' min')}`;
    if (Tsec !== 0) tempus += ` ${Tsec}${L(' с', ' s')}`;
  }

  /// ОКНО РЕЗУЛЬТАТОВ  :  Сборка массива с результатами обработки
  const mSt = [];
  const mRzd = [];
  let rz = 0;
  const push = (line) => mSt.push(line);
  push('');
  push(` ${L(ScriptName, '«General statistics»')} v.${NumerusVersion}`);
  push('-------------------------------------------------------');
  push('\t\t\t\t\t   ');
  push(`${L('• Время выполнения  .  .  .  .  .  .  .  .\t', '• Time  .  .  .  .  .  .  .  .  .  .  .  .\t')}${tempus}`);
  push('');
  push(`${L('Строк   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Lines  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_P}`);
  push(`${L('Слов .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Words  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${wordsText}`);
  push(`${L('Символов   .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Characters  .  .  .  .  .  .  .  .  .  .  .  .\t')}${letterText}`);
  mRzd[rz] = mSt.length;

  const sectionLines = (tip, kind) => {
    for (let k = 0; k <= 5; k += 1) {
      if (count_sect[tip][k] !== 0) {
        if (k < 5) push(L(`Секций ${k}-го уровня   .  .  .  .  .  .  .  .\t${count_sect[tip][k]}`, `Sections of level ${k}  .  .  .  .  .  .  .\t${count_sect[tip][k]}`));
        else push(L(`Секций 5-го уровня и выше   .  .  .  .\t${count_sect[tip][k]}`, `Sections of level 5 and deeper  .  .  .\t${count_sect[tip][k]}`));
      }
      if ((kind.titlesAtZero && k === 0) || count_sect[tip][k] !== 0) {
        push(`${L('      заголовков\t', '      titles\t')}${count_titl[tip][k]}  /${count_titl_p[tip][k]}/`);
      }
      if (count_epig[tip][k] !== 0) push(`${L('      эпиграфов\t', '      epigraphs\t')}${count_epig[tip][k]}  /${count_epig_p[tip][k]}/`);
      if (count_anot[tip][k] !== 0) push(`${L('      аннотаций\t', '      annotations\t')}${count_anot[tip][k]}  /${count_anot_p[tip][k]}/`);
    }
    if (count_poem[tip] !== 0) push(`${L('Стихов .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Poems  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_poem[tip]}  /${count_poem_p[tip]}/`);
    if (count_titlPoem[tip] !== 0) push(`${L('      заголовков\t', '      titles\t')}${count_titlPoem[tip]}  /${count_titlPoem_p[tip]}/`);
    if (count_epigPoem[tip] !== 0) push(`${L('      эпиграфов\t', '      epigraphs\t')}${count_epigPoem[tip]}  /${count_epigPoem_p[tip]}/`);
    if (count_stan[tip] !== 0) push(`${L('      строф       \t', '      stanzas       \t')}${count_stan[tip]}  /${count_stan_p[tip]}/`);
    if (count_tAutPoem[tip] !== 0) push(`      text-author\t${count_tAutPoem[tip]}  /${count_tAutPoem_p[tip]}/`);
    if (count_cite[tip] !== 0) push(`${L('Цитат  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Cites  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_cite[tip]}  /${count_cite_p[tip]}/`);
    if (count_subt[tip] !== 0) push(`${L('Подзаголовков   .  .  .  .  .  .  .  .  .  .\t', 'Subtitles  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_subt[tip]}  /${count_subt_p[tip]}/`);
    if (count_tAutCite[tip] !== 0) push(`${L('text-author в цитатах  .  .  .  .  .  .  .\t', 'text-author in cites  .  .  .  .  .  .  .\t')}${count_tAutCite[tip]}  /${count_tAutCite_p[tip]}/`);
    if (count_tAutEpig[tip] !== 0) push(`${L('text-author в эпиграфах  .  .  .  .  .  .\t', 'text-author in epigraphs  .  .  .  .  .\t')}${count_tAutEpig[tip]}  /${count_tAutEpig_p[tip]}/`);
    if (count_tAut[tip] !== 0) push(`${L('Невалидный text-author  .  .  .  .  .  .\t', 'Invalid text-author  .  .  .  .  .  .  .\t')}${count_tAut[tip]}  /${count_tAut_p[tip]}/`);
    if (count_tabl[tip] !== 0) push(`${L('Таблиц .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Tables  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_tabl[tip]}  /${count_tr[tip]}/`);
    if (count_tabl_p[tip] !== 0) push(`${L('      ячеек        \t', '      cells        \t')}${count_tabl_p[tip]}`);
    if (count_xxx[tip] !== 0) push(`${L('Непонятных разделов .  .  .  .  .  .  .\t', 'Unknown parts  .  .  .  .  .  .  .  .  .\t')}${count_xxx[tip]}  /${count_xxx_p[tip]}/`);
    if (count_txt[tip] !== 0) push(`${L('Строк обычного текста  .  .  .  .  .  .\t', 'Lines of ordinary text  .  .  .  .  .  .\t')}${count_txt[tip]}`);
    if (kind.noRoot && count_no_p !== 0) push(`${L('Строк без корневого раздела  .  .  .\t', 'Lines outside any part  .  .  .  .  .\t')}${count_no_p}`);
    if (count_Sp[tip] !== 0) push(`${L('Пустые строки .  .  .  .  .  .  .  .  .  .  .\t', 'Empty lines  .  .  .  .  .  .  .  .  .  .  .\t')}${count_Sp[tip]}`);
    if (count_titleSp[tip] !== 0) push(`${L('      в заголовках\t', '      in titles\t')}${count_titleSp[tip]}`);
    if (count_subtSp[tip] !== 0) push(`${L('      в п/заголовках ', '      in subtitles ')}${count_subtSp[tip]}`);
    if (count_epigSp[tip] !== 0) push(`${L('      в эпиграфах\t', '      in epigraphs\t')}${count_epigSp[tip]}`);
    if (count_poemSp[tip] !== 0) push(`${L('      в стихах      \t', '      in poems      \t')}${count_poemSp[tip]}`);
  };
  //  Удаление двух последних строк, если нет пунктов в последнем разделе
  const closeSection = () => {
    if (mRzd[rz] === mSt.length - 2) mSt.length -= 2;
    rz += 1;
    mRzd[rz] = mSt.length;
  };

  push('');
  push(L('• РАЗДЕЛ аннотации к книге и история:', '• The book annotation and the history:'));
  push(`${L('Аннотация,     шт. /строк/  .  .  .  .  .\t', 'Annotation, number /lines/  .  .  .  .\t')}${count_anotFB}  /${count_anotFB_p}/`);
  push(`${L('Раздел <history>   .  .  .  .  .  .  .  .  .\t', 'The <history>   .  .  .  .  .  .  .  .  .\t')}${count_hist}  /${count_hist_p}/`);
  sectionLines(0, {});
  closeSection();

  push('');
  push(L('• РАЗДЕЛЫ основных <body>:', '• The main <body>:'));
  push(`${L('Разделов <body>   .  .  .  .  .  .  .  .  .\t', '<body> elements   .  .  .  .  .  .  .  .\t')}${count_body}  /${count_body_p}/`);
  sectionLines(1, { titlesAtZero: count_body !== 0 });
  closeSection();

  push('');
  push(L('• РАЗДЕЛЫ примечаний и комментариев:', '• The notes and comments:'));
  if (count_boNC !== 0) push(`${L('Разделов <body>  .  .  .  .  .  .  .  .  .\t', '<body> elements  .  .  .  .  .  .  .  .\t')}${count_boNC}  /${count_boNC_p}/`);
  sectionLines(2, { titlesAtZero: count_boNC !== 0 });
  closeSection();

  push('');
  push(L('• НЕПОНЯТНЫЕ КОРНЕВЫЕ РАЗДЕЛЫ:', '• UNKNOWN ROOT PARTS:'));
  if (count_X !== 0) push(`${L('Количество этих разделов .  .  .  .  .\t', 'Number of these parts  .  .  .  .  .\t')}${count_X}  /${count_X_p}/`);
  sectionLines(3, { noRoot: true });
  closeSection();

  push('');
  push(L('• ВЛОЖЕННЫЕ ФАЙЛЫ:', '• ATTACHED FILES:'));
  if (count_Bin !== 0) push(`${L('Всего файлов   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Files  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_Bin}`);
  if (count_BinUnused !== 0) push(`${L('Неиспользуемые файлы  .  .  .  .  .  .  .  .  .  .  .\t', 'Unused files  .  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinUnused}`);
  if (count_BinRepit !== 0) push(`${L('Копии файлов  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Copies of files  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinRepit}`);
  if (count_BinSizeAll !== 0) {
    if (count_Bin > 1) push(`${L('Размер всех файлов  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Size of all files  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinSizeAll}`);
    if (count_Bin === 1 && count_BinUnused !== 0) push(`${L('Размер файла  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Size of the file  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinSizeAll}`);
  }
  if (count_BinSizeMedi !== 0 && count_Bin > 1) push(`${L('Средний размер файла   .  .  .  .  .  .  .  .  .  .  .\t', 'Average file size  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinSizeMedi}`);
  if (count_BinSizeCovMax !== 0) {
    if (count_BinCov > 1) push(`${L('Максимальный размер обложки .  .  .  .  .  .  .\t', 'Largest cover  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinSizeCovMax}`);
    if (count_BinCov === 1) push(`${L('Размер обложки  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Size of the cover  .  .  .  .  .  .  .  .  .  .  .\t')}${count_BinSizeCovMax}`);
  }
  if (count_BinSizeImgMax !== 0) {
    if (count_BinImg > 1) push(`${L('Максимальный размер иллюстрации  .  .  .  .\t', 'Largest illustration  .  .  .  .  .  .  .  .  .\t')}${count_BinSizeImgMax}`);
    if (count_BinImg === 1) push(`${L('Размер иллюстрации    .  .  .  .  .  .  .  .  .  .  .  .\t', 'Size of the illustration  .  .  .  .  .  .  .  .\t')}${count_BinSizeImgMax}`);
  }
  closeSection();

  push('');
  push(L('• ИЛЛЮСТРАЦИИ:', '• PICTURES:'));
  // A kind of picture with one format only is written on one line ("Обложек (jpg)").
  const byFormat = (counter, total, jpg, png, invalid) => {
    if (counter[0] !== 0) push(`${total}${counter[0]}`);
    const formats = [
      [1, jpg, L('      jpg-формат   .  .  .  .  .  .\t', '      jpg format   .  .  .  .  .  .\t')],
      [2, png, L('      png-формат  .  .  .  .  .  .\t', '      png format  .  .  .  .  .  .\t')],
      [3, invalid, L('      невалидный формат   \t', '      invalid format   \t')],
    ];
    for (const [i, alone, part] of formats) {
      if (counter[i] === 0) continue;
      if (counter[i] === counter[0]) {
        mSt.pop();
        push(`${alone}${counter[i]}`);
      } else push(`${part}${counter[i]}`);
    }
  };
  byFormat(
    count_tiCover,
    L('Обложек   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Covers  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t'),
    L('Обложек (jpg)  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Covers (jpg)  .  .  .  .  .  .  .  .  .  .  .  .  .\t'),
    L('Обложек (png) .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Covers (png)  .  .  .  .  .  .  .  .  .  .  .  .  .\t'),
    L('Обложек (невалидный формат)  .  .  .  .  .  .\t', 'Covers (invalid format)  .  .  .  .  .  .\t'),
  );
  byFormat(
    count_stiCover,
    L('Обложек на языке оригинала  .  .  .  .  .  .  .  .\t', 'Covers of the original  .  .  .  .  .  .  .  .\t'),
    L('Обложек на языке оригинала (jpg)   .  .  .  .  .\t', 'Covers of the original (jpg)   .  .  .  .  .\t'),
    L('Обложек на языке оригинала (png)  .  .  .  .  .\t', 'Covers of the original (png)  .  .  .  .  .\t'),
    L('Обложек на языке ориг. (невалид. формат)\t', 'Covers of the original (invalid format)\t'),
  );
  byFormat(
    count_divImg,
    L('Обычная графика  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Block pictures  .  .  .  .  .  .  .  .  .  .  .  .\t'),
    L('Обычная графика (jpg)   .  .  .  .  .  .  .  .  .  .  .\t', 'Block pictures (jpg)   .  .  .  .  .  .  .  .  .\t'),
    L('Обычная графика (png)  .  .  .  .  .  .  .  .  .  .  .\t', 'Block pictures (png)  .  .  .  .  .  .  .  .  .\t'),
    L('Обычная графика (невалидный формат) .  .\t', 'Block pictures (invalid format) .  .  .\t'),
  );
  byFormat(
    count_spanImg,
    L('Графика в строке  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Inline pictures  .  .  .  .  .  .  .  .  .  .  .  .\t'),
    L('Графика в строке (jpg)   .  .  .  .  .  .  .  .  .  .  .\t', 'Inline pictures (jpg)   .  .  .  .  .  .  .  .  .\t'),
    L('Графика в строке (png)  .  .  .  .  .  .  .  .  .  .  .\t', 'Inline pictures (png)  .  .  .  .  .  .  .  .  .\t'),
    L('Графика в строке (невалидный формат)   .  .\t', 'Inline pictures (invalid format)   .  .  .\t'),
  );
  if (count_CovRepit !== 0) push(`${L('Повторное использование обложки   .  .  .  .\t', 'Covers used again  .  .  .  .  .  .  .  .  .\t')}${count_CovRepit}`);
  if (count_ImgRepit !== 0) push(`${L('Повторные иллюстрации   .  .  .  .  .  .  .  .  .  .\t', 'Repeated illustrations  .  .  .  .  .  .  .  .\t')}${count_ImgRepit}`);
  if (count_zeroImg !== 0) push(`${L('Пустые иллюстрации   .  .  .  .  .  .  .  .  .  .  .  .\t', 'Empty pictures  .  .  .  .  .  .  .  .  .  .  .  .\t')}${count_zeroImg}`);
  if (count_titleImg !== 0) push(`${L('Заголовки внутри иллюстраций .  .  .  .  .  .  .\t', 'Titles inside pictures  .  .  .  .  .  .  .  .\t')}${count_titleImg}`);
  closeSection();

  push('');
  push(L('• ВНУТРЕННИЕ ТЕГИ:', '• INLINE FORMATTING:'));
  const tagLines = [
    [count_Em, 'Курсив   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Italics  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_St, 'Жирность  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Bold  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_EmSt, 'Жирный курсив  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Bold italics  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A10, 'Верхний индекс  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Superscript  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A11, 'Нижний индекс   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Subscript   .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A12, 'Зачеркивание  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Strikethrough  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A13, 'Код  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Code  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A14, 'Стиль  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Styles  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_Not, 'Сноски на примечания .  .  .  .  .  .  .  .  .  .  .  .\t', 'Note links  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_Com, 'Сноски на комментарии  .  .  .  .  .  .  .  .  .  .  .\t', 'Comment links  .  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A15, 'Гиперссылки    .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Hyperlinks    .  .  .  .  .  .  .  .  .  .  .  .  .\t'],
  ];
  for (const [value, ru, en] of tagLines) if (value !== 0) push(`${L(ru, en)}${value}`);
  closeSection();

  push('');
  push(L('• ПРЕДПОЛАГАЕМЫЕ ОШИБКИ:', '• LIKELY ERRORS:'));
  if (!VersionH) push(`${L('• В истории не найдена версия файла .  .  .  .\tv.', '• The history does not name the file version  .\tv.')}${VersionFile}`);
  if (count_A41_42 > 0) push(`${L('• «Левых «угловых «кавычек «больше   .  .  .\t+', '• More «left «angle «quotes   .  .  .  .  .  .\t+')}${count_A41_42}`);
  if (count_A41_42 < 0) push(`${L('• Правых» угловых» кавычек» больше» .  .  .\t+', '• More right» angle» quotes» .  .  .  .  .  .\t+')}${-count_A41_42}`);
  if (count_A43_44 > 0) push(`${L('• „Левых „внутренних „кавычек „больше   .  .\t+', '• More „left „inner „quotes   .  .  .  .  .  .\t+')}${count_A43_44}`);
  if (count_A43_44 < 0) push(`${L('• Правых“ внутренних“ кавычек“ больше“ .  .\t+', '• More right“ inner“ quotes“ .  .  .  .  .  .\t+')}${-count_A43_44}`);
  const errorLines = [
    [count_A45, '• Простые кавычки  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '• Straight quotes  .  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A80, '• Р а з р я д к а   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '• S p a c e d  words  .  .  .  .  .  .  .  .  .  .\t'],
    [count_A81, '• Латиница в кириллице .  .  .  .  .  .  .  .  .  .  .\t', '• Latin letters in Cyrillic words  .  .  .  .  .\t'],
    [count_A97, '• строчная буква в начале строки .  .  .  .  .  .\t', '• a lower-case letter at the start of a line .\t'],
    [count_A95, '• Большие числа без разрядов .  .  .  .  .  .  .  .\t', '• Large numbers without separators .  .  .  .\t'],
    [count_A83, '• * Звездочка в начале строки   .  .  .  .  .  .  .\t', '• * An asterisk at the start of a line  .  .  .\t'],
    [count_A91, '• [Текст в квадратных скобках] .  .  .  .  .  .  .\t', '• [Text in square brackets] .  .  .  .  .  .  .\t'],
    [count_A92, '• {Текст в фигурных скобках} .  .  .  .  .  .  .  .\t', '• {Text in curly brackets} .  .  .  .  .  .  .  .\t'],
    [count_A93, '• [Число в квадратных скобках] .  .  .  .  .  .  .\t', '• [A number in square brackets] .  .  .  .  .\t'],
    [count_A94, '• {Число в фигурных скобках} .  .  .  .  .  .  .  .\t', '• {A number in curly brackets} .  .  .  .  .  .\t'],
    [count_A96, '• Текст+число без пробела между ними .  .  .\t', '• Text+number with no space between them .\t'],
  ];
  for (const [value, ru, en] of errorLines) if (value !== 0) push(`${L(ru, en)}${value}`);
  closeSection();

  //  Сборка строк текущей даты и времени
  push('');
  push(`• ${currentDate} • ${currentTime} •`);
  // The proverb the original added here is left out, pending the requester's decision.
  push('');
  push('-------------------------------------------------------');
  rz += 1;
  mRzd[rz] = mSt.length;
  let ind = mSt.length;

  /// СОХРАНЕНИЕ  :  Сборка текста статистики
  const textStat = mSt.map((line) => `${line}\n`).join('');

  /// ОКНО РЕЗУЛЬТАТОВ  :  Определение высоты колонки в таблице с результатами обработки
  for (let n = rz; n > 0; n -= 1) mRzd[n] -= mRzd[n - 1];
  let Vysota_teksta = VYSOTA_TEKSTA;
  let page;
  let Kolo;
  if (Vysota_teksta >= ind) {
    page = 1;
    Kolo = ind;
  } else {
    Vysota_teksta -= 2;
    for (let n = 5; ; n += 1) {
      let j = 0;
      let k;
      for (k = 1; k <= 15; k += 1) {
        let Kolo_R = -1;
        for (; j <= rz; j += 1) {
          if (Kolo_R + mRzd[j] <= n) Kolo_R += mRzd[j];
          else break;
        }
        if (j > rz) break;
      }
      if (j > rz) {
        if (!Kolo) {
          Kolo = n;
          page = k;
          if (Kolo > Vysota_teksta) break;
        } else if (n > Vysota_teksta) break;
        else if (page !== k) {
          Kolo = n;
          page = k;
        }
      }
      if (n > 10000) break;
    }
  }
  const mPage = [];
  ind = 0;
  let indFinita = 0;
  let j = 0;
  for (let k = 0; k < page; k += 1) {
    mPage[k] = '';
    let Kolo_R = -1;
    for (; j <= rz; j += 1) {
      if (Kolo_R + mRzd[j] <= Kolo) Kolo_R += mRzd[j];
      else break;
    }
    let n = 0;
    ind += 1;
    indFinita += 1 + Kolo_R;
    for (; ind < indFinita; ind += 1) {
      mPage[k] += `${mSt[ind]}\n`;
      n += 1;
    }
    for (; n < Kolo; n += 1) mPage[k] += '\n';
    if (page !== 1) {
      mPage[k] += '\t\t\t\t\t\t\n';
      if (k !== page - 1) mPage[k] += L(`◊  Стр. ${k + 1}  ◊  Показать  следующую  страницу?`, `◊  Page ${k + 1}  ◊  Show the next page?`);
      else mPage[k] += L(`◊  Стр. ${k + 1} (последняя)  ◊  Закрыть окно?`, `◊  Page ${k + 1} (the last)  ◊  Close the window?`);
    }
  }

  /// ОКНО РЕЗУЛЬТАТОВ  :  Вывод страниц с результатами на экран
  let otvet = true;
  let n = 0;
  while (otvet) {
    if (page === 1) {
      await mfbe.ui.message(mPage[0], { caption: ctx.script.name, icon: 'info' });
      break;
    }
    otvet = (await MsgBox(mPage[n], ctx.script.name, 4 + 64)) === 6;
    n += 1;
    if (n === page) {
      n = 0;
      otvet = !otvet;
    }
  }

  /// СОХРАНЕНИЕ: the questions of the original's settings SaveStat = 1 and SaveStat = 2
  if ((await MsgBox(L('◊  Сохранить текст общей статистики       \n               в буфер обмена?', '◊  Save the text of the general statistics       \n               to the clipboard?'), ctx.script.name, 4 + 32)) === 6) {
    await mfbe.clipboard.writeText(textStat);
  }
  const name = `${L('Общая статистика', 'General statistics')} (${currentDate} ${currentHours}-${currentMinutes}-${currentSeconds}).txt`;
  if ((await MsgBox(L('◊  Сохранить текст общей статистики       \n    в TXT-файл, в кодировке "UTF-16 LE"?       ', '◊  Save the text of the general statistics       \n    to a TXT file, in the "UTF-16 LE" encoding?       '), ctx.script.name, 4 + 32)) === 6) {
    await mfbe.files.saveText({ suggestedName: name, text: textStat, encoding: 'utf-16', title: ctx.script.name });
  }
}

///  ИСТОРИЯ ИЗМЕНЕНИЙ (of the original, kept as written)
// v.1.0 — Создание скрипта «Статистика строк» — Александр Ка (11.02.2024)
// v.1.1  — Александр Ка (08.06.2024)
// + Поиск и подсчет форматирования: автор текста, стиль
// + Поиск и подсчет внутренних заголовков в картинках
// + Поиск и подсчет р а з р я д к и
// + Увеличение ширины окна результатов
// v.1.2  — Александр Ка (31.07.2024)
// + Разделение на два скрипта:  «Общая статистика» и «Цитатный фразатрон».
// + Раздельный подсчет в структуре текста (в зависимости от корневого раздела, и уровня вложений секции)
// + Подробный подсчет для    иллюстраций, обложек, бинарных объектов.
// + Третья колонка в окне результатов
// + Пословицы
// v.1.3  — Александр Ка (08.01.2025)
// Страничный вид окна результатов
// Исправлены все ошибки в окнах для win7
// Добавлена возможность сохранения результатов (в настройках)
// Добавлен демонстрационный режим (в настройках)
// v.1.3  — Мелочи — Александр Ка (28.04.2025)
