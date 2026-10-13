// Converted from 09_Стихи/01_Слияние подряд идущих стихов.js (FictionBook Editor).
// Walks the selected part of the book and, whenever a poem starts with a stanza and follows
// another poem with only empty lines in between, moves its content into the previous poem
// (only when that poem ends with a stanza, otherwise the FB2 order title/stanza/text-author
// would break). The empty lines between the two poems are removed.
//
// The original also removed every empty line after the merged poem up to the end of the
// enclosing block; that over-reach is not reproduced (see conversion-notes-b.md).

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function isEmptyLine(node) {
  if (node.type === 'empty-line') return true;
  if (!TEXT_BLOCK_TYPES.has(node.type)) return false;
  return (node.content ?? []).every((c) => c.type === 'text' && /^[ \u00A0]*$/.test(c.text ?? ''));
}

/** Deep copy without node ids so the host assigns fresh ones to the moved subtree. */
function withoutIds(node) {
  if (node.type === 'text') return node;
  const attrs = { ...(node.attrs ?? {}) };
  delete attrs.nodeId;
  const copy = { type: node.type, attrs };
  if (node.content) copy.content = node.content.map(withoutIds);
  return copy;
}

function firstTextBlock(node) {
  if (!node || node.type === 'text') return null;
  if (TEXT_BLOCK_TYPES.has(node.type)) return node;
  for (const child of node.content ?? []) {
    const found = firstTextBlock(child);
    if (found) return found;
  }
  return null;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(
      ru
        ? 'Нет выделения.\n\nПеред запуском скрипта нужно выделить текст, который будет обработан, а именно: будут объединены подряд идущие стихи в тех случаях, когда объединение не нарушит валидности документа.'
        : 'Nothing is selected.\n\nSelect the text to process first: consecutive poems inside the selection are merged when the result stays a valid document.',
      { icon: 'warning' },
    );
    return;
  }
  await mfbe.ui.status(ru ? 'Выполняется объединение стихов…' : 'Merging poems…');

  // A stanza counts as "inside the selection" when its first line is a selected block and the
  // selection does not start in the middle of that line (the legacy marker logic).
  const selectedIds = new Set(selection.nodes.map((n) => n.nodeId));
  const startId = selection.nodes[0]?.nodeId;
  const startOffset = Math.min(selection.anchor.offset, selection.head.offset);
  const stanzaSelected = (stanza) => {
    const line = firstTextBlock(stanza);
    if (!line || !selectedIds.has(line.attrs.nodeId)) return false;
    return line.attrs.nodeId !== startId || startOffset === 0;
  };

  const snapshot = await mfbe.doc.get();
  let joins = 0;
  const poemsJoinedTo = new Set();

  const visit = async (container) => {
    const children = container.content ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.type === 'text') continue;
      if (child.type === 'poem' && child.content?.[0]?.type === 'stanza' && stanzaSelected(child.content[0])) {
        // Look back over empty lines for the previous poem.
        let j = i - 1;
        const empties = [];
        while (j >= 0 && isEmptyLine(children[j])) {
          empties.push(children[j]);
          j -= 1;
        }
        const previous = j >= 0 ? children[j] : null;
        const last = previous?.type === 'poem' ? previous.content?.[previous.content.length - 1] : null;
        if (previous && last && last.type === 'stanza') {
          const target = { nodeId: previous.attrs.nodeId, type: 'poem' };
          await mfbe.doc.removeNode(child.attrs.nodeId);
          for (const part of child.content) {
            await mfbe.doc.insertNode('append', target, withoutIds(part));
          }
          for (const empty of empties) await mfbe.doc.removeNode(empty.attrs.nodeId);
          previous.content = [...previous.content, ...child.content];
          children.splice(i - empties.length, empties.length + 1);
          i -= empties.length + 1;
          joins += 1;
          poemsJoinedTo.add(previous.attrs.nodeId);
          continue;
        }
      }
      if (!TEXT_BLOCK_TYPES.has(child.type)) await visit(child);
      if (ctx.cancelled) return;
    }
  };
  for (const body of snapshot.bodies ?? []) await visit(body);

  await mfbe.ui.status(
    ru
      ? `Стихов, к которым присоединяли: ${poemsJoinedTo.size}. Присоединений: ${joins}`
      : `Poems extended: ${poemsJoinedTo.size}. Poems appended: ${joins}`,
    { sticky: true },
  );
}
