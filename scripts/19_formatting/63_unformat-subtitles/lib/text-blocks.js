// Shared helper of the scripts of "Обработка форматирования" converted from FictionBook Editor
// 2.7.9 (each package carries its own copy: the sandbox only allows imports from inside the
// script's folder).
//
// The Body view shows, above the first body, the book annotation and the history, as the
// original editor did: a selection may start or end there. Their text blocks are not nodes of
// the bodies (mfbe.doc.getNode refuses them); they are changed through doc.setDescription. A
// TextBlocks object finds a node by its id in either place and writes the changed ones: those
// of the bodies at once (doc.replaceNode), those of the description with one setDescription at
// the end (commit). The empty paragraph the Body view shows for a missing annotation or history
// is in neither place: it is reported as not found.

export const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** Length of inline content in selection offsets: characters, an inline node counts as one. */
export function contentLength(content) {
  return (content ?? []).reduce(
    (n, item) => n + (item.type === 'text' ? (item.text ?? '').length : 1),
    0,
  );
}

export function isApiError(error, ...codes) {
  return (
    Boolean(error) &&
    error.name === 'ScriptApiError' &&
    (codes.length === 0 || codes.includes(error.code))
  );
}

/** The first (`last` false) or last text block of a subtree in document order, or null. */
export function edgeTextBlock(node, last = false) {
  if (!node || node.type === 'text') return null;
  if (TEXT_BLOCK_TYPES.has(node.type)) return node;
  const children = node.content ?? [];
  for (let k = 0; k < children.length; k += 1) {
    const found = edgeTextBlock(children[last ? children.length - 1 - k : k], last);
    if (found) return found;
  }
  return null;
}

export class TextBlocks {
  constructor() {
    this.description = null;
    this.descriptionChanged = false;
  }

  /** The book annotation and the history (loaded once, when a node is not in the bodies). */
  async descriptionRoots() {
    if (!this.description) this.description = (await mfbe.doc.get()).description;
    const info = this.description;
    return [info.titleInfo?.annotation, info.documentInfo?.history].filter(Boolean);
  }

  /**
   * `{ nodeId, node, inDescription, place }` of the node with this id, or null when it is
   * neither in the bodies nor in the book annotation or the history.
   */
  async get(nodeId) {
    try {
      return { nodeId, node: await mfbe.doc.getNode(nodeId), inDescription: false, place: null };
    } catch (error) {
      if (!isApiError(error, 'unknownNode')) throw error;
    }
    const place = findIn(await this.descriptionRoots(), nodeId);
    return place ? { nodeId, node: place.node, inDescription: true, place } : null;
  }

  /** The type of the parent of a node `get` returned ('section', 'stanza', 'annotation', …). */
  async parentType(entry) {
    if (entry.inDescription) return entry.place.parent.type;
    const parent = await mfbe.doc.parentOf(entry.nodeId);
    return parent ? parent.type : null;
  }

  /** Writes `node` in place of the node `get` returned; the node keeps its id. */
  async put(entry, node) {
    if (!entry.inDescription) {
      await mfbe.doc.replaceNode(entry.nodeId, node);
      entry.node = node;
      return;
    }
    const written = { ...node, attrs: { ...(node.attrs ?? {}), nodeId: entry.nodeId } };
    entry.place.parent.content[entry.place.index] = written;
    entry.place.node = written;
    entry.node = written;
    this.descriptionChanged = true;
  }

  /** Writes the changed annotation and history. */
  async commit() {
    if (!this.descriptionChanged) return;
    await mfbe.doc.setDescription(this.description);
    this.descriptionChanged = false;
  }
}

/** `{ node, parent, index }` of the node with this id inside the given trees, or null. */
function findIn(roots, nodeId) {
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const parent = stack.pop();
      const content = parent.content ?? [];
      for (let index = 0; index < content.length; index += 1) {
        const node = content[index];
        if (!node || node.type === 'text') continue;
        if (node.attrs?.nodeId === nodeId) return { node, parent, index };
        stack.push(node);
      }
    }
  }
  return null;
}
