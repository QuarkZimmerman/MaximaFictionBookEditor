// Converted from 18_Мелочи редактирования/03_Снятие форматирования стихом, цитатой или эпиграфом.js
// (FictionBook Editor 2.7), Tier 2. With the caret (no selection) inside a poem, a cite or an
// epigraph, the innermost of them is dissolved into its parent: stanzas and nested epigraphs
// are unwrapped, verses, text-authors and dates become plain paragraphs. The original left the
// poem's <title> in place (invalid FB2 in the middle of a section); here its lines become
// paragraphs too, and a subtitle landing in an epigraph (no subtitles allowed there) as well.

const TARGETS = new Set(['poem', 'cite', 'epigraph']);
/** Block types a parent accepts from a dissolved container (text-author never: it becomes p). */
const ALLOWED = {
  section: new Set(['p', 'subtitle', 'poem', 'cite', 'empty-line', 'table']),
  cite: new Set(['p', 'subtitle', 'empty-line', 'poem', 'table']),
  epigraph: new Set(['p', 'poem', 'cite', 'empty-line']),
  annotation: new Set(['p', 'poem', 'cite', 'subtitle', 'table', 'empty-line']),
};

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function stripIds(node) {
  if (node.type === 'text') return node;
  const attrs = { ...(node.attrs ?? {}) };
  delete attrs.nodeId;
  return { ...node, attrs, ...(node.content ? { content: node.content.map(stripIds) } : {}) };
}

function asParagraph(node) {
  return { type: 'p', attrs: {}, content: node.content ?? [] };
}

/** The blocks that replace the container, in document order. */
function flatten(container) {
  const out = [];
  const push = (node) => {
    switch (node.type) {
      case 'title':
      case 'epigraph':
      case 'stanza':
        for (const child of node.content ?? []) push(child);
        break;
      case 'v':
      case 'text-author':
      case 'date':
        out.push(asParagraph(node));
        break;
      default:
        out.push(node);
    }
  };
  for (const child of container.content ?? []) push(child);
  return out;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection) return;
  if (selection.text) {
    await mfbe.ui.message(
      t(ctx, 'При запуске скрипта не должно быть выделения. Должен быть просто курсор.',
        'There must be no selection when the script runs, only the caret.'),
      { icon: 'warning' },
    );
    return;
  }
  let container = await mfbe.doc.parentOf(selection.anchor);
  while (container && !TARGETS.has(container.type)) container = await mfbe.doc.parentOf(container);
  if (!container) {
    await mfbe.ui.status(t(ctx, 'Курсор не внутри стиха, цитаты или эпиграфа.', 'The caret is not inside a poem, a cite or an epigraph.'));
    return;
  }
  const parent = await mfbe.doc.parentOf(container);
  const allowed = parent ? ALLOWED[parent.type] : null;
  if (!allowed) {
    await mfbe.ui.message(
      t(ctx, `Снять форматирование нельзя: элемент «${container.type}» находится прямо в «${parent ? parent.type : '?'}».`,
        `The formatting cannot be removed: the "${container.type}" sits directly in "${parent ? parent.type : '?'}".`),
      { icon: 'warning' },
    );
    return;
  }
  const blocks = flatten(await mfbe.doc.getNode(container)).map((node) =>
    !allowed.has(node.type) && node.type === 'subtitle' ? asParagraph(node) : node,
  );
  const rejected = blocks.find((node) => !allowed.has(node.type));
  if (rejected) {
    await mfbe.ui.message(
      t(ctx, `Снять форматирование нельзя: «${rejected.type}» недопустим внутри «${parent.type}».`,
        `The formatting cannot be removed: "${rejected.type}" is not allowed inside "${parent.type}".`),
      { icon: 'warning' },
    );
    return;
  }
  // Poems and cites already stand among the blocks; a section epigraph does not, so its lines
  // go to the start of the block area (after any further epigraphs, image and annotation).
  let where = 'before';
  let anchor = container;
  if (container.type === 'epigraph') {
    const siblings = await mfbe.doc.childrenOf(parent);
    let j = siblings.findIndex((s) => s.nodeId === container.nodeId) + 1;
    while (j < siblings.length && ['epigraph', 'image', 'annotation'].includes(siblings[j].type)) j += 1;
    if (j < siblings.length) anchor = siblings[j];
    else {
      where = 'append';
      anchor = parent;
    }
  }
  let first = null;
  for (const block of blocks) {
    const ref = await mfbe.doc.insertNode(where, anchor, stripIds(block));
    if (!first) first = ref;
  }
  await mfbe.doc.removeNode(container);
  if (first) await mfbe.selection.set({ nodeId: first.nodeId, offset: 0 });
}
