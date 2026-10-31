// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/560_Унификация подзаголовков-звездочек (С-К).js
// Unifies "asterisk" subtitles: in every body (notes and comments too) and in the book's
// annotation, a subtitle made of three or more asterisks with any spaces between them, also in
// italics or bold, becomes "* * *" without formatting. The original is a "script constructor"
// (С-К): a list of search-and-replace operations with their place of action and statistics line,
// run on the HTML of every paragraph; this conversion keeps that list (OPERATIONS below, with the
// original's instructions translated) and runs it on the legacy inline-HTML notation of
// lib/legacy-html.js. A window with statistics follows, laid out as in the original.
// Difference from the original: the optional proverb of the results window (off in the
// original's settings) is not included.
// The original's notice, kept as written (FR-029):
//======================================
//             «Скрипт-конструктор» версия «Унификация подзаголовков-звёздочек» (TaKir, декабрь 2024)
//  Предназначен для быстрого и удобного создания несложных скриптов по поиску и замене в строках текста (с тегами).
//  * Раздел для добавления операций начинается сразу после "настроек";  чуть ниже шаблон операций  и  пояснения.
//  ** Скрипт создавался и тестировался в FBE 2.7.4, система win XP, IE8
//======================================
// v.1.0 — Создание оболочки скрипта — Александр Ка (12.08.2024)
// v.1.1 — Небольшое улучшение — Александр Ка (16.08.2024)
// Все полезные разделы перенесены в начало скрипта
// Добавлена возможность добавления операции с номером "0"
// v.1.2 — исправлена ошибка с невозможностью добавления области поиска — Александр Ка (22.08.2024)
//======================================
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// ---------------------------------------------------------------
                 ///  НАСТРОЙКИ
// ---------------------------------------------------------------
         //     Название скрипта
import { parseInline, serializeInline } from './lib/legacy-html.js';

/* --------------------------------------------------------------------------------------------- */
/* Settings (НАСТРОЙКИ) of the original, with their values                                       */
/* --------------------------------------------------------------------------------------------- */

// Название скрипта (shown in the statistics)
const NazvanieSkripta = { ru: 'Унификация подзаголовков-звёздочек', en: 'Unification of asterisk subtitles' };
// Номер версии скрипта
const NumerusVersion = '1.2';
// Обработка текста внутри "Истории изменений файла" (0 off, 1 on)
const ObrabotkaHistory_on_off = 0;
// Обработка текста внутри аннотации к книге (0 off, 1 on)
const ObrabotkaAnnotation_on_off = 1;
// Направленность скрипта (0 "Поиск и подсчет", 1 "Исправления"): the heading of the statistics
const Poisk_ili_Ispravlenija = 1;
// Ориентировочный максимум строк колонки в окне результатов (12-46); up to 3 columns
const Vysota_kolonki = 37;
// Демонстрационный режим (0 off, 1 on): show every statistics line, zero counts too
const VseStroki_on_off = 0;

// The tags of italics and bold in the legacy HTML (the original's sIB, fIB, aIB), and the
// non-breaking space as it appears there (nbspEntity) and as text (nbspChar).
const sIB = '<EM><STRONG>|<STRONG><EM>|<EM>|<STRONG>';
const fIB = '</EM></STRONG>|</STRONG></EM>|</EM>|</STRONG>';
const aIB = '<EM><STRONG>|<STRONG><EM>|</EM></STRONG>|</STRONG></EM>|<EM>|<STRONG>|</EM>|</STRONG>';
const nbspEntity = '&nbsp;';
const nbspChar = ' ';

/* --------------------------------------------------------------------------------------------- */
/* ОПЕРАЦИИ - the operations. New search/replace operations can be added to this list.          */
/* --------------------------------------------------------------------------------------------- */
//
// How to add an operation (translated from the original's instructions):
//   { n: <a number from 0 to 999, unique>,
//     re: new RegExp("<expression to search for>", "g"),
//     re_: "<replacement>"                 (leave it out when the operation only searches and counts),
//     stat: { ru: "<line of the statistics>", en: "<the same in English>" }
//                                          (leave it out when the operation is not counted),
//     where: (z) => <condition> },
//   - the expression runs on the paragraph as HTML: <EM>, <STRONG>, <SUB>, <SUP>, <STRIKE>,
//     <SPAN class=code>, <SPAN class=NAME>, <A href=...>, <IMG ...>, &nbsp; &lt; &gt; &amp;; inside a
//     string a backslash is written twice ("\\d"); sIB, fIB and aIB stand for the opening, the
//     closing and either tag of italics, bold or bold italics, nbspEntity for a non-breaking space
//     in the expression and nbspChar for one in the replacement;
//   - `where` says where the operation acts, from the fields of z: annotation, history, title,
//     subtitle, poem, stanza, cite, epigraph, table, text_author ("text-author"), text (a plain
//     paragraph of a section); `!z.annotation` excludes, `z.annotation || z.epigraph` combines,
//     `(z) => true` acts everywhere;
//   - the statistics line should end with a tab; all lines should be of one length (the
//     demonstration mode, VseStroki_on_off = 1, shows them all);
//   - an example of the original (a letter or quote, a dash, a space -> the letter, an en dash):
//       re: new RegExp("([А-яA-Za-zЁё“»”\\\"])("+fIB+"){0,1}—("+fIB+"){0,1}(\\\s|"+nbspEntity+")","g"),
//       re_: "$1$2–$3 ".
const OPERATIONS = [
  {
    n: 1, //  унификация более 3 звёздочек с разными пробелами или без (TaKir)
    re: new RegExp("^(?:"+sIB+")?(?:(?:\\\s|"+nbspEntity+"){0,}[*]{1,}(?:\\\s|"+nbspEntity+"){0,}){3,}(?:"+fIB+")?$","g"),
    re_: '* * *',
    stat: {
      ru: '<Унификация более 3 звёздочек (TaKir)>   .  .  .  .  .  .  .  .  .\t',
      en: '<More than 3 asterisks unified (TaKir)>   .  .  .  .  .  .  .  .  .\t',
    },
    where: (z) => z.subtitle, //  annotation, history, title, subtitle, poem, stanza, cite, epigraph, table, text_author, text
  },
];

// The result window's layout strings, as written (column paddings for 2 and 3 columns, the
// header and the underline made of combining vertical lines).
const PAD = { 1: ['', '', '', ''], 2: ["                                                ", "                              ", ":::::::::", " ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍"], 3: ["                                                                                                ", "                                                                      ", ":::::::::::::", " ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍"] };
const HEADER = "                                  –= ◊ =–                                                    ";
const UNDERLINE = " ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍";

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const P_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'date', 'td', 'th', 'empty-line']);

/** The original's place of the paragraph (HandleP): its own class and the elements above it. */
function placeOf(node, ancestors) {
  const z = {
    title: false, history: false, stanza: false, poem: false, epigraph: false, annotation: false,
    cite: false, table: false,
    subtitle: node.type === 'subtitle',
    text_author: node.type === 'text-author' || node.type === 'date',
  };
  z.text = !z.subtitle && ancestors[0]?.type === 'section';
  for (const up of ancestors) {
    if (up.type === 'section') break;
    if (z[up.type] === false) z[up.type] = true;
  }
  return z;
}

/** Runs the operations on one paragraph's HTML (HandleP); returns the new HTML. */
function handleP(html, z, count) {
  let s = html;
  for (const op of OPERATIONS) {
    if (!op.where(z)) continue;
    if (s.search(op.re) !== -1) {
      count[op.n] += s.match(op.re).length; // для статистики
      if (op.re_ !== undefined) s = s.replace(op.re, op.re_); //  для замены
    }
  }
  return s;
}

/** The paragraphs of a tree with their ancestors (nearest first). */
function collect(node, ancestors, out) {
  for (const child of node.content ?? []) {
    if (child.type === 'text') continue;
    if (P_TYPES.has(child.type)) out.push({ node: child, ancestors: [node, ...ancestors] });
    else collect(child, [node, ...ancestors], out);
  }
  return out;
}

function pad3(k) {
  return `00${k}`.replace(/.*(...)$/g, '$1');
}

/** The results window of the original: lines in up to three columns, the date and time below. */
function resultsText(ctx, counters, started) {
  const ru = ctx.uiLanguage === 'ru';
  const T2 = Date.now() - started;
  const TsecD = T2 / 1000;
  const tempus = `${`${TsecD}`.replace(/(.{1,5}).*/g, '$1').replace(/\.$/g, '').replace('.', ',')} ${ru ? 'с' : 's'}`;
  const mSt = [];
  mSt.push(t(ctx, '• СТАТИСТИКА:\t\t\t\t', '• STATISTICS:\t\t\t\t'));
  mSt.push(t(ctx, '• Время выполнения  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '• Running time  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t') + tempus);
  mSt.push(t(ctx, '• Всего строк   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '• Lines in all   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t') + counters.count_P);
  mSt.push(t(ctx, '• Исправлено строк  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '• Lines changed  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t') + counters.count_GU);
  const cTaT1 = mSt.length - 1;
  mSt.push('\t\t\t\t\t');
  mSt.push(Poisk_ili_Ispravlenija === 0 ? t(ctx, '• ПОИСК И ПОДСЧЁТ:\t\t\t', '• SEARCH AND COUNT:\t\t\t') : t(ctx, '• ИСПРАВЛЕНИЯ:\t\t\t\t', '• CORRECTIONS:\t\t\t\t'));
  const d = VseStroki_on_off === 1 ? 'показать все строки' : 0;
  for (const op of [...OPERATIONS].sort((a, b) => a.n - b.n)) {
    if (op.stat !== undefined && counters.count[op.n] !== d) mSt.push(`${pad3(op.n)}. ${ru ? op.stat.ru : op.stat.en}${counters.count[op.n]}`);
  }
  let ind = mSt.length;
  if (cTaT1 === ind - 3) ind -= 2; //  Удаление двух последних строк, если нет пунктов в этом разделе

  // Columns: at most Vysota_kolonki lines in one, up to three of them.
  const max0 = Math.max(Vysota_kolonki, 1);
  const sto = ind / max0 <= 3 ? Math.ceil(ind / max0) : 3;
  const Kolo = Math.ceil(ind / sto);
  let stT = '';
  for (let k = 0; k < Kolo; k += 1) {
    stT += `\n${mSt[k]}\t`;
    if (sto > 1 && k + Kolo < ind) stT += `${mSt[k + Kolo]}\t`;
    if (sto > 2 && k + 2 * Kolo < ind) stT += `${mSt[k + 2 * Kolo]}\t`;
  }
  const [otst, otst2, otst3, otst4] = PAD[sto] ?? PAD[1];
  const now = new Date();
  const minutes = now.getMinutes() < 10 ? `0${now.getMinutes()}` : `${now.getMinutes()}`;
  const seconds = now.getSeconds() < 10 ? `0${now.getSeconds()}` : `${now.getSeconds()}`;
  const day = now.getDate();
  const month = now.getMonth() + 1 < 10 ? `0${now.getMonth() + 1}` : `${now.getMonth() + 1}`;
  const year = `${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const Day_ = day < 10 ? '  ' : '';
  const currentTime = `${now.getHours()}:${minutes}:${seconds}`;
  const currentDate = `${day}.${month}.${year}`;
  return (
    `${otst}${HEADER}${otst}\n\n` +
    `• «${ru ? NazvanieSkripta.ru : NazvanieSkripta.en}»  v.${NumerusVersion}\n` +
    `${UNDERLINE}${otst4}${stT}\n\n` +
    `${otst2}${Day_}.:::::::::::${otst3} ${currentDate} ::::::::::::${otst3} ${currentTime} ${otst3}:::::::::::.`
  );
}

export default async function run(ctx) {
  const started = Date.now();
  const counters = { count: Object.fromEntries(OPERATIONS.map((op) => [op.n, 0])), count_P: 0, count_GU: 0 };
  const doc = await mfbe.doc.get();

  // The book's annotation and the document's history first, as the original found them at the
  // top of the text.
  const description = doc.description;
  let descriptionChanged = false;
  const parts = [];
  if (ObrabotkaAnnotation_on_off !== 0 && description?.titleInfo?.annotation) parts.push([description.titleInfo.annotation, 'annotation']);
  if (ObrabotkaHistory_on_off !== 0 && description?.documentInfo?.history) parts.push([description.documentInfo.history, 'history']);
  for (const [part, kind] of parts) {
    for (const { node, ancestors } of collect(part, [], []).map((p) => ({ ...p, ancestors: [...p.ancestors.slice(0, -1), { type: kind }] }))) {
      counters.count_P += 1;
      const extras = [];
      const before = serializeInline(node.content ?? [], extras);
      const after = handleP(before, placeOf(node, ancestors), counters.count);
      if (after !== before) {
        counters.count_GU += 1;
        node.content = parseInline(after, extras);
        descriptionChanged = true;
      }
    }
  }

  const paragraphs = [];
  for (const body of doc.bodies ?? []) collect(body, [], paragraphs);
  for (let i = 0; i < paragraphs.length; i += 1) {
    const { node, ancestors } = paragraphs[i];
    counters.count_P += 1;
    const extras = [];
    const before = serializeInline(node.content ?? [], extras);
    const after = handleP(before, placeOf(node, ancestors), counters.count);
    if (after !== before) {
      counters.count_GU += 1;
      await mfbe.doc.replaceNode(node.attrs.nodeId, { type: node.type, attrs: { ...node.attrs }, content: parseInline(after, extras) });
    }
    if (i % 200 === 199) {
      await mfbe.ui.progress(i + 1, paragraphs.length);
      if (ctx.cancelled) return;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);
  await mfbe.ui.message(resultsText(ctx, counters, started));
}
