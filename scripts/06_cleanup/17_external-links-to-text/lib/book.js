// Helper of the "Чистка" scripts converted from FictionBook Editor 2.7.9 (byte-identical copies in
// each package that uses it: a package imports only files of its own folder).
//
// FictionBook Editor showed the book as one HTML page; its editable part (fbw_body) held the
// title-info annotation, the document-info history and the bodies, in this order. The scripts
// walked that page. Here the same parts are walked in the editor's document model, edited in
// memory and written back: the changed body nodes with doc.replaceNode (the topmost changed node of
// each branch, with its subtree), the annotation and the history with doc.setDescription.

/** The text blocks: the elements the editor's page showed as <P>. */
export const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date', 'empty-line']);

/** Texts in the interface language: Russian in the Russian interface, English otherwise. */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** Russian plural form of a count, as the originals' units(): {nom: 1, gen: 2-4, plu: 5-20}. */
export function units(num, cases) {
  const n = Math.abs(num);
  if (n.toString().indexOf('.') > -1) return cases.gen;
  if (n % 10 === 1 && n % 100 !== 11) return cases.nom;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return cases.gen;
  return cases.plu;
}

/**
 * The parts of the page in its order: { kind: 'annotation' | 'history' | 'body', node }. The
 * annotation and the history are there only when the book has them.
 */
export function pageParts(snapshot) {
  const parts = [];
  const annotation = snapshot.description?.titleInfo?.annotation;
  if (annotation) parts.push({ kind: 'annotation', node: annotation });
  const history = snapshot.description?.documentInfo?.history;
  if (history) parts.push({ kind: 'history', node: history });
  for (const body of snapshot.bodies ?? []) parts.push({ kind: 'body', node: body });
  return parts;
}

/** The body's name attribute as the page carried it (fbname, "" when there is none). */
export function bodyName(body) {
  return typeof body.attrs?.name === 'string' ? body.attrs.name : '';
}

/**
 * Visits the structural and block nodes of a subtree in document order (pre-order), with their
 * ancestors (nearest first). Inline content is not entered.
 */
export function forEachNode(node, visit, ancestors = []) {
  if (!node || typeof node !== 'object' || node.type === 'text') return;
  visit(node, ancestors);
  if (TEXT_BLOCK_TYPES.has(node.type)) return;
  const inner = [node, ...ancestors];
  for (const child of node.content ?? []) forEachNode(child, visit, inner);
}

/** Whether a node carries a non-empty id (the originals skipped id=""). */
export function hasId(node) {
  return typeof node.attrs?.id === 'string' && node.attrs.id !== '';
}

function sameMark(a, b) {
  return a.type === b.type && JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
}

/**
 * Removes the marks for which `drop(mark)` is true from inline content (text, inline pictures and
 * inline raw XML alike), keeping the text. Returns { content, removed }: `removed` counts the
 * elements, a mark that the previous inline node did not carry being one element (a run of nodes
 * with the same mark was one element on the page).
 */
export function stripMarks(content, drop) {
  let removed = 0;
  let previous = [];
  const out = (content ?? []).map((item) => {
    const marks = item.marks ?? [];
    const dropped = marks.filter((m) => drop(m));
    for (const mark of dropped) {
      if (!previous.some((other) => sameMark(other, mark))) removed += 1;
    }
    previous = dropped;
    if (!dropped.length) return item;
    const kept = marks.filter((m) => !drop(m));
    const copy = { ...item };
    if (kept.length) copy.marks = kept;
    else delete copy.marks;
    return copy;
  });
  return { content: out, removed };
}

/**
 * The changes of a run. `mark(node, ancestors)` records a changed node (edited in place); `commit`
 * writes the topmost changed nodes of the bodies back and the description when its annotation or
 * history changed.
 */
export class Changes {
  constructor(snapshot) {
    this.snapshot = snapshot;
    this.changed = new Set();
    this.dirty = new Set();
    this.description = false;
  }

  mark(node, ancestors, part) {
    this.changed.add(node);
    for (const ancestor of ancestors) this.dirty.add(ancestor);
    if (part && part.kind !== 'body') this.description = true;
  }

  get count() {
    return this.changed.size;
  }

  async commit(ctx, label) {
    const targets = [];
    const collect = (node) => {
      if (!node || typeof node !== 'object' || node.type === 'text') return;
      if (this.changed.has(node)) {
        targets.push(node);
        return;
      }
      if (!this.dirty.has(node)) return;
      for (const child of node.content ?? []) collect(child);
    };
    for (const body of this.snapshot.bodies ?? []) collect(body);
    for (let i = 0; i < targets.length; i += 1) {
      const node = targets[i];
      await mfbe.doc.replaceNode({ nodeId: node.attrs.nodeId, type: node.type }, node);
      if (i % 50 === 0) await mfbe.ui.progress(i, targets.length, label);
      if (ctx.cancelled) return false;
    }
    if (this.description) await mfbe.doc.setDescription(this.snapshot.description);
    return true;
  }
}
