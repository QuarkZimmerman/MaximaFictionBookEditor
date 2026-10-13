// Shared engine of the "Переход на ... кавычки" scripts (group 12): moves the caret to the
// next / previous occurrence of one of `chars`, selecting that character. At the end (start)
// of the book the user is asked whether to continue from the other end; the search then
// stops at the original position.

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function textBlocks(snapshot) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      const text = (node.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : '\uFFFC')).join('');
      out.push({ nodeId: node.attrs.nodeId, text });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of snapshot.bodies ?? []) visit(body);
  return out;
}

/** Smallest index >= from (or largest index < before) of any of `chars` in `text`. */
function findForward(text, chars, from) {
  let best = -1;
  for (const ch of chars) {
    const index = text.indexOf(ch, from);
    if (index !== -1 && (best === -1 || index < best)) best = index;
  }
  return best;
}

function findBackward(text, chars, before) {
  let best = -1;
  for (const ch of chars) {
    const index = before > 0 ? text.lastIndexOf(ch, before - 1) : -1;
    if (index > best) best = index;
  }
  return best;
}

export async function goToQuotes(ctx, { direction, chars }) {
  const ru = ctx.uiLanguage === 'ru';
  const versionStr = ru ? 'Скрипт «Переход на кавычки».\n\n' : 'Script "Go to quotes".\n\n';
  const selection = await mfbe.selection.get();
  if (!selection) {
    await mfbe.ui.message(
      ru ? `${versionStr}Курсор должен находиться в тексте книги.` : `${versionStr}The caret must be in the book text.`,
      { icon: 'warning' },
    );
    return;
  }
  const blocks = textBlocks(await mfbe.doc.get());
  const indexOf = (id) => blocks.findIndex((b) => b.nodeId === id);
  // Selection boundaries in document order.
  let startPos = selection.anchor;
  let endPos = selection.head;
  if (selection.anchor.nodeId === selection.head.nodeId) {
    if (selection.anchor.offset > selection.head.offset) [startPos, endPos] = [endPos, startPos];
  } else if (indexOf(selection.anchor.nodeId) > indexOf(selection.head.nodeId)) {
    [startPos, endPos] = [endPos, startPos];
  }
  const startIndex = indexOf(startPos.nodeId);
  const endIndex = indexOf(endPos.nodeId);
  if (startIndex < 0 || endIndex < 0) return;

  const select = async (block, index) => {
    await mfbe.selection.set({ nodeId: block.nodeId, offset: index }, { nodeId: block.nodeId, offset: index + 1 });
    await mfbe.selection.scrollIntoView();
  };
  const confirmWrap = async () => {
    const text = direction === 'forward'
      ? (ru ? 'Достигнут конец документа.\nПродолжить поиск с начала документа?' : 'The end of the document was reached.\nContinue from the beginning?')
      : (ru ? 'Достигнуто начало документа.\nПродолжить поиск с конца документа?' : 'The beginning of the document was reached.\nContinue from the end?');
    return (await MsgBox(versionStr + text, ctx.script.name, 4 + 32)) === 6;
  };
  const notFound = () =>
    mfbe.ui.message(ru ? `${versionStr}Ничего не найдено, поиск завершен.` : `${versionStr}Nothing found, the search is over.`, { icon: 'info' });

  if (direction === 'forward') {
    // After the selection end, then the following blocks.
    let found = findForward(blocks[endIndex].text, chars, endPos.offset);
    if (found !== -1) return select(blocks[endIndex], found);
    for (let i = endIndex + 1; i < blocks.length; i += 1) {
      found = findForward(blocks[i].text, chars, 0);
      if (found !== -1) return select(blocks[i], found);
    }
    if (!(await confirmWrap())) return;
    for (let i = 0; i < startIndex; i += 1) {
      found = findForward(blocks[i].text, chars, 0);
      if (found !== -1) return select(blocks[i], found);
    }
    found = findForward(blocks[startIndex].text, chars, 0);
    if (found !== -1 && found < startPos.offset) return select(blocks[startIndex], found);
    return notFound();
  }
  // Backward: before the selection start, then the preceding blocks.
  let found = findBackward(blocks[startIndex].text, chars, startPos.offset);
  if (found !== -1) return select(blocks[startIndex], found);
  for (let i = startIndex - 1; i >= 0; i -= 1) {
    found = findBackward(blocks[i].text, chars, blocks[i].text.length);
    if (found !== -1) return select(blocks[i], found);
  }
  if (!(await confirmWrap())) return;
  for (let i = blocks.length - 1; i > endIndex; i -= 1) {
    found = findBackward(blocks[i].text, chars, blocks[i].text.length);
    if (found !== -1) return select(blocks[i], found);
  }
  found = findBackward(blocks[endIndex].text, chars, blocks[endIndex].text.length);
  if (found !== -1 && found >= endPos.offset) return select(blocks[endIndex], found);
  return notFound();
}
