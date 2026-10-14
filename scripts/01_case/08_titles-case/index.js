// Converted from 01_Регистр/08_Регистр заголовков и подзаголовков....js (FictionBook Editor 2.7),
// Tier 3: the HTML dialog "Регистр заголовков - набор фреймов.html" listed the titles and
// subtitles of the book and let the user flip the case of single characters or of a dragged range.
// A declarative form cannot offer per-character editing, so the conversion is: (1) choose which
// titles/subtitles to list (the dialog's five checkboxes), (2) tick the elements to change and
// pick the operation - upper or lower case (the dialog's context menu) plus the two usual title
// styles, Sentence case and Capitalised Words.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//скрипт "Регистр заголовков и подзаголовков"
//автор Sclex
//сайт скриптов: http://scripts.fictionbook.org
import { LETTERS, capitalize, t } from './case-lib.js';

const WORDS = new RegExp(`[${LETTERS}]+`, 'gi');
const LAST_IS_LETTER = new RegExp(`[${LETTERS}]$`, 'i');
const LETTER = new RegExp(`[${LETTERS}]`, 'i');
const STRUCTURAL = new Set(['poem', 'section', 'body', 'cite', 'stanza']);

function textOf(block) {
  return (block.content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
}

/** Collects the title paragraphs and subtitles selected by the filters, in document order. */
function collect(doc, filters) {
  const items = [];
  const visit = (node, ancestors) => {
    if (node.type === 'text') return;
    if (node.type === 'title') {
      const parent = ancestors[ancestors.length - 1]?.type;
      const wanted =
        ((parent === 'body' || parent === 'section') && filters.bodySectionTitles) ||
        ((parent === 'poem' || parent === 'stanza') && filters.poemTitles);
      if (wanted) {
        for (const p of node.content ?? []) {
          if (p.type === 'p') items.push({ kind: 'title', node: p });
        }
      }
      return;
    }
    if (node.type === 'subtitle') {
      const structural = [...ancestors].reverse().find((a) => STRUCTURAL.has(a.type))?.type;
      const wanted =
        (structural === 'section' && filters.sectionSubtitles) ||
        ((structural === 'cite' || structural === 'poem' || structural === 'stanza') &&
          filters.poemSubtitles);
      if (wanted) items.push({ kind: 'subtitle', node });
      return;
    }
    for (const child of node.content ?? []) visit(child, [...ancestors, node]);
  };
  for (const body of doc.bodies) {
    const name = body.attrs?.name;
    if ((name === 'notes' || name === 'comments') && !filters.noteBodies) continue;
    visit(body, []);
  }
  return items;
}

/** Applies the chosen case operation to every text run of a block, keeping the marks. */
function applyCase(block, operation) {
  const state = { first: true, lastSymbolLetter: false };
  const content = (block.content ?? []).map((child) => {
    if (child.type !== 'text') return child;
    let text;
    switch (operation) {
      case 'upper':
        text = child.text.toUpperCase();
        break;
      case 'lower':
        text = child.text.toLowerCase();
        break;
      case 'sentence': {
        const first = child.text.search(LETTER);
        if (!state.first || first < 0) text = child.text.toLowerCase();
        else {
          state.first = false;
          text = child.text.slice(0, first + 1).toUpperCase() + child.text.slice(first + 1).toLowerCase();
        }
        break;
      }
      default:
        text = child.text.replace(WORDS, (word, offset) => {
          if (state.lastSymbolLetter && offset === 0) return word.toLowerCase();
          return capitalize(word);
        });
        state.lastSymbolLetter = LAST_IS_LETTER.test(text);
    }
    return { ...child, text };
  });
  return { ...block, content };
}

export default async function run(ctx) {
  const filters = await mfbe.ui.form({
    title: t(ctx, 'Регистр заголовков и подзаголовков v1.6 (скрипт Sclex’а)', 'Case of titles and subtitles v1.6 (script by Sclex)'),
    fields: [
      { kind: 'static', id: 'help', text: t(ctx, 'Вначале выберите, что показывать.', 'First choose what to list.') },
      { kind: 'checkbox', id: 'bodySectionTitles', label: t(ctx, 'заголовки body и section', 'body and section titles'), value: true },
      { kind: 'checkbox', id: 'poemTitles', label: t(ctx, 'заголовки poem и stanza', 'poem and stanza titles'), value: false },
      { kind: 'checkbox', id: 'sectionSubtitles', label: t(ctx, 'подзаголовки в section', 'section subtitles'), value: true },
      { kind: 'checkbox', id: 'poemSubtitles', label: t(ctx, 'подзаголовки в poem, stanza и cite', 'poem, stanza and cite subtitles'), value: false },
      { kind: 'checkbox', id: 'noteBodies', label: t(ctx, 'также в body примечаний и комментариев', 'in notes and comments bodies too'), value: false },
    ],
    okLabel: t(ctx, 'Отобразить', 'Show'),
  });
  if (!filters) return;

  const doc = await mfbe.doc.get();
  const items = collect(doc, filters);
  if (items.length === 0) {
    await mfbe.ui.message(t(ctx, 'Ничего не найдено.', 'Nothing found.'));
    return;
  }
  const options = items.map(({ kind, node }) => {
    const text = textOf(node).replace(/\s+/g, ' ').trim();
    const label = text.length > 100 ? `${text.slice(0, 100)}…` : text || '(пусто)';
    return { value: String(node.attrs.nodeId), label: `${kind === 'title' ? 'T' : 'S'}: ${label}` };
  });
  const choice = await mfbe.ui.form({
    title: t(ctx, 'Регистр заголовков и подзаголовков v1.6 (скрипт Sclex’а)', 'Case of titles and subtitles v1.6 (script by Sclex)'),
    width: 640,
    fields: [
      {
        kind: 'list', id: 'elements', multiple: true, options, value: options.map((o) => o.value),
        label: t(ctx, 'Элементы (T — заголовок, S — подзаголовок)', 'Elements (T - title paragraph, S - subtitle)'),
      },
      {
        kind: 'radio', id: 'operation', value: 'upper',
        label: t(ctx, 'Что сделать с выбранными', 'Operation on the chosen elements'),
        options: [
          { value: 'upper', label: t(ctx, 'Большие буквы', 'UPPER CASE') },
          { value: 'lower', label: t(ctx, 'Маленькие буквы', 'lower case') },
          { value: 'sentence', label: t(ctx, 'Как в предложении', 'Sentence case') },
          { value: 'capitalize', label: t(ctx, 'Каждое Слово С Большой', 'Capitalised Words') },
        ],
      },
    ],
    okLabel: t(ctx, 'ОК', 'OK'),
  });
  if (!choice) return;

  const chosen = new Set(Array.isArray(choice.elements) ? choice.elements : []);
  let changed = 0;
  for (let i = 0; i < items.length; i += 1) {
    const { node } = items[i];
    if (!chosen.has(String(node.attrs.nodeId))) continue;
    const updated = applyCase(node, choice.operation);
    if (JSON.stringify(updated.content) !== JSON.stringify(node.content)) {
      await mfbe.doc.replaceNode(node.attrs.nodeId, updated);
      changed += 1;
    }
    if (i % 20 === 0) await mfbe.ui.progress(i, items.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(t(ctx, `Изменено элементов: ${changed}`, `${changed} element(s) changed`), { sticky: true });
}
