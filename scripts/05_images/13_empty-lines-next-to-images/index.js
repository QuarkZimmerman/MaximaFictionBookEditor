// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/13_Пустые строки рядом с иллюстрациями.js
// Semi-automatic clean-up of the empty lines next to the illustrations. First every paragraph of
// the book (its annotation, the history, every body): lines of white space are emptied (111), a
// line holding one inline picture loses the spaces and formatting around it (112) - a subtitle
// becoming a paragraph (113), a cite or poem holding nothing else being dissolved (114) -, and
// the empty lines are tidied: a repeated one goes (121), a cite, epigraph, poem or section
// annotation holding nothing but an empty line is dissolved (122), the empty lines at the edges of
// a container (123) and between a title, annotation, poem, epigraph, cite or subtitle and anything
// but a picture (124) go. Then every block picture of a section: no empty line between it and the
// end of its section (212), one between it and a poem, table or epigraph (221). The combinations
// of a picture with a probable caption below it or a heading above it (a cite, a subtitle, italic,
// bold or plain text, another picture; with or without an empty line between) are then counted
// and, as the settings below say, an empty line between them is added or removed always, never,
// or - the default - after a question for each (the line is shown, Да / Нет / Отмена). Last the
// version of the file is raised with a line in the history, and a window gives the statistics.
// The settings are the original's, with its values (the user name excepted, below); another
// script may pass its own in `ctx.args` (and `today`, YYYY-MM-DD, the date the history line
// takes; the tests do).
// The book is rebuilt as FictionBook Editor showed it (fbw_body: DIVs named by their FB2 element,
// a P for every paragraph and empty line), every rule runs on that tree, and each edit goes to the
// editor as it is made (`doc.replaceNode` / `removeNode` / `insertNode`; the book annotation and
// the history through `doc.setDescription` at the end). Paragraph HTML for the italic and bold
// tests: lib/legacy-html.js.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - the result window shows no proverb: left out pending the requester's decision (the original
//   appended a random saying from a list of wartime proverbs);
// - an edit FB2 does not allow there (a section left with a title alone, an empty line in a body
//   or a poem) is not made and not counted; a container is dissolved in one step;
// - a question shows the place by the selection instead of a coloured line; the "B mode" check
//   and the refreshing of the pictures have no counterpart (scripts edit the book itself);
// - the history line carries no user name, by the requester's decision (2026-10-31): the
//   original's setting youName was «Зорро», a placeholder for the user's own name, and an empty
//   name - what the setting holds here - is the original's own way to a line without one,
//   "v.1.1 —  Скрипт: ... — (31.10.26)" (it also read a fbeUserName of its main.js).
// The original's notice, kept as written (FR-029):
//======================================
//             «Пустые строки рядом с иллюстрациями»
//  Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//======================================
//  Скрипт предназначен для полуавтоматического удаления/добавления пустой строки между иллюстрациями и вероятными подписями к ним.
//  * История изменений в конце скрипта
//======================================
//
//                 ///  ИСТОРИЯ ИЗМЕНЕНИЙ
// v.1.0 — Создание скрипта — Александр Ка (17.05.2024)
// v.1.1 — Исправлена ошибка с добавлением пустых строк — Александр Ка (10.06.2024)
// v.1.2 — Добавлены настройки; улучшен интерфейс — Александр Ка (07.08.2024)
// v.2.0 — Александр Ка (15.02.2025)
//    Добавлены сочетания: "иллюстрация + иллюстрация" и "иллюстрация + пустая строка + иллюстрация"
//    Улучшен интерфейс, повышена стабильность работы, исправлены ошибки, увеличены возможности настроек
// v.2.1 — Добавлена функция повышения версии файла и запись в историю изменений — Александр Ка (25.04.2025)

import { parseInline, serializeInline } from './lib/legacy-html.js';

const ScriptName = '«Пустые строки рядом с иллюстрациями»';
const NumerusVersion = '2.1';

// ---------------------------------------------------------------
///  НАСТРОЙКИ
// ---------------------------------------------------------------
const SETTINGS = {
  //  • Пустые строки ("0" — всегда удалять, "1" — всегда добавлять, "2" — всегда спрашивать, "3" — ничего не трогать)
  //     Пустая строка   между   иллюстрацией   и   возможной подписью к ней
  Posle_illjustratsii: 2,
  //     Пустая строка   между   возможной надписью   и   иллюстрацией
  Pered_illjustratsiej: 2,
  //     Пустая строка   между   иллюстрациями
  Mezhdu_illjustratsijami: 2,
  //   •  Удаление внешнего форматирования для строки с графикой (операции 113, 114)
  //  Это может быть формат подзаголовка, цитаты или стихов для этой строки ("0" — ничего не трогать, "1" — всегда удалять)
  Vneshnij_format: 1,
  //  Автоматическое повышение версии файла и запись в историю изменений ("0" — отключить, "1" — включить)
  Version_on_off: 1,
  //  Добавлять, если не сделано ни одного исправления ("0" — отключить, "1" — включить)
  Vsegda_on_off: 0,
  //   Имя используемое в добавленной записи (an empty name gives a line without a name; the
  //   original's "Зорро" is left out by the requester's decision of 2026-10-31):
  youName: '',
  /// Демонстрационный режим "Показать все строки" ("0" — отключить, "1" — включить)
  VseStroki_on_off: 0,
};

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const nbspEntity = '&nbsp;';
const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);
const RE123 = new Set(['title', 'epigraph', 'image', 'annotation']); //  между ними и концом секции сохраняется пустая строка
const RE124 = new Set(['title', 'annotation', 'stanza', 'poem', 'epigraph', 'cite', 'subtitle']);
const RE221EX = new Set(['cite', 'subtitle', '', 'normal', 'image', 'title']); //  исключения для автоматической редакции
const refused = (error) => error?.code === 'notAllowed' || error?.code === 'invalidNode';

//  выявление курсивной строки
const reEm = new RegExp(`^(\\s|${nbspEntity}|[…\\.\\(\\[«„“»”\\"—–\\-]|<[^>]{1,}>){0,}<EM>.{1,}</EM>(\\s|${nbspEntity}|[…\\.,:;\\?!\\)\\]«„“»”\\"—–\\-]|<[^>]{1,}>){0,}$`, '');
//  выявление полужирной строки
const reSt = new RegExp(`^(\\s|${nbspEntity}|[…\\.\\(\\[«„“»”\\"—–\\-]|<[^>]{1,}>){0,}<STRONG>.{1,}</STRONG>(\\s|${nbspEntity}|[…\\.,:;\\?!\\)\\]«„“»”\\"—–\\-]|<[^>]{1,}>){0,}$`, '');

/* ------------------------------------------------------------------------------------------ */
/* The book as fbw_body                                                                        */
/* ------------------------------------------------------------------------------------------ */

/** The class FictionBook Editor gave the element of a model type (files/fb2.xsl). */
function classOf(type) {
  if (type === 'subtitle') return 'subtitle';
  if (type === 'text-author' || type === 'date') return 'text-author';
  if (type === 'td' || type === 'th') return type;
  if (TEXT_BLOCKS.has(type) || type === 'empty-line') return '';
  return type;
}

function makeItem(json, parent, inDescription) {
  const isP = TEXT_BLOCKS.has(json.type) || json.type === 'empty-line';
  return {
    kind: isP ? 'p' : 'div',
    type: json.type,
    cls: classOf(json.type),
    json,
    parent,
    children: [],
    inDescription,
    empty: isP && (json.type === 'empty-line' || (json.content ?? []).length === 0),
    removed: false,
  };
}

function buildTree(doc) {
  const root = { kind: 'div', type: 'root', cls: '', children: [], parent: null };
  const build = (json, parent, inDescription) => {
    const item = makeItem(json, parent, inDescription);
    parent.children.push(item);
    if (item.kind === 'div' && json.type !== 'image' && json.type !== 'raw-xml') {
      for (const child of json.content ?? []) if (child && child.type !== 'text') build(child, item, inDescription);
    }
    return item;
  };
  const block = (json, cls) => {
    if (json && (json.content ?? []).length) {
      const item = build(json, root, true);
      item.cls = cls;
      return item;
    }
    // The empty paragraph FictionBook Editor put into an empty annotation or history block.
    const item = { kind: 'div', type: cls, cls, json: null, parent: root, children: [], inDescription: true, placeholder: true };
    item.children.push({ kind: 'p', type: 'p', cls: '', json: { type: 'p', content: [] }, parent: item, children: [], inDescription: true, empty: true, placeholder: true });
    root.children.push(item);
    return item;
  };
  block(doc.description?.titleInfo?.annotation, 'annotation');
  block(doc.description?.documentInfo?.history, 'history');
  for (const body of doc.bodies ?? []) build(body, root, false);
  return root;
}

function walk(root, visit) {
  const go = (item) => {
    visit(item);
    for (const child of [...item.children]) go(child);
  };
  for (const child of [...root.children]) go(child);
}

function siblingOf(item, step) {
  const list = item.parent?.children ?? [];
  const at = list.indexOf(item);
  return at < 0 ? null : (list[at + step] ?? null);
}
const prevOf = (item) => siblingOf(item, -1);
const nextOf = (item) => siblingOf(item, 1);
const isEmptyP = (item) => !!item && item.kind === 'p' && item.empty;
const isPlain = (item) => !!item && item.kind === 'p' && (item.cls === '' || item.cls === 'normal');
const contentOf = (item) => item.json?.content ?? [];
const innerHTML = (item) => (item.kind === 'p' ? (item.empty ? '' : serializeInline(contentOf(item), [])) : null);
/** The original's reImgInLine: the paragraph is one inline picture and nothing else. */
const imgInLine = (item) => {
  const content = contentOf(item);
  return item.kind === 'p' && content.length === 1 && content[0].type === 'inline-image' && !content[0].marks?.length;
};
const italic = (item) => item.kind === 'p' && !item.empty && innerHTML(item).search(reEm) !== -1;
const bold = (item) => item.kind === 'p' && !item.empty && innerHTML(item).search(reSt) !== -1;

/** The name of an item's picture (the original's reSrc on its first IMG). */
function pictureName(item) {
  if (!item) return '';
  if (item.type === 'image') return String(item.json.attrs?.href ?? '').replace(/^#/, '');
  const picture = contentOf(item).find((child) => child.type === 'inline-image');
  return picture ? String(picture.attrs?.href ?? '').replace(/^#/, '') : '';
}

/* ------------------------------------------------------------------------------------------ */
/* Edits: on the tree and, at once, on the book                                                 */
/* ------------------------------------------------------------------------------------------ */

let descriptionChanged = false;
const nodeIdOf = (item) => item.json?.attrs?.nodeId;

/** The model list an item of the description lives in. */
function jsonListOf(item) {
  return item.parent?.json?.content ?? null;
}

async function removeItem(item) {
  if (item.inDescription) {
    if (item.placeholder) return false;
    const list = jsonListOf(item);
    const at = list ? list.indexOf(item.json) : -1;
    if (at < 0) return false;
    list.splice(at, 1);
    descriptionChanged = true;
  } else {
    try {
      await mfbe.doc.removeNode(nodeIdOf(item));
    } catch (error) {
      if (refused(error)) return false;
      throw error;
    }
  }
  const list = item.parent.children;
  list.splice(list.indexOf(item), 1);
  item.removed = true;
  return true;
}

/** Puts `json` in the place of `target` (an item or a container), keeping its node id. */
async function replaceWith(target, json) {
  if (target.inDescription) {
    if (target.placeholder) return false;
    const list = jsonListOf(target);
    const at = list ? list.indexOf(target.json) : -1;
    if (at < 0) return false;
    list[at] = json;
    descriptionChanged = true;
    return true;
  }
  const nodeId = nodeIdOf(target);
  try {
    await mfbe.doc.replaceNode(nodeId, json);
  } catch (error) {
    if (refused(error)) return false;
    throw error;
  }
  json.attrs = { ...(json.attrs ?? {}), nodeId };
  return true;
}

const attrsOf = (item) => {
  const attrs = { ...(item.json?.attrs ?? {}) };
  delete attrs.nodeId;
  return attrs;
};

/**
 * The emptied P as FictionBook Editor saved it (FBDoc.cpp, ProcessP): an empty line; in a stanza
 * a verse of one space; a table cell stays an empty cell.
 */
function emptyJson(item, parentType) {
  if (item.cls === 'td' || item.cls === 'th') return { type: item.type, attrs: attrsOf(item), content: [] };
  if (parentType === 'stanza') return { type: 'v', content: [{ type: 'text', text: ' ' }] };
  return { type: 'empty-line' };
}

async function replaceItem(item, json) {
  if (JSON.stringify({ ...json, attrs: undefined }) === JSON.stringify({ ...item.json, attrs: undefined })) return true;
  if (!(await replaceWith(item, json))) return false;
  item.json = json;
  item.type = json.type;
  return true;
}

/** An empty P next to `item` (an empty line; a verse of one space in a stanza). */
async function insertEmpty(item, after) {
  const json = item.parent.type === 'stanza' ? { type: 'v', content: [{ type: 'text', text: ' ' }] } : { type: 'empty-line' };
  if (item.inDescription) {
    const list = jsonListOf(item);
    const at = list ? list.indexOf(item.json) : -1;
    if (at < 0) return null;
    list.splice(after ? at + 1 : at, 0, json);
    descriptionChanged = true;
  } else {
    let ref;
    try {
      ref = await mfbe.doc.insertNode(after ? 'after' : 'before', nodeIdOf(item), json);
    } catch (error) {
      if (refused(error)) return null;
      throw error;
    }
    json.attrs = { nodeId: ref.nodeId };
  }
  const line = makeItem(json, item.parent, item.inDescription);
  line.empty = true;
  const list = item.parent.children;
  list.splice(list.indexOf(item) + (after ? 1 : 0), 0, line);
  return line;
}

/**
 * Dissolves the containers from `item`'s parent up to `outer` (each holding one child): `item`
 * takes `outer`'s place, a verse becoming a paragraph outside a stanza.
 */
async function unwrapTo(item, outer) {
  const parentType = outer.parent.type;
  let json;
  if (item.empty) json = emptyJson(item, parentType);
  else {
    const type = item.type === 'v' && parentType !== 'stanza' ? 'p' : item.type;
    json = { type, attrs: attrsOf(item), content: contentOf(item) };
  }
  if (!(await replaceWith(outer, json))) return false;
  const list = outer.parent.children;
  list[list.indexOf(outer)] = item;
  item.parent = outer.parent;
  item.json = json;
  item.type = json.type;
  return true;
}

/* ------------------------------------------------------------------------------------------ */
/* The history (the original's HistoryChange)                                                  */
/* ------------------------------------------------------------------------------------------ */

function historyChange(description, Script_Name, youName, today) {
  const info = description.documentInfo;
  const result = { HiCh: 0, VersionUp: false, versionFile: String(info.version ?? ''), newVersion: String(info.version ?? '') };
  if (!info.history || !(info.history.content ?? []).length) {
    // An empty history block held one empty paragraph.
    info.history = { type: 'annotation', attrs: { ...(info.history?.attrs ?? {}) }, content: [{ type: 'empty-line' }] };
  }
  const History = info.history;
  const extras = [];
  const htmlOf = (json) => (json.type === 'empty-line' ? '' : serializeInline(json.content ?? [], extras));
  const setHTML = (list, index, html) => {
    const old = list[index];
    const attrs = { ...(old.attrs ?? {}) };
    delete attrs.nodeId;
    list[index] = { type: old.type === 'empty-line' ? 'p' : old.type, attrs, content: parseInline(html, extras) };
  };
  // Всех строк (P) истории, в порядке документа, с их списками.
  const mP = [];
  const collect = (json) => {
    for (let i = 0; i < (json.content ?? []).length; i += 1) {
      const child = json.content[i];
      if (TEXT_BLOCKS.has(child.type) || child.type === 'empty-line') mP.push({ list: json.content, index: i });
      else if (child.type !== 'image' && child.type !== 'raw-xml') collect(child);
    }
  };
  collect(History);

  //  Создание массива с прошедшими датами
  const mDate = [];
  let D = today.getTime();
  for (let j = 0; j < 10; j += 1) {
    const fullDate = new Date(D);
    const Day = fullDate.getDate();
    const Month = `0${1 + fullDate.getMonth()}`.replace(/^.*?(\d\d)$/g, '$1');
    const Year = `0${fullDate.getFullYear()}`.replace(/^.*?(\d\d)$/g, '$1');
    mDate[j] = `${Day}.${Month}.${Year}`;
    D -= 86400000;
  }

  //  Поиск недавней записи в "истории"
  let povtorD = false;
  let s = '';
  let j = mP.length - 1;
  let k = 0;
  fff: for (; j > 0; j -= 1) {
    s = htmlOf(mP[j].list[mP[j].index]);
    for (k = 0; k < 10; k += 1) {
      if (s.search(mDate[k]) !== -1) {
        povtorD = true;
        break fff;
      }
    }
  }

  //  Обновление записи в истории изменений
  let textYouName = `${youName}`;
  if (youName !== '') textYouName += ', ';
  const reHist00s = new RegExp(`[^А-яЁёA-Za-z0-9]${Script_Name}[^А-яЁёA-Za-z0-9]`, 'g');
  const reHist01 = new RegExp(`(.[^…\\?!\\.,;:—])(\\s|${nbspEntity})(— \\(${textYouName}${mDate[k]}\\))`, 'g');
  const reHist02 = new RegExp(`(.)(\\s|${nbspEntity})(— \\(${textYouName}${mDate[k]}\\))`, 'g');
  const reHist03 = new RegExp(`(.)(\\s|${nbspEntity})(— \\(${textYouName}${mDate[k]}\\))`, 'g');
  if (povtorD) {
    if (s.search(reHist03) !== -1) {
      const before = s;
      if (s.search(reHist00s) === -1) {
        if (s.search(/([Сс]крипт):/) !== -1) s = s.replace(/([Сс]крипт):/g, '$1ы:');
        if (s.search(reHist01) !== -1) s = s.replace(reHist01, '$1; $3');
        if (s.search(/[Сс]крипты?:/) === -1) s = s.replace(reHist02, '$1 Скрипт: $3');
        s = s.replace(reHist03, `$1 ${Script_Name} $3`);
      }
      if (k !== 0) s = s.replace(mDate[k], mDate[0]);
      if (before !== s) {
        setHTML(mP[j].list, mP[j].index, s);
        result.HiCh = 3;
      }
    } else povtorD = false;
  }
  if (povtorD) return result;

  //  Повышение версии
  let versionText = '';
  let versionFile = result.versionFile;
  const ValidationVersion = versionFile.length <= 10 && versionFile.search(/^\d{0,10}(\.\d{1,8})?$/g) !== -1;
  if (ValidationVersion) {
    if (versionFile === '') versionFile = '1.0';
    let newVersion;
    if (versionFile.search(/^\d+$/g) !== -1) newVersion = `${versionFile}.1`;
    else newVersion = `${versionFile.replace(/\.\d+$/g, '')}.${+versionFile.replace(/^\d+\./g, '') + 1}`;
    if (newVersion.length <= 10) info.version = newVersion;
    result.VersionUp = true;
    result.newVersion = newVersion;
    versionText = `v.${newVersion} — `;
  }
  result.versionFile = versionFile;

  //   Добавление строк в историю изменений (the history's HTML as the original read it)
  const reHist11 = new RegExp(`^(\\s|${nbspEntity}){0,}$`, 'g');
  const reHist12 = new RegExp(`(^|\\n)[^0-9]{0,10}${versionFile}([^0-9]|$)`, 'g');
  const blockHTML = (json) => {
    if (TEXT_BLOCKS.has(json.type) || json.type === 'empty-line') {
      const cls = classOf(json.type);
      return `<P${cls ? ` class=${cls}` : ''}>${htmlOf(json)}</P>`;
    }
    return `<DIV class=${json.type}>\r\n${(json.content ?? []).map(blockHTML).join('\r\n')}</DIV>`;
  };
  const historyHTML = () => (History.content ?? []).map(blockHTML).join('\r\n');
  const lastIsEmpty = () => {
    const last = History.content[History.content.length - 1];
    if (!last) return false;
    const html = TEXT_BLOCKS.has(last.type) || last.type === 'empty-line' ? htmlOf(last) : blockHTML(last);
    return html.search(reHist11) !== -1;
  };
  //   Добавление строки с информацией о старой версии
  if (ValidationVersion && historyHTML().search(reHist12) === -1) {
    if (!lastIsEmpty()) History.content.push({ type: 'empty-line' });
    setHTML(History.content, History.content.length - 1, `v.${versionFile} — ?`);
    result.HiCh += 1;
  }
  //   Добавление строки с информацией о новой версии
  if (!lastIsEmpty()) History.content.push({ type: 'empty-line' });
  setHTML(History.content, History.content.length - 1, `${versionText} Скрипт: ${Script_Name} — (${textYouName}${mDate[0]})`);
  result.HiCh += 1;
  return result;
}

/* ------------------------------------------------------------------------------------------ */
/* The run                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** The original's time(): seconds with a comma (five characters of the number), or minutes and seconds. */
function timeOf(ctx, T) {
  const Tmin = Math.floor(T / 60000);
  const TsecD = (T % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  if (Tmin === 0) {
    const seconds = String(+String(TsecD).replace(/(.{1,5}).*/g, '$1'));
    return t(ctx, `${seconds.replace('.', ',')} сек`, `${seconds} s`);
  }
  let tempus = t(ctx, `${Tmin} мин`, `${Tmin} min`);
  if (Tsec !== 0) tempus += t(ctx, ` ${Tsec} с`, ` ${Tsec} s`);
  return tempus;
}

function todayOf(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return new Date();
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
}

// The questions of the original (its functions addNext, delNext, addPrev, delPrev) by kind:
// [setting, function, counter, title (ru, en), summary line (ru, en)].
const KINDS = {
  '001': ['Posle_illjustratsii', 'addNext', 231, ' •  Иллюстрация  +  Цитата', ' •  Illustration  +  Cite', 'Иллюстрация + Цитата  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Cite\t'],
  '002': ['Posle_illjustratsii', 'addNext', 231, ' •  Иллюстрация  +  Подзаголовок', ' •  Illustration  +  Subtitle', 'Иллюстрация + Подзаголовок .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Subtitle\t'],
  '003': ['Posle_illjustratsii', 'addNext', 231, ' •  Иллюстрация  +  Курсивный текст', ' •  Illustration  +  Italic text', 'Иллюстрация + Курсив   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Italics\t'],
  '004': ['Posle_illjustratsii', 'addNext', 231, ' •  Иллюстрация  +  Полужирный текст', ' •  Illustration  +  Bold text', 'Иллюстрация + Полужирный текст  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Bold text\t'],
  '005': ['Posle_illjustratsii', 'addNext', 231, ' •  Иллюстрация  +  Обычный текст', ' •  Illustration  +  Plain text', 'Иллюстрация + Обычный текст .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Plain text\t'],
  '006': ['Posle_illjustratsii', 'addNext', 231, ' •  Иллюстрация  +  Текст  /в блоке/', ' •  Illustration  +  Text  /in a block/', 'Иллюстрация + Текст /в блоке/ .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Text /in a block/\t'],
  '011': ['Posle_illjustratsii', 'delNext', 232, ' •  Иллюстрация  +  Пустая  строка  +  Цитата', ' •  Illustration  +  Empty  line  +  Cite', 'Иллюстрация + Пустая  строка + Цитата  .  .  .  .  .  .  .\t', 'Illustration + Empty line + Cite\t'],
  '012': ['Posle_illjustratsii', 'delNext', 232, ' •  Иллюстрация  +  Пустая  строка  +  Подзаголовок', ' •  Illustration  +  Empty  line  +  Subtitle', 'Иллюстрация + Пустая  строка + Подзаголовок  .  .  .\t', 'Illustration + Empty line + Subtitle\t'],
  '013': ['Posle_illjustratsii', 'delNext', 232, ' •  Иллюстрация  +  Пустая  строка  +  Курсивный текст', ' •  Illustration  +  Empty  line  +  Italic text', 'Иллюстрация + Пустая  строка + Курсив  .  .  .  .  .  .  .\t', 'Illustration + Empty line + Italics\t'],
  '014': ['Posle_illjustratsii', 'delNext', 232, ' •  Иллюстрация  +  Пустая  строка  +  Полужирный текст', ' •  Illustration  +  Empty  line  +  Bold text', 'Иллюстрация + Пустая  строка + Полужирный текст \t', 'Illustration + Empty line + Bold text\t'],
  '015': ['Posle_illjustratsii', 'delNext', 232, ' •  Иллюстрация  +  Пустая  строка  +  Обычный текст', ' •  Illustration  +  Empty  line  +  Plain text', 'Иллюстрация + Пустая  строка + Обычный текст   .  .\t', 'Illustration + Empty line + Plain text\t'],
  '016': ['Posle_illjustratsii', 'delNext', 232, ' •  Иллюстрация  +  Пустая  строка  +  Текст  /в блоке/', ' •  Illustration  +  Empty  line  +  Text  /in a block/', 'Иллюстрация + Пустая  строка + Текст /в блоке/ .  .  .\t', 'Illustration + Empty line + Text /in a block/\t'],
  '021': ['Pered_illjustratsiej', 'addPrev', 241, ' •  Цитата + Иллюстрация', ' •  Cite + Illustration', 'Цитата + Иллюстрация  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Cite + Illustration\t'],
  '022': ['Pered_illjustratsiej', 'addPrev', 241, ' •  Подзаголовок + Иллюстрация', ' •  Subtitle + Illustration', 'Подзаголовок + Иллюстрация .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Subtitle + Illustration\t'],
  '023': ['Pered_illjustratsiej', 'addPrev', 241, ' •  Курсивный текст + Иллюстрация', ' •  Italic text + Illustration', 'Курсив + Иллюстрация   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Italics + Illustration\t'],
  '024': ['Pered_illjustratsiej', 'addPrev', 241, ' •  Полужирный текст + Иллюстрация', ' •  Bold text + Illustration', 'Полужирный текст + Иллюстрация  .  .  .  .  .  .  .  .  .  .\t', 'Bold text + Illustration\t'],
  '025': ['Pered_illjustratsiej', 'addPrev', 241, ' •  Обычный текст + Иллюстрация', ' •  Plain text + Illustration', 'Обычный текст + Иллюстрация .  .  .  .  .  .  .  .  .  .  .  .\t', 'Plain text + Illustration\t'],
  '026': ['Pered_illjustratsiej', 'addPrev', 241, ' •  Текст + Иллюстрация  /в блоке/', ' •  Text + Illustration  /in a block/', 'Текст + Иллюстрация /в блоке/  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Text + Illustration /in a block/\t'],
  '031': ['Pered_illjustratsiej', 'delPrev', 242, ' •  Цитата + Пустая  строка + Иллюстрация', ' •  Cite + Empty  line + Illustration', 'Цитата + Пустая  строка + Иллюстрация  .  .  .  .  .  .  .\t', 'Cite + Empty line + Illustration\t'],
  '032': ['Pered_illjustratsiej', 'delPrev', 242, ' •  Подзаголовок + Пустая  строка + Иллюстрация', ' •  Subtitle + Empty  line + Illustration', 'Подзаголовок + Пустая  строка + Иллюстрация  .  .  .\t', 'Subtitle + Empty line + Illustration\t'],
  '033': ['Pered_illjustratsiej', 'delPrev', 242, ' •  Курсивный текст + Пустая  строка + Иллюстрация', ' •  Italic text + Empty  line + Illustration', 'Курсив + Пустая  строка + Иллюстрация  .  .  .  .  .  .  .\t', 'Italics + Empty line + Illustration\t'],
  '034': ['Pered_illjustratsiej', 'delPrev', 242, ' •  Полужирный текст + Пустая  строка + Иллюстрация', ' •  Bold text + Empty  line + Illustration', 'Полужирный текст + Пустая  строка + Иллюстрация \t', 'Bold text + Empty line + Illustration\t'],
  '035': ['Pered_illjustratsiej', 'delPrev', 242, ' •  Обычный текст + Пустая  строка + Иллюстрация', ' •  Plain text + Empty  line + Illustration', 'Обычный текст + Пустая  строка + Иллюстрация   .  .\t', 'Plain text + Empty line + Illustration\t'],
  '036': ['Pered_illjustratsiej', 'delPrev', 242, ' •  Текст + Пустая  строка + Иллюстрация  /в блоке/', ' •  Text + Empty  line + Illustration  /in a block/', 'Текст + Пустая  строка + Иллюстрация /в блоке/ .  .  .\t', 'Text + Empty line + Illustration /in a block/\t'],
  '007': ['Mezhdu_illjustratsijami', 'addNext', 251, ' •  Иллюстрация  +  Иллюстрация', ' •  Illustration  +  Illustration', 'Иллюстрация + Иллюстрация  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustration + Illustration\t'],
  '017': ['Mezhdu_illjustratsijami', 'delNext', 252, ' •  Иллюстрация  +  Пустая  строка  +  Иллюстрация', ' •  Illustration  +  Empty  line  +  Illustration', 'Иллюстрация + Пустая  строка + Иллюстрация .  .  .  .\t', 'Illustration + Empty line + Illustration\t'],
};

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const S = { ...SETTINGS };
  if (ctx.startedBy === 'script' && ctx.args && typeof ctx.args === 'object' && !Array.isArray(ctx.args)) {
    for (const key of Object.keys(SETTINGS)) if (key in ctx.args) S[key] = ctx.args[key];
  }
  const now = todayOf(ctx.startedBy === 'script' ? ctx.args?.today : undefined);
  const Ts = Date.now();
  let T_pause = 0; //  продолжительность диалоговых пауз
  descriptionChanged = false;

  const doc = await mfbe.doc.get();
  const root = buildTree(doc);
  const counts = {};
  for (const n of [111, 112, 113, 114, 121, 122, 123, 124, 201, 211, 212, 221, 231, 232, 241, 242, 251, 252]) counts[n] = 0;

  /// ОБРАБОТКА ТЕКСТА _1_  :  Параграфы <P>  :  операции  № 1хх
  const mImgP = []; //  массив строк с графикой
  const paragraphs = [];
  walk(root, (item) => {
    if (item.kind === 'p' && !item.placeholder) paragraphs.push(item);
  });
  const chainUp = (item, accepts) => {
    let outer = null;
    let levels = 0;
    for (let node = item; ; ) {
      const parent = node.parent;
      if (!parent || parent.kind !== 'div' || parent.type === 'root' || parent.children.length !== 1 || !accepts(parent)) break;
      outer = parent;
      levels += 1;
      node = parent;
    }
    return { outer, levels };
  };
  const HandleP = async (ptr) => {
    const content = contentOf(ptr);
    const pictures = content.filter((child) => child.type === 'inline-image');
    const blank = (child) => child.type === 'text' && /^[\s ]*$/.test(child.text ?? '');
    // Чистка пустых строк от пробелов и внутренних тегов
    if (!ptr.empty && content.length > 0 && pictures.length === 0 && content.every(blank)) {
      if (await replaceItem(ptr, emptyJson(ptr, ptr.parent.type))) {
        ptr.empty = true;
        counts[111] += 1;
      }
    }
    //  Внутренняя чистка графики в пустом параграфе  (от пробелов и внутренних тегов)
    let q_112 = false;
    if (!ptr.empty && pictures.length === 1 && content.every((child) => child.type === 'inline-image' || blank(child))) {
      const bare = { type: 'inline-image', attrs: { ...pictures[0].attrs } };
      delete bare.attrs.nodeId;
      const changed = !(content.length === 1 && !pictures[0].marks?.length);
      mImgP.push(ptr);
      q_112 = true;
      let type = ptr.type;
      // Снятие форматирования "подзаголовок"
      if (ptr.cls === 'subtitle' && S.Vneshnij_format === 1) {
        type = ptr.parent.type === 'stanza' ? 'v' : 'p';
        ptr.cls = '';
        counts[113] += 1;
      }
      if (changed || type !== ptr.type) await replaceItem(ptr, { type, attrs: attrsOf(ptr), content: [bare] });
      if (changed) counts[112] += 1;
    }
    // Снятие внешнего форматирования с графики в пустом параграфе
    if (q_112 && S.Vneshnij_format === 1) {
      const { outer, levels } = chainUp(
        ptr,
        (parent) => parent.cls === 'cite' || parent.cls === 'poem' || (parent.cls === 'stanza' && parent.parent?.children.length === 1 && parent.parent.cls === 'poem'),
      );
      if (outer && (await unwrapTo(ptr, outer))) counts[114] += levels;
    }
    //  ОПЕРАЦИИ с очищенными пустыми строками (anywhere but in a table)
    if (ptr.empty && ptr.cls !== 'th' && ptr.cls !== 'td') {
      // Удаление первой пустой строки в ряде из двух пустых строк
      const before = prevOf(ptr);
      if (isEmptyP(before) && (await removeItem(before))) counts[121] += 1;
      // Удаление внешних тегов для единственной пустой строки
      const { outer, levels } = chainUp(
        ptr,
        (parent) => ['epigraph', 'stanza', 'poem', 'cite'].includes(parent.cls) || (parent.cls === 'annotation' && parent.parent?.type !== 'root'),
      );
      if (outer && (await unwrapTo(ptr, outer))) counts[122] += levels;
      //  Удаление пустых строк на окраине разделов (исключение: после картинки, заголовка, эпиграфа или аннотации)
      const prev = prevOf(ptr);
      const next = nextOf(ptr);
      if ((!prev && next) || (!next && prev && !RE123.has(prev.cls))) {
        if (await removeItem(ptr)) counts[123] += 1;
        return;
      }
      //  Удаление пустых строк рядом с разделами и подзаголовками (исключение: рядом с картинкой)
      if (prev && next && ((RE124.has(prev.cls) && next.cls !== 'image') || (RE124.has(next.cls) && prev.cls !== 'image'))) {
        if (await removeItem(ptr)) counts[124] += 1;
      }
    }
  };
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (!paragraphs[i].removed) await HandleP(paragraphs[i]);
    if (i % 100 === 0) {
      await mfbe.ui.progress(i, paragraphs.length);
      if (ctx.cancelled) return;
    }
  }

  /// ОБРАБОТКА ТЕКСТА _2_  :  Разделы "image"  :  операции № 2хх
  const m = {};
  for (const key of Object.keys(KINDS)) m[key] = [];
  const mImg = [];
  let count_ImgAll = 0;
  walk(root, (item) => {
    if (item.type === 'image') mImg.push(item);
    if (item.type === 'image') count_ImgAll += 1;
    if (item.kind === 'p') count_ImgAll += contentOf(item).filter((child) => child.type === 'inline-image').length;
  });
  const count_Img = mImg.length;
  const inSection = (item) => item.parent?.cls === 'section';

  for (const img of mImg) {
    if (inSection(img)) {
      //  Удаление пустых строк рядом с картинкой в "кармане" секций
      let next = nextOf(img);
      if (isEmptyP(next) && nextOf(next) && ['section', 'annotation'].includes(nextOf(next).cls)) {
        if (await removeItem(next)) counts[201] += 1;
      }
      let prev = prevOf(img);
      next = nextOf(img);
      if (isEmptyP(prev) && next && ['section', 'annotation'].includes(next.cls)) {
        if (await removeItem(prev)) counts[201] += 1;
      }
      //  Удаление пустой строки между границей секции и картинкой
      prev = prevOf(img);
      if (prev && !prevOf(prev) && isEmptyP(prev) && (await removeItem(prev))) counts[212] += 1;
      //  Вставка пустой строки между картинкой и границей секции (если кроме картинки, в секции больше ничего нет)
      if (!prevOf(img) && !nextOf(img) && (await insertEmpty(img, true))) counts[211] += 1;
      //  Удаление пустой строки между картинкой и границей секции (если перед картинкой что-то есть)
      next = nextOf(img);
      if (prevOf(img) && next && !nextOf(next) && isEmptyP(next) && (await removeItem(next))) counts[212] += 1;
      //  Фильтр для картинок, которые не в "кармане"
      next = nextOf(img);
      if (!next || !['section', 'annotation'].includes(next.cls)) {
        prev = prevOf(img);
        if (prev && !isEmptyP(prev) && !RE221EX.has(prev.cls) && (await insertEmpty(img, false))) counts[221] += 1;
        next = nextOf(img);
        if (next && !isEmptyP(next) && !RE221EX.has(next.cls) && (await insertEmpty(img, true))) counts[221] += 1;
      }
    }
    if (!inSection(img)) continue;
    const next = nextOf(img);
    const prev = prevOf(img);
    //  Поиск и сохранение сочетаний    "Иллюстрация + Текст"
    if (next && !isEmptyP(next)) {
      if (next.cls === 'cite') m['001'].push(img);
      if (next.cls === 'subtitle') m['002'].push(img);
      if (next.cls === 'image') m['007'].push(img);
      if (isPlain(next)) {
        if (italic(next)) m['003'].push(img);
        else if (bold(next)) m['004'].push(img);
        else if (imgInLine(next)) m['007'].push(img);
        else m['005'].push(img);
      }
    }
    //  "Иллюстрация + Пустая_строка + Текст"
    if (next && isEmptyP(next) && nextOf(next)) {
      const after = nextOf(next);
      if (after.cls === 'cite') m['011'].push(img);
      if (after.cls === 'subtitle') m['012'].push(img);
      if (after.cls === 'image') m['017'].push(img);
      if (isPlain(after)) {
        if (italic(after)) m['013'].push(img);
        else if (bold(after)) m['014'].push(img);
        else if (imgInLine(after)) m['017'].push(img);
        else m['015'].push(img);
      }
    }
    //  "Текст + Иллюстрация"
    if (prev && !isEmptyP(prev)) {
      if (prev.cls === 'cite') m['021'].push(img);
      if (prev.cls === 'subtitle') m['022'].push(img);
      if (isPlain(prev) && !imgInLine(prev)) {
        if (italic(prev)) m['023'].push(img);
        else if (bold(prev)) m['024'].push(img);
        else m['025'].push(img);
      }
    }
    //  "Текст + Пустая_строка + Иллюстрация"
    if (prev && isEmptyP(prev) && prevOf(prev)) {
      const before = prevOf(prev);
      if (before.cls === 'cite') m['031'].push(img);
      if (before.cls === 'subtitle') m['032'].push(img);
      if (isPlain(before) && !imgInLine(before)) {
        if (italic(before)) m['033'].push(img);
        else if (bold(before)) m['034'].push(img);
        else m['035'].push(img);
      }
    }
  }

  /// ЦИКЛ строк с графикой
  const count_ImgP = mImgP.length;
  for (const img of mImgP) {
    if (img.removed) continue;
    const next = nextOf(img);
    const prev = prevOf(img);
    //  "<P>Иллюстрация</P> + Обычный текст"
    if (next && !isEmptyP(next)) {
      if (inSection(img) && isPlain(next)) {
        if (italic(next)) m['003'].push(img);
        else if (bold(next)) m['004'].push(img);
        else if (imgInLine(next)) m['007'].push(img);
        else m['005'].push(img);
      }
      if (!inSection(img) && isPlain(next)) m[imgInLine(next) ? '007' : '006'].push(img);
      if (inSection(img) && next.cls === 'image') m['007'].push(img);
    }
    //  "<P>Иллюстрация</P> + Пустая_строка + Обычный текст"
    if (next && isEmptyP(next) && nextOf(next)) {
      const after = nextOf(next);
      if (inSection(img) && isPlain(after)) {
        if (italic(after)) m['013'].push(img);
        else if (bold(after)) m['014'].push(img);
        else if (imgInLine(after)) m['017'].push(img);
        else m['015'].push(img);
      }
      if (!inSection(img) && isPlain(after)) m[imgInLine(after) ? '017' : '016'].push(img);
      if (inSection(img) && after.cls === 'image') m['017'].push(img);
    }
    //  "Обычный текст + <P>Иллюстрация</P>"
    if (prev && !isEmptyP(prev) && isPlain(prev) && !imgInLine(prev)) {
      if (inSection(img)) {
        if (italic(prev)) m['023'].push(img);
        else if (bold(prev)) m['024'].push(img);
        else m['025'].push(img);
      } else m['026'].push(img);
    }
    //  "Обычный текст + Пустая_строка + <P>Иллюстрация</P>"
    if (prev && isEmptyP(prev) && prevOf(prev) && isPlain(prevOf(prev)) && !imgInLine(prevOf(prev))) {
      const before = prevOf(prev);
      if (inSection(img)) {
        if (italic(before)) m['033'].push(img);
        else if (bold(before)) m['034'].push(img);
        else m['035'].push(img);
      } else m['036'].push(img);
    }
  }

  ///  АВТОМАТИКА (settings 0 and 1)
  const automatic = async (key) => {
    const [setting, fn, counter] = KINDS[key];
    for (const item of m[key]) {
      if (S[setting] === 1 && fn.startsWith('add')) {
        if (await insertEmpty(item, fn === 'addNext')) counts[counter] += 1;
      }
      if (S[setting] === 0 && fn.startsWith('del')) {
        const line = fn === 'delNext' ? nextOf(item) : prevOf(item);
        if (isEmptyP(line) && (await removeItem(line))) counts[counter] += 1;
      }
    }
  };
  for (const key of Object.keys(KINDS)) await automatic(key);

  /// ФУНКЦИИ ПРОСМОТРА, УДАЛЕНИЯ И ДОБАВЛЕНИЯ ПУСТЫХ СТРОК (setting 2)
  const ask = async (text, caption) => {
    const paused = Date.now();
    const answer = await MsgBox(text, caption, 3 + 32);
    T_pause += Date.now() - paused;
    return answer;
  };
  const show = async (line) => {
    if (line && !line.inDescription) await mfbe.selection.selectNode(nodeIdOf(line)).catch(() => {});
  };
  const caption = (key, name1, name2) => {
    const title = ru ? KINDS[key][3] : KINDS[key][4];
    const word = ru ? 'ция' : 'Illustration';
    return title.replace(word, `${word}${name1}`) + name2;
  };
  const prompt = (n, count, adding) =>
    t(
      ctx,
      ` • ${n + 1} из ${count} •  \n                        ◊  ${adding ? 'Сохранить добавленную пустую строку?' : 'Удалить пустую строку?'}`,
      ` • ${n + 1} of ${count} •  \n                        ◊  ${adding ? 'Keep the added empty line?' : 'Remove the empty line?'}`,
    );
  const review = async (key) => {
    const [, fn, counter] = KINDS[key];
    const mass = m[key];
    const Centrum = key === '007' || key === '017';
    for (let n = 0; n < mass.length; n += 1) {
      const item = mass[n];
      if (item.removed) continue;
      const name1 = ` "${pictureName(item)}"`;
      if (fn === 'addNext' || fn === 'addPrev') {
        const line = await insertEmpty(item, fn === 'addNext');
        if (!line) continue;
        await show(line);
        const name2 = Centrum ? ` "${pictureName(nextOf(line))}"` : '';
        const answer = await ask(prompt(n, mass.length, true), caption(key, name1, name2));
        if (answer === 6) counts[counter] += 1;
        else await removeItem(line);
        if (answer === 2) return;
      } else {
        const line = fn === 'delNext' ? nextOf(item) : prevOf(item);
        if (!isEmptyP(line)) continue;
        await show(line);
        const name2 = Centrum ? ` "${pictureName(nextOf(line))}"` : '';
        const answer = await ask(prompt(n, mass.length, false), caption(key, name1, name2));
        if (answer === 6 && (await removeItem(line))) counts[counter] += 1;
        if (answer === 2) return;
      }
    }
  };

  /// ВОПРОСЫ
  const d = S.VseStroki_on_off === 1 ? 'показать нули' : 0;
  const m1 = [];
  let cTaT0 = 0;
  const line = (key) => {
    if (m[key].length !== d) m1.push(`${ru ? KINDS[key][5] : KINDS[key][6]}${m[key].length}`);
  };
  if (S.Posle_illjustratsii === 2) {
    for (const key of ['001', '002', '003', '004', '005', '006']) line(key);
    if (cTaT0 !== m1.length) {
      m1.push('');
      cTaT0 = m1.length;
    }
    for (const key of ['011', '012', '013', '014', '015', '016']) line(key);
    if (cTaT0 !== m1.length) {
      m1.push('');
      cTaT0 = m1.length;
    }
  }
  if (S.Pered_illjustratsiej === 2) {
    for (const key of ['021', '022', '023', '024', '025', '026']) line(key);
    if (cTaT0 !== m1.length) {
      m1.push('');
      cTaT0 = m1.length;
    }
    for (const key of ['031', '032', '033', '034', '035', '036']) line(key);
    if (cTaT0 !== m1.length) m1.push('');
  }
  if (S.Mezhdu_illjustratsijami === 2 || d) {
    for (const key of ['007', '017']) line(key);
    if (cTaT0 !== m1.length) m1.push('');
  }
  if (m1.length !== 0) {
    const paused = Date.now();
    const answer = await mfbe.ui.message(
      t(
        ctx,
        `  • НАЙДЕНО\n· · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·                              \n\t\t\t\t\t\t       \n${m1.map((l) => `${l}\n`).join('')}\n                                   Продолжить?`,
        `  • FOUND\n· · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · · ·                              \n\t\t\t\t\t\t       \n${m1.map((l) => `${l}\n`).join('')}\n                                   Continue?`,
      ),
      { icon: 'question', buttons: [{ id: 'yes', label: '', default: true }, { id: 'no', label: '', cancel: true }] },
    );
    T_pause += Date.now() - paused;
    const otvet_2 = answer === 'yes';
    if (otvet_2 && S.Posle_illjustratsii === 2) {
      for (const key of ['001', '002', '003', '004', '005', '006', '011', '012', '013', '014', '015', '016']) if (m[key].length) await review(key);
    }
    if (otvet_2 && S.Pered_illjustratsiej === 2) {
      for (const key of ['021', '022', '023', '024', '025', '026', '031', '032', '033', '034', '035', '036']) if (m[key].length) await review(key);
    }
    if (otvet_2 && S.Mezhdu_illjustratsijami === 2) {
      for (const key of ['007', '017']) if (m[key].length) await review(key);
    }
  }

  // Подсчет общего количества исправлений
  const itogi = Object.values(counts).reduce((sum, n) => sum + n, 0);

  ///  ПОВЫШЕНИЕ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В ИСТОРИЮ ИЗМЕНЕНИЙ
  const description = doc.description;
  let history = { HiCh: 0, VersionUp: false, versionFile: String(description?.documentInfo?.version ?? ''), newVersion: '' };
  if (description && S.Version_on_off === 1 && (itogi || S.Vsegda_on_off === 1)) {
    history = historyChange(description, `${ScriptName} ${NumerusVersion}`, String(S.youName ?? ''), now);
    descriptionChanged = true;
  }
  if (descriptionChanged && description) await mfbe.doc.setDescription(description);

  /// ОКНО РЕЗУЛЬТАТОВ
  const Tf = Date.now();
  const count_ImgEts = count_ImgAll - count_Img - count_ImgP;
  const shown = (value) => value !== d;
  const mSt = [];
  mSt.push(` ${t(ctx, ScriptName, '"Empty lines next to the illustrations"')} v.${NumerusVersion}`);
  mSt.push('-----------------------------------------------------------------------');
  if (d) mSt.push(t(ctx, ' Демонстрационный режим', ' Demonstration mode'));
  mSt.push('\t\t\t\t\t\t          ');
  mSt.push(t(ctx, '• СТАТИСТИКА:', '• STATISTICS:'));
  mSt.push(`${t(ctx, ' · Вычисления  .  .  .  .  .  .  .  .  .  .  .\t', ' · Computing\t')}${timeOf(ctx, Tf - Ts - T_pause)}`);
  if (shown(T_pause)) mSt.push(`${t(ctx, ' · Диалоговые паузы .  .  .  .  .  .  .  .\t', ' · Dialog pauses\t')}${timeOf(ctx, T_pause)}`);
  if (shown(count_Img)) {
    if ((count_ImgP === 0 && count_ImgEts === 0) || d) mSt.push(`${t(ctx, '   Иллюстраций .  .  .  .  .  .  .  .  .  .  .\t', '   Illustrations\t')}${count_ImgAll}`);
    if (count_ImgP !== 0 || count_ImgEts !== 0 || d) mSt.push(`${t(ctx, '   Обычных иллюстраций .  .  .  .  .  .\t', '   Block illustrations\t')}${count_Img}`);
  }
  if (shown(count_ImgP)) mSt.push(`${t(ctx, '   Строк с одной иллюстрацией  .  .\t', '   Lines holding one illustration\t')}${count_ImgP}`);
  if (shown(count_ImgEts)) mSt.push(`${t(ctx, '   Иллюстраций в тексте строки  .  .\t', '   Illustrations within the text of a line\t')}${count_ImgEts}`);
  let cTaT = mSt.length;
  mSt.push('', t(ctx, '• ОПЕРАЦИИ С ГРАФИКОЙ В СТРОКЕ:', '• OPERATIONS ON PICTURES IN A LINE:'));
  const op = (n, ruText, enText, star) => {
    if (shown(counts[n])) mSt.push(`${t(ctx, ruText, enText)}${counts[n]}${star ? '*' : ''}`);
  };
  op(112, '112. Внутренняя чистка строк   .  .  .  .  .  .  .  .  .  .  .  .\t', '112. Lines cleaned inside\t');
  op(113, '113. Снятие форматирования "подзаголовок"  .  .  .  .\t', '113. "Subtitle" formatting removed\t');
  op(114, '114. Снятие внешнего форматирования   .  .  .  .  .  .  .\t', '114. Outer formatting removed\t');
  if (cTaT === mSt.length - 2) mSt.splice(cTaT, 2);
  cTaT = mSt.length;
  mSt.push('', t(ctx, '• ОПЕРАЦИИ С ПУСТЫМИ СТРОКАМИ:', '• OPERATIONS ON EMPTY LINES:'));
  op(111, '111. Чистка внутри строки  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '111. Lines cleaned\t');
  op(121, '121. Удаление повторной пустой строки   .  .  .  .  .  .  .\t', '121. Repeated empty lines removed\t');
  op(122, '122. Снятие внешнего форматирования   .  .  .  .  .  .  .\t', '122. Outer formatting removed\t');
  op(123, '123. Удаление на окраине разделов  .  .  .  .  .  .  .  .  .\t', '123. Removed at the edges of containers\t');
  op(124, '124. Удаление за краем разделов  .  .  .  .  .  .  .  .  .  . \t', '124. Removed next to containers\t');
  op(201, '201. Удаление рядом с картинкой в кармане секций\t', '201. Removed next to a picture in a section\'s head\t');
  op(211, '211. Вставка между картинкой и границей секции  \t', '211. Inserted between a picture and the section\'s edge\t');
  op(212, '212. Удаление между картинкой и границей секции\t', '212. Removed between a picture and the section\'s edge\t');
  op(221, '221. Вставка рядом с картинкой посреди секции .  .\t', '221. Inserted next to a picture inside a section\t');
  if (cTaT !== mSt.length - 2) mSt.push('');
  op(231, '231. Добавление между картинкой и текстом   .  .  .  .\t', '231. Added between a picture and text\t', S.Posle_illjustratsii === 2);
  op(232, '232. Удаление между картинкой и текстом .  .  .  .  .  .\t', '232. Removed between a picture and text\t', S.Posle_illjustratsii === 2);
  op(241, '241. Добавление между текстом и картинкой   .  .  .  .\t', '241. Added between text and a picture\t', S.Pered_illjustratsiej === 2);
  op(242, '242. Удаление между текстом и картинкой .  .  .  .  .  .\t', '242. Removed between text and a picture\t', S.Pered_illjustratsiej === 2);
  op(251, '251. Добавление между иллюстрациями   .  .  .  .  .  .  .\t', '251. Added between illustrations\t', S.Mezhdu_illjustratsijami === 2);
  op(252, '252. Удаление между иллюстрациями .  .  .  .  .  .  .  .  .\t', '252. Removed between illustrations\t', S.Mezhdu_illjustratsijami === 2);
  if (cTaT === mSt.length - 2) mSt.splice(cTaT, 2);
  if (mSt[mSt.length - 1] === '') mSt.pop();
  mSt.push('');
  if (shown(itogi)) mSt.push(`${t(ctx, ' · Всего исправлений  .  .  .  .  .  .  .  .\t', ' · Corrections in all\t')}${itogi}`);
  if (itogi === 0 || d) mSt.push(t(ctx, '   >> Исправлений нет', '   >> No corrections'));
  //  История
  const { HiCh, VersionUp } = history;
  if (VersionUp || HiCh || d) mSt.push('');
  if (VersionUp || d) mSt.push(`${t(ctx, '• Версия файла:  ', '• File version:  ')}${history.versionFile}  ›››  ${history.newVersion}`);
  if (HiCh === 1 || d) mSt.push(t(ctx, '• Добавлена новая строка в историю', '• A new line added to the history'));
  if (HiCh === 2 || d) mSt.push(t(ctx, '• Добавлены две строки в историю', '• Two lines added to the history'));
  if (HiCh === 3 || d) mSt.push(t(ctx, '• Изменены данные в строке истории', '• A line of the history changed'));
  //  Сборка строк текущей даты и времени
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const month = String(1 + now.getMonth()).padStart(2, '0');
  const year = String(now.getFullYear()).replace(/^.*?(\d{1,2})$/g, '$1');
  mSt.push('', `• ${now.getDate()}.${month}.${year} • ${now.getHours()}:${minutes}:${seconds} •`);
  await mfbe.ui.message(mSt.map((l) => `${l}\n`).join(''));
}
