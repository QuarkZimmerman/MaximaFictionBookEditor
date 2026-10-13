// Shared by "Удаление пробелов" and "Удаление пробелов и дефисов" (18_Мелочи редактирования
// 01 and 06, FictionBook Editor 2.7, Tier 1): removes the characters matching `pattern` from
// the selected text while keeping inline formatting, then re-selects the processed text,
// exactly as the originals did by editing the text nodes between two markers.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** Selection as {from, to, nodes} with `from` before `to` in document order. */
export function orderedSelection(selection) {
  const { anchor, head, nodes } = selection;
  let forward = true;
  if (anchor.nodeId === head.nodeId) forward = anchor.offset <= head.offset;
  else if (nodes.length) forward = nodes[0].nodeId === anchor.nodeId;
  return forward ? { from: anchor, to: head, nodes } : { from: head, to: anchor, nodes };
}

/**
 * Rewrites the inline content of a text block: `transform` is applied to the text inside
 * [start, end) (offsets in the block's text, inline leaves count as 1), marks are kept.
 * Returns the new content and how many characters were removed before `end`.
 */
export function transformRange(content, start, end, transform) {
  const out = [];
  let offset = 0;
  let removed = 0;
  for (const item of content) {
    if (item.type !== 'text') {
      out.push(item);
      offset += 1;
      continue;
    }
    const itemStart = offset;
    const itemEnd = offset + item.text.length;
    offset = itemEnd;
    const a = Math.max(start, itemStart);
    const b = Math.min(end, itemEnd);
    if (a >= b) {
      out.push(item);
      continue;
    }
    const before = item.text.slice(0, a - itemStart);
    const inside = item.text.slice(a - itemStart, b - itemStart);
    const after = item.text.slice(b - itemStart);
    const replaced = transform(inside);
    removed += inside.length - replaced.length;
    const text = before + replaced + after;
    if (text) out.push({ ...item, text });
  }
  return { content: out, removed };
}

export async function stripSelectedText(ctx, pattern) {
  const raw = await mfbe.selection.get();
  if (!raw || !raw.text) {
    await mfbe.ui.message(t(ctx, 'Ничего не выделено!', 'Nothing is selected!'), { icon: 'warning' });
    return;
  }
  const { from, to, nodes } = orderedSelection(raw);
  let removedInLast = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    const block = nodes[i];
    const node = await mfbe.doc.getNode(block);
    const content = node.content ?? [];
    const length = content.reduce((n, c) => n + (c.type === 'text' ? c.text.length : 1), 0);
    const start = block.nodeId === from.nodeId ? from.offset : 0;
    const end = block.nodeId === to.nodeId ? to.offset : length;
    const result = transformRange(content, start, end, (text) => text.replace(pattern, ''));
    if (result.removed === 0) continue;
    await mfbe.doc.replaceNode(block, { ...node, content: result.content });
    if (block.nodeId === to.nodeId) removedInLast = result.removed;
  }
  // The original left the processed text selected.
  await mfbe.selection.set(
    { nodeId: from.nodeId, offset: from.offset },
    { nodeId: to.nodeId, offset: to.offset - removedInLast },
  );
}
