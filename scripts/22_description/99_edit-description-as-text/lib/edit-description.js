// Engine of the converted «Редакция описания документа» (FictionBook Editor 2.7.9,
// Scripts/22_Дескрипшен/99_Редакция описания документа.js, version 1.1, by Александр Ка).
//
// The original works in two steps. The first run copies the text data of the Description form
// into a body of its own, named "Раздел «description-1.z.<code>»", where they can be edited by
// hand or by other scripts; the second run reads that body back into the form, with automatic
// clean-up, removes it and raises the file's version with a history line. With the setting
// Pause = 0 both steps run at once (the automatic clean-up alone).
//
// Here the form is the description of the document model (`mfbe.doc.get()`, written back with
// one `mfbe.doc.setDescription`) and the body is a body of the book (`doc.insertNode` /
// `doc.removeNode`):
//  - a list of the form always held at least one row, a blank one for an empty list; the
//    model's empty list is that row (it shows as an empty entry when empty data are shown);
//  - the body is built as 2.7.9 built it; where FB2 needs content after a section's title or
//    annotation (a book title, a sequence, the explanation), an `empty-line` follows it;
//  - the body is placed after the book's first body: a script cannot remove the first body, so a
//    body placed before it, as 2.7.9 did, could not be taken out again;
//  - the second step reads the body's lines as the IE page gave them (`innerText`: lines joined
//    by CR LF, a non-breaking space read as a space) and applies the original's expressions to
//    them unchanged.

import { parseInline, serializeInline } from './legacy-html.js';
import { PROVERBS } from './proverbs.js';

const NBSP = ' ';
const NBSP_ENTITY = '&nbsp;';
const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const STALE_BODY = /^Раздел «description\-\d\.[a-z]\.\d+»$/;

/* ------------------------------------------------------------------------ */
/* Small helpers                                                            */
/* ------------------------------------------------------------------------ */

/** `inCode` of the original: plain text in the notation of the page. */
function inCode(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/ /g, NBSP_ENTITY);
}

function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

const str = (value) => (value === undefined || value === null ? '' : String(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A paragraph from page HTML. */
function pHtml(html) {
  return { type: 'p', attrs: {}, content: parseInline(html) };
}

/** A line of the explanation: a blank one is an `empty-line`, as 2.7.9 saved it. */
function pOrEmpty(html) {
  const content = parseInline(html);
  const blank = content.every((c) => c.type === 'text' && !/[^\s ]/.test(c.text ?? ''));
  return blank ? { type: 'empty-line', attrs: {} } : { type: 'p', attrs: {}, content };
}

function todayOf(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(value));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0) : new Date();
}

function sequenceNumber(text) {
  const value = str(text).trim();
  return /^-?\d+$/.test(value) ? Number(value) : undefined;
}

/** The plain text of a person field list's first item. */
const first = (list) => str((list ?? [])[0]);

/* ------------------------------------------------------------------------ */
/* The body as the IE page held it                                          */
/* ------------------------------------------------------------------------ */

/** Parent links of a model subtree (the page's parentNode). */
function parentsOf(root) {
  const parents = new Map();
  const visit = (node) => {
    if (!node || node.type === 'text' || TEXT_BLOCKS.has(node.type)) return;
    for (const child of node.content ?? []) {
      if (child.type === 'text') continue;
      parents.set(child, node);
      visit(child);
    }
  };
  visit(root);
  return parents;
}

/** `innerText` of a node of the body: text, lines joined by CR LF, NBSP read as a space. */
function textOf(node) {
  if (!node || node.type === 'empty-line') return '';
  if (TEXT_BLOCKS.has(node.type)) {
    return (node.content ?? [])
      .map((c) => (c.type === 'text' ? c.text ?? '' : ''))
      .join('')
      .replace(/ /g, ' ');
  }
  return (node.content ?? []).filter((c) => c.type !== 'text').map(textOf).join('\r\n');
}

const isP = (node) => !!node && (node.type === 'empty-line' || TEXT_BLOCKS.has(node.type));
const isDiv = (node) => !!node && !isP(node) && node.type !== 'text';

/** The P elements (text blocks and empty lines) of a subtree, in document order. */
function linesOf(root) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (isP(node)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const child of root.content ?? []) visit(child);
  return out;
}

/** The DIV elements of a subtree, in document order (the root itself not included). */
function divsOf(root) {
  const out = [];
  const visit = (node) => {
    if (!isDiv(node)) return;
    out.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  for (const child of root.content ?? []) visit(child);
  return out;
}

/* ------------------------------------------------------------------------ */
/* Names: sorting, dropping repeats (one algorithm in four places of 2.7.9) */
/* ------------------------------------------------------------------------ */

/**
 * The original's binary insertion over "Ф LAST FIRST MIDDLE NICK [ID]" (upper case, Ё after Е):
 * drops a name met before and returns the names in their order and sorted.
 */
function dedupeAndSort(M, ID) {
  const list = [...M];
  const mFION = [' ', '№'];
  const MM = [];
  aaa: for (let n = 0; n < list.length; n++) {
    let fion = ('Ф ' + list[n][2] + ' ' + list[n][0] + ' ' + list[n][1] + ' ' + list[n][3]).toUpperCase().replace(/Ё/g, 'Е№').replace(/[′`´ʼ΄‘’]/g, "'");
    if (ID) fion += ' ' + list[n][6];
    let k1 = 0;
    let k2 = mFION.length - 1;
    while (k2 - k1 !== 1) {
      const kMidi = Math.floor((k2 + k1) / 2);
      if (fion === mFION[kMidi]) {
        list.splice(n, 1);
        n--;
        continue aaa;
      }
      if (fion > mFION[kMidi]) k1 = kMidi;
      else k2 = kMidi;
    }
    mFION.splice(k2, 0, fion);
    MM.splice(k2 - 1, 0, list[n]);
  }
  return { M: list, MM };
}

/** A row of the form: [first, middle, last, nick, email, home(, id)]. */
function rowOf(person, ID) {
  const row = [str(person.firstName), str(person.middleName), str(person.lastName), str(person.nickname), first(person.emails), first(person.homePages)];
  if (ID) row.push(str(person.id));
  return row;
}

const rowHasName = (row) => !!(row[0] || row[1] || row[2] || row[3]);

/** The rows the form showed for a list (an empty list is one blank row), for its change flag. */
function formRows(persons, ID) {
  return JSON.stringify((persons.length ? persons : [{}]).map((person) => rowOf(person, ID)));
}

/** The rows the form showed for sequences (an empty list is one blank row). */
function sequenceRows(list) {
  const row = (seq) => [str(seq.name), seq.number === undefined || seq.number === null ? '' : String(seq.number), (seq.children ?? []).map(row)];
  return JSON.stringify((list.length ? list : [{ name: '', children: [] }]).map(row));
}

/**
 * Persons written from rows. The fields the text does not hold come back from the person of
 * the same names before the run: the id of a translator or of a document author, the second
 * and further e-mails and home pages.
 */
function personsOf(rows, ID, previous) {
  const used = new Set();
  return rows.map((row) => {
    const person = { homePages: row[5] ? [row[5]] : [], emails: row[4] ? [row[4]] : [] };
    if (row[0]) person.firstName = row[0];
    if (row[1]) person.middleName = row[1];
    if (row[2]) person.lastName = row[2];
    if (row[3]) person.nickname = row[3];
    if (ID && row[6]) person.id = row[6];
    const twin = previous.find((p, i) => !used.has(i) && str(p.firstName) === row[0] && str(p.middleName) === row[1] && str(p.lastName) === row[2] && str(p.nickname) === row[3] && (used.add(i), true));
    if (twin) {
      if (!ID && twin.id) person.id = twin.id;
      if ((twin.emails ?? []).length > 1 && first(twin.emails) === row[4]) person.emails = [...twin.emails];
      if ((twin.homePages ?? []).length > 1 && first(twin.homePages) === row[5]) person.homePages = [...twin.homePages];
    }
    return person;
  });
}

/** EntitySrcTitleInfo of the original: no value in any field of the source book's form. */
function isBlankSource(info) {
  const seqBlank = (q) => !q.name && (q.number === undefined || q.number === null) && (q.children ?? []).every(seqBlank);
  return (
    !info.genres.some((g) => g.code || (g.match !== undefined && g.match !== 100)) &&
    !info.authors.some((p) => p.firstName || p.middleName || p.lastName || p.nickname || first(p.emails) || first(p.homePages) || p.id) &&
    !str(info.bookTitle) && !str(info.keywords) && !str(info.date?.text) && !str(info.date?.value) && !str(info.lang) && !str(info.srcLang) &&
    !info.translators.some((p) => p.firstName || p.middleName || p.lastName || p.nickname || first(p.emails) || first(p.homePages)) &&
    info.sequences.every(seqBlank) && !(info.coverpage ?? []).length && !info.annotation
  );
}

/* ------------------------------------------------------------------------ */
/* The script                                                               */
/* ------------------------------------------------------------------------ */

export async function editDescription(ctx, input) {
  const ru = ctx.uiLanguage === 'ru';
  const t = (r, e) => (ru ? r : e);
  const d = { ...input };
  if (ctx.startedBy === 'script' && ctx.args && typeof ctx.args === 'object' && !Array.isArray(ctx.args)) Object.assign(d, ctx.args);
  const num = (name) => Number(d[name]);

  const ScriptName = '«Редакция описания документа»';
  const NumerusVersion = '1.1';
  const Ts = Date.now();
  const today = todayOf(d.today);
  let T_pause = 0;

  let Pause = num('Pause'), ShowEmpty = num('ShowEmpty'), FIO = num('FIO'), Delenie = num('Delenie'), Sortirovka = num('Sortirovka');
  const DelLang = num('DelLang');
  let ShowAuthorTI = num('ShowAuthorTI'), ShowTranslatorTI = num('ShowTranslatorTI'), ShowSequenceTI = num('ShowSequenceTI');
  let ShowAuthorSTI = num('ShowAuthorSTI'), ShowTranslatorSTI = num('ShowTranslatorSTI'), ShowSequenceSTI = num('ShowSequenceSTI');
  let ShowAuthorDI = num('ShowAuthorDI'), ShowSequencePI = num('ShowSequencePI');
  const Pojasnenie = num('Pojasnenie'), Version_on_off = num('Version_on_off'), Vsegda_on_off = num('Vsegda_on_off');
  const youName = str(d.youName);

  ///   Дополнительная обработка настроек
  if (Pause === 0) {
    ShowEmpty = 0;
    ShowAuthorTI = ShowTranslatorTI = ShowSequenceTI = 0;
    ShowAuthorSTI = ShowTranslatorSTI = ShowSequenceSTI = 0;
    ShowAuthorDI = ShowSequencePI = 0;
    FIO = 0;
  }
  let ShowAuthor = 0;
  if (ShowAuthorTI === 1 || ShowTranslatorTI === 1 || ShowAuthorSTI === 1 || ShowTranslatorSTI === 1 || ShowAuthorDI === 1) ShowAuthor = 1;
  if (ShowAuthorTI === 1 && ShowTranslatorTI === 1 && ShowAuthorSTI === 1 && ShowTranslatorSTI === 1 && ShowAuthorDI === 1) ShowAuthor = 2;
  if (ShowAuthor === 0) Delenie = 1;

  ///   Функция создания кода
  const createCode = () => {
    let code = 0;
    if (ShowEmpty === 1) code += 1;
    if (FIO !== 0) code += 2;
    if (Delenie !== 0) code += 4;
    if (Sortirovka !== 0) code += 8;
    if (ShowAuthorTI === 1) code += 16;
    if (ShowTranslatorTI === 1) code += 32;
    if (ShowSequenceTI === 1) code += 64;
    if (ShowAuthorSTI === 1) code += 128;
    if (ShowTranslatorSTI === 1) code += 256;
    if (ShowSequenceSTI === 1) code += 512;
    if (ShowAuthorDI === 1) code += 1024;
    if (ShowSequencePI === 1) code += 2048;
    return 'Раздел «description-' + NumerusVersion.replace(/\.\d+$/g, '.z') + '.' + code + '»';
  };

  const snapshot = await mfbe.doc.get();
  const desc = snapshot.description;
  const before = JSON.stringify(desc);
  const ti = desc.titleInfo;
  const sti = desc.srcTitleInfo ?? { genres: [], authors: [], bookTitle: '', coverpage: [], lang: '', translators: [], sequences: [] };
  const di = desc.documentInfo;
  const pi = desc.publishInfo ?? { sequences: [] };

  ///   Поиск <body> с дескрипшеном
  const bodyRefs = await mfbe.doc.getElementsByTagName('body');
  let bodyIndex = snapshot.bodies.findIndex((b) => b.attrs?.name === createCode());
  let bodyD = bodyIndex >= 0 ? snapshot.bodies[bodyIndex] : null;
  let bodyRef = bodyIndex >= 0 ? bodyRefs[bodyIndex] : null;

  /** Removes a body; the first body is replaced by the one after it (a script cannot remove it). */
  const removeBody = async (ref, index, count) => {
    if (index > 0) {
      await mfbe.doc.removeNode(ref);
      return;
    }
    const withoutIds = (node) => {
      if (!node || typeof node !== 'object') return node;
      const copy = { ...node };
      if (copy.attrs) {
        copy.attrs = { ...copy.attrs };
        delete copy.attrs.nodeId;
      }
      if (Array.isArray(copy.content)) copy.content = copy.content.map(withoutIds);
      return copy;
    };
    if (count > 1) {
      const refs = await mfbe.doc.getElementsByTagName('body');
      const next = await mfbe.doc.getNode(refs[1]);
      await mfbe.doc.replaceNode(ref, withoutIds(next));
      await mfbe.doc.removeNode(refs[1]);
    } else {
      await mfbe.doc.replaceNode(ref, { type: 'body', attrs: {}, content: [{ type: 'section', attrs: {}, content: [{ type: 'p', attrs: {}, content: [] }] }] });
    }
  };

  if (Pause === 0) await mfbe.edit.label(ScriptName + ': Мини-обработка');

  /* ====================================================================== */
  /* Step 1: the body                                                       */
  /* ====================================================================== */
  if (!bodyD) {
    if (Pause !== 0) await mfbe.edit.label(ScriptName + ': Создание <body>');

    ///   Поиск и удаление <body> с неточным дескрипшеном (from the last, so the others stay put)
    let count = snapshot.bodies.length;
    for (let j = count - 1; j >= 0; j--) {
      if (STALE_BODY.test(str(snapshot.bodies[j].attrs?.name))) {
        await removeBody(bodyRefs[j], j, count);
        count -= 1;
      }
    }

    const body = buildBody();
    const refs = await mfbe.doc.getElementsByTagName('body');
    bodyRef = await mfbe.doc.insertNode('after', refs[0], body);
    bodyIndex = 1;
    if (Pause !== 0) {
      // GoTo_0: the window showed the new body; here the caret goes to its title.
      const node = await mfbe.doc.getNode(bodyRef);
      const titleP = node.content?.[0]?.content?.[0];
      if (titleP?.attrs?.nodeId) {
        await mfbe.selection.set({ nodeId: titleP.attrs.nodeId, offset: 0 });
        await mfbe.selection.scrollIntoView();
      }
      return;
    }
    bodyD = await mfbe.doc.getNode(bodyRef);
  }

  /** The body of step 1, as the original built it on the page. */
  function buildBody() {
    const p = (text) => pHtml(inCode(text));
    const title = (paras) => ({ type: 'title', attrs: {}, content: paras });
    const section = (content) => ({ type: 'section', attrs: {}, content });
    const strongLabel = (text) => pHtml('<STRONG>•' + NBSP_ENTITY + text + ':</STRONG>');
    const bodyNode = { type: 'body', attrs: { name: createCode() }, content: [title([p('<DESCRIPTION>')])] };

    //   Создание раздела для отображения режимов
    const cite = { type: 'cite', attrs: {}, content: [] };
    bodyNode.content.push(section([cite]));
    cite.content.push(pHtml(ShowEmpty === 1 ? 'Разрешено отображение пустых данных.' : 'Пустые данные скрыты.'));
    if (ShowAuthor !== 0) {
      cite.content.push(pHtml(FIO !== 0 ? 'Имена авторов и переводчиков записываются по форме: Фамилия Имя Отчество.' : 'Имена авторов и переводчиков записываются по форме: Имя Отчество Фамилия.'));
    }
    cite.content.push(pHtml(Sortirovka !== 0 ? 'Списки имён авторов и переводчиков сортируются в алфавитном порядке.' : 'Сохраняется исходный порядок в списках имён авторов и переводчиков.'));
    cite.content.push(p(Delenie !== 0 ? 'При импорте в <body>, деление на «Фамилия Имя Отчество» сохраняется.' : 'При импорте в <body>, деление на «Фамилия Имя Отчество» скрипт будет производить заново.'));
    if (ShowAuthorTI !== 1 || ShowTranslatorTI !== 1 || ShowSequenceTI !== 1 || ShowAuthorSTI !== 1 || ShowTranslatorSTI !== 1 || ShowSequenceSTI !== 1 || ShowAuthorDI !== 1 || ShowSequencePI !== 1) {
      let s = 'Скрыты списки:';
      let s2 = '';
      if (ShowAuthorTI !== 1) s2 += ' авторы,';
      if (ShowTranslatorTI !== 1) s2 += ' переводчики,';
      if (ShowSequenceTI !== 1) s2 += ' серии,';
      if (s2 !== '') s2 = s2.replace(/,$/, ' <title-info>;').replace(/,([^,]+)$/, ' и$1');
      s += s2;
      s2 = '';
      if (ShowAuthorSTI !== 1) s2 += ' авторы,';
      if (ShowTranslatorSTI !== 1) s2 += ' переводчики,';
      if (ShowSequenceSTI !== 1) s2 += ' серии,';
      if (s2 !== '') s2 = s2.replace(/,$/, ' <src-title-info>;').replace(/,([^,]+)$/, ' и$1');
      s += s2;
      if (ShowAuthorDI !== 1) s += ' авторы <document-info>;';
      if (ShowSequencePI !== 1) s += ' серии <publish-info>;';
      s = s.replace(/;$/, '.');
      cite.content.push(p(s));
    }

    // AddSection: a section whose title is "===<name>===", the parts follow as its sections.
    let part = null;
    const AddSection = (text) => {
      part = section([title([pHtml('===' + inCode(text) + '===')])]);
      bodyNode.content.push(part);
    };
    const AddTitle = (data) => {
      if (ShowEmpty === 1 || data) part.content.push(section([title([pHtml(('•' + NBSP_ENTITY + 'Название: ' + inCode(data)).replace(/ $/, ''))])]));
    };
    const AddStroka = (data, text) => {
      if (ShowEmpty === 1 || data) part.content.push(section([strongLabel(text), pHtml(inCode(data))]));
    };
    const razdelitel = Delenie !== 0 ? '| ' : '';
    const AddBlock = (persons, text, ID) => {
      // The form's rows; a row without a name or a nickname is left out. (2.7.9 dropped the
      // last row instead of that one, and failed on the list when it was not the last: fixed.)
      let M = (persons.length ? persons : [{}]).map((person) => rowOf(person, ID)).filter(rowHasName);
      const sorted = dedupeAndSort(M, ID);
      M = Sortirovka !== 0 ? sorted.MM : sorted.M;
      if (FIO !== 0) M = M.map((row) => [row[2], row[0], row[1], ...row.slice(3)]);
      const Length = M.length;
      let block = null;
      if (ShowEmpty === 1 || Length !== 0) {
        block = section([strongLabel(text)]);
        part.content.push(block);
      }
      for (let n = 0; n < Length; n++) {
        let html = inCode(M[n][0] + ' ' + razdelitel + M[n][1] + ' ' + razdelitel + M[n][2] + ' | ');
        if (ShowEmpty === 1 || M[n][3]) html += 'Ник: ' + inCode(M[n][3]) + ' | ';
        if (ShowEmpty === 1 || M[n][4]) html += 'Почта: ' + inCode(M[n][4]) + ' | ';
        if (ShowEmpty === 1 || M[n][5]) html += 'Сайт: ' + inCode(M[n][5]) + ' | ';
        if (ID && (ShowEmpty === 1 || M[n][6])) html += '<SPAN class=code>ID: ' + inCode(M[n][6]) + '</SPAN>';
        html = html.replace(/  +/g, ' ').replace(/ (?=<\/SPAN>)/, '').replace(/ \| $/, '');
        block.content.push(pHtml(html));
      }
      if (ShowEmpty === 1 && Length === 0) block.content.push({ type: 'p', attrs: {}, content: [] });
    };
    const AddSequence = (sequences) => {
      const one = (seq) => {
        const lines = [];
        if (ShowEmpty === 1 || seq.name) lines.push(pHtml(('•' + NBSP_ENTITY + 'Серия: ' + inCode(seq.name)).replace(/ $/, '')));
        const number = seq.number === undefined || seq.number === null ? '' : String(seq.number);
        if (ShowEmpty === 1 || number) lines.push(pHtml(('<SUP>•' + NBSP_ENTITY + 'Номер: ' + inCode(number) + '</SUP>').replace(/ (?=<\/SUP>)/, '')));
        return section([title(lines), ...(seq.children ?? []).map(one)]);
      };
      for (const seq of sequences.length ? sequences : [{ name: '', children: [] }]) part.content.push(one(seq));
    };

    ///   ЗАПОЛНЕНИЕ ДАННЫМИ
    AddSection('<title-info>');
    AddTitle(str(ti.bookTitle));
    if (ShowAuthorTI === 1) AddBlock(ti.authors, 'Авторы', true);
    AddStroka(str(ti.keywords), 'Ключевые слова');
    if (ShowTranslatorTI === 1) AddBlock(ti.translators, 'Переводчики', false);
    if (ShowSequenceTI === 1) AddSequence(ti.sequences);
    AddSection('<src-title-info>');
    AddTitle(str(sti.bookTitle));
    if (ShowAuthorSTI === 1) AddBlock(sti.authors, 'Авторы', true);
    AddStroka(str(sti.keywords), 'Ключевые слова');
    if (ShowTranslatorSTI === 1) AddBlock(sti.translators, 'Переводчики', false);
    if (ShowSequenceSTI === 1) AddSequence(sti.sequences);
    AddSection('<document-info>');
    if (ShowAuthorDI === 1) AddBlock(di.authors, 'Авторы', false);
    AddStroka(str(di.programUsed), 'Использованы программы');
    AddStroka(str(di.srcOcr), 'Source OCR');
    AddSection('<publish-info>');
    AddStroka(str(pi.bookName), 'Заголовок книги');
    AddStroka(str(pi.publisher), 'Издатель');
    AddStroka(str(pi.city), 'Город');
    AddStroka(str(pi.year), 'Год');
    if (ShowSequencePI === 1) AddSequence(pi.sequences);
    AddSection('<custom-info>');
    for (const entry of desc.customInfo.length ? desc.customInfo : [{ infoType: '', text: '' }]) {
      const customInfoType = str(entry.infoType);
      let customInfo = str(entry.text).replace(/\r?\n/g, '\r\n'); // the text box's lines
      let block = null;
      if (ShowEmpty === 1 || customInfoType || customInfo) {
        block = section([]);
        part.content.push(block);
      }
      if (ShowEmpty === 1 || customInfoType) {
        block.content.push(strongLabel('Тип'), pHtml(inCode(customInfoType)));
      }
      if (ShowEmpty === 1 || customInfo.replace(/^\s+$/, '')) {
        block.content.push(strongLabel('Значение'));
        customInfo = customInfo.replace(/^\s+|\s+$/g, '');
        customInfo = customInfo.replace(/\r\n\s*\r\n/g, '\r\n\r\n');
        customInfo = customInfo + '\r\n';
        for (const line of customInfo.match(/.*?\r\n/g) ?? []) block.content.push(pHtml(inCode(line.replace(/^\s+|\s+$/g, ''))));
      }
    }

    ///   Чистка пустых разделов: a container without any text goes.
    const clean = (node) => {
      if (!Array.isArray(node.content) || isP(node)) return;
      node.content = node.content.filter((child) => {
        if (!isDiv(child)) return true;
        clean(child);
        return textOf(child) !== '';
      });
    };
    clean(bodyNode);

    ///   Создание раздела "Пояснение"
    if (Pojasnenie !== 0) {
      const text = [
        'Работает скрипт в два этапа. На первом этапе, скрипт импортирует текстовые данные <description> в специальный раздел <body>. Затем скрипт отключается.',
        'Полученный раздел можно редактировать текстовыми скриптами, проверить грамматику, произвести ручную правку, добавить или удалить данные.',
        'При повторном запуске этого скрипта, включается второй этап, во время которого скрипт возвращает измененные данные обратно в <description>.',
        ' ',
        'Скрипт никогда не импортирует следующие разделы: «Жанр», «Дата текстом», «Значение даты», «Язык», «Язык оригинала», «Source URLs», «ISBN», «Обложка», «Стили», «Бинарные файлы», «Аннотация», «История».',
        ' ',
        'Для расширения функциональности, скрипт имеет несколько режимов работы. Изменить их можно в разделе «Настройки», которой расположен в начале самого скрипта.',
        'Например, чтобы добавить заготовленный список авторов в пустой файл, необходимо включить отображение пустых данных, включить отображение нужного раздела с авторами, и выбрать порядок в имени (ФИО или ИОФ), который подходит для заготовленного списка. Затем после импорта <description>, добавить заготовленный список имён в подходящий раздел и вернуть <description> на место.',
        'При разделении текста имени, скрипт сначала находит фамилию, в которую должно входить одно слово, которое начинается с заглавной буквы, плюс все слова строчными буквами перед ним, затем по тем же принципам находит имя, а весь оставшийся текст скрипт отправляет в отчество. В сложном тексте можно самостоятельно поставить разделители в нужных местах. Для деления на Имя-Фамилия достаточно одного разделителя, во всех остальных случаях — потребуются два.',
        ' ',
        'Если настройки, которые влияют на <body>, изменялись во время паузы между этапами, то скрипт сначала заменит недавно созданное <body> на новое.',
        ' ',
        'Возможные ошибки:',
        'Для возвращения <description>, скрипт должен найти раздел, который он создавал на первом этапе, и правильно определить разделы.',
        'Основными ориентирами для скрипта служит имя (name) <body> и названия разделов (<title-info>, Серия, Заголовок и т. д.)',
        'Изменение имени <body> может привести к созданию ещё одного <body>.',
        'Изменение названий разделов, приведет к удалению всех данных соответствующего раздела в <description>.',
        ' ',
        'Автоматическая обработка:',
        'Автоматическая обработка охватывает более широкий спектр <description>.',
        'В сферу этой обработки включено всё кроме разделов «Обложка», «Стили», «Бинарные файлы», «Аннотация», «История».',
        'В автоматические операции входит замена всех неразрывных пробелов на обычные, замена ряда из нескольких пробелов на один, удаление начальных и конечных пробелов или пробельных символов, замена ряда пустых строк на одну.',
        'Для списков имён авторов и переводчиков удаляются полные дубли имен, а так же можно включить сортировку. Кроме того, имена, которые не разделены на Имя-Отчество-Фамилия, скрипт разделит самостоятельно.',
        'Скрипт может самостоятельно заполнять пустые поля «Дата текстом» и «Значение даты». Но только в том случае, когда есть одно уже заполненное поле, опираясь на которое, скрипт и будет заполнять второе поле. Кроме того, скрипт заменяет шаблонную дату в формате ГГГГ-ММ-ДД в поле «Дата текстом» на более удобную для восприятия.',
        'Если в разделе <title-info> отсутствует «Язык оригинала», скрипт может скопировать недостающее значение из поля «Язык», раздела <src-title-info>. Если же в одном и том же разделе «Язык оригинала» повторяет значение «Язык», то скрипт может удалить это значение (зависит от настроек скрипта).',
        'В случае, когда раздел <src-title-info> заполнен только частично, скрипт может скопировать недостающие значения жанра и языка из раздела <title-info>',
        ' ',
        'Скрипт не отображает в статистике, какие именно операции производились, но какие именно значения <description> были изменены, определяет точно.',
        ' ',
        '(Отображение этого пояснения можно отключить в разделе настроек)',
      ];
      const annotation = { type: 'annotation', attrs: {}, content: [{ type: 'subtitle', attrs: {}, content: parseInline('Пояснение к скрипту ' + ScriptName) }] };
      for (const line of text) annotation.content.push(pOrEmpty(inCode(line)));
      bodyNode.content.push(section([title([pHtml('= = = = = = = = = = = = = =')]), annotation]));
    }

    // FB2 needs content after a section's title and annotation: an empty line follows them.
    const fill = (node) => {
      if (node.type === 'section') {
        const content = node.content ?? [];
        if (!content.some((c) => c.type === 'section' || !['title', 'epigraph', 'image', 'annotation'].includes(c.type))) content.push({ type: 'empty-line', attrs: {} });
      }
      for (const child of node.content ?? []) if (isDiv(child)) fill(child);
    };
    fill(bodyNode);
    return bodyNode;
  }

  /* ====================================================================== */
  /* Step 2: the body back into the description                             */
  /* ====================================================================== */
  if (Pause !== 0) await mfbe.edit.label(ScriptName + ': Перезапись');

  const parents = parentsOf(bodyD);
  const parentOf = (node) => parents.get(node) ?? null;
  const siblingsOf = (node) => parentOf(node)?.content?.filter((c) => c.type !== 'text') ?? [];
  const nextSiblingOf = (node) => {
    const list = siblingsOf(node);
    return list[list.indexOf(node) + 1] ?? null;
  };
  const clean = (text) => text.replace(/^\s+|\s+$/g, '').replace(/\s+/g, ' ');
  /** The text after a keyword in the whole text of the line's parent (titles, one-line sections). */
  const valueAfter = (ptr, keyword) => clean(textOf(parentOf(ptr)).replace(new RegExp('^(.|\\s)*?• ' + escapeRe(keyword) + ':'), ''));

  const changes = {};
  const flag = (name, value = true) => {
    if (value) changes[name] = true;
  };
  let aborted = false;

  // Fields of the form.
  const field = {
    get: (obj, key) => str(obj[key]),
    set: (obj, key, value, optional) => {
      if (optional && value === '') delete obj[key];
      else obj[key] = value;
    },
  };
  const dateOf = (info) => ({ text: str(info.date?.text), value: str(info.date?.value) });
  const setDate = (info, text, value, required) => {
    if (!required && text === '' && value === '') {
      delete info.date;
      return;
    }
    const next = { ...(info.date ?? {}), text };
    if (value) next.value = value;
    else delete next.value;
    info.date = next;
  };

  /** Mini: white space of a value made one space, the ends trimmed. */
  const miniValue = (value) => value.replace(/[\s\xA0]+/g, ' ').replace(/^ +| +$/g, '');

  /// Функция добавления авторов или переводчиков в дескрипшен (the lines after the header).
  async function AddAuthor(header, persons, ID) {
    const reFIO = /^(.*?[А-ЯЁA-Z].*?) (.*?[А-ЯЁA-Z].*?) (.*?[А-ЯЁA-Z].*?)$/g;
    const reIOF = /^(.*?[А-ЯЁA-Z].*?) (.*?[А-ЯЁA-Z].*) (.*?[А-ЯЁA-Z].*?)$/g;
    const reFI = /^(.*?[А-ЯЁA-Z].*?) (.*?[А-ЯЁA-Z].*?)$/g;
    const reIF = /^(.*?[А-ЯЁA-Z].*) (.*?[А-ЯЁA-Z].*?)$/g;
    const M = [];
    let ptr = header;
    while (nextSiblingOf(ptr)) {
      ptr = nextSiblingOf(ptr);
      let s = textOf(ptr);
      s = s.replace(/^\s+|\s+$/g, '');
      s = s.replace(/\s+/g, ' ');
      if (s === '') continue;
      const s2 = s.replace(/(^| ?\| ?)(Ник|Почта|Сайт|ID):.*/g, '');
      const R = ('|' + s2).match(/\|/g).length - 1;
      if (R > 2) {
        if (ptr.attrs?.nodeId) await mfbe.selection.selectNode(ptr.attrs.nodeId);
        T_pause -= Date.now();
        const answer = await MsgBox(
          t(
            ' • ОШИБКА \n\n Это имя не будет отправлено в <description> \n         из-за ошибки в записи имени. \n\n (вероятно поставлен лишний разделитель) \n\n ◊ Прервать выполнение скрипта?',
            ' • ERROR \n\n This name will not be sent to <description> \n         because of a mistake in how it is written. \n\n (probably one separator too many) \n\n ◊ Stop the script?',
          ),
          ctx.script.name,
          4 + 32,
        );
        T_pause += Date.now();
        if (answer === 6) return true;
        continue;
      }
      let row;
      const test = (re) => {
        re.lastIndex = 0;
        return s2.search(re) !== -1;
      };
      const part = (re, n) => {
        re.lastIndex = 0;
        return s2.replace(re, '$' + n);
      };
      const bySeparators = () => ('|' + s2).match(/\|[^\|]*/g).map((x) => x.replace(/\| ?| $/g, ''));
      if (R === 0) {
        if (FIO !== 0) {
          if (test(reFIO)) row = [part(reFIO, 1), part(reFIO, 2), part(reFIO, 3)];
          else if (test(reFI)) row = [part(reFI, 1), part(reFI, 2), ''];
          else row = [s2, '', ''];
        } else if (test(reIOF)) row = [part(reIOF, 1), part(reIOF, 2), part(reIOF, 3)];
        else if (test(reIF)) row = [part(reIF, 1), '', part(reIF, 2)];
        else row = ['', '', s2];
      } else if (R === 1) {
        const pieces = bySeparators();
        row = FIO === 0 ? [pieces[0], '', pieces[1]] : [pieces[0], pieces[1], ''];
      } else {
        const pieces = bySeparators();
        row = [pieces[0], pieces[1], pieces[2]];
      }
      if (FIO !== 0) row = [row[1], row[2], row[0]];
      row[3] = s.replace(/^(.*(^|\| ?)Ник: ?(.*?)( \||\||$).*|.*)$/g, '$3');
      row[4] = s.replace(/^(.*(^|\| ?)Почта: ?(.*?)( \||\||$).*|.*)$/g, '$3');
      row[5] = s.replace(/^(.*(^|\| ?)Сайт: ?(.*?)( \||\||$).*|.*)$/g, '$3');
      if (ID) row[6] = s.replace(/^(.*(^|\| ?)ID: ?(.*?)( \||\||$).*|.*)$/g, '$3');
      if (rowHasName(row)) M.push(row);
    }
    const sorted = dedupeAndSort(M, ID);
    const rows = Sortirovka !== 0 ? sorted.MM : sorted.M;
    const next = personsOf(rows, ID, persons);
    persons.splice(0, persons.length, ...next);
    return false;
  }

  /// Функция независимой обработки авторов или переводчиков в дескрипшене (a list not shown).
  function HandelAuthor(persons, ID) {
    const ex = formRows(persons, ID);
    const normalised = persons.map((person) => {
      const copy = JSON.parse(JSON.stringify(person));
      const fix = (key) => {
        if (copy[key] === undefined) return;
        copy[key] = miniValue(str(copy[key]));
        if (copy[key] === '') delete copy[key];
      };
      fix('firstName');
      fix('middleName');
      fix('lastName');
      fix('nickname');
      if (copy.emails?.length) copy.emails[0] = miniValue(copy.emails[0]);
      if (copy.homePages?.length) copy.homePages[0] = miniValue(copy.homePages[0]);
      if (ID) fix('id');
      return copy;
    });
    // A row without a name or nickname is dropped (2.7.9 dropped the last row, and failed on the
    // list when that row was not the last: fixed).
    const kept = normalised.filter((person) => rowHasName(rowOf(person, ID)));
    const rows = kept.map((person) => rowOf(person, ID));
    const sorted = dedupeAndSort(rows, ID);
    const chosen = Sortirovka !== 0 ? sorted.MM : sorted.M;
    const next = chosen.map((row) => kept[rows.indexOf(row)]);
    persons.splice(0, persons.length, ...next);
    return ex !== formRows(persons, ID);
  }

  /// Функция добавления структуры серий в дескрипшен: the sections from the first sequence on.
  function AddSeq(list, found, seqP, mainElem) {
    const ex = sequenceRows(list);
    const langs = new Map();
    const collect = (seq) => {
      if (seq.lang !== undefined && !langs.has(str(seq.name))) langs.set(str(seq.name), seq.lang);
      (seq.children ?? []).forEach(collect);
    };
    list.forEach(collect);
    const blank = () => ({ kind: 'seq', name: '', number: '', children: [], parent: null });
    const fs = { kind: 'fs', children: [] };
    const firstRow = blank();
    firstRow.parent = fs;
    fs.children.push(firstRow);
    if (found) {
      // The rows of the form: a pointer may stand on the fieldset, a row, or the inputs of a row.
      const lastChild = (node) => {
        if (!node) return null;
        if (node.kind === 'input') return null;
        if (node.children.length) return node.children[node.children.length - 1];
        return node.kind === 'seq' ? { kind: 'input', owner: node } : null;
      };
      const parentNode = (node) => (!node ? null : node.kind === 'input' ? node.owner : node.parent);
      const insertAfter = (node, row) => {
        if (!node) return null;
        if (node.kind === 'input') {
          row.parent = node.owner;
          node.owner.children.unshift(row);
        } else if (node.parent) {
          row.parent = node.parent;
          node.parent.children.splice(node.parent.children.indexOf(node) + 1, 0, row);
        } else return null;
        return row;
      };
      const append = (node, row) => {
        if (!node || node.kind === 'input') return;
        row.parent = node;
        node.children.push(row);
      };
      let seq = seqP;
      while (parentOf(seq) && parentOf(seq) !== mainElem) seq = parentOf(seq);
      let divSeq = fs;
      let First = true;
      aaa: for (let guard = 0; guard < 100000; guard++) {
        if (seq && seq.type === 'section') {
          seq = (seq.content ?? []).find((c) => c.type !== 'text') ?? null;
          if (seq && seq.type === 'section') {
            if (!First) append(divSeq, blank());
            First = false;
          }
          divSeq = lastChild(divSeq);
          if (!seq) break;
        } else {
          while (!nextSiblingOf(seq)) {
            seq = parentOf(seq);
            divSeq = parentNode(divSeq);
            if (!seq || seq === mainElem) break aaa;
          }
          seq = nextSiblingOf(seq);
        }
        if (seq && seq.type === 'title') {
          if (!First) divSeq = insertAfter(divSeq, blank());
          First = false;
          if (!divSeq || divSeq.kind !== 'seq') continue;
          const s = textOf(seq);
          if (s.search(/• Серия:/) !== -1) divSeq.name = clean(s.replace(/^(.|\s)*?• Серия:/, '').replace(/• Номер:(.|\s)*/, ''));
          if (s.search(/• Номер:/) !== -1) divSeq.number = clean(s.replace(/^(.|\s)*?• Номер:/, '').replace(/• Серия:(.|\s)*/, ''));
        }
      }
    }
    // The form wrote a row with a name, a number or a written row inside; the model holds
    // integer numbers only.
    const toModel = (row) => {
      const kids = row.children.map(toModel).filter(Boolean);
      if (!row.name && !row.number && !kids.length) return null;
      const out = { name: row.name, children: kids };
      const n = sequenceNumber(row.number);
      if (n !== undefined) out.number = n;
      // The language, which the text does not hold, stays with the sequence of the same name.
      if (langs.has(row.name)) out.lang = langs.get(row.name);
      return out;
    };
    const next = fs.children.map(toModel).filter(Boolean);
    list.splice(0, list.length, ...next);
    return ex !== sequenceRows(list);
  }

  /// Функция независимой обработки серий (a list not shown).
  function HadelSeq(list) {
    const ex = JSON.stringify(list);
    const visit = (seq) => {
      seq.name = miniValue(str(seq.name));
      (seq.children ?? []).forEach(visit);
    };
    list.forEach(visit);
    return ex !== JSON.stringify(list);
  }

  /** The section of a part: the title whose only line is "===<name>===". */
  const partOf = (marker) => {
    for (const div of divsOf(bodyD)) {
      const kids = (div.content ?? []).filter((c) => c.type !== 'text');
      if (div.type === 'title' && kids.length === 1 && textOf(kids[0]) === marker) return parentOf(div);
    }
    return null;
  };

  /** title-info and src-title-info share the code; `tag` names their change flags (T / S). */
  async function titleInfoPart(marker, info, tag, showAuthor, showTranslator, showSequence) {
    const mainElem = partOf(marker);
    const search = {};
    let seqP = null;
    if (mainElem) {
      for (const ptr of linesOf(mainElem)) {
        const s = textOf(ptr);
        const parentType = parentOf(ptr)?.type;
        if (!search.title && /^\s*?• Название:/.test(s) && parentType === 'title') {
          search.title = true;
          const value = valueAfter(ptr, 'Название');
          if (str(info.bookTitle) !== value) flag(tag + '03');
          info.bookTitle = value;
          continue;
        }
        if (!search.authors && /^\s*?• Авторы:/.test(s) && parentType === 'section') {
          search.authors = true;
          const ex = formRows(info.authors, true);
          if (await AddAuthor(ptr, info.authors, true)) return true;
          flag(tag + '02', ex !== formRows(info.authors, true));
          continue;
        }
        if (!search.keywords && /^\s*?• Ключевые слова:/.test(s) && parentType === 'section') {
          search.keywords = true;
          const value = valueAfter(ptr, 'Ключевые слова');
          if (str(info.keywords) !== value) flag(tag + '04');
          field.set(info, 'keywords', value, true);
          continue;
        }
        if (!search.translators && /^\s*?• Переводчики:/.test(s) && parentType === 'section') {
          search.translators = true;
          const ex = formRows(info.translators, false);
          if (await AddAuthor(ptr, info.translators, false)) return true;
          flag(tag + '09', ex !== formRows(info.translators, false));
          continue;
        }
        if (!search.sequences && /^\s*?• (Серия|Номер):/.test(s) && parentType === 'title') {
          search.sequences = true;
          seqP = ptr;
        }
      }
    }
    //  Очистка: a part not found in the body is emptied.
    if (!search.title && str(info.bookTitle) !== '') {
      info.bookTitle = '';
      flag(tag + '03');
    }
    if (showAuthor === 1 && !search.authors) {
      const ex = formRows(info.authors, true);
      info.authors.length = 0;
      flag(tag + '02', ex !== formRows(info.authors, true));
    }
    if (!search.keywords && str(info.keywords) !== '') {
      delete info.keywords;
      flag(tag + '04');
    }
    if (showTranslator === 1 && !search.translators) {
      const ex = formRows(info.translators, false);
      info.translators.length = 0;
      flag(tag + '09', ex !== formRows(info.translators, false));
    }
    if (showSequence === 1 && AddSeq(info.sequences, !!search.sequences, seqP, mainElem)) flag(tag + '10');

    //  Мини-обработка оставшихся полей
    if (showAuthor !== 1 && HandelAuthor(info.authors, true)) flag(tag + '02');
    if (showTranslator !== 1 && HandelAuthor(info.translators, false)) flag(tag + '09');
    if (showSequence !== 1 && HadelSeq(info.sequences)) flag(tag + '10');
    for (const genre of info.genres) {
      const s = str(genre.code);
      if (s.search(/^\s+|\s+$/) !== -1) {
        genre.code = s.replace(/^\s+|\s+$/g, '');
        flag(tag + '01');
      }
    }
    const date = dateOf(info);
    const text = miniValue(date.text);
    const value = miniValue(date.value);
    if (text !== date.text) flag(tag + '05');
    if (value !== date.value) flag(tag + '06');
    if (text !== date.text || value !== date.value) setDate(info, text, value, false);
    return false;
  }

  let historyBlocks = null;
  Block1: {
    ///   Запись данных в <title-info>
    if (await titleInfoPart('===<title-info>===', ti, 'T', ShowAuthorTI, ShowTranslatorTI, ShowSequenceTI)) {
      aborted = true;
      break Block1;
    }
    ///   Запись данных в <src-title-info>
    if (await titleInfoPart('===<src-title-info>===', sti, 'S', ShowAuthorSTI, ShowTranslatorSTI, ShowSequenceSTI)) {
      aborted = true;
      break Block1;
    }

    ///   Запись данных в <document-info>
    {
      const mainElem = partOf('===<document-info>===');
      const search = {};
      if (mainElem) {
        for (const ptr of linesOf(mainElem)) {
          const s = textOf(ptr);
          const parentType = parentOf(ptr)?.type;
          if (!search.authors && /^\s*?• Авторы:/.test(s) && parentType === 'section') {
            search.authors = true;
            const ex = formRows(di.authors, false);
            if (await AddAuthor(ptr, di.authors, false)) {
              aborted = true;
              break Block1;
            }
            flag('D03', ex !== formRows(di.authors, false));
            continue;
          }
          if (!search.programs && /^\s*?• Использованы программы:/.test(s) && parentType === 'section') {
            search.programs = true;
            const value = valueAfter(ptr, 'Использованы программы');
            if (str(di.programUsed) !== value) flag('D04');
            field.set(di, 'programUsed', value, true);
            continue;
          }
          if (!search.ocr && /^\s*?• Source OCR:/.test(s) && parentType === 'section') {
            search.ocr = true;
            const value = valueAfter(ptr, 'Source OCR');
            if (str(di.srcOcr) !== value) flag('D07');
            field.set(di, 'srcOcr', value, true);
            continue;
          }
        }
      }
      if (ShowAuthorDI === 1 && !search.authors) {
        const ex = formRows(di.authors, false);
        di.authors.length = 0;
        flag('D03', ex !== formRows(di.authors, false));
      }
      if (!search.programs && str(di.programUsed) !== '') {
        delete di.programUsed;
        flag('D04');
      }
      if (!search.ocr && str(di.srcOcr) !== '') {
        delete di.srcOcr;
        flag('D07');
      }
      if (ShowAuthorDI !== 1 && HandelAuthor(di.authors, false)) flag('D03');
      const mini = (key, name) => {
        const value = miniValue(str(di[key]));
        if (value !== str(di[key])) {
          di[key] = value;
          flag(name);
        }
      };
      mini('version', 'D01');
      mini('id', 'D02');
      const date = dateOf(di);
      const text = miniValue(date.text);
      const value = miniValue(date.value);
      if (text !== date.text) flag('D05');
      if (value !== date.value) flag('D06');
      if (text !== date.text || value !== date.value) setDate(di, text, value, true);
      di.srcUrls = di.srcUrls.map((url) => {
        const next = miniValue(str(url));
        if (next !== url) flag('D08');
        return next;
      });
    }

    ///   Запись данных в <publish-info>
    {
      const mainElem = partOf('===<publish-info>===');
      const search = {};
      let seqP = null;
      const fields = [['bookName', 'Заголовок книги', 'P01'], ['publisher', 'Издатель', 'P02'], ['city', 'Город', 'P03'], ['year', 'Год', 'P04']];
      if (mainElem) {
        lines: for (const ptr of linesOf(mainElem)) {
          const s = textOf(ptr);
          const parentType = parentOf(ptr)?.type;
          for (const [key, keyword, name] of fields) {
            if (!search[key] && new RegExp('^\\s*?• ' + keyword + ':').test(s) && parentType === 'section') {
              search[key] = true;
              const value = valueAfter(ptr, keyword);
              if (str(pi[key]) !== value) flag(name);
              field.set(pi, key, value, true);
              continue lines;
            }
          }
          if (!search.sequences && /^\s*?• (Серия|Номер):/.test(s) && parentType === 'title') {
            search.sequences = true;
            seqP = ptr;
          }
        }
      }
      for (const [key, , name] of fields) {
        if (!search[key] && str(pi[key]) !== '') {
          delete pi[key];
          flag(name);
        }
      }
      if (ShowSequencePI === 1 && AddSeq(pi.sequences, !!search.sequences, seqP, mainElem)) flag('P06');
      if (ShowSequencePI !== 1 && HadelSeq(pi.sequences)) flag('P06');
      const isbn = miniValue(str(pi.isbn));
      if (isbn !== str(pi.isbn)) {
        field.set(pi, 'isbn', isbn, true);
        flag('P05');
      }
    }

    ///   Запись данных в <custom-info>
    {
      const mainElem = partOf('===<custom-info>===');
      const ex = JSON.stringify(desc.customInfo);
      const rows = desc.customInfo;
      let row = -1; // the row written last
      let found = false;
      if (mainElem) {
        const mP = linesOf(mainElem);
        for (let n = 0; n < mP.length; n++) {
          let ptr = mP[n];
          const s = textOf(ptr);
          if (/^\s*?• (Тип|Значение):/.test(s) && parentOf(ptr)?.type === 'section') {
            found = true;
            row += 1;
            if (row >= rows.length) rows.push({ infoType: '', text: '' });
            const all = textOf(parentOf(ptr));
            rows[row].infoType = all.search(/• Тип:/) !== -1 ? clean(all.replace(/^(.|\s)*?• Тип:/, '').replace(/• Значение:(.|\s)*/, '')) : '';
            if (all.search(/• Значение:/) !== -1) {
              let s2 = all.replace(/^(.|\s)*?• Значение:/, '');
              s2 = s2.replace(/^\s+|\s+$/g, '');
              s2 = s2.replace(/\r\n\s*\r\n/g, '\r\n\r\n');
              s2 = s2.replace(/\r\n +| +\r\n/g, '\r\n');
              rows[row].text = s2.replace(/\r\n/g, '\n');
            } else rows[row].text = '';
            while (nextSiblingOf(ptr)) {
              ptr = nextSiblingOf(ptr);
              n++;
            }
          }
        }
      }
      if (!found && rows.length) {
        row = 0;
        rows[0].infoType = '';
        rows[0].text = '';
      }
      rows.length = Math.max(row + 1, 0);
      // A row with neither type nor value is not written (2.7.9 did not write it).
      for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].infoType && !rows[i].text) rows.splice(i, 1);
      flag('C01', ex !== JSON.stringify(rows));
    }

    ///  ПОСТОБРАБОТКА
    //  Удаление повторного значения языка
    if (DelLang === 0) {
      if (str(ti.lang) !== '' && str(ti.lang) === str(ti.srcLang)) {
        delete ti.srcLang;
        flag('T08');
      }
      if (str(sti.lang) !== '' && str(sti.lang) === str(sti.srcLang)) {
        delete sti.srcLang;
        flag('S08');
      }
    }
    //  Общий язык оригинала
    if (str(sti.lang) !== '' && str(ti.srcLang) === '') {
      ti.srcLang = sti.lang;
      flag('T08');
    }
    //  Добавление "значения даты" из "даты", "даты" из "значения даты", шаблонная дата в текст
    for (const [info, tag, required] of [[ti, 'T', false], [sti, 'S', false], [di, 'D', true]]) {
      const date = dateOf(info);
      const value = AddDateVal(date.text, date.value);
      if (value !== null) {
        setDate(info, date.text, value, required);
        flag(tag + '06');
      }
    }
    for (const [info, tag, required] of [[ti, 'T', false], [sti, 'S', false], [di, 'D', true]]) {
      const date = dateOf(info);
      const text = AddDate(date.value, date.text);
      if (text !== null) {
        setDate(info, text, date.value, required);
        flag(tag + '05');
      }
    }
    for (const [info, tag, required] of [[ti, 'T', false], [sti, 'S', false], [di, 'D', true]]) {
      const date = dateOf(info);
      const text = ChangeDate(date.text);
      if (text !== null) {
        setDate(info, text, date.value, required);
        flag(tag + '05');
      }
    }
    //  Добавление недостающих данных в <src-title-info> (when it holds anything at all)
    if (!isBlankSource(sti)) {
      if (sti.genres.length <= 1 && !str(sti.genres[0]?.code)) {
        const ex = JSON.stringify(sti.genres);
        const next = ti.genres.length ? ti.genres.map((g) => ({ code: str(g.code) })) : sti.genres;
        sti.genres.splice(0, sti.genres.length, ...next);
        flag('S01', ex !== JSON.stringify(sti.genres));
      }
      if (str(sti.lang) === '' && str(ti.srcLang) !== '') {
        sti.lang = ti.srcLang;
        // 2.7.9 reported this as a change of "Язык оригинала" (fixed: it is "Язык").
        flag('S07');
      }
    }

    ///  Удаление искусственного <body>
    await removeBody(bodyRef, bodyIndex, (await mfbe.doc.getElementsByTagName('body')).length);
  }

  /// Функция добавления "значения даты" из "даты"
  function AddDateVal(d1, d2) {
    const reDate01 = /^([0-9]{1,2})([\-\.\/])([0-9]{2})(\2)([0-9]{4})$/;
    const reDate02 = /^([0-9]{4}) ?(г\.?|года?)?$/;
    const reDate03 = /^([0-9]{4})([\-\.\/])([0-9]{2})(\2)([0-9]{2})$/;
    const reDate04 = /^([0-9]{1,2}) (янв|фев|мар|апр|ма[йя]|июн|июл|авг|сен|окт|ноя|дек)[а-я]*\.? ([0-9]{4}) ?(г\.?|года?)?$/;
    const pad = (x) => ('0' + x).replace(/.(..$)/, '$1');
    if (d1 !== '' && d2 === '') {
      if (d1.search(reDate01) !== -1 && +d1.replace(reDate01, '$1') <= 31 && +d1.replace(reDate01, '$3') <= 12 && +d1.replace(reDate01, '$5') <= 2100) {
        return d1.replace(reDate01, '$5') + '-' + d1.replace(reDate01, '$3') + '-' + pad(d1.replace(reDate01, '$1'));
      }
      if (d1.search(reDate02) !== -1 && +d1.replace(reDate02, '$1') <= 2100) return d1.replace(reDate02, '$1') + '-01-01';
      if (d1.search(reDate03) !== -1 && +d1.replace(reDate03, '$1') <= 2100 && +d1.replace(reDate03, '$3') <= 12 && +d1.replace(reDate03, '$5') <= 31) {
        return d1.replace(reDate03, '$1') + '-' + d1.replace(reDate03, '$3') + '-' + d1.replace(reDate03, '$5');
      }
      if (d1.search(reDate04) !== -1 && +d1.replace(reDate04, '$1') <= 31 && +d1.replace(reDate04, '$3') <= 2100) {
        const months = { янв: '01', фев: '02', мар: '03', апр: '04', май: '05', мая: '05', июн: '06', июл: '07', авг: '08', сен: '09', окт: '10', ноя: '11', дек: '12' };
        return d1.replace(reDate04, '$3') + '-' + months[d1.replace(reDate04, '$2')] + '-' + pad(d1.replace(reDate04, '$1'));
      }
    }
    return null;
  }

  /// Функция добавления "даты" из "значения даты" (a month 00 gave "undefined" in 2.7.9: fixed)
  function AddDate(d1, d2) {
    const reDate03 = /^([0-9]{4})\-([0-9]{2})\-([0-9]{2})$/;
    if (d1 !== '' && d2 === '' && d1.search(reDate03) !== -1 && +d1.replace(reDate03, '$1') <= 2100 && +d1.replace(reDate03, '$2') <= 12 && +d1.replace(reDate03, '$3') <= 31 && +d1.replace(reDate03, '$2') >= 1) {
      return d1.replace(reDate03, '$3').replace(/^0/, '') + ' ' + MONTHS_GENITIVE[+d1.replace(reDate03, '$2') - 1] + ' ' + d1.replace(reDate03, '$1');
    }
    return null;
  }

  /// Функция изменения шаблонной "даты" на текстовую (a month 00 gave "undefined": fixed)
  function ChangeDate(d1) {
    const reDate03 = /^([0-9]{4})\-([0-9]{2})\-([0-9]{2})$/;
    if (d1 !== '' && d1.search(reDate03) !== -1 && +d1.replace(reDate03, '$1') <= 2100 && +d1.replace(reDate03, '$2') <= 12 && +d1.replace(reDate03, '$3') <= 31 && +d1.replace(reDate03, '$2') >= 1) {
      return d1.replace(reDate03, '$3').replace(/^0/, '') + ' ' + MONTHS_GENITIVE[+d1.replace(reDate03, '$2') - 1] + ' ' + d1.replace(reDate03, '$1');
    }
    return null;
  }

  // The source book's description is written when it holds anything (2.7.9 wrote it then).
  if (!desc.srcTitleInfo && !isBlankSource(sti)) desc.srcTitleInfo = sti;
  if (!desc.publishInfo && !same(pi, { sequences: [] })) desc.publishInfo = pi;

  ///  ПОВЫШЕНИЕ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В ИСТОРИЮ ИЗМЕНЕНИЙ
  let versionFile = str(di.version);
  let newVersion = versionFile;
  let HiCh = 0;
  let VersionUp = false;
  const change_all = Object.keys(changes).length > 0;
  if (Version_on_off === 1 && (change_all || Vsegda_on_off === 1)) HistoryChange(ScriptName + ' ' + NumerusVersion);

  function HistoryChange(Script_Name) {
    const placeholder = [{ type: 'empty-line', attrs: {} }];
    const History = JSON.parse(JSON.stringify(di.history?.content?.length ? di.history.content : placeholder));
    const original = JSON.stringify(History);
    const mDate = [];
    let D = today.getTime();
    for (let j = 0; j < 10; j++) {
      const date = new Date(D);
      mDate[j] = date.getDate() + '.' + String(date.getMonth() + 1).padStart(2, '0') + '.' + date.getFullYear();
      D -= 86400000;
    }
    //  Поиск недавней записи в "истории"
    let povtorD = false;
    const mP = linesOf({ content: History });
    let s = '';
    let j;
    let k = 0;
    fff: for (j = mP.length - 1; j >= 0; j--) {
      s = serializeInline(mP[j].content ?? []);
      for (k = 0; k < 10; k++) {
        if (s.includes(mDate[k])) {
          povtorD = true;
          break fff;
        }
      }
    }
    let textYouName = inCode(youName);
    if (youName !== '') textYouName += ', ';
    const name = inCode(Script_Name);
    const nameDate = escapeRe(textYouName + mDate[k]);
    const reHist00s = new RegExp('[^А-яЁёA-Za-z0-9]' + escapeRe(name) + '[^А-яЁёA-Za-z0-9]', '');
    const reHist01 = new RegExp('(.[^…\\?!\\.,;:—])(\\s|' + NBSP_ENTITY + ')(— ' + nameDate + ')', '');
    const reHist02 = new RegExp('(.[^…\\?!\\.,;:—])[,;:]{0,1}(\\s|' + NBSP_ENTITY + ')(— ' + nameDate + ')', '');
    const reHist03 = new RegExp('(.)(\\s|' + NBSP_ENTITY + ')(— ' + nameDate + ')', '');
    const reHist04 = new RegExp('(.)(\\s|' + NBSP_ENTITY + ')(— ' + nameDate + ')', '');
    const setLine = (line, html) => {
      const content = parseInline(html);
      if (line.type === 'empty-line') {
        const list = History.includes(line) ? History : null;
        if (list) list[list.indexOf(line)] = { type: 'p', attrs: {}, content };
      } else line.content = content;
    };
    if (povtorD) {
      if (s.search(reHist04) !== -1) {
        if (s.search(reHist00s) === -1) {
          if (s.search(/([Сс]крипт):/) !== -1) s = s.replace(/([Сс]крипт):/g, '$1ы:');
          if (s.search(reHist01) !== -1) s = s.replace(reHist01, '$1; $3');
          if (s.search(/[Сс]крипты?:/) === -1) s = s.replace(reHist02, '$1. $3').replace(reHist03, '$1 Скрипт: $3');
          s = s.replace(reHist04, (all, c1, c2, c3) => c1 + ' ' + name + ' ' + c3);
        }
        if (k !== 0) s = s.replace(mDate[k], mDate[0]);
        if (serializeInline(mP[j].content ?? []) !== s) {
          setLine(mP[j], s);
          HiCh = 3;
        }
      } else povtorD = false;
    }
    if (!povtorD) {
      //  Повышение версии
      let versionText = '';
      const ValidationVersion = versionFile.length <= 10 && versionFile.search(/^\d{0,10}(\.\d{1,8})?$/g) !== -1;
      if (ValidationVersion) {
        if (versionFile === '') versionFile = '1.0';
        if (versionFile.search(/^\d+$/g) !== -1) newVersion = versionFile + '.1';
        else {
          let n = +versionFile.replace(/^\d+\./g, '');
          n++;
          newVersion = versionFile.replace(/\.\d+$/g, '') + '.' + n;
        }
        if (newVersion.length <= 10) di.version = newVersion;
        VersionUp = true;
        versionText = 'v.' + newVersion + ' — ';
      }
      //   Добавление строк в историю изменений
      const reHist11 = new RegExp('^(\\s|' + NBSP_ENTITY + '){0,}$', '');
      const reHist12 = new RegExp('(^|\\n)[^0-9]{0,12}' + escapeRe(versionFile) + '([^0-9]|$)', '');
      const lastEmpty = () => {
        const last = History[History.length - 1];
        return reHist11.test(last.type === 'empty-line' ? '' : TEXT_BLOCKS.has(last.type) ? serializeInline(last.content ?? []) : '<DIV>');
      };
      const putLast = (html) => {
        if (!lastEmpty()) History.push({ type: 'empty-line', attrs: {} });
        const last = History[History.length - 1];
        if (TEXT_BLOCKS.has(last.type)) last.content = parseInline(html);
        else History[History.length - 1] = { type: 'p', attrs: {}, content: parseInline(html) };
      };
      if (ValidationVersion && History.map(textOf).join('\r\n').search(reHist12) === -1) {
        putLast('v.' + inCode(versionFile) + ' — ?');
        HiCh++;
      }
      putLast(versionText + ' Скрипт: ' + name + ' — ' + textYouName + mDate[0]);
      HiCh++;
    }
    if (JSON.stringify(History) !== original) di.history = { type: 'annotation', attrs: { ...(di.history?.attrs ?? {}) }, content: History };
  }

  if (JSON.stringify(desc) !== before) await mfbe.doc.setDescription(desc);
  void aborted;

  /* ====================================================================== */
  /* ОКНО РЕЗУЛЬТАТОВ                                                       */
  /* ====================================================================== */
  const time = (T) => {
    const Tmin = Math.floor(T / 60000);
    const TsecD = (T % 60000) / 1000;
    const Tsec = Math.floor(TsecD);
    if (Tmin === 0) return (+(TsecD + '').replace(/(.{1,5}).*/g, '$1') + '').replace('.', ru ? ',' : '.') + t(' сек', ' s');
    return Tmin + t(' мин', ' min') + (Tsec !== 0 ? ' ' + Tsec + t(' с', ' s') : '');
  };
  const now = new Date();
  const currentTime = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const currentDate = `${now.getDate()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(-2)}`;
  const VseStroki_on_off = 0; // Демонстрационный режим "Показать все строки"
  const demo = VseStroki_on_off === 1;
  const mSt = [];
  mSt.push(' ' + t(ScriptName, '"Edit the document description"') + ' v.' + NumerusVersion);
  mSt.push('---------------------------------------------------------');
  if (demo) mSt.push(t(' Демонстрационный режим', ' Demonstration mode'));
  mSt.push('\t\t\t\t\t    ');
  mSt.push(t('Вычисления  .  .  .  .  .  .  .\t', 'Computing  .  .  .  .  .  .  .\t') + time(Date.now() - Ts - T_pause));
  if (T_pause !== 0) mSt.push(t('Диалоговые паузы .  .  .  .\t', 'Pauses in dialogs .  .  .  .\t') + time(T_pause));
  const start = mSt.length;
  const block = (titleRu, titleEn, items) => {
    const lines = items.filter(([name]) => changes[name] || demo).map(([, r, e]) => '   ' + t(r, e));
    if (lines.length) mSt.push('', t(titleRu, titleEn), ...lines);
  };
  const titleItems = (tag) => [
    [tag + '01', 'Жанры', 'Genres'], [tag + '02', 'Авторы', 'Authors'], [tag + '03', 'Название', 'Title'], [tag + '04', 'Ключевые слова', 'Keywords'],
    [tag + '05', 'Дата', 'Date'], [tag + '06', 'Значение даты', 'Date value'], [tag + '07', 'Язык', 'Language'], [tag + '08', 'Язык оригинала', 'Source language'],
    [tag + '09', 'Переводчики', 'Translators'], [tag + '10', 'Серия', 'Sequence'],
  ];
  block('• ИЗМЕНЕНИЯ в <title-info>:', '• CHANGES in <title-info>:', titleItems('T'));
  block('• ИЗМЕНЕНИЯ в <src-title-info>:', '• CHANGES in <src-title-info>:', titleItems('S'));
  block('• ИЗМЕНЕНИЯ в <document-info>:', '• CHANGES in <document-info>:', [
    ['D01', 'Версия', 'Version'], ['D02', 'ID файла', 'File ID'], ['D03', 'Авторы', 'Authors'], ['D04', 'Программы', 'Programs used'],
    ['D05', 'Дата', 'Date'], ['D06', 'Значение даты', 'Date value'], ['D07', 'Source OCR', 'Source OCR'], ['D08', 'Source URLs', 'Source URLs'],
  ]);
  block('• ИЗМЕНЕНИЯ в <publish-info>:', '• CHANGES in <publish-info>:', [
    ['P01', 'Заголовок книги', 'Book name'], ['P02', 'Издатель', 'Publisher'], ['P03', 'Город', 'City'], ['P04', 'Год издания', 'Year'],
    ['P05', 'ISBN', 'ISBN'], ['P06', 'Серия', 'Sequence'],
  ]);
  block('• ИЗМЕНЕНИЯ в <custom-info>:', '• CHANGES in <custom-info>:', [['C01', 'есть изменения', 'changed']]);
  if (mSt.length === start || demo) mSt.push('', t('   >> Исправлений нет', '   >> No changes'));
  if (VersionUp || HiCh || demo) mSt.push('');
  if (VersionUp || demo) mSt.push(t('• Версия файла:  ', '• File version:  ') + versionFile + '  ›››  ' + newVersion);
  if (HiCh === 1 || demo) mSt.push(t('• Добавлена новая строка в историю', '• A new line was added to the history'));
  if (HiCh === 2 || demo) mSt.push(t('• Добавлены две строки в историю', '• Two lines were added to the history'));
  if (HiCh === 3 || demo) mSt.push(t('• Изменены данные в строке истории', '• A line of the history was changed'));
  mSt.push('', '• ' + currentDate + ' • ' + currentTime + ' •');
  if (ru) {
    // The proverb (a Russian saying of the original's list; the English interface has none).
    mSt.push('', '---------------------------------------------------------');
    const proverb = PROVERBS[Math.floor(Math.random() * PROVERBS.length)];
    for (const line of proverb.replace(/ /g, '  ').match(/([^ ].{0,45})(?=\s\s.{0,}|$)/g) ?? []) mSt.push(' ' + line);
  }
  await mfbe.ui.message(mSt.join('\n'), { caption: ctx.script.name });
}
