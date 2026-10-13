// Converted from 06_Чистка/06_Управляемое исправление разрывов абзацев....js (FictionBook
// Editor) - interactive repair of paragraphs broken by a scan/convert: pairs of consecutive
// paragraphs are classified by the last character of the first one and the first character of
// the second one (hyphen with a space before it, dash, comma, lower-case letter, no final
// punctuation...). For every class the user chooses in the first form either an automatic
// action or "manual": manual cases are then shown one by one (the original listed them in a
// second HTML dialog) with the end of the first and the start of the second paragraph.
//
// Actions: 1 join with a space, 2 add a full stop, 3 full stop instead of the comma, 4/5 join
// with an en/em dash and a space instead of the hyphen, 6 join removing the hyphen/dash,
// 7 join with a hyphen (dash -> hyphen, no space), 8 join without a space removing the hyphen,
// 9 join with ":" and a space, 10 add ":". Empty lines between the two paragraphs disappear
// when they are joined. Titles, tables, poems, epigraphs, annotations and text-author lines
// are never touched; cites and subtitles only when enabled in the form.

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const SKIP_CONTAINERS = new Set(['title', 'table', 'annotation', 'poem']);
const RESET_CONTAINERS = new Set(['section', 'annotation', 'poem']);
const SPACE = /[ \u00A0)]/; // the legacy "space" set skipped a closing parenthesis too
const LOWER = /[а-яёa-z]/;
const OPENERS = /[«(\["=–—]/;
const CAPITAL_OR_DIGIT = /[А-ЯA-ZЁ\d]/;
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

function isEmptyBlock(node) {
  if (node.type === 'empty-line') return true;
  return TEXT_BLOCK_TYPES.has(node.type) && /^[ \u00A0]*$/.test(allText(node));
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
    const text = run.text.replace(/[ \u00A0]+$/, '');
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
    const text = run.text.replace(/^[ \u00A0]+/, '');
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

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const L = (r, e) => (ru ? r : e);
  const manual = { value: 'manual', label: L('Ручной выбор', 'Ask me') };
  const action = (code, r, e) => ({ value: String(code), label: L(r, e) });
  const LEAVE = action(0, 'Не трогать', 'Leave as it is');
  const JOIN_SPACE = action(1, 'Соединить через пробел', 'Join with a space');
  const JOIN_NO_SPACE = action(8, 'Соединить без пробела', 'Join without a space');
  const JOIN_COLON = action(9, 'Соединить через ":" и пробел', 'Join with ":" and a space');
  const ADD_COLON = action(10, 'Добавить ":"', 'Add ":"');
  // Options of every class, as in the first and the second legacy dialog.
  const CASES = {
    4: { label: L('Дефис, перед которым пробел  →  любой символ', 'Hyphen with a space before it  →  any character'),
      options: [LEAVE, action(4, 'Соединить через короткое тире и пробел', 'Join with an en dash and a space'), action(5, 'Соединить через длинное тире и пробел', 'Join with an em dash and a space'), action(8, 'Соединить, удалив дефис', 'Join removing the hyphen')] },
    5: { label: L('Тире или дефис после непробельного символа  →  любой символ', 'Dash or hyphen after a non-space character  →  any character'),
      options: [LEAVE, action(6, 'Соединить, удалив дефис', 'Join removing the hyphen'), action(7, 'Соединить через дефис без пробела', 'Join with a hyphen, no space'), action(8, 'Соединить без пробела, сохранив тире/дефис', 'Join without a space, keeping the dash/hyphen')] },
    3: { label: L('Запятая  →  любой символ', 'Comma  →  any character'),
      options: [LEAVE, JOIN_SPACE, action(3, 'Точку вместо запятой', 'Full stop instead of the comma')] },
    1: { label: L('Маленькая буква  →  маленькая буква', 'Lower-case letter  →  lower-case letter'),
      options: [LEAVE, JOIN_SPACE, JOIN_NO_SPACE, JOIN_COLON, ADD_COLON] },
    6: { label: L('Тире, перед которым пробел  →  маленькая буква', 'Dash with a space before it  →  lower-case letter'),
      options: [LEAVE, JOIN_SPACE, JOIN_NO_SPACE] },
    7: { label: L('Не запятая и не закрывающая кавычка (или кавычка после ?!.…)  →  маленькая буква (или «"(–[=— и маленькая буква)', 'Not a comma nor a closing quote (or a quote after ?!.…)  →  lower-case letter (or «"(–[=— and a lower-case letter)'),
      options: [LEAVE, JOIN_SPACE, JOIN_NO_SPACE] },
    2: { label: L('Символ, не характерный для конца строки (не , " : ;)  →  большая буква или цифра (или «"(–[=— и большая буква/цифра)', 'A character unusual at a line end (not , " : ;)  →  capital or digit (or «"(–[=— and a capital/digit)'),
      options: [LEAVE, JOIN_SPACE, action(2, 'Добавить точку', 'Add a full stop'), JOIN_COLON, ADD_COLON] },
  };

  /* ---- first dialog: modes ---- */
  const modes = await mfbe.ui.form({
    title: L('Выбор режимов обработки', 'Processing modes'),
    width: 640,
    fields: [
      { kind: 'static', id: 'h1', text: L('Что обрабатывать помимо обычных абзацев', 'Besides ordinary paragraphs also handle') },
      { kind: 'checkbox', id: 'handle1Cite', label: L('Первый абзац в цитате', 'First paragraph inside a cite'), value: true },
      { kind: 'checkbox', id: 'handle2Cite', label: L('Второй абзац в цитате', 'Second paragraph inside a cite'), value: true },
      { kind: 'checkbox', id: 'handle1Subtitle', label: L('Первый абзац — подзаголовок', 'First paragraph is a subtitle'), value: false },
      { kind: 'checkbox', id: 'handle2Subtitle', label: L('Второй абзац — подзаголовок', 'Second paragraph is a subtitle'), value: false },
      { kind: 'static', id: 'h2', text: L('Выберите режим обработки для каждого вида разрыва (конец первого абзаца → начало второго)', 'Choose how each kind of break is handled (end of the first paragraph → start of the second)') },
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
    const join = async (space) => {
      trimRight(content);
      const tail = cloneContent(next);
      trimLeft(tail);
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
        trimRight(content);
        return join(false);
      case 7:
        trimRight(content);
        editLastText(content, (t) => t.replace(/[-–—]$/, '-'));
        return join(false);
      case 8:
        trimRight(content);
        editLastText(content, (t) => t.replace(/[-–—]$/, ''));
        return join(false);
      case 9:
        trimRight(content);
        editLastText(content, (t) => `${t}:`);
        return join(true);
      case 10:
        trimRight(content);
        editLastText(content, (t) => `${t}:`);
        break;
      default:
        return false;
    }
    prev.content = content;
    await write(prev);
    return false;
  };

  /**
   * Automatic action or manual collection for a classified pair. Returns the legacy
   * `wasReplace` flag (true after any automatic action, even "leave as it is", and after the
   * manual collection of the classes that set it) and whether the pair was merged.
   */
  const decide = async (kind, prev, next, empties, manualSetsFlag) => {
    const mode = modes[`case${kind}`];
    if (mode === 'manual') {
      pending.push({ kind, prev, next, empties });
      return { flag: manualSetsFlag, merged: false };
    }
    const code = Number(mode);
    const merged = code ? await perform(code, prev, next, empties) : false;
    if (code) autoCount += 1;
    return { flag: true, merged };
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
          const apply = async (kind, manualSetsFlag) => {
            const result = await decide(kind, target, node, between, manualSetsFlag);
            if (result.flag) wasReplace = true;
            if (result.merged) merged = true;
          };
          if (last === '-' && spaceBefore) await apply(4, true);
          else if (DASHES.test(last) && !spaceBefore) await apply(5, true);
          if (!wasReplace && last === ',') await apply(3, false);
          const quoteOk = !QUOTES.test(last) || !SENTENCE_END.test(preLast);
          if (LOWER.test(first)) {
            if (!wasReplace && LOWER.test(last)) await apply(1, true);
            else if (!wasReplace && (last === '–' || last === '—') && spaceBefore) await apply(6, true);
          } else if (!wasReplace && last && NON_ENDING.test(last) && quoteOk
            && ((OPENERS.test(first) && CAPITAL_OR_DIGIT.test(second)) || CAPITAL_OR_DIGIT.test(first))
            && last !== ':' && last !== ';') {
            await apply(2, false);
          }
          if (!wasReplace && last !== ',' && quoteOk
            && ((OPENERS.test(first) && LOWER.test(second)) || LOWER.test(first))
            && !((last === ':' || last === ';') && DASH_OR_LAQUO.test(first))) {
            await apply(7, false);
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

  /* ---- second dialog: the disputed places, one by one ---- */
  let manualCount = 0;
  const context = (node, fromEnd) => {
    const text = visibleText(node).replace(/\s+/g, ' ');
    return fromEnd ? (text.length > 80 ? `…${text.slice(-80)}` : text) : (text.length > 80 ? `${text.slice(0, 80)}…` : text);
  };
  for (let i = 0; i < pending.length; i += 1) {
    if (ctx.cancelled) break;
    const item = pending[i];
    const prev = resolve(item.prev);
    const defaultCode = modes[`case${item.kind}`] === 'manual' ? '0' : modes[`case${item.kind}`];
    // A class-7 place was offered the class-1 actions in the legacy dialog.
    const spec = { label: CASES[item.kind].label, options: CASES[item.kind === 7 ? 1 : item.kind].options };
    try {
      await mfbe.selection.set({ nodeId: item.next.attrs.nodeId, offset: 0 });
      await mfbe.selection.scrollIntoView();
    } catch {
      // best effort
    }
    const answer = await mfbe.ui.form({
      title: L(`Спорное место ${i + 1} из ${pending.length}`, `Disputed place ${i + 1} of ${pending.length}`),
      width: 640,
      fields: [
        { kind: 'static', id: 'kind', text: spec.label },
        { kind: 'static', id: 'before', text: `${L('Конец первого абзаца', 'End of the first paragraph')}:\n${context(prev, true)}` },
        { kind: 'static', id: 'after', text: `${L('Начало второго абзаца', 'Start of the second paragraph')}:\n${context(item.next, false)}` },
        { kind: 'radio', id: 'action', label: L('Действие', 'Action'), options: spec.options, value: String(defaultCode) },
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

  const seconds = Math.ceil(((Date.now() - started) / 1000) * 10) / 10;
  let msg = ru
    ? `Ликвидация разрывов абзацев завершена.\nАвтоматических слияний абзацев: ${autoCount}.\n`
    : `Paragraph breaks processed.\nAutomatic corrections: ${autoCount}.\n`;
  if (pending.length) msg += ru ? `Подтвержденных вручную коррекций: ${manualCount} из ${pending.length}.\n` : `Manually confirmed corrections: ${manualCount} of ${pending.length}.\n`;
  msg += ru ? `Время обработки: ${seconds} с.` : `Time: ${seconds} s.`;
  await mfbe.ui.message(msg, { caption: ctx.script.name, icon: 'info' });
}
