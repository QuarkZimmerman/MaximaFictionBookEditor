// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/06_Управляемое исправление разрывов
// абзацев....js, version 4.5 (2.7beta1's «Интерактивная ликвидация разрывов абзацев» 3.8 before
// feature 007), with its two dialogs (HTML/Управляемое исправление разрывов абзацев - выбор
// режимов.html and - сомнительные места.html). Pairs of consecutive paragraphs broken by a scan or a
// conversion are classified by the last character of the first one and the first character of the
// second one (hyphen with a space before it, dash, comma, lower-case letter, no final punctuation...).
// For every class the user chooses in the first form either an automatic action or "Ручной выбор":
// those places are then shown one by one (the original listed them in its second dialog) with the
// end of the first and the start of the second paragraph.
//
// Actions (2.7.9's codes): 1 join with a space, 2 add a full stop, 3 full stop instead of the comma,
// 4/5 an en/em dash instead of the hyphen and join with a space, 6 remove the hyphen or dash and
// join with a space, 7 join with a hyphen (a dash becomes a hyphen), 8 remove the hyphen or dash and
// join without a space, 9 join with a space and make the first letter of the second paragraph
// lower-case, 10 add ":" and join with a space, 11 add ":", 12 join without a space keeping the
// hyphen or dash. Empty lines between the two paragraphs disappear when they are joined. Titles,
// tables, poems, epigraphs, annotations and text-author lines are never touched; cites and
// subtitles only when enabled in the form.
//
// What 2.7.9 changed is ported: its letters (letters.js: lower and upper case of many scripts, not
// only Russian and Latin), a paragraph holding a picture is no longer an empty line, a class-7 place
// asked by hand is offered its own actions (2.7beta1 offered those of class 1), class 7 accepts a
// closing quote after ?.!… (2.7beta1 required it not to follow them), the new actions 9, 11 and 12,
// action 6 joining with a space, and the dialogs' texts.
// The original's notice, kept as written (FR-029):
// Управляемое исправление разрывов абзацев
// Автор скрипта: Sclex
// Сайт скриптов FBE Sclex’а: http://scripts.fictionbook.org
import { BIG_LETTERS, SMALL_LETTERS } from './letters.js';

const VERSION = '4.5';
const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const SKIP_CONTAINERS = new Set(['title', 'table', 'annotation', 'poem']);
const RESET_CONTAINERS = new Set(['section', 'annotation', 'poem']);
const SPACE = /[  )]/; // the legacy "space" set skipped a closing parenthesis too
const LOWER = new RegExp(`[${SMALL_LETTERS}]`);
const CAPITAL_OR_DIGIT = new RegExp(`[${BIG_LETTERS}\\d]`);
const FIRST_CAPITAL = new RegExp(`^([^${BIG_LETTERS}]*?)([${BIG_LETTERS}])`);
const OPENERS = /[«(\["=–—]/;
const SENTENCE_END = /[!?….]/;
const DASHES = /[-–—]/;
const DASH_OR_LAQUO = /[-«–—]/;
const QUOTES = /["»”“]/;
const NON_ENDING = /[^.,?!…]/;

/* ----------------------------------------------------------------- texts */

function isNote(run) {
  return run.type === 'text' && (run.marks ?? []).some((m) => m.type === 'link' && m.attrs?.type === 'note');
}

function visibleText(node) {
  return (node.content ?? []).filter((r) => r.type === 'text' && !isNote(r)).map((r) => r.text ?? '').join('');
}

function allText(node) {
  return (node.content ?? []).filter((r) => r.type === 'text').map((r) => r.text ?? '').join('');
}

/** 2.7.9's isEmptyLine: only spaces and non-breaking spaces, and no picture. */
function isEmptyBlock(node) {
  if (node.type === 'empty-line') return true;
  if (!TEXT_BLOCK_TYPES.has(node.type)) return false;
  if ((node.content ?? []).some((r) => r.type === 'inline-image')) return false;
  return /^[  ]*$/.test(allText(node));
}

/** Last and pre-last non-space characters of a paragraph; whether a space precedes the last. */
function tailInfo(node) {
  const text = visibleText(node);
  let i = text.length - 1;
  while (i >= 0 && SPACE.test(text[i])) i -= 1;
  const last = i >= 0 ? text[i] : '';
  let spaceBefore = false;
  i -= 1;
  while (i >= 0 && SPACE.test(text[i])) {
    spaceBefore = true;
    i -= 1;
  }
  return { last, preLast: i >= 0 ? text[i] : '', spaceBefore };
}

function headInfo(node) {
  const text = visibleText(node);
  const chars = [];
  for (const ch of text) {
    if (SPACE.test(ch)) continue;
    chars.push(ch);
    if (chars.length === 2) break;
  }
  return { first: chars[0] ?? '', second: chars[1] ?? '' };
}

/* ------------------------------------------------------------ edits */

function cloneContent(node) {
  return JSON.parse(JSON.stringify(node.content ?? []));
}

function trimRight(content) {
  for (let i = content.length - 1; i >= 0; i -= 1) {
    const run = content[i];
    if (run.type !== 'text') return;
    const text = run.text.replace(/[  ]+$/, '');
    if (text) {
      run.text = text;
      return;
    }
    content.splice(i, 1);
  }
}

function trimLeft(content) {
  while (content.length) {
    const run = content[0];
    if (run.type !== 'text') return;
    const text = run.text.replace(/^[  ]+/, '');
    if (text) {
      run.text = text;
      return;
    }
    content.shift();
  }
}

/** Applies `fn` to the text of the last text run (the legacy "last text node"). */
function editLastText(content, fn) {
  for (let i = content.length - 1; i >= 0; i -= 1) {
    if (content[i].type === 'text') {
      content[i].text = fn(content[i].text);
      return;
    }
  }
  content.push({ type: 'text', text: fn('') });
}

/** 2.7.9's makeFirstLetterSmall: the first capital of the first text run becomes lower-case. */
function firstLetterSmall(content) {
  const run = content.find((r) => r.type === 'text');
  if (run) run.text = run.text.replace(FIRST_CAPITAL, (all, before, capital) => before + capital.toLowerCase());
}

/** The original's time string: tenths of a second, with the minutes when there are any. */
function timeString(ms, ru) {
  const min = Math.floor(ms / 60000);
  const sec = Math.ceil(10 * (ms / 1000 - min * 60)) / 10;
  if (min > 0) return ru ? `${min} мин. ${sec} с` : `${min} min ${sec} s`;
  return ru ? `${sec} с` : `${sec} s`;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  let started = Date.now();
  const L = (r, e) => (ru ? r : e);
  const manual = { value: 'manual', label: L('Ручной выбор', 'Ask me') };
  const action = (code, r, e) => ({ value: String(code), label: L(r, e) });
  const LEAVE = action(0, 'Не трогать', 'Leave as it is');
  const JOIN_SPACE = action(1, 'Соединить через пробел', 'Join with a space');
  const JOIN_NO_SPACE = action(8, 'Соединить без пробела', 'Join without a space');
  const JOIN_COLON = action(10, 'Соединить через ":" и пробел', 'Join with ":" and a space');
  const ADD_COLON = action(11, 'Добавить ":"', 'Add ":"');
  const arrow = (first, second) => `${first}  →  ${second}`;
  // Each class with the options of 2.7.9's two dialogs, in their order.
  const CASES = {
    4: { label: arrow(L('Дефис, перед которым пробел', 'Hyphen with a space before it'), L('Любой символ', 'Any character')),
      options: [LEAVE, action(4, 'Соединить через короткое тире и пробел', 'Join with an en dash and a space'), action(5, 'Соединить через длинное тире и пробел', 'Join with an em dash and a space'), action(8, 'Удалить дефис, соединить абзацы без пробела между ними', 'Remove the hyphen, join the paragraphs without a space'), action(6, 'Удалить дефис, соединить абзацы через пробел', 'Remove the hyphen, join the paragraphs with a space')] },
    5: { label: arrow(L('Тире или дефис, перед которым непробельный символ', 'Dash or hyphen after a non-space character'), L('Любой символ', 'Any character')),
      options: [LEAVE, action(12, 'Сохранить тире/дефис, соединить абзацы (без пробелов между ними)', 'Keep the dash or hyphen, join the paragraphs (without spaces between them)'), action(7, 'Соединить абзацы через дефис (без пробелов)', 'Join the paragraphs with a hyphen (without spaces)'), action(6, 'Удалить дефис/тире, соединить абзацы через пробел', 'Remove the hyphen or dash, join the paragraphs with a space'), action(8, 'Удалить дефис/тире, соединить абзацы без пробела между ними', 'Remove the hyphen or dash, join the paragraphs without a space')] },
    3: { label: arrow(L('Запятая', 'Comma'), L('Любой символ', 'Any character')),
      options: [LEAVE, action(1, 'Сохранить запятую, соединить абзацы через пробел', 'Keep the comma, join the paragraphs with a space'), action(3, 'Сделать точку вместо запятой', 'Put a full stop instead of the comma'), action(9, 'Сохранить запятую, соединить абзацы через пробел. Первую букву 2-го абзаца сделать маленькой (если надо)', 'Keep the comma, join the paragraphs with a space. Make the first letter of the second paragraph lower-case (if needed)')] },
    1: { label: arrow(L('Маленькая буква', 'Lower-case letter'), L('Маленькая буква', 'Lower-case letter')),
      options: [LEAVE, ADD_COLON, JOIN_NO_SPACE, JOIN_SPACE, JOIN_COLON] },
    6: { label: arrow(L('Тире, перед которым пробел', 'Dash with a space before it'), L('Маленькая буква', 'Lower-case letter')),
      options: [LEAVE, action(1, 'Сохранить тире, присоединить абзац через пробел', 'Keep the dash, join the paragraph with a space'), action(8, 'Удалить тире, соединить абзацы без пробелов между ними', 'Remove the dash, join the paragraphs without spaces')] },
    7: { label: arrow(L('Не запятая и не закрывающая кавычка, либо закрывающая кавычка, перед которой один из знаков: ?.!…', 'Not a comma nor a closing quote, or a closing quote after one of ?.!…'), L('Маленькая буква. Или символ из перечисленных: «"(–[=— а потом маленькая буква', 'A lower-case letter, or one of «"(–[=— and then a lower-case letter')),
      options: [LEAVE, JOIN_SPACE, JOIN_NO_SPACE] },
    2: { label: arrow(L('Символ, не характерный для законченной строки (не точка, не запятая, не кавычки, не двоеточие, не точка с запятой)', 'A character unusual at the end of a line (not a full stop, comma, quote, colon or semicolon)'), L('Большая буква. Либо один из символов: «"(–[=— и потом большая буква', 'A capital letter, or one of «"(–[=— and then a capital letter')),
      options: [LEAVE, action(2, 'Добавить точку', 'Add a full stop'), ADD_COLON, JOIN_SPACE, JOIN_COLON, action(9, 'Соединить через пробел, первую букву 2-го абзаца сделать маленькой', 'Join with a space, make the first letter of the second paragraph lower-case')] },
  };

  /* ---- first dialog: modes ---- */
  const modes = await mfbe.ui.form({
    title: L(`Выбор режимов обработки. – Скрипт «Управляемое исправление разрывов абзацев v${VERSION}» (автор Sclex).`, `Processing modes. – Script "Guided repair of paragraph breaks v${VERSION}" (by Sclex).`),
    width: 640,
    fields: [
      { kind: 'static', id: 'h1', text: L('Для некоторых ситуаций можно выбрать, включена ли обработка', 'For some situations you can choose whether they are handled') },
      { kind: 'checkbox', id: 'handle1Cite', label: L('Ситуация, когда первый абзац из двух соседних проверяемых абзацев находится в цитате', 'The first of the two neighbouring paragraphs checked is in a cite'), value: true },
      { kind: 'checkbox', id: 'handle2Cite', label: L('Ситуация, когда второй абзац из двух соседних проверяемых абзацев находится в цитате', 'The second of the two neighbouring paragraphs checked is in a cite'), value: true },
      { kind: 'checkbox', id: 'handle1Subtitle', label: L('Ситуация, когда первый абзац из двух соседних проверяемых абзацев является подзаголовком', 'The first of the two neighbouring paragraphs checked is a subtitle'), value: false },
      { kind: 'checkbox', id: 'handle2Subtitle', label: L('Ситуация, когда второй абзац из двух соседних проверяемых абзацев является подзаголовком', 'The second of the two neighbouring paragraphs checked is a subtitle'), value: false },
      { kind: 'static', id: 'h2', text: L('Выберите режим обработки для различных обнаруженных случаев (конец первого абзаца  →  начало второго абзаца).', 'Choose how each kind of place found is handled (end of the first paragraph  →  start of the second paragraph).') },
      ...[4, 5, 3, 1, 6, 7, 2].map((n) => ({ kind: 'select', id: `case${n}`, label: CASES[n].label, options: [manual, ...CASES[n].options], value: 'manual' })),
    ],
  });
  if (!modes) return;

  /* ---- scan ---- */
  const snapshot = await mfbe.doc.get();
  let autoCount = 0;
  const pending = []; // manual cases: { kind, prev, next, empties }
  const removed = new Map(); // nodeId of a merged-away paragraph -> the paragraph it went into

  const resolve = (node) => {
    let current = node;
    while (removed.has(current.attrs.nodeId)) current = removed.get(current.attrs.nodeId);
    return current;
  };

  const write = async (node) => {
    await mfbe.doc.replaceNode({ nodeId: node.attrs.nodeId, type: node.type }, { type: node.type, attrs: { ...node.attrs }, content: node.content });
  };

  /** Performs `code` on the pair; returns true when the second paragraph was merged away. */
  const perform = async (code, prevIn, next, empties) => {
    const prev = resolve(prevIn);
    const content = cloneContent(prev);
    const join = async (space, { lowerFirst = false } = {}) => {
      trimRight(content);
      const tail = cloneContent(next);
      trimLeft(tail);
      if (lowerFirst) firstLetterSmall(tail);
      if (space) content.push({ type: 'text', text: ' ' });
      content.push(...tail);
      prev.content = content;
      await write(prev);
      for (const empty of empties) await mfbe.doc.removeNode(empty.attrs.nodeId);
      await mfbe.doc.removeNode(next.attrs.nodeId);
      removed.set(next.attrs.nodeId, prev);
      return true;
    };
    switch (code) {
      case 1:
        return join(true);
      case 2:
        trimRight(content);
        editLastText(content, (t) => `${t}.`);
        break;
      case 3:
        trimRight(content);
        editLastText(content, (t) => t.replace(/,?$/, '.'));
        break;
      case 4:
        trimRight(content);
        editLastText(content, (t) => t.replace(/-$/, '–'));
        return join(true);
      case 5:
        trimRight(content);
        editLastText(content, (t) => t.replace(/-$/, '—'));
        return join(true);
      case 6:
        trimRight(content);
        editLastText(content, (t) => t.replace(/[-–—]$/, ''));
        return join(true);
      case 7:
        trimRight(content);
        editLastText(content, (t) => t.replace(/[-–—]$/, '-'));
        return join(false);
      case 8:
        trimRight(content);
        editLastText(content, (t) => t.replace(/[-–—]$/, ''));
        return join(false);
      case 9:
        return join(true, { lowerFirst: true });
      case 10:
        trimRight(content);
        editLastText(content, (t) => `${t}:`);
        return join(true);
      case 11:
        trimRight(content);
        editLastText(content, (t) => `${t}:`);
        break;
      case 12:
        return join(false);
      default:
        return false;
    }
    prev.content = content;
    await write(prev);
    return false;
  };

  /**
   * 2.7.9's addCaseOrDoAction: a class asked by hand is collected, any other gets its automatic
   * action (0 leaves the place as it is); either way the pair is settled (`wasReplace`).
   */
  const decide = async (kind, prev, next, empties) => {
    const mode = modes[`case${kind}`];
    if (mode === 'manual') {
      pending.push({ kind, prev, next, empties });
      return false;
    }
    const code = Number(mode);
    const merged = code ? await perform(code, prev, next, empties) : false;
    if (code) autoCount += 1;
    return merged;
  };

  let prevP = null;
  let empties = [];
  const inEpigraph = (ancestors) => ancestors[0]?.type === 'epigraph';
  const inCite = (ancestors) => ancestors[0]?.type === 'cite';

  const visit = async (node, ancestors) => {
    if (ctx.cancelled) return;
    if (node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type) || node.type === 'empty-line') {
      if (isEmptyBlock(node)) {
        empties.push(node);
        return;
      }
      if (prevP) {
        const { prevNode, prevAncestors } = prevP;
        const allowed = !(
          inEpigraph(prevAncestors) || inEpigraph(ancestors)
          || prevNode.type === 'text-author' || node.type === 'text-author'
          || (!modes.handle1Cite && inCite(prevAncestors)) || (!modes.handle2Cite && inCite(ancestors))
          || (!modes.handle1Subtitle && prevNode.type === 'subtitle') || (!modes.handle2Subtitle && node.type === 'subtitle')
        );
        if (allowed) {
          const target = resolve(prevNode);
          const { last, preLast, spaceBefore } = tailInfo(target);
          const { first, second } = headInfo(node);
          const between = empties;
          let wasReplace = false;
          let merged = false;
          const apply = async (kind) => {
            if (await decide(kind, target, node, between)) merged = true;
            wasReplace = true;
          };
          if (last === '-' && spaceBefore) await apply(4);
          else if (DASHES.test(last) && !spaceBefore) await apply(5);
          if (!wasReplace && last === ',') await apply(3);
          if (LOWER.test(first)) {
            if (!wasReplace && LOWER.test(last)) await apply(1);
            else if (!wasReplace && (last === '–' || last === '—') && spaceBefore) await apply(6);
          } else if (!wasReplace && last && NON_ENDING.test(last)
            && (!QUOTES.test(last) || !SENTENCE_END.test(preLast))
            && ((OPENERS.test(first) && CAPITAL_OR_DIGIT.test(second)) || CAPITAL_OR_DIGIT.test(first))
            && last !== ':' && last !== ';') {
            await apply(2);
          }
          // Class 7 (2.7.9): not a comma, and not a closing quote unless one of ?.!… precedes it.
          if (!wasReplace && last !== ',' && (!QUOTES.test(last) || SENTENCE_END.test(preLast))
            && ((OPENERS.test(first) && LOWER.test(second)) || LOWER.test(first))
            && !((last === ':' || last === ';') && DASH_OR_LAQUO.test(first))) {
            await apply(7);
          }
          if (merged) {
            // The second paragraph was appended to the first: the pair stays "previous".
            empties = [];
            return;
          }
        }
      }
      prevP = { prevNode: node, prevAncestors: ancestors };
      empties = [];
      return;
    }
    if (SKIP_CONTAINERS.has(node.type)) return;
    if (RESET_CONTAINERS.has(node.type)) prevP = null;
    for (const child of node.content ?? []) await visit(child, [node, ...ancestors]);
  };
  for (const body of snapshot.bodies ?? []) {
    prevP = null;
    await visit(body, []);
  }
  const autoTime = Date.now() - started;
  started = Date.now();

  /* ---- second dialog: the presumed breaks, one by one ---- */
  let manualCount = 0;
  const context = (node, fromEnd) => {
    const text = visibleText(node).replace(/\s+/g, ' ');
    return fromEnd ? (text.length > 80 ? `…${text.slice(-80)}` : text) : (text.length > 80 ? `${text.slice(0, 80)}…` : text);
  };
  for (let i = 0; i < pending.length; i += 1) {
    if (ctx.cancelled) break;
    const item = pending[i];
    const prev = resolve(item.prev);
    const spec = CASES[item.kind];
    try {
      await mfbe.selection.set({ nodeId: item.next.attrs.nodeId, offset: 0 });
      await mfbe.selection.scrollIntoView();
    } catch {
      // best effort
    }
    const answer = await mfbe.ui.form({
      title: L(`Предположительный разрыв ${i + 1} из ${pending.length}. Управляемое исправление разрывов абзацев ${VERSION}`, `Presumed break ${i + 1} of ${pending.length}. Guided repair of paragraph breaks ${VERSION}`),
      width: 640,
      fields: [
        { kind: 'static', id: 'kind', text: spec.label },
        { kind: 'static', id: 'before', text: `${L('Конец первого абзаца', 'End of the first paragraph')}:\n${context(prev, true)}` },
        { kind: 'static', id: 'after', text: `${L('Начало второго абзаца', 'Start of the second paragraph')}:\n${context(item.next, false)}` },
        { kind: 'radio', id: 'action', label: L('Вид обработки', 'Action'), options: spec.options, value: '0' },
      ],
      okLabel: L('Применить и дальше', 'Apply and continue'),
      cancelLabel: L('Прекратить', 'Stop'),
    });
    if (!answer) break;
    const code = Number(answer.action);
    if (!code) continue;
    await perform(code, prev, item.next, item.empties);
    manualCount += 1;
  }
  const manualTime = Date.now() - started;

  let msg = ru
    ? `Версия ${VERSION}.\nИсправление разрывов абзацев завершено.\nПроизведено автоматических слияний абзацев: ${autoCount}.\n`
    : `Version ${VERSION}.\nThe repair of paragraph breaks is finished.\nAutomatic joins of paragraphs made: ${autoCount}.\n`;
  if (pending.length) msg += ru ? `Подтвержденных вручную коррекций: ${manualCount}.\n` : `Corrections confirmed by hand: ${manualCount}.\n`;
  msg += ru ? `Время автоматической обработки: ${timeString(autoTime, true)}.\n` : `Time of the automatic processing: ${timeString(autoTime, false)}.\n`;
  if (pending.length) msg += ru ? `Время ручной обработки: ${timeString(manualTime, true)}.` : `Time of the processing by hand: ${timeString(manualTime, false)}.`;
  await mfbe.ui.message(msg, { caption: ctx.script.name, icon: 'info' });
}
