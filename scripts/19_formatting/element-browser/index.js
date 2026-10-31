// Converted from FictionBook Editor 2.7.9: Scripts/19_Обработка форматирования/01_Обзор и
// превращение элементов....js, with its dialog HTML/Обзор и превращение элементов - набор
// фреймов.html (frames 1-3); first converted from the 2.7beta1 version (v1.8), brought up to the
// 2.7.9 one (v4.2) in feature 007.
//
// The dialog lists all elements of one kind - the title lines of sections, the subtitles or the
// runs of italics, bold, superscript, subscript or strikethrough of the book - and reformats the
// chosen ones: section title lines as subtitles, as subtitles framed by empty lines (2.7.9's new
// default) or as text; subtitles as titles or text; one inline style as another or as text. Its
// context menu changes the case of title lines and subtitles in ten ways (2.7.9; 2.7beta1 had
// three). The original's dialog stayed open; here it is a loop of two forms: the kind, then the
// numbered list (up to 160 characters of each element, then "<...>", as 2.7.9 shows them) with the
// action to apply - the list is rebuilt after every action until the user closes it.
//
// What a title becomes is worked out as 2.7.9 did it, on a copy of the body in the shape of its
// page (page.js, the original's procedures statement by statement): a section whose whole title
// becomes subtitles or text merges into the section before it, its epigraphs and annotation
// becoming text and its subsections moving up; selected lines at the start of a title go to the
// end of the section before; unselected lines between selected ones become the title of a new
// section; "framed by empty lines" puts an empty line before and after each group of subtitles,
// using the empty lines already there. The case changes run the original's expressions
// (case-modes.js). Differences from 2.7.9 (docs/scripting/conversion-notes of feature 007):
//  - the list is a form field: plain text without the original's formatting and link tooltips,
//    no "selected" counter, no Ctrl+A; a click no longer shows the element in the book; Undo and
//    Redo are Edit > Undo after the run (the run is one undo step); "Выполнено." after a case
//    change and the counts are a status-bar line;
//  - three defects are fixed (FR-023, page.js FIX 1-3): lines moved to a previous section ending
//    with empty lines were lost and the script stopped; empty lines framed an insertion of
//    nothing; merging a section of nothing but subtitles stopped with a script error;
//  - the "N-th word" number is read as a decimal number (JScript's eval read "010" as octal 8);
//  - where FB2 allows a subtitle's preceding content nowhere at the end of the previous container
//    (after subsections, an epigraph), it goes to a new container as in 2.7beta1; a subtitle of a
//    section's annotation stays a subtitle; an edit the schema still refuses is reported and its
//    body left as it was, instead of producing an invalid book.
// The original's notice, kept as written (FR-029):
// Скрипт "Обзор и превращение элементов"
// Автор Sclex
// Сайт скриптов: http://scripts.fictionbook.org

import { toBox, toJson, reformatTitles, reformatSubtitles } from './page.js';
import { changeCaseOfContent, CASE_MODES } from './case-modes.js';

const VERSION = '4.2';
const INLINE_KINDS = ['emphasis', 'strong', 'sup', 'sub', 'strikethrough'];
const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const MAX_LABEL = 160; // maxNumberOfTextSymbolsInElement

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const nodeId = (node) => node.attrs?.nodeId;

function inlineText(node) {
  if (node.type === 'text') return node.text;
  return (node.content ?? []).map(inlineText).join('');
}

/** The list label 2.7.9 built: only spaces -> " "; over 160 characters -> 160 and "<...>". */
function preview(text) {
  if (/^[ \u00A0]*$/.test(text)) return ' ';
  return text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL)}<...>` : text;
}

/* ---------------------------------------------------------------------------------------- */
/* Scanning (findBlockElements, findParagraphElements, findInlineElements)                    */
/* ---------------------------------------------------------------------------------------- */

/** Elements of `kind` in document order. */
async function scan(kind) {
  const found = [];
  const visit = (node, path, inSection) => {
    if (node.type === 'text') return;
    const parent = path[path.length - 1];
    if (kind === 'titles') {
      // 2.7.9 lists the titles of sections only ("titles of sections"; those of poems and
      // stanzas are commented out of its list of kinds)
      if (node.type === 'title' && inSection && parent && parent.type === 'section') {
        (node.content ?? []).forEach((line, index) => {
          found.push({ kind, key: `${nodeId(node)}:${index}`, text: preview(inlineText(line)), titleId: nodeId(node), index });
        });
        return;
      }
    } else if (kind === 'subtitles') {
      if (node.type === 'subtitle' && inSection) {
        found.push({ kind, key: nodeId(node), text: preview(inlineText(node)), nodeId: nodeId(node), parentType: parent?.type });
      }
    } else if (TEXT_BLOCKS.has(node.type) && inSection) {
      const content = node.content ?? [];
      let i = 0;
      while (i < content.length) {
        const has = (item) => item.type === 'text' && (item.marks ?? []).some((m) => m.type === kind);
        if (!has(content[i])) {
          i += 1;
          continue;
        }
        let j = i;
        while (j < content.length && has(content[j])) j += 1;
        found.push({
          kind, key: `${nodeId(node)}:${i}:${j}`, blockId: nodeId(node), start: i, end: j,
          text: preview(content.slice(i, j).map((c) => c.text).join('')),
        });
        i = j;
      }
      return;
    }
    const next = [...path, node];
    for (const child of node.content ?? []) visit(child, next, inSection || node.type === 'section');
  };
  for (const body of await mfbe.doc.getElementsByTagName('body')) visit(await mfbe.doc.getNode(body), [], false);
  return found;
}

/* ---------------------------------------------------------------------------------------- */
/* Titles and subtitles: on a copy of the bodies in the shape of 2.7.9's page                  */
/* ---------------------------------------------------------------------------------------- */

/** Every body as a Box tree with the map of its node ids. */
async function loadBodies() {
  const bodies = [];
  const byId = new Map();
  for (const ref of await mfbe.doc.getElementsByTagName('body')) {
    const node = await mfbe.doc.getNode(ref);
    bodies.push({ ref, before: JSON.stringify(node), box: toBox(node, byId) });
  }
  return { bodies, byId };
}

/** Writes the bodies that changed; a body the schema refuses stays as it was (reported). */
async function writeBodies(bodies, report) {
  for (const body of bodies) {
    const node = toJson(body.box);
    if (JSON.stringify(node) === body.before) continue;
    try {
      await mfbe.doc.replaceNode(body.ref, node);
    } catch (error) {
      report.push(error.message);
    }
  }
}

async function titlesTo(elements, target, report) {
  const { bodies, byId } = await loadBodies();
  const lines = elements.map((el) => byId.get(el.titleId)?.kids[el.index]).filter(Boolean);
  reformatTitles(lines, target);
  await writeBodies(bodies, report);
}

async function subtitlesToTitles(ctx, elements, report) {
  const { bodies, byId } = await loadBodies();
  const subtitles = elements.map((el) => byId.get(el.nodeId)).filter(Boolean);
  const inCite = reformatSubtitles(subtitles);
  await writeBodies(bodies, report);
  if (inCite) {
    await mfbe.ui.message(
      t(ctx, 'Среди выделенных подзаголовков имелись подзаголовки, вложенные в цитаты. Они не были превращены в заголовки в процессе обработки, потому что согласно схеме формата FictionBook2 у цитат не может быть заголовков.',
        'Some of the selected subtitles are nested in cites. They were not turned into titles, because by the FictionBook2 schema cites cannot have titles.'),
      { icon: 'warning' },
    );
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Subtitles -> text, inline runs -> another mark / text (unchanged since 2.7beta1)            */
/* ---------------------------------------------------------------------------------------- */

async function subtitlesToText(elements, report) {
  for (const el of elements) {
    try {
      const node = await mfbe.doc.getNode(el.nodeId);
      const attrs = { ...(node.attrs ?? {}) };
      if (el.parentType === 'poem') {
        // A subtitle between stanzas becomes a one-verse stanza (an empty-class <P> in a poem).
        await mfbe.doc.replaceNode(el.nodeId, {
          type: 'stanza', attrs: {}, content: [{ type: 'v', attrs: {}, content: node.content ?? [] }],
        });
      } else {
        await mfbe.doc.replaceNode(el.nodeId, { ...node, type: el.parentType === 'stanza' ? 'v' : 'p', attrs });
      }
    } catch (error) {
      report.push(error.message);
    }
  }
}

async function reformatInline(elements, from, to, report) {
  const byBlock = new Map();
  for (const el of elements) {
    if (!byBlock.has(el.blockId)) byBlock.set(el.blockId, []);
    byBlock.get(el.blockId).push(el);
  }
  for (const [blockId, runs] of byBlock) {
    try {
      const block = await mfbe.doc.getNode(blockId);
      const content = block.content.map((item, index) => {
        if (item.type !== 'text' || !runs.some((r) => index >= r.start && index < r.end)) return item;
        const marks = (item.marks ?? []).filter((m) => m.type !== from && m.type !== to);
        if (to !== 'text') marks.push({ type: to });
        return marks.length ? { ...item, marks } : { type: 'text', text: item.text };
      });
      await mfbe.doc.replaceNode(blockId, { ...block, content });
    } catch (error) {
      report.push(error.message);
    }
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Case (the context menu of titles and subtitles)                                            */
/* ---------------------------------------------------------------------------------------- */

/** The word number of "N-ное «слово»…": a number from 1, or null after the original's message. */
async function askWordNumber(ctx) {
  const value = await mfbe.ui.prompt(
    t(ctx, 'Введите номер «слова» для перевода в верхний регистр:', 'Enter the number of the “word” to put in upper case:'),
    { defaultValue: '2' },
  );
  if (value === null || value === undefined) return null;
  let problem = null;
  if (value === '') {
    problem = t(ctx, 'Вы ввели не корректный номер слова, а пустую строку. Изменение регистра не будет произведено.',
      'You entered an empty string, not a word number. The case is not changed.');
  } else if (!/^[0-9]+$/.test(value)) {
    problem = t(ctx, 'Введенный вами номер «слова» содержит недопустимые символы. Изменение регистра не будет произведено.',
      'The “word” number you entered contains characters that are not allowed. The case is not changed.');
  } else if (Number.parseInt(value, 10) < 1) {
    problem = t(ctx, 'Вы ввели некорректное значение номера «слова». Изменение регистра не будет произведено.',
      'The “word” number you entered is not valid. The case is not changed.');
  }
  if (problem) {
    await mfbe.ui.message(problem, { icon: 'warning' });
    return null;
  }
  return Number.parseInt(value, 10);
}

async function applyCase(elements, mode, number, report) {
  for (const el of elements) {
    try {
      if (el.kind === 'titles') {
        const title = await mfbe.doc.getNode(el.titleId);
        const line = title.content[el.index];
        if (!line?.content) continue;
        await mfbe.doc.replaceNode(nodeId(line), { ...line, content: changeCaseOfContent(line.content, mode, number) });
      } else {
        const node = await mfbe.doc.getNode(el.nodeId);
        await mfbe.doc.replaceNode(el.nodeId, { ...node, content: changeCaseOfContent(node.content ?? [], mode, number) });
      }
    } catch (error) {
      report.push(error.message);
    }
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Dialogs                                                                                   */
/* ---------------------------------------------------------------------------------------- */

// frame 1's list of kinds (2.7.9 labels)
const KINDS = [
  ['titles', 'Заголовки разделов', 'Section titles'],
  ['subtitles', 'Подзаголовки', 'Subtitles'],
  ['emphasis', 'Курсив', 'Italics'],
  ['strong', 'Жирность', 'Bold'],
  ['sup', 'Верхние индексы', 'Superscripts'],
  ['sub', 'Нижние индексы', 'Subscripts'],
  ['strikethrough', 'Зачеркивание', 'Strikethrough'],
];
const KIND_LABEL = Object.fromEntries(KINDS.map(([value, ru, en]) => [value, [ru, en]]));

// frame 3's "Переформатировать выбранные элементы как" (2.7.9 labels)
const TARGETS = {
  subtitles: ['Подзаголовки', 'Subtitles'],
  subtitlesWithEmptyLines: ['Подзаголовки, обрамленные пустыми строками', 'Subtitles framed by empty lines'],
  text: ['Текст', 'Text'],
  titles: ['Заголовки', 'Titles'],
  ...KIND_LABEL,
};

// the context menu of titles and subtitles (2.7.9 texts)
const CASE_LABELS = {
  onlyFirstBig: ['Первая буква большая, остальные маленькие', 'First letter upper case, the rest lower case'],
  firstBigAndAfterFirstDotBig: ['Первая буква большая, и после первой точки большая буква', 'First letter upper case, and the letter after the first full stop'],
  firstLetterBigAndAfterEveryDotBigToo: ['Первая буква большая, и после каждой точки большая буква', 'First letter upper case, and the letter after every full stop'],
  firstLetterBigAndAfterSymbolsBigToo: ['Первая буква большая, и после символов «.», «!», «?» – большая буква', 'First letter upper case, and the letter after «.», «!», «?»'],
  secondWordBigLetters: ['Второе «слово» каждого элемента – большими буквами', 'The second “word” of every element in capitals'],
  nthWordBigLetters: ['N-ное «слово» каждого элемента – большими буквами…', 'The N-th “word” of every element in capitals…'],
  allBig: ['Все буквы сделать большими', 'All letters upper case'],
  allSmall: ['Все буквы сделать маленькими', 'All letters lower case'],
  wordFirstLetterBig: ['Первую букву каждого слова сделать большой, остальные – маленькими', 'First letter of every word upper case, the rest lower case'],
  wordFirstLetterBigWithExclusions: ['Первую букву каждого слова (кроме исключений) сделать большой, остальные – маленькими', 'First letter of every word (but the exceptions) upper case, the rest lower case'],
};

function targetsFor(kind) {
  if (kind === 'titles') return ['subtitles', 'subtitlesWithEmptyLines', 'text'];
  if (kind === 'subtitles') return ['titles', 'text'];
  return ['text', ...INLINE_KINDS.filter((other) => other !== kind)];
}

/** The action selected when a kind is shown (2.7.9's changingOfSelect). */
function defaultAction(kind, previous) {
  if (previous === 'text') return 'text';
  if (kind === 'titles') return 'subtitlesWithEmptyLines';
  if (kind === 'subtitles') return 'titles';
  return INLINE_KINDS.includes(previous) && previous !== kind ? previous : 'text';
}

function actionsFor(ctx, kind) {
  const out = targetsFor(kind).map((value) => ({
    value,
    label: t(ctx, `Переформатировать как: ${TARGETS[value][0]}`, `Reformat as: ${TARGETS[value][1]}`),
  }));
  if (kind === 'titles' || kind === 'subtitles') {
    for (const mode of CASE_MODES) {
      out.push({ value: `case:${mode}`, label: t(ctx, `Регистр: ${CASE_LABELS[mode][0]}`, `Case: ${CASE_LABELS[mode][1]}`) });
    }
  }
  out.push({ value: 'kind', label: t(ctx, 'Показать другой тип элементов…', 'Show another kind of elements…') });
  return out;
}

export default async function run(ctx) {
  const title = t(ctx, `Обзор и превращение элементов v${VERSION} (скрипт Sclex’а)`, `Browse and convert elements v${VERSION} (script by Sclex)`);
  let kind = null;
  let action = null;
  for (;;) {
    if (!kind) {
      const choice = await mfbe.ui.form({
        title,
        width: 520,
        fields: [
          {
            kind: 'select', id: 'kind', label: t(ctx, 'Отобразить', 'Show'), value: 'titles',
            options: KINDS.map(([value, ru, en]) => ({ value, label: t(ctx, ru, en) })),
          },
        ],
        okLabel: t(ctx, 'Выполнить', 'Run'),
      });
      if (!choice) return;
      kind = String(choice.kind);
      action = defaultAction(kind, action);
    }
    const elements = await scan(kind);
    const actions = actionsFor(ctx, kind);
    if (!actions.some((a) => a.value === action)) action = defaultAction(kind, null);
    const values = await mfbe.ui.form({
      title: `${title}: ${t(ctx, KIND_LABEL[kind][0], KIND_LABEL[kind][1])}`,
      width: 560,
      fields: [
        { kind: 'static', id: 'count', text: t(ctx, `Всего: ${elements.length}`, `In all: ${elements.length}`) },
        {
          kind: 'list', id: 'items', label: t(ctx, 'Элементы (выберите один или несколько)', 'Elements (select one or more)'),
          multiple: true, value: [],
          options: elements.map((el, i) => ({ value: el.key, label: `${i + 1}. ${el.text}` })),
        },
        { kind: 'select', id: 'action', label: t(ctx, 'Действие', 'Action'), options: actions, value: action },
      ],
      okLabel: t(ctx, 'Выполнить', 'Run'),
      cancelLabel: t(ctx, 'Закрыть', 'Close'),
    });
    if (!values) return;
    action = String(values.action);
    if (action === 'kind') {
      kind = null;
      action = null;
      continue;
    }
    const chosen = new Set(Array.isArray(values.items) ? values.items : values.items ? [values.items] : []);
    const picked = elements.filter((el) => chosen.has(el.key));
    if (!picked.length) {
      await mfbe.ui.message(t(ctx, 'Не выбран ни один элемент.', 'No element is selected.'), { icon: 'warning' });
      continue;
    }
    const report = [];
    if (action.startsWith('case:')) {
      const mode = action.slice(5);
      const number = mode === 'nthWordBigLetters' ? await askWordNumber(ctx) : undefined;
      if (number === null) continue;
      await applyCase(picked, mode, number, report);
    } else if (kind === 'titles') {
      const target = { subtitles: 'subtitle', subtitlesWithEmptyLines: 'subtitles with empty lines before and after', text: 'p' }[action];
      await titlesTo(picked, target, report);
    } else if (kind === 'subtitles' && action === 'text') await subtitlesToText(picked, report);
    else if (kind === 'subtitles' && action === 'titles') await subtitlesToTitles(ctx, picked, report);
    else await reformatInline(picked, kind, action, report);
    if (report.length) {
      await mfbe.ui.message(
        t(ctx, 'Часть элементов не удалось преобразовать (структура FB2 не позволяет):\n', 'Some elements could not be converted (the FB2 structure does not allow it):\n') +
          [...new Set(report)].join('\n'),
        { icon: 'warning' },
      );
    }
    await mfbe.ui.status(t(ctx, `Обработано элементов: ${picked.length}`, `Elements processed: ${picked.length}`), { sticky: true });
  }
}
