// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/02_Генеральная уборка.js - "General
// clean-up", version 2.7 (2.7beta1's version 2.3 before feature 007). Runs the original's
// typographic regular expressions (rules.js, 134 of them) over every text block of the book and of
// the title-info annotation and the document-info history, as the original processed them: spaces
// around punctuation, hyphens and dashes, abbreviations and units, date ranges, leading and
// trailing spaces, soft hyphens, final dots in titles, junk ids, and since 2.7.9 (TaKir) apostrophes,
// invisible and Unicode space characters, ellipses stuck to words or after punctuation, the space
// before a note link and "crooked" note links. Each block is rendered in the legacy inline-HTML
// notation (lib/legacy-html.js), so the expressions that mention <EM>, <STRONG> and &nbsp; work
// as written and inline formatting survives; they compile with JScript's meaning of \s and .
// (lib/jscript-regexp.js). The annotation and the history are written back with
// mfbe.doc.setDescription, since node operations cannot address them.
//
// Differences from 2.7.9: none in the text. The statistics are shown in a message box as the
// original's, with the English labels in the English interface.
//
// The original's notice, kept as written (FR-029):
//======================================
//             «Генеральная уборка» (версия 2.7)
//                                             Engine by ©Sclex
//                                                    01.05.2007 – 31.08.2022
//~~~~~~~~~~~~~~~~~~
// v.1.01 — курсивное лидирующее тире в диалогах №08 — Faiber
//~~~~~~~~~~~~~~~~~~
// v.1.02 — курсив в списках №50
//~~~~~~~~~~~~~~~~~~
// v.1.03 — тире за препинаниями после скобки №13
//~~~~~~~~~~~~~~~~~~
// v.1.04 — открывающие кавычки перед лидирующим тире в диалогах №08
//              запрещение вставки пробела после точки, если после следующей буквы стоит точка №31
//              пробел перед % после цифр №53
//              неразрывный после № и § перед цифрами №54
//              оставил в покое многоточие №05
//              лидирующая тильда ушла в №08
//              тире после запятой, перед которой точка №13
//              начальные и конечные пробелы абзаца в курсиве №81, 82
//~~~~~~~~~~~~~~~~~~
// v.1.05 — тотальная замена коротких тире на длинные №07 — Faiber
//              две точки после слова в одноточие №38
//              в сносках не только цифры в квадратных скобках, а ваще всё что угодно
//~~~~~~~~~~~~~~~~~~
// v.1.06 — замена конечных дефисов на тире производится только в стихах №19 — Faiber
//              удаление лишних точек в заголовках №84
//              счётчики статистики
//              примитивная унификация сносок №40 — Faiber
//              дефис после точки не меняется на тире №13
//~~~~~~~~~~~~~~~~~~
// v.1.07 — вынос сноски за многоточие в конце строки №46
//~~~~~~~~~~~~~~~~~~
// v.1.08 — тире вместо дефиса после точки перед Прописной №29 — Faiber
//               препинания после сноски — везде № 46
//~~~~~~~~~~~~~~~~~~
// v.1.09 — удаление лишних ID №90
//~~~~~~~~~~~~~~~~~~
// v.1.10 — отдельный шаблон для тире после препинаний №55
//~~~~~~~~~~~~~~~~~~
// v.1.11 — немного дополнительной статистики
//               укороченное тире в интервалах дат №52, 60–63, 67
//~~~~~~~~~~~~~~~~~~
// v.1.12 — пропущенные пробелы после препинаний №85
//~~~~~~~~~~~~~~~~~~
// v.1.13 — дефис на тире ещё и в курсиве №29
//~~~~~~~~~~~~~~~~~~
// v.1.14 — стык эмфазиса через тире и пр. №56
//~~~~~~~~~~~~~~~~~~
// v.1.16 — тире вместо дефиса после точки перед открывающимися угловыми кавычками №57
//               пробел после букв-пробел-тире  №58
//~~~~~~~~~~~~~~~~~~
// v.1.17 — неверный знак препинания !… -> !.. №86
//               тире после «!..»  №14а — Faiber
//~~~~~~~~~~~~~~~~~~
// v.1.18 — пробел после тире №55a — Faiber
//~~~~~~~~~~~~~~~~~~
// v.1.19 — более жёстко заданы номера сносок без < и > №41…49
//               сноска зашагивает за многоточие только в конце абзаца — №46a
//~~~~~~~~~~~~~~~~~~
// v.1.20 — пробел перед тире после двоеточия и закр. кавычек №26
//~~~~~~~~~~~~~~~~~~
// v.1.21 — пробел перед тире после вопроса\восклицания и двоеточия №13а
//~~~~~~~~~~~~~~~~~~
// v.1.27 — пробел после букв+двоеточия перед кавычками ["] №27
//               пробел после точки перед откр. кавычками [«] №34
//~~~~~~~~~~~~~~~~~~
// v.1.28 — пронумерованный список: статьи Ст. 1… №50a
//~~~~~~~~~~~~~~~~~~
// v.1.29 — удаление неразрывного пробела после тире №01
//~~~~~~~~~~~~~~~~~~
// v.1.30 — мультипрепинания за сноской №46
//~~~~~~~~~~~~~~~~~~
// v.1.31 — уточнил градусы Цельсия №67
//
// вопрос по обычным двойным кавычкам в №№27, 32
//~~~~~~~~~~~~~~~~~~
// v.1.33 — опять. - дефис после препинаний №29, 31
//~~~~~~~~~~~~~~~~~~
// v.1.34 — emphasis'ы со strong'ами загнал в переменные
//~~~~~~~~~~~~~~~~~~
// v.1.35 — #84 попытка оставить на месте точки в заголовках, типа 1980 г.; XXI в.; Буш-мл. и т.п.
//~~~~~~~~~~~~~~~~~~
// v.1.36 — ##40,46,46a + PromtSnoska – возможность отключениия простановки квадратных скобок вокруг сноски
//~~~~~~~~~~~~~~~~~~
//v.2.0 — изменения для правильной работы с учетом возможности выбора вида неразрывного пробела в FBE
//======================================
//v.2.1 — отключил «окавычивание» №15,17, 18, 37, 38 — для этого есть скрипты по кавычкам; перестал обращать внимание на сноски 40, 41, 43, 47 — есть скрипты по сноскам
//======================================
//v.2.2 — убрал Ко
//======================================
//v.2.3 — унификация апострофов, замена-удаление различных мусорных знаков: U+202B, U+00AD, U+E088, пробелы U+0020, U+2002, U+200B, U+202F, U+2009, U+200A, прилипшие многоточия и проч. (п.п. 92-141) — TaKir
//======================================
//v.2.4 — теперь, если заголовок заканчивается на вопросительное или восклицательное многоточие ("?..", "!..", "?!.") , то скрипт не будет отрывать от него конечную точку.
//Примеры заголовков, которые раньше обрабатывались неверно: "СССР: вернуться в детство?..", "Ты кто?!."
//======================================
//v.2.5 — регэкспы (п.п. 142-149) — TaKir
//
//======================================
import { collectTextBlocks, legacyTimeString, parseInline, rewriteBlockHtml, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';
import { cleanHtml, HEADING_COUNTERS, JUNK_ID, STATISTICS } from './rules.js';

const VERSION = '2.7';

/** The original's junk-id test (re90) of a paragraph id. */
function isJunkId(id) {
  return typeof id === 'string' && id.search(JUNK_ID) >= 0;
}

/** The title-info annotation and the document-info history live in the description. */
function descriptionBlocks(description) {
  const out = [];
  const visit = (node, ancestors) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      out.push({ node, parentType: ancestors[0]?.type });
      return;
    }
    for (const child of node.content ?? []) visit(child, [node, ...ancestors]);
  };
  visit(description.titleInfo?.annotation, []);
  visit(description.documentInfo?.history, []);
  return out;
}

/** The result message: the version, the time and the statistics as 2.7.9 shows them. */
function resultMessage(ru, started, counters) {
  let stats = '';
  if (HEADING_COUNTERS.some((key) => counters[key])) stats += ru ? '\n Статистика' : '\n Statistics';
  for (const [key, ruLabel, enLabel] of STATISTICS) {
    if (counters[key]) stats += `\n• ${ru ? ruLabel : enLabel}:\t${counters[key]}`;
  }
  if (stats) stats = `\n${stats}`;
  return ru
    ? `–= Jurgen Script =–\n«Генеральная уборка» v.${VERSION} Golma+TaKir Edition 2025\n\n Время: ${legacyTimeString(started)}.${stats}`
    : `–= Jurgen Script =–\n"General clean-up" v.${VERSION} Golma+TaKir Edition 2025\n\n Time: ${legacyTimeString(started)}.${stats}`;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const counters = {};
  const snapshot = await mfbe.doc.get();
  const blocks = collectTextBlocks(snapshot);

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const parentType = block.ancestors[0]?.type;
    // Junk ids left by converters: the attribute goes away together with the text clean-up.
    const dropId = isJunkId(block.node.attrs?.id);
    if (dropId) counters['90'] = (counters['90'] ?? 0) + 1;
    await rewriteBlockHtml(block, (html) => cleanHtml(html, parentType, counters));
    if (dropId) {
      // rewriteBlockHtml refreshed block.node, so the cleaned content is kept.
      const attrs = { ...block.node.attrs };
      delete attrs.id;
      await mfbe.doc.replaceNode(block.ref, { type: block.node.type, attrs, content: block.node.content ?? [] });
    }
    if (i % 25 === 0) await mfbe.ui.progress(i, blocks.length, ru ? 'Генеральная уборка' : 'General clean-up');
    if (ctx.cancelled) return;
  }

  // Description blocks cannot be addressed by node operations: edit the JSON and write it back.
  const description = snapshot.description;
  let descriptionChanged = false;
  for (const { node, parentType } of descriptionBlocks(description)) {
    if (isJunkId(node.attrs?.id)) {
      delete node.attrs.id;
      counters['90'] = (counters['90'] ?? 0) + 1;
      descriptionChanged = true;
    }
    const extras = [];
    const before = serializeInline(node.content, extras);
    const after = cleanHtml(before, parentType, counters);
    if (after !== before) {
      node.content = parseInline(after, extras);
      descriptionChanged = true;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);

  await mfbe.ui.message(resultMessage(ru, started, counters), { caption: ctx.script.name, icon: 'info' });
}
