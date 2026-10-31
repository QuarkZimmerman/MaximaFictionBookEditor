// Shared by "Вставить заголовок стиха" and "Вставить заголовок body" (FictionBook Editor 2.7.9,
// 18_Мелочи редактирования 01 and 02); each package carries its own copy, since the sandbox only
// loads modules from the script's own folder.
//
// The originals pasted a marker at the caret and climbed from it to the nearest DIV of class
// "poem" (01) or "body" (02). When that container's first child was not a title they inserted a
// title with one empty paragraph as its first child; then they put the caret at the start of the
// title (FictionBook Editor's GoTo). A selection instead of a caret was refused with a message.
// Here the caret's text block is found in the document model - in a body, or in the book's
// annotation or the document's history, which FictionBook Editor showed above the bodies - and its
// nearest container of the type is changed in the same way.

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const NO_CARET = {
  ru: 'При запуске скрипта не должно быть выделения. Должен быть просто курсор.',
  en: 'There must be no selection when the script starts, just a caret.',
};

/** The path (outermost first) from the root to the node with this id, or null. */
function pathTo(root, nodeId) {
  if (!root || typeof root !== 'object' || root.type === 'text') return null;
  if (root.attrs?.nodeId === nodeId) return [root];
  for (const child of root.content ?? []) {
    const path = pathTo(child, nodeId);
    if (path) return [root, ...path];
  }
  return null;
}

/**
 * Where the caret's text block is: `{ path, place }` with `place` 'body' (path from its body),
 * 'annotation' or 'history' (path from that description block), or null.
 */
function locate(snapshot, nodeId) {
  for (const body of snapshot.bodies ?? []) {
    const path = pathTo(body, nodeId);
    if (path) return { path, place: 'body' };
  }
  const blocks = [
    ['annotation', snapshot.description?.titleInfo?.annotation],
    ['history', snapshot.description?.documentInfo?.history],
  ];
  for (const [place, block] of blocks) {
    const path = pathTo(block, nodeId);
    if (path) return { path, place };
  }
  return null;
}

/** An empty title, as the originals created it: a title DIV holding one empty paragraph. */
function emptyTitle() {
  return { type: 'title', attrs: {}, content: [{ type: 'p', attrs: {}, content: [] }] };
}

/** FictionBook Editor's GoTo(title): the caret at the start of the title's first paragraph. */
async function caretToTitle(titleRef) {
  const children = await mfbe.doc.childrenOf(titleRef);
  const first = children.find((child) => child.type === 'p');
  if (first) {
    await mfbe.selection.set({ nodeId: first.nodeId, offset: 0 });
    await mfbe.selection.scrollIntoView();
  } else {
    // A title of empty lines only: an empty line holds no caret in the Body view.
    await mfbe.selection.selectNode(titleRef);
  }
}

/**
 * The caret into a title the description just got: the new paragraph has no id of the document
 * model, only a UI id of the Body view, so its container (which keeps its id) is selected once
 * to learn it - the selection of a container starts at its first paragraph, the new title's.
 */
async function caretToNewDescriptionTitle(containerId) {
  await mfbe.selection.selectNode(containerId);
  const selection = await mfbe.selection.get();
  if (!selection) return;
  await mfbe.selection.set({ nodeId: selection.anchor.nodeId, offset: 0 });
  await mfbe.selection.scrollIntoView();
}

/**
 * Runs the script: `containerType` is 'poem' or 'body'; `titleIndexOf(container)` gives the
 * index of the container's title, or -1, and `insertAt(container)` the index a new title takes.
 */
export async function insertTitle(ctx, containerType, titleIndexOf, insertAt) {
  const selection = await mfbe.selection.get();
  if (!selection) return;
  const collapsed =
    selection.anchor.nodeId === selection.head.nodeId &&
    selection.anchor.offset === selection.head.offset &&
    selection.text === '';
  if (!collapsed) {
    await mfbe.ui.message(t(ctx, NO_CARET.ru, NO_CARET.en), { icon: 'warning' });
    return;
  }
  const snapshot = await mfbe.doc.get();
  const where = locate(snapshot, selection.anchor.nodeId);
  if (!where) return;
  let level = -1;
  for (let i = where.path.length - 1; i >= 0; i -= 1) {
    if (where.path[i].type === containerType) {
      level = i;
      break;
    }
  }
  // Not inside such a container: the original did nothing.
  if (level < 0) return;
  const container = where.path[level];
  const titleIndex = titleIndexOf(container);
  if (where.place === 'body') {
    if (titleIndex >= 0) {
      const title = container.content[titleIndex];
      await caretToTitle({ nodeId: title.attrs.nodeId, type: 'title' });
      return;
    }
    const at = insertAt(container);
    const sibling = container.content[at];
    const ref = sibling
      ? await mfbe.doc.insertNode('before', { nodeId: sibling.attrs.nodeId, type: sibling.type }, emptyTitle())
      : await mfbe.doc.insertNode('append', { nodeId: container.attrs.nodeId, type: container.type }, emptyTitle());
    await caretToTitle(ref);
    return;
  }
  // A poem of the book's annotation or of the history: node operations cover the bodies only,
  // so the description is changed as a whole.
  if (titleIndex >= 0) {
    const title = container.content[titleIndex];
    const first = (title.content ?? []).find((child) => child.type === 'p');
    if (first?.attrs?.nodeId) {
      await mfbe.selection.set({ nodeId: first.attrs.nodeId, offset: 0 });
      await mfbe.selection.scrollIntoView();
    }
    return;
  }
  container.content.splice(insertAt(container), 0, emptyTitle());
  await mfbe.doc.setDescription(snapshot.description);
  await caretToNewDescriptionTitle(container.attrs.nodeId);
}
