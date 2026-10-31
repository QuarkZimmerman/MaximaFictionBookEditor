// Shared helper of the scripts converted from FictionBook Editor 2.7.9's group 05_Иллюстрации that
// remove pictures (10 "Удалить все теги иллюстраций - теги image" and 16 "Удалить иллюстрации, не
// 'ссылающиеся' на наличествующий бинарник"). Each package carries its own copy: the sandbox only
// loads modules from the script's own folder.
//
// The originals walked FictionBook Editor's fbw_body - the book's annotation, the history, then
// every body - and removed, from the last to the first, first the inline pictures (SPAN.image),
// then the block pictures (DIV.image) together with the empty lines next to them, then the empty
// lines collected on the way. An empty line was any P (an empty line, a paragraph, a subtitle)
// holding nothing but spaces and non-breaking spaces once the inline pictures were gone. This
// module plays the same steps on the document model and applies the result: text blocks through
// `doc.replaceNode` (those of the book annotation and the history through `doc.setDescription`),
// pictures and empty lines through `doc.removeNode`.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** True for a P of FictionBook Editor: a text block or an empty line. */
function isP(node) {
  return !!node && (TEXT_BLOCKS.has(node.type) || node.type === 'empty-line');
}

/**
 * The original's isLineEmpty: the text of the P, its tags left out but its remaining pictures
 * kept, is nothing but spaces and non-breaking spaces. (Fix: the original's expression also took
 * the word "undefined" for an empty line - it was built before its non-breaking space variable
 * was set.)
 */
function isLineEmpty(node, contentOf) {
  if (node.type === 'empty-line') return true;
  let text = '';
  for (const child of contentOf(node)) {
    if (child.type === 'text') text += child.text ?? '';
    else return false; // a picture (or an unknown inline element) left in the paragraph
  }
  return /^[  ]*$/.test(text);
}

/**
 * Whether the empty line after a block picture must stay for the book to remain valid: the
 * picture opens its container (or follows its title or an epigraph) and the empty line is the
 * last thing after it. (Fix: the original's operator precedence kept the empty line after any
 * picture that opened its container, whatever followed.)
 */
function emptyLineIsNeededForValidity(kids, at, contentOf) {
  const prev = kids[at - 1];
  const next = kids[at + 1];
  const headed = !prev || prev.type === 'title' || prev.type === 'epigraph';
  return headed && isP(next) && isLineEmpty(next, contentOf) && at + 2 >= kids.length;
}

/**
 * The form FictionBook Editor saved a paragraph in once its pictures were removed (FBDoc.cpp,
 * ProcessP): a P with no child left, or with one plain text of white space, became an empty line
 * (in a stanza a verse of one space; table cells stayed cells). A formatting element or a link
 * that held the picture stayed there as an empty element, for which the document model has no
 * form: the paragraph keeps what is left. `fallback` is the emptied block itself, for the places
 * where FB2 allows no empty line (a poem's text author).
 */
function savedForm(node, content, removedMarked) {
  const attrs = { ...(node.attrs ?? {}) };
  delete attrs.nodeId;
  const kept = { type: node.type, attrs, content };
  const plain =
    !removedMarked &&
    (content.length === 0 ||
      (content.length === 1 &&
        content[0].type === 'text' &&
        !content[0].marks?.length &&
        /^[\s ]*$/.test(content[0].text ?? '')));
  if (!plain || node.type === 'td' || node.type === 'th') return { node: kept, fallback: kept };
  if (node.type === 'v') {
    return { node: { type: 'v', attrs, content: [{ type: 'text', text: ' ' }] }, fallback: kept };
  }
  return { node: { type: 'empty-line' }, fallback: kept };
}

const refused = (error) => error?.code === 'notAllowed' || error?.code === 'invalidNode';

/**
 * Removes the pictures whose `href` `shouldRemove(href)` accepts, as the originals did, and the
 * empty lines next to the removed block pictures. Returns the counts `{ block, inline, emptyLines }`
 * of what was removed, or null when the run was cancelled.
 */
export async function removePictures(ctx, shouldRemove) {
  const doc = await mfbe.doc.get();
  const description = doc.description;
  const annotation = description?.titleInfo?.annotation ?? null;
  const history = description?.documentInfo?.history ?? null;

  // The tree in fbw_body order; the children of every container as working arrays.
  const kids = new Map();
  const blocks = []; // text blocks in document order: { node, parent, inDescription }
  const pictures = []; // block pictures in document order: { node, parent }
  const visit = (node, parent, inDescription) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      blocks.push({ node, parent, inDescription });
      return;
    }
    if (node.type === 'image' || node.type === 'empty-line' || node.type === 'raw-xml') return;
    const children = [...(node.content ?? [])];
    kids.set(node, children);
    for (const child of children) {
      if (child.type === 'image') pictures.push({ node: child, parent: node });
      visit(child, node, inDescription);
    }
  };
  if (annotation) visit(annotation, null, true);
  if (history) visit(history, null, true);
  for (const body of doc.bodies ?? []) visit(body, null, false);

  // 1. The inline pictures, from the last to the first.
  const edited = new Map(); // text block -> { content, removedMarked }
  let inline = 0;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const { node } = blocks[i];
    const content = node.content ?? [];
    let removedMarked = false;
    const left = [];
    for (const child of content) {
      if (child.type === 'inline-image' && shouldRemove(child.attrs?.href ?? '')) {
        inline += 1;
        if (child.marks?.length) removedMarked = true;
      } else left.push(child);
    }
    if (left.length !== content.length) edited.set(node, { content: left, removedMarked });
  }
  const contentOf = (node) => edited.get(node)?.content ?? node.content ?? [];

  // 2. The block pictures, from the last to the first, collecting the empty lines next to them.
  const emptyLines = [];
  const removed = [];
  for (let i = pictures.length - 1; i >= 0; i -= 1) {
    const { node, parent } = pictures[i];
    if (!shouldRemove(node.attrs?.href ?? '')) continue;
    const children = kids.get(parent);
    const at = children.indexOf(node);
    const next = children[at + 1];
    const prev = children[at - 1];
    if (isP(next) && isLineEmpty(next, contentOf) && !emptyLineIsNeededForValidity(children, at, contentOf)) {
      if (emptyLines[emptyLines.length - 1] !== next) emptyLines.push(next);
    }
    if (isP(prev) && isLineEmpty(prev, contentOf)) {
      if (emptyLines[emptyLines.length - 1] !== prev) emptyLines.push(prev);
    }
    children.splice(at, 1);
    removed.push(node);
  }
  const doomed = new Set(emptyLines);

  // The edits, in an order that keeps the book valid at every step: the text blocks, then the
  // pictures, then the empty lines.
  const total = edited.size + removed.length + emptyLines.length;
  let done = 0;
  const step = async () => {
    done += 1;
    if (done % 25 === 0) await mfbe.ui.progress(done, total);
    return !ctx.cancelled;
  };
  const fallbacks = [];
  for (const { node, parent, inDescription } of blocks) {
    const edit = edited.get(node);
    if (!edit || doomed.has(node)) continue;
    const form = savedForm(node, edit.content, edit.removedMarked);
    if (inDescription) {
      const list = parent.content;
      const at = list.indexOf(node);
      list[at] = form.node;
      fallbacks.push(() => {
        list[at] = form.fallback;
      });
    } else {
      try {
        await mfbe.doc.replaceNode(node.attrs.nodeId, form.node);
      } catch (error) {
        if (!refused(error)) throw error;
        await mfbe.doc.replaceNode(node.attrs.nodeId, form.fallback);
      }
    }
    if (!(await step())) return null;
  }
  if (fallbacks.length) {
    try {
      await mfbe.doc.setDescription(description);
    } catch (error) {
      if (!refused(error)) throw error;
      for (const use of fallbacks) use();
      await mfbe.doc.setDescription(description);
    }
  }
  for (const node of removed) {
    try {
      await mfbe.doc.removeNode(node.attrs.nodeId);
    } catch (error) {
      if (!refused(error)) throw error;
      // The picture is all its section holds: an empty line takes its place, so that the
      // section stays valid (the original left the section without content).
      await mfbe.doc.replaceNode(node.attrs.nodeId, { type: 'empty-line' });
    }
    if (!(await step())) return null;
  }
  let lines = 0;
  for (const node of emptyLines) {
    try {
      await mfbe.doc.removeNode(node.attrs.nodeId);
      lines += 1;
    } catch (error) {
      if (!refused(error)) throw error;
      // Its section would keep nothing but its title: the empty line stays (the original
      // removed it and left the section invalid).
    }
    if (!(await step())) return null;
  }
  return { block: removed.length, inline, emptyLines: lines };
}
