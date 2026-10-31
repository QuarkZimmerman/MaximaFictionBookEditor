// Shared engine of the scripts "Сформатировать абзац(ы) …" (19/40-46), "Расформатировать
// абзац(ы) от …" (19/55-62) and "Расформатировать подзаголовок(-ки)" (19/63, with 19/20)
// converted from FictionBook Editor 2.7.9 (each package carries its own copy: the sandbox only
// allows imports from inside the script's folder).
//
// The originals pasted an empty marker element at each end of the selection, took every <P>
// from the one holding the start marker to the one holding the end marker in document order
// (the editor's <P> are all text blocks: paragraphs, title lines, subtitles, verses, text
// authors, dates, table cells, and the empty lines, which stay empty), rewrote the innerHTML of
// each and selected the processed paragraphs, from the start of the first to the end of the
// last. Their "nothing selected" check is commented out: a caret processes its own paragraph.
// Here the blocks are the ones mfbe.selection.get() lists - the text blocks from the one holding
// the selection's start to the one holding its end, the book annotation and the history
// included (TextBlocks) - and the run leaves the same selection.

import {
  TextBlocks,
  TEXT_BLOCK_TYPES,
  contentLength,
  edgeTextBlock,
  isApiError,
  t,
} from './text-blocks.js';

const MARKED = new Set(['text', 'inline-image', 'raw-xml']);

/**
 * A block transform on marks. Every mark of the `remove` types goes (with any attributes: the
 * originals' expressions removed the tags whatever attributes they had), and `add` puts its
 * marks, in this order, around the whole content, outermost (the originals wrapped innerHTML in
 * the tags). With `when`, only the inline nodes whose marks pass it change. A poem's date is
 * left alone: FB2 allows no formatting in it.
 */
export function markTransform({ remove = [], add = [], when = null }) {
  const removed = new Set(remove);
  return (node) => {
    if (node.type === 'date') return null;
    let changed = false;
    const content = (node.content ?? []).map((item) => {
      if (!MARKED.has(item.type)) return item;
      const marks = item.marks ?? [];
      if (when && !when(marks)) return item;
      const next = [...add.map((type) => ({ type })), ...marks.filter((m) => !removed.has(m.type))];
      if (JSON.stringify(next) === JSON.stringify(marks)) return item;
      changed = true;
      const copy = { ...item };
      if (next.length) copy.marks = next;
      else delete copy.marks;
      return copy;
    });
    return changed ? { ...node, content } : null;
  };
}

/** Whether marks hold both a strong and an emphasis (19/58). */
export function boldAndItalic(marks) {
  return marks.some((m) => m.type === 'strong') && marks.some((m) => m.type === 'emphasis');
}

/**
 * A subtitle as plain text: a verse inside a stanza, a stanza of one verse directly in a poem
 * (a paragraph cannot stand there), a paragraph elsewhere; other blocks stay (null). The
 * originals removed the paragraph's class, which made it a paragraph - or a verse in a stanza.
 */
export async function unformatSubtitle(node, entry, blocks) {
  if (node.type !== 'subtitle') return null;
  const parent = await blocks.parentType(entry);
  if (parent === 'stanza') return { ...node, type: 'v' };
  if (parent === 'poem') {
    const { nodeId, ...attrs } = node.attrs ?? {};
    return { type: 'stanza', attrs: {}, content: [{ ...node, type: 'v', attrs }] };
  }
  return { ...node, type: 'p' };
}

/**
 * Runs `transform(node, entry, blocks)` on every text block of the selection (a caret: its
 * block), writes the blocks it changes and selects them all, from the start of the first to
 * the end of the last, as the originals did. `status` is shown while it works, "ОК" at the end.
 * Does nothing when the selection lists no text block: a selected picture (the originals stopped
 * with an error then), or Select All, for which mfbe.selection.get() reports no selection.
 */
export async function formatSelectedParagraphs(ctx, { status, transform }) {
  const selection = await mfbe.selection.get();
  const refs = selection?.nodes ?? [];
  if (refs.length === 0) return;
  await mfbe.ui.status(status);
  const blocks = new TextBlocks();
  for (let i = 0; i < refs.length; i += 1) {
    if (ctx.cancelled) return;
    if (i % 100 === 99) await mfbe.ui.progress(i, refs.length);
    const entry = await blocks.get(refs[i].nodeId);
    if (!entry || !TEXT_BLOCK_TYPES.has(entry.node.type)) continue;
    const next = await transform(entry.node, entry, blocks);
    if (next) await blocks.put(entry, next);
  }
  await blocks.commit();
  await selectBlocks(blocks, refs[0].nodeId, refs[refs.length - 1].nodeId);
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'), { sticky: true });
}

/** Selects from the start of the first block to the end of the last one. */
async function selectBlocks(blocks, firstId, lastId) {
  const start = await edgePosition(blocks, firstId, false);
  const end = await edgePosition(blocks, lastId, true);
  if (!start || !end) return;
  try {
    await mfbe.selection.set(start, end);
  } catch (error) {
    if (!isApiError(error)) throw error;
  }
}

/** The start (or end) of a processed block; a subtitle that became a stanza: of its verse. */
async function edgePosition(blocks, nodeId, atEnd) {
  const entry = await blocks.get(nodeId);
  // The Body view's empty paragraph of a missing annotation or history.
  if (!entry) return { nodeId, offset: 0 };
  const block = edgeTextBlock(entry.node, atEnd);
  const id = block?.attrs?.nodeId;
  if (!id) return null;
  return { nodeId: id, offset: atEnd ? contentLength(block.content) : 0 };
}
