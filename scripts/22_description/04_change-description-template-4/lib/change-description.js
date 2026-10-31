// Engine of the converted «Изменить дескрипшен» templates (FictionBook Editor 2.7.9,
// Scripts/22_Дескрипшен/00_Изменить дескрипшен - исходный шаблон.js, version 1.4, and its five
// copies 01_ ... 05_Изменить дескрипшен - шаблон N.js, version 1.2). Each package carries its own,
// byte-identical copy: a script may import only files of its own folder.
//
// The originals wrote the template's values into the fields of the editor's Description form
// (the IE page `fbw_desc`) and the annotation and history blocks of the Body view. Here the same
// steps run on the description of the document model (`mfbe.doc.get()`), which is written back
// with one `mfbe.doc.setDescription` call:
//  - a list of the form (genres, authors, translators, sequences, custom-info, source URLs) always
//    held at least one row, a blank one for an empty list; the model's empty list is that row;
//  - the annotation and the history were always present in the Body view, an absent one as one
//    empty line; an empty line the script adds is an `empty-line`, as 2.7.9 saved it, and an
//    annotation or history left with empty lines only is not written, as 2.7.9 did not write it;
//  - the expressions that tested a line's HTML (`innerHTML`) are applied, verbatim, to the line in
//    the notation of the IE page (`fbeInner`), and the history lines are edited in the notation of
//    lib/legacy-html.js, as the original edited their `innerHTML`;
//  - texts the originals looked for as regular expressions (a line of the history or of the
//    annotation, the history text, the name, the dates, the version) are looked for as written.
// `version` is '1.4' (00) or '1.2' (01 to 05); the behaviours that differ are marked V14 / V12.

import { parseInline, serializeInline } from './legacy-html.js';

const NBSP = ' ';
const NBSP_ENTITY = '&nbsp;';
const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** `inCode` of the original: plain text in the notation of the page (&, <, >, NBSP). */
export function inCode(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, NBSP_ENTITY);
}

/** A text as a literal inside a regular expression. */
export function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

function emptyLine() {
  return { type: 'empty-line', attrs: {} };
}

/** HTML typed into a 1.2 template: a "<" that starts no tag stays text, as the page read it. */
function htmlOfTemplate(html) {
  return String(html).replace(/<(?![A-Za-z\/!?])/g, '&lt;');
}

/** A line of the Body view built from page HTML: an empty one is an `empty-line`. */
function lineFromHtml(html) {
  const content = parseInline(html);
  return content.length ? { type: 'p', attrs: {}, content } : emptyLine();
}

/** The inner HTML of a node as the IE page showed it (inline pictures as FBE's `SPAN class=image`). */
export function fbeInner(node) {
  if (!node) return '';
  if (node.type === 'empty-line') return '';
  if (TEXT_BLOCKS.has(node.type)) {
    return serializeInline(node.content ?? []).replace(
      /<IMG href="([^"]*)"(?: alt="[^"]*")?>/g,
      (all, href) => `<SPAN class=image contentEditable=false href="${href}"><IMG src="fbw-internal:${href}"></SPAN>`,
    );
  }
  return (node.content ?? []).map(fbeOuter).join('\r\n');
}

/** The outer HTML of a node on the IE page: text blocks as `P`, containers as `DIV`. */
export function fbeOuter(node) {
  if (node.type === 'empty-line') return '<P></P>';
  if (TEXT_BLOCKS.has(node.type)) {
    const cls = node.type === 'p' || node.type === 'v' ? '' : node.type === 'date' ? ' class=text-author' : ` class=${node.type}`;
    const id = node.attrs?.id ? ` id=${node.attrs.id}` : '';
    return `<P${id}${cls}>${fbeInner(node)}</P>`;
  }
  return `<DIV class=${node.type}>${fbeInner(node)}</DIV>`;
}

/** `innerText` of a node on the IE page: lines joined by CR LF, NBSP read as a space. */
export function fbeText(node) {
  if (!node || node.type === 'empty-line') return '';
  if (TEXT_BLOCKS.has(node.type)) {
    return (node.content ?? [])
      .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
      .join('')
      .replace(/ /g, ' ');
  }
  return (node.content ?? []).map(fbeText).join('\r\n');
}

/** The text blocks (P elements of the page) under a list of blocks, in document order. */
function linesOf(blocks) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (node.type === 'empty-line' || TEXT_BLOCKS.has(node.type)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  blocks.forEach(visit);
  return out;
}

/**
 * Puts page HTML into a line (`line.innerHTML = html`): an `empty-line` becomes a `p`. A container
 * that the page counted as empty gets the line after it (on the page its HTML was replaced, and
 * 2.7.9 then lost the text when it saved the book).
 */
function setLineHtml(blocks, line, html) {
  const content = parseInline(html);
  if (TEXT_BLOCKS.has(line.type)) {
    line.content = content;
    return line;
  }
  const replacement = { type: 'p', attrs: {}, content };
  const place = (list) => {
    const at = list.indexOf(line);
    if (at >= 0) {
      if (line.type === 'empty-line') list[at] = replacement;
      else list.splice(at + 1, 0, replacement);
      return true;
    }
    return list.some((node) => !TEXT_BLOCKS.has(node.type) && Array.isArray(node.content) && place(node.content));
  };
  place(blocks);
  return replacement;
}

/** A block that 2.7.9 saved as an `empty-line`: no content, or white space (NBSP included) only. */
function isSavedAsEmptyLine(block) {
  if (block.type === 'empty-line') return true;
  if (!TEXT_BLOCKS.has(block.type) || block.type === 'td' || block.type === 'th') return false;
  const content = block.content ?? [];
  if (content.length === 0) return true;
  return content.length === 1 && content[0].type === 'text' && !content[0].marks?.length && !/[^\s\u00A0]/.test(content[0].text ?? '');
}

/** True when every block is an empty line: 2.7.9 did not write such an annotation or history. */
function onlyEmptyLines(blocks) {
  return blocks.every(isSavedAsEmptyLine);
}

function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** `today` of the reference books (YYYY-MM-DD), else the computer's date. */
export function todayOf(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : new Date();
}

/** The ten dates "D.MM.YYYY" from today back, as HistoryChange built them. */
export function recentDates(today) {
  const out = [];
  let time = today.getTime();
  for (let j = 0; j < 10; j += 1) {
    const date = new Date(time);
    out.push(`${date.getDate()}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`);
    time -= 86400000;
  }
  return out;
}

/** FBE's GetUUID: a random UUID in upper case. */
function newUuid() {
  const hex = [];
  for (let i = 0; i < 32; i += 1) hex.push(Math.floor(Math.random() * 16));
  hex[12] = 4;
  hex[16] = (hex[16] & 3) | 8;
  const s = hex.map((h) => h.toString(16)).join('').toUpperCase();
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** A sequence number of the form: an integer, or nothing (the model holds integers only). */
function sequenceNumber(text) {
  const value = String(text ?? '').trim();
  return /^-?\d+$/.test(value) ? Number(value) : undefined;
}

function str(value) {
  return value === undefined || value === null ? '' : String(value);
}

function blankTitleInfo() {
  return { genres: [], authors: [], bookTitle: '', coverpage: [], lang: '', translators: [], sequences: [] };
}

/** A person as the form row left it: the fields the row did not hold stay as they were. */
function fillPerson(person, first, middle, last, nick, email, home) {
  const set = (key, value) => {
    if (value) person[key] = String(value);
    else delete person[key];
  };
  set('firstName', first);
  set('middleName', middle);
  set('lastName', last);
  set('nickname', nick);
  person.emails = email ? [String(email)] : [];
  person.homePages = home ? [String(home)] : [];
}

function isBlankPerson(person) {
  return !person.firstName && !person.middleName && !person.lastName && !person.nickname && !(person.emails ?? [])[0] && !(person.homePages ?? [])[0];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/**
 * Runs the template: `input` holds the settings and the data of the script's section (the
 * original's variable names); another script may pass its own in `ctx.args`, and `today`
 * (YYYY-MM-DD) for the date the script takes as today.
 */
export async function applyTemplate(ctx, input, version) {
  const V14 = version === '1.4';
  const ru = ctx.uiLanguage === 'ru';
  const t = (r, e) => (ru ? r : e);
  const d = { ...input };
  if (ctx.startedBy === 'script' && ctx.args && typeof ctx.args === 'object' && !Array.isArray(ctx.args)) {
    Object.assign(d, ctx.args);
  }
  const arr = (name) => (Array.isArray(d[name]) ? d[name] : []);
  const today = todayOf(d.today);
  const ScriptName = str(d.ScriptName);
  const NumerusVersion = str(d.NumerusVersion);
  const ShablonName = str(d.ShablonName);
  let TextHistory = str(d.TextHistory);
  const youName = str(d.youName);

  //  Текущая дата
  const Segodnja = isoDate(today);
  const SegodnjaText = `${today.getDate()} ${MONTHS_GENITIVE[today.getMonth()]} ${today.getFullYear()}`;

  // The empty-line tests of the page (reELine, reELine_ex): 1.4 lets any tag through but an
  // inline picture; 1.2 lets through the tags whose second letter is not P (a picture's SPAN is
  // content).
  const reELine = V14
    ? new RegExp('^(\\s|' + NBSP_ENTITY + '|<[^>]{1,}>){0,}$', '')
    : new RegExp('^(\\s|' + NBSP_ENTITY + '|<.[^P>][^>]{0,}>){0,}$', '');
  const reELine_ex = /<SPAN [^>]{0,}?class=image/;
  const isEmpty = (block) => (block ? reELine.test(fbeInner(block)) && (!V14 || !reELine_ex.test(fbeInner(block))) : false);

  const snapshot = await mfbe.doc.get();
  const desc = snapshot.description;
  const before = JSON.stringify(desc);
  await mfbe.edit.label(`${ScriptName} v.${NumerusVersion} :: ${ShablonName}`);

  const ClearOf = (name) => Number(d[name]) === 0;

  let k = 0;
  let Length;
  let change = false;
  let ex;

  /// Функция добавления жанров
  function AddGenre(mGenre, list) {
    change = false;
    ex = JSON.stringify(list);
    Length = mGenre.length;
    let row = 0;
    for (k = 0; k < Length; k++) {
      if (mGenre[k]) {
        list[row] = { code: String(mGenre[k]) }; // the genre replaced, its match removed
        row += 1;
        change = true;
      }
    }
    if (change) list.length = row;
    return V14 ? ex !== JSON.stringify(list) : change;
  }

  /// Функция добавления авторов и переводчиков (the replacing mode)
  function AddAuthor(mFirstName, mMiddleName, mLastName, mNickname, mEmail, mHomePage, mID, list, ID) {
    change = false;
    ex = JSON.stringify(list);
    Length = Math.max(mFirstName.length, mMiddleName.length, mLastName.length, mNickname.length);
    let row = 0;
    for (; k < Length; k++) {
      if (mFirstName[k] || mMiddleName[k] || mLastName[k] || mNickname[k]) {
        // A row beyond the book's persons is a new person. 2.7.9 made it a copy of the row
        // before, so it kept that row's id where the template gave none (fixed).
        if (row >= list.length) list.push({ homePages: [], emails: [] });
        const person = list[row];
        fillPerson(person, mFirstName[k], mMiddleName[k], mLastName[k], mNickname[k], mEmail[k], mHomePage[k]);
        if (ID) {
          if (V14) {
            if (mID[k] && person.id !== String(mID[k])) person.id = String(mID[k]);
          } else if (mID[k]) person.id = String(mID[k]);
          else delete person.id;
        }
        row += 1;
        change = true;
      }
    }
    if (change) list.length = row;
    return V14 ? ex !== JSON.stringify(list) : change;
  }

  /// Функция добавления серии
  function AddSequence(sequenceName, sequenceNumber_, list) {
    ex = JSON.stringify(list);
    if (sequenceName) {
      const first = list[0] ? { ...list[0] } : { name: '', children: [] };
      first.name = String(sequenceName);
      first.children = [];
      const n = sequenceNumber_ ? sequenceNumber(sequenceNumber_) : undefined;
      if (n !== undefined) first.number = n;
      else delete first.number;
      list.length = 0;
      list.push(first);
      return V14 ? ex !== JSON.stringify(list) : true;
    }
    return false;
  }

  /// Simple fields: 1.4 changes a field (and reports it) only when the value differs.
  function SetField(value, get, set) {
    if (!value) return false;
    if (V14 && get() === String(value)) return false;
    set(String(value));
    return true;
  }

  // ---------------------------------------------------------------
  ///   TITLE-INFO
  const ti = desc.titleInfo;
  let change_T01 = false, change_T02 = false, change_T03 = false, change_T04 = false, change_T05 = false, change_T06 = false,
    change_T07 = false, change_T08 = false, change_T09 = false, change_T10 = false, change_T11 = false;

  change_T01 = AddGenre(arr('titleInfoGenre'), ti.genres);
  change_T02 = AddAuthor(arr('titleInfoAuthorFirstName'), arr('titleInfoAuthorMiddleName'), arr('titleInfoAuthorLastName'), arr('titleInfoAuthorNickname'), arr('titleInfoAuthorEmail'), arr('titleInfoAuthorHomePage'), arr('titleInfoAuthorID'), ti.authors, true);
  change_T03 = SetField(d.titleInfoBookTitle, () => ti.bookTitle ?? '', (v) => { ti.bookTitle = v; });
  change_T04 = SetField(d.titleInfoKeywords, () => ti.keywords ?? '', (v) => { ti.keywords = v; });
  change_T05 = SetField(d.titleInfoDate, () => ti.date?.text ?? '', (v) => { ti.date = { ...(ti.date ?? {}), text: v }; });
  change_T06 = SetField(d.titleInfoDateValue, () => ti.date?.value ?? '', (v) => { ti.date = { text: '', ...(ti.date ?? {}), value: v }; });
  change_T07 = SetField(d.titleInfoLang, () => ti.lang ?? '', (v) => { ti.lang = v; });
  change_T08 = SetField(d.titleInfoSrcLang, () => ti.srcLang ?? '', (v) => { ti.srcLang = v; });
  change_T09 = AddAuthor(arr('titleInfoTranslatorFirstName'), arr('titleInfoTranslatorMiddleName'), arr('titleInfoTranslatorLastName'), arr('titleInfoTranslatorNickname'), arr('titleInfoTranslatorEmail'), arr('titleInfoTranslatorHomePage'), [], ti.translators, false);
  change_T10 = AddSequence(d.titleInfoSequenceName, d.titleInfoSequenceNumber, ti.sequences);

  /// <title-info>  ::  Аннотация (the Body view always held the annotation block)
  {
    const original = ti.annotation?.content?.length ? ti.annotation.content : [emptyLine()];
    let Annotation = clone(original);
    const exAnnotation = Annotation.map(fbeOuter).join('\r\n');
    if (ClearOf('ClearAnnotation') && (V14 || Annotation.length !== 1 || fbeInner(Annotation[Annotation.length - 1]) !== '')) {
      Annotation = [emptyLine()];
      if (!V14) change_T11 = true;
    }
    const titleInfoAnnotation = arr('titleInfoAnnotation');
    const newSection = [];
    Length = titleInfoAnnotation.length;
    for (; k < Length; k++) {
      let line = str(titleInfoAnnotation[k]);
      if (line) {
        // The four tags of the template become the page's tags; 1.4 reads the rest as text.
        if (V14) {
          line = inCode(line)
            .replace(/&lt;(\/{0,1})strong&gt;/g, '<$1STRONG>')
            .replace(/&lt;(\/{0,1})emphasis&gt;/g, '<$1EM>')
            .replace(/&lt;(\/{0,1})sup&gt;/g, '<$1SUP>')
            .replace(/&lt;(\/{0,1})sub&gt;/g, '<$1SUB>');
        } else {
          line = htmlOfTemplate(line)
            .replace(/(<\/{0,1})strong>/g, '$1STRONG>')
            .replace(/(<\/{0,1})emphasis>/g, '$1EM>')
            .replace(/(<\/{0,1})sup>/g, '$1SUP>')
            .replace(/(<\/{0,1})sub>/g, '$1SUB>');
        }
      }
      newSection.push(lineFromHtml(line));
    }
    // The empty first and last lines are removed (1.2 tests their text, 1.4 their HTML).
    const blankEnd = (block) => (V14 ? isEmpty(block) : reELine.test(fbeText(block)));
    while (newSection.length && blankEnd(newSection[0])) newSection.shift();
    while (newSection.length && blankEnd(newSection[newSection.length - 1])) newSection.pop();
    const newText = newSection.map(fbeText).join('\r\n');
    const newHtml = newSection.map(fbeOuter).join('\r\n');
    // Already in the annotation? (2.7.9 used the lines' HTML as a regular expression: fixed.)
    if (newText !== '' && !Annotation.map(fbeOuter).join('\r\n').includes(newHtml)) {
      if (!isEmpty(Annotation[Annotation.length - 1])) Annotation.push(emptyLine());
      if (Annotation.length === 1) Annotation = [];
      Annotation.push(...newSection);
      if (!V14) change_T11 = true;
    }
    if (V14 && exAnnotation !== Annotation.map(fbeOuter).join('\r\n')) change_T11 = true;
    if (!same(Annotation, original)) {
      if (onlyEmptyLines(Annotation)) delete ti.annotation;
      else ti.annotation = { type: 'annotation', attrs: { ...(ti.annotation?.attrs ?? {}) }, content: Annotation };
    }
  }

  // ---------------------------------------------------------------
  ///   SRC-TITLE-INFO (the form always showed it; an absent one is blank)
  const sti = desc.srcTitleInfo ? desc.srcTitleInfo : blankTitleInfo();
  let change_S01 = false, change_S02 = false, change_S03 = false, change_S04 = false, change_S05 = false, change_S06 = false,
    change_S07 = false, change_S08 = false, change_S09 = false, change_S10 = false;

  if (V14) change_S01 = AddGenre(arr('srcTitleInfoGenre'), sti.genres);
  else {
    // 1.2 goes on from the index the annotation reached.
    const mGenre = arr('srcTitleInfoGenre');
    Length = mGenre.length;
    let row = 0;
    for (; k < Length; k++) {
      if (mGenre[k]) {
        sti.genres[row] = { code: String(mGenre[k]) };
        row += 1;
        change_S01 = true;
      }
    }
    if (change_S01) sti.genres.length = row;
  }
  change_S02 = AddAuthor(arr('srcTitleInfoAuthorFirstName'), arr('srcTitleInfoAuthorMiddleName'), arr('srcTitleInfoAuthorLastName'), arr('srcTitleInfoAuthorNickname'), arr('srcTitleInfoAuthorEmail'), arr('srcTitleInfoAuthorHomePage'), arr('srcTitleInfoAuthorID'), sti.authors, true);
  change_S03 = SetField(d.srcTitleInfoBookTitle, () => sti.bookTitle ?? '', (v) => { sti.bookTitle = v; });
  change_S04 = SetField(d.srcTitleInfoKeywords, () => sti.keywords ?? '', (v) => { sti.keywords = v; });
  change_S05 = SetField(d.srcTitleInfoDate, () => sti.date?.text ?? '', (v) => { sti.date = { ...(sti.date ?? {}), text: v }; });
  change_S06 = SetField(d.srcTitleInfoDateValue, () => sti.date?.value ?? '', (v) => { sti.date = { text: '', ...(sti.date ?? {}), value: v }; });
  change_S07 = SetField(d.srcTitleInfoLang, () => sti.lang ?? '', (v) => { sti.lang = v; });
  change_S08 = SetField(d.srcTitleInfoSrcLang, () => sti.srcLang ?? '', (v) => { sti.srcLang = v; });
  change_S09 = AddAuthor(arr('srcTitleInfoTranslatorFirstName'), arr('srcTitleInfoTranslatorMiddleName'), arr('srcTitleInfoTranslatorLastName'), arr('srcTitleInfoTranslatorNickname'), arr('srcTitleInfoTranslatorEmail'), arr('srcTitleInfoTranslatorHomePage'), [], sti.translators, false);
  change_S10 = AddSequence(d.srcTitleInfoSequenceName, d.srcTitleInfoSequenceNumber, sti.sequences);
  if (!desc.srcTitleInfo && !same(sti, blankTitleInfo())) desc.srcTitleInfo = sti;

  // ---------------------------------------------------------------
  ///   DOCUMENT-INFO
  const di = desc.documentInfo;
  let change_D01 = false, change_D02 = false, change_D03 = false, change_D04 = false, change_D05 = false, change_D06 = false,
    change_D07 = false, change_D08 = false, change_D09 = false;

  change_D01 = SetField(d.documentInfoVersion, () => di.version ?? '', (v) => { di.version = v; });

  if (Number(d.ChangeID) === 0) {
    di.id = newUuid();
    change_D02 = true;
  }

  /// <document-info>  ::  Авторы (adding or replacing, as the setting says)
  {
    change = false;
    ex = JSON.stringify(di.authors);
    const F = arr('documentInfoAuthorFirstName'), M = arr('documentInfoAuthorMiddleName'), L = arr('documentInfoAuthorLastName'),
      N = arr('documentInfoAuthorNickname'), E = arr('documentInfoAuthorEmail'), H = arr('documentInfoAuthorHomePage');
    Length = Math.max(F.length, M.length, L.length, N.length);
    const list = di.authors;
    let row = 0; // the row the next author goes into
    if (Number(d.ChangeAuthor) !== 0) {
      // Adding: after the last row, or into it when it is blank.
      row = list.length;
      if (row > 0 && isBlankPerson(list[row - 1])) row -= 1;
    }
    Label_1: for (; k < Length; k++) {
      if (F[k] || M[k] || L[k] || N[k]) {
        if (Number(d.ChangeAuthor) !== 0) {
          for (const person of list) {
            const eq = (a, b) => str(a) === str(b) || (!a && !b);
            if (eq(F[k], person.firstName) && eq(M[k], person.middleName) && eq(L[k], person.lastName) && eq(N[k], person.nickname)) continue Label_1;
          }
        }
        if (row >= list.length) list.push({ homePages: [], emails: [] });
        fillPerson(list[row], F[k], M[k], L[k], N[k], E[k], H[k]);
        row += 1;
        change = true;
      }
    }
    if (change) list.length = row;
    change_D03 = V14 ? ex !== JSON.stringify(list) : change;
  }

  change_D04 = SetField(d.documentInfoProgramUsed, () => di.programUsed ?? '', (v) => { di.programUsed = v; });

  /// Дата текстом ; Значение даты :: "сегодня" is today's date
  {
    let date = str(d.documentInfoDate);
    if (date === 'сегодня') date = SegodnjaText;
    change_D05 = SetField(date, () => di.date?.text ?? '', (v) => { di.date = { ...(di.date ?? {}), text: v }; });
    let value = str(d.documentInfoDateValue);
    if (value === 'сегодня') value = Segodnja;
    change_D06 = SetField(value, () => di.date?.value ?? '', (v) => { di.date = { text: '', ...(di.date ?? {}), value: v }; });
  }

  change_D07 = SetField(d.documentInfoSrcOcr, () => di.srcOcr ?? '', (v) => { di.srcOcr = v; });

  if (d.documentInfoSrcUrl) {
    ex = JSON.stringify(di.srcUrls);
    di.srcUrls = [String(d.documentInfoSrcUrl)];
    change_D08 = V14 ? ex !== JSON.stringify(di.srcUrls) : true;
  }

  /// <document-info>  ::  История изменений файла (the Body view always held the history block)
  const historyOriginal = di.history?.content?.length ? di.history.content : [emptyLine()];
  let History = clone(historyOriginal);
  if (ClearOf('ClearHistory') && (History.length !== 1 || fbeInner(History[0]) !== '')) {
    History = [emptyLine()];
    change_D09 = true;
  }
  let documentInfoHistory = str(d.documentInfoHistory);
  if (documentInfoHistory) {
    documentInfoHistory = V14 ? inCode(documentInfoHistory) : htmlOfTemplate(documentInfoHistory);
    // Already a line of the history? (2.7.9 used the text as a regular expression, and 1.2
    // compared the template's HTML with the page's: fixed, the line is compared as read.)
    const line = fbeOuter(lineFromHtml(documentInfoHistory));
    const present = History.map(fbeOuter).join('\r\n').includes(line);
    if (!present) {
      if (!isEmpty(History[History.length - 1])) History.push(emptyLine());
      setLineHtml(History, History[History.length - 1], documentInfoHistory);
      change_D09 = true;
    }
  }

  // ---------------------------------------------------------------
  ///   PUBLISH-INFO
  const pi = desc.publishInfo ? desc.publishInfo : { sequences: [] };
  let change_P01 = false, change_P02 = false, change_P03 = false, change_P04 = false, change_P05 = false, change_P06 = false;
  change_P01 = SetField(d.publishInfoBookName, () => pi.bookName ?? '', (v) => { pi.bookName = v; });
  change_P02 = SetField(d.publishInfoPublisher, () => pi.publisher ?? '', (v) => { pi.publisher = v; });
  change_P03 = SetField(d.publishInfoCity, () => pi.city ?? '', (v) => { pi.city = v; });
  change_P04 = SetField(d.publishInfoYear, () => pi.year ?? '', (v) => { pi.year = v; });
  change_P05 = SetField(d.publishInfoISBN, () => pi.isbn ?? '', (v) => { pi.isbn = v; });
  change_P06 = AddSequence(d.publishInfoSequenceName, d.publishInfoSequenceNumber, pi.sequences);
  if (!desc.publishInfo && !same(pi, { sequences: [] })) desc.publishInfo = pi;

  // ---------------------------------------------------------------
  ///   CUSTOM-INFO
  let change_C01 = false;
  {
    change = false;
    ex = JSON.stringify(desc.customInfo);
    const customInfoType = arr('customInfoType');
    const customInfo = arr('customInfo');
    Length = customInfo.length;
    let row = 0;
    for (; k < Length; k++) {
      const value = str(customInfo[k]).replace(/^\n+|\n+$/g, '');
      if (value) {
        if (row >= desc.customInfo.length) desc.customInfo.push({ infoType: '', text: '' });
        const entry = desc.customInfo[row];
        entry.text = value;
        entry.infoType = customInfoType[k] ? String(customInfoType[k]) : '';
        row += 1;
        change = true;
      }
    }
    if (change) desc.customInfo.length = row;
    change_C01 = V14 ? ex !== JSON.stringify(desc.customInfo) : change;
  }

  // ---------------------------------------------------------------
  ///  ПОВЫШЕНИЕ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В ИСТОРИЮ ИЗМЕНЕНИЙ (HistoryChange)
  if (Number(d.Version_on_off) === 1 && !documentInfoHistory) {
    HistoryChange();
  }

  function HistoryChange() {
    const mDate = recentDates(today);
    // Поиск недавней записи в "истории": the last line holding one of the ten dates.
    let povtorD = false;
    const mP = linesOf(History);
    let s = '';
    let j;
    let kd = 0;
    fff: for (j = mP.length - 1; j >= 0; j--) {
      s = serializeInline(mP[j].content ?? []);
      for (kd = 0; kd < 10; kd++) {
        if (s.includes(mDate[kd])) {
          povtorD = true;
          break fff;
        }
      }
    }
    let textYouName = V14 ? inCode(youName) : youName;
    if (youName !== '') textYouName += ', ';
    if (V14) TextHistory = inCode(TextHistory);
    const nameDate = escapeRe(textYouName + mDate[kd]);
    const reHist00s = new RegExp('[^А-яЁёA-Za-z0-9]' + escapeRe(TextHistory) + '[^А-яЁёA-Za-z0-9]', '');
    //  Добавление текста перед словом "Скрипт"
    const reHist01 = new RegExp('(\\s|' + NBSP_ENTITY + ')([Сс]крипт)', '');
    const reHist01_ = ' ' + TextHistory + '. $2';
    //  Добавление точки
    const reHist02 = new RegExp('(.[^…\\?!\\.,;:—])(\\s|' + NBSP_ENTITY + ')(— ' + nameDate + ')', '');
    const reHist02_ = '$1. $3';
    //  Добавление текста перед именем и датой
    const reHist03 = new RegExp('(.)(\\s|' + NBSP_ENTITY + ')(— ' + nameDate + ')', '');
    const reHist03_ = '$1 ' + TextHistory + ' $3';

    if (povtorD) {
      if (s.search(reHist03) !== -1) {
        if (s.search(reHist00s) === -1) {
          if (s.search(reHist01) !== -1) s = s.replace(reHist01, reHist01_);
          else {
            if (s.search(reHist02) !== -1) s = s.replace(reHist02, reHist02_);
            if (s.search(reHist03) !== -1) s = s.replace(reHist03, reHist03_);
          }
        }
        if (kd !== 0) s = s.replace(mDate[kd], mDate[0]);
        if (serializeInline(mP[j].content ?? []) !== s) {
          setLineHtml(History, mP[j], s);
          change_D09 = true;
        }
      } else povtorD = false;
    }
    if (povtorD) return;

    //  Повышение версии
    let versionFile = str(di.version);
    let newVersion = versionFile;
    let versionText = '';
    if (d.documentInfoVersion) versionText = 'v.' + versionFile + ' — ';
    const ValidationVersion = versionFile.length <= 10 && versionFile.search(/^\d{0,10}(\.\d{1,8})?$/g) !== -1;
    if (ValidationVersion && !d.documentInfoVersion) {
      if (versionFile === '') versionFile = '1.0';
      if (versionFile.search(/^\d+$/g) !== -1) newVersion = versionFile + '.1';
      else {
        let n = +versionFile.replace(/^\d+\./g, '');
        n++;
        newVersion = versionFile.replace(/\.\d+$/g, '') + '.' + n;
      }
      if (newVersion.length <= 10) di.version = newVersion;
      versionText = 'v.' + newVersion + ' — ';
      change_D01 = true;
    }
    //   Добавление строк в историю изменений
    const reHist11 = V14 ? new RegExp('^(\\s|' + NBSP_ENTITY + '){0,}$', '') : reELine;
    const reHist12 = new RegExp('(^|\\n)[^0-9]{0,12}' + escapeRe(versionFile) + '([^0-9]|$)', '');
    const historyText = History.map(fbeText).join('\r\n');
    const lastIsEmpty = () => reHist11.test(fbeInner(History[History.length - 1]));
    if ((!V14 || ValidationVersion) && historyText.search(reHist12) === -1 && !d.documentInfoVersion) {
      if (!lastIsEmpty()) History.push(emptyLine());
      setLineHtml(History, History[History.length - 1], 'v.' + inCode(versionFile) + ' — ?');
      change_D09 = true;
    }
    if (!lastIsEmpty()) History.push(emptyLine());
    setLineHtml(History, History[History.length - 1], versionText + ' ' + TextHistory + ' — ' + textYouName + mDate[0]);
    change_D09 = true;
  }

  if (!same(History, historyOriginal)) {
    if (onlyEmptyLines(History)) delete di.history;
    else di.history = { type: 'annotation', attrs: { ...(di.history?.attrs ?? {}) }, content: History };
  }

  if (JSON.stringify(desc) !== before) await mfbe.doc.setDescription(desc);

  // ---------------------------------------------------------------
  /// ОКНО РЕЗУЛЬТАТОВ
  const now = new Date();
  const currentTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const currentDate = `${now.getDate()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(-2)}`;
  const DEFAULT_SCRIPT = '«Изменить дескрипшен»';
  const DEFAULT_TEMPLATE = '«Без изменений»';
  const shownScript = !ru && ScriptName === DEFAULT_SCRIPT ? '"Change the description"' : ScriptName;
  const shownTemplate = !ru && ShablonName === DEFAULT_TEMPLATE ? '"No changes"' : ShablonName;

  // Демонстрационный режим "Показать все строки"
  const VseStroki_on_off = 0;
  const demo = VseStroki_on_off === 1;

  const mSt = [];
  mSt.push(' ' + shownScript + ' v.' + NumerusVersion);
  mSt.push('-----------------------------------------------------');
  mSt.push(' ' + shownTemplate);
  mSt.push('-----------------------------------------------------');
  if (demo) mSt.push(t(' Демонстрационный режим', ' Demonstration mode'));
  const start = mSt.length;
  const block = (title, items) => {
    const lines = items.filter(([flag]) => flag || demo).map(([, ruText, enText]) => '   ' + t(ruText, enText));
    if (lines.length) mSt.push('', title, ...lines);
  };
  block(t('• ИЗМЕНЕНИЯ в <title-info>:', '• CHANGES in <title-info>:'), [
    [change_T01, 'Жанры', 'Genres'], [change_T02, 'Авторы', 'Authors'], [change_T03, 'Название', 'Title'],
    [change_T04, 'Ключевые слова', 'Keywords'], [change_T05, 'Дата', 'Date'], [change_T06, 'Значение даты', 'Date value'],
    [change_T07, 'Язык', 'Language'], [change_T08, 'Язык оригинала', 'Source language'], [change_T09, 'Переводчики', 'Translators'],
    [change_T10, 'Серия', 'Sequence'], [change_T11, 'Аннотация', 'Annotation'],
  ]);
  block(t('• ИЗМЕНЕНИЯ в <src-title-info>:', '• CHANGES in <src-title-info>:'), [
    [change_S01, 'Жанры', 'Genres'], [change_S02, 'Авторы', 'Authors'], [change_S03, 'Название', 'Title'],
    [change_S04, 'Ключевые слова', 'Keywords'], [change_S05, 'Дата', 'Date'], [change_S06, 'Значение даты', 'Date value'],
    [change_S07, 'Язык', 'Language'], [change_S08, 'Язык оригинала', 'Source language'], [change_S09, 'Переводчики', 'Translators'],
    [change_S10, 'Серия', 'Sequence'],
  ]);
  block(t('• ИЗМЕНЕНИЯ в <document-info>:', '• CHANGES in <document-info>:'), [
    [change_D01, 'Версия', 'Version'], [change_D02, 'ID файла', 'File ID'], [change_D03, 'Авторы', 'Authors'],
    [change_D04, 'Программы', 'Programs used'], [change_D05, 'Дата', 'Date'], [change_D06, 'Значение даты', 'Date value'],
    [change_D07, 'Source OCR', 'Source OCR'], [change_D08, 'Source URLs', 'Source URLs'], [change_D09, 'История изменений', 'History'],
  ]);
  block(t('• ИЗМЕНЕНИЯ в <publish-info>:', '• CHANGES in <publish-info>:'), [
    [change_P01, 'Заголовок книги', 'Book name'], [change_P02, 'Издатель', 'Publisher'], [change_P03, 'Город', 'City'],
    [change_P04, 'Год издания', 'Year'], [change_P05, 'ISBN', 'ISBN'], [change_P06, 'Серия', 'Sequence'],
  ]);
  block(t('• ИЗМЕНЕНИЯ в <custom-info>:', '• CHANGES in <custom-info>:'), [[change_C01, 'Весь раздел', 'The whole section']]);
  if (mSt.length === start || demo) {
    mSt.push('', t('   >> Исправлений нет', '   >> No changes'));
    if (ShablonName === DEFAULT_TEMPLATE) {
      mSt.push('');
      if (ru) {
        mSt.push('Сейчас скрипт не производит никаких ', 'изменений в разделе <description>. ', 'Для того, чтобы он что-то сделал, ',
          'необходимо указать, что именно от него ', 'требуется, в коде самого скрипта. ', 'А точнее в разделах: «Настройки» и ',
          '«Добавляемые данные». ', 'Оба этих раздела расположены в самом ', 'начале скрипта. ', '',
          'Встроенный скрипт не меняется: скопируйте ', 'его папку в свою папку скриптов ', '(Скрипты > Открыть папку скриптов), ',
          'дайте копии новый id в её script.json, ', 'заполните её файл index.js ', 'и выберите Скрипты > Перечитать скрипты.');
      } else {
        mSt.push('As it is, the script makes no changes ', 'to the <description> section. ', 'To make it do something, say what it ',
          'should do in the code of the script itself, ', 'in its sections "Settings" (НАСТРОЙКИ) and ', '"Data to add" (ДОБАВЛЯЕМЫЕ ДАННЫЕ). ',
          'Both sections are at the very beginning ', 'of the script. ', '',
          'A bundled script cannot be edited: copy ', 'its folder into your scripts folder ', '(Scripts > Open scripts folder), ',
          'give the copy a new id in its script.json, ', 'fill in its index.js ', 'and choose Scripts > Reload scripts.');
      }
    }
  }
  mSt.push('\t\t\t\t\t', '-----------------------------------------------------', '• ' + currentDate + ' • ' + currentTime + ' •');
  await mfbe.ui.message(mSt.join('\n'), { caption: ctx.script.name });
}
