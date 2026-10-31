// Shared engine of «Символы win-1252, истолкованные как win-1251» (group 06, scripts 19 and 20),
// converted from the FictionBook Editor 2.7.9 scripts and their dialog (HTML/Символы win-1252,
// истолкованные как win-1251 - набор фреймов.html and its three frames, version 1.5). Text that was
// decoded as windows-1251 although it was windows-1252 shows up as Cyrillic letters glued to Latin
// ones ("cafй" for "café"). From the caret on, every such place is selected in the Body view and
// offered in a form with the recoded proposal (the cp1251 characters mapped to their cp1252
// counterparts); the user may replace it with the proposal or an own text, skip it, go there and
// stop, or (2.7.9) replace it and every later place with their proposals up to the end of the book.
// Each package's index.js keeps the notice of its own original (FR-029).

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
// cp1251 characters (0x80-0xFF) whose cp1252 counterpart differs, and those counterparts.
const RUS = "Ђѓ€ЉЊЋљњћџЎўЈҐЁЄЇІіґё№єјЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя";
const WIN = "€ƒˆŠŒŽšœžŸ¡¢£¥¨ª¯²³´¸¹º¼½¾¿ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ";
const RECODE = new Map([...RUS].map((ch, i) => [ch, WIN[i]]));
const IS_LETTER = new RegExp(`[a-zA-Z${RUS}]`);
const IS_RUS = new RegExp(`[${RUS}]`);
const IS_LATIN = /[a-zA-Z]/;
const WORD = new RegExp(`(?<![а-яёa-z])(?:[${RUS}A-Za-z]*[${RUS}][A-Za-z][${RUS}A-Za-z]*|[${RUS}A-Za-z]*[A-Za-z][${RUS}][${RUS}A-Za-z]*)`, 'gi');

export function recode(text) {
  return [...text].map((ch) => RECODE.get(ch) ?? ch).join('');
}

/** Runs that the original never looked into: footnote links, sub/superscripts. */
function isBarrier(run) {
  return run.type !== 'text' || (run.marks ?? []).some((m) => (m.type === 'link' && m.attrs?.type === 'note') || m.type === 'sub' || m.type === 'sup');
}

/** Plain text of a block with barrier runs blanked out (same length as the real text). */
function searchText(node) {
  return (node.content ?? []).map((run) => (run.type !== 'text' ? ' ' : isBarrier(run) ? ' '.repeat((run.text ?? '').length) : run.text ?? '')).join('');
}

function textBlocks(snapshot) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of snapshot.bodies ?? []) visit(body);
  return out;
}

/** Replaces [from, to) of the block's plain text in its content model (marks are kept). */
function replaceInContent(node, from, to, text) {
  const content = [];
  let pos = 0;
  let inserted = false;
  for (const run of node.content ?? []) {
    const length = run.type === 'text' ? (run.text ?? '').length : 1;
    const start = pos;
    const end = pos + length;
    pos = end;
    if (run.type !== 'text' || end <= from || start >= to) {
      if (run.type !== 'text' && start >= from && end <= to) continue; // image inside the range
      content.push(run);
      continue;
    }
    const head = run.text.slice(0, Math.max(0, from - start));
    const tail = run.text.slice(Math.min(length, to - start));
    const middle = !inserted && from >= start && from <= end ? text : '';
    inserted = inserted || middle !== '';
    const joined = head + middle + tail;
    if (joined) content.push({ ...run, text: joined });
  }
  if (!inserted && text) content.push({ type: 'text', text });
  node.content = content;
}

/** Next finding in `text` at or after `start`: { from, to } or null. */
function findLetters(text, start) {
  // Latin letters to the left inside the current word make the next Cyrillic letter suspicious.
  let engToTheLeft = false;
  for (let g = start - 1; g >= 0; g -= 1) {
    const ch = text[g];
    if (IS_LATIN.test(ch)) {
      engToTheLeft = true;
      break;
    }
    if (!IS_LETTER.test(ch)) break;
  }
  let flag = false;
  let firstRus = -1;
  for (let g = start; g < text.length; g += 1) {
    const ch = text[g];
    const isEng = IS_LATIN.test(ch);
    if (isEng) flag = true;
    if (!IS_LETTER.test(ch)) {
      flag = false;
      engToTheLeft = false;
      firstRus = -1;
    }
    const isRus = IS_RUS.test(ch);
    if (firstRus < 0 && isRus) firstRus = g;
    if ((flag && isRus) || (isEng && firstRus >= 0) || (engToTheLeft && isRus)) {
      const at = isEng && firstRus >= 0 ? firstRus : g;
      return { from: at, to: at + 1 };
    }
  }
  return null;
}

function findWords(text, start) {
  WORD.lastIndex = 0;
  let m;
  while ((m = WORD.exec(text))) {
    if (m.index >= start) return { from: m.index, to: m.index + m[0].length };
    if (m[0].length === 0) WORD.lastIndex += 1;
  }
  return null;
}

export async function win1252(ctx, { mode }) {
  const ru = ctx.uiLanguage === 'ru';
  const L = (r, e) => (ru ? r : e);
  const snapshot = await mfbe.doc.get();
  const blocks = textBlocks(snapshot);
  const selection = await mfbe.selection.get();
  // The search position: a block and an offset in its text, from the end of the selection.
  let b = 0;
  let start = 0;
  if (selection) {
    const index = blocks.findIndex((block) => block.attrs.nodeId === selection.head.nodeId);
    if (index >= 0) {
      b = index;
      start = Math.max(selection.anchor.nodeId === selection.head.nodeId ? selection.anchor.offset : 0, selection.head.offset);
    }
  }
  // 2.7.9's search for words starts one character before the caret (a word whose first letter is
  // right before it is found), the search for letters at the caret.
  if (mode === 'words') start = Math.max(0, start - 1);
  const find = mode === 'words' ? findWords : findLetters;
  /** The next place from the search position on: { node, id, text, hit } or null. */
  const next = () => {
    for (; b < blocks.length; b += 1, start = 0) {
      const node = blocks[b];
      const text = searchText(node);
      const hit = find(text, start);
      if (hit) return { node, id: node.attrs.nodeId, text, hit };
    }
    return null;
  };
  /** Replaces a place and moves the search position behind the replacement. */
  const replace = async (place, replacement) => {
    const { node, id, hit } = place;
    replaceInContent(node, hit.from, hit.to, replacement);
    await mfbe.doc.replaceNode({ nodeId: id, type: node.type }, { type: node.type, attrs: { ...node.attrs }, content: node.content });
    start = hit.from + replacement.length;
  };
  let found = 0;
  for (;;) {
    if (ctx.cancelled) return;
    const place = next();
    if (!place) break;
    const { id, text, hit } = place;
    found += 1;
    const original = text.slice(hit.from, hit.to);
    const proposal = recode(original);
    try {
      await mfbe.selection.set({ nodeId: id, offset: hit.from }, { nodeId: id, offset: hit.to });
      await mfbe.selection.scrollIntoView();
    } catch {
      // best effort
    }
    const shown = `${text.slice(Math.max(0, hit.from - 60), hit.from)}⟦${original}⟧${text.slice(hit.to, hit.to + 60)}`;
    const answer = await mfbe.ui.form({
      title: L('Символы win-1252, истолкованные как win-1251 v1.5 (скрипт Sclex’а)', 'win-1252 characters read as win-1251 v1.5 (script by Sclex)'),
      width: 560,
      fields: [
        { kind: 'static', id: 'ctx', text: shown },
        { kind: 'static', id: 'prop', text: L(`Найдено: ${original}   →   предлагается: ${proposal}`, `Found: ${original}   →   proposed: ${proposal}`) },
        { kind: 'radio', id: 'action', label: L('Действие', 'Action'), value: 'replace', options: [
          { value: 'replace', label: L('Заменить на текст из поля ниже', 'Replace with the text below') },
          { value: 'all', label: L('Заменить все от текущей позиции до конца документа', 'Replace all from the current place to the end of the document') },
          { value: 'skip', label: L('Пропустить', 'Skip') },
          { value: 'go', label: L('Перейти без замены (и закончить)', 'Go there without changes (and stop)') },
        ] },
        { kind: 'text', id: 'replacement', label: L('Заменить на:', 'Replace with:'), value: proposal },
        { kind: 'checkbox', id: 'goAfter', label: L('После замены перейти к этому месту', 'Go to this place after the change (and stop)'), value: false },
      ],
      okLabel: L('ОК', 'OK'),
      cancelLabel: L('Выйти', 'Exit'),
    });
    if (!answer) return;
    if (answer.action === 'go') {
      await mfbe.selection.set({ nodeId: id, offset: hit.from });
      return;
    }
    if (answer.action === 'all') {
      // 2.7.9's "Заменить все…": this place and every later one get their proposal (the text field
      // is not used); the message counts all of them, or says that nothing followed this place.
      await replace(place, proposal);
      let last = { id, from: hit.from, to: hit.from + proposal.length };
      let count = 1;
      for (;;) {
        if (ctx.cancelled) return;
        const more = next();
        if (!more) break;
        const recoded = recode(more.text.slice(more.hit.from, more.hit.to));
        await replace(more, recoded);
        last = { id: more.id, from: more.hit.from, to: more.hit.from + recoded.length };
        count += 1;
        if (count % 20 === 0) await mfbe.ui.progress(count);
      }
      try {
        await mfbe.selection.set({ nodeId: last.id, offset: last.from }, { nodeId: last.id, offset: last.to });
      } catch {
        // best effort
      }
      await mfbe.ui.message(
        count === 1
          ? L('От текущей позиции до конца документа больше ничего не найдено.', 'Nothing more was found from the current place to the end of the document.')
          : mode === 'words'
            ? L(`Произведены автоматические замены в таком количестве слов: ${count}.`, `Automatic replacements were made in this number of words: ${count}.`)
            : L(`Произведены автоматические замены такого количества букв: ${count}.`, `Automatic replacements were made for this number of letters: ${count}.`),
        { caption: ctx.script.name, icon: 'info' },
      );
      return;
    }
    if (answer.action === 'replace') {
      const replacement = String(answer.replacement ?? '');
      if (replacement === '' && (await MsgBox(L('Подтверждаете замену на пустую строку (на ничего)?', 'Replace with an empty string (delete)?'), ctx.script.name, 4 + 32)) !== 6) {
        start = hit.to;
        continue;
      }
      await replace(place, replacement);
      if (answer.goAfter) {
        await mfbe.selection.set({ nodeId: id, offset: hit.from }, { nodeId: id, offset: hit.from + replacement.length });
        return;
      }
    } else {
      start = hit.to;
    }
  }
  await mfbe.ui.message(
    found === 0
      ? L('Искомых сочетаний символов от позиции курсора не найдено.', 'No such combination of characters was found after the caret.')
      : L('Больше ничего найти не удалось.', 'Nothing more could be found.'),
    { caption: ctx.script.name, icon: 'info' },
  );
}
