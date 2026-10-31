// Test driver of the conversions of group 03 (FictionBook Editor 2.7.9, 03_Комментарии), not a
// bundled script: it puts the caret at the start of the book's first paragraph, runs the check of
// the comments through mfbe.scripts.run by its FictionBook Editor path and writes to the
// clipboard what it returned (null: the original returns nothing) and where it left the caret -
// the place of the problem it reported. The harness records the clipboard in the snapshot's
// outputs.json; the document must stay as it was.
const SCRIPT = '03_Комментарии\\20_Проверить корректность оформления комментариев.js';

function firstBlock(node) {
  if (!node || typeof node !== 'object' || node.type === 'text') return null;
  if (['p', 'v', 'subtitle', 'text-author', 'td', 'th'].includes(node.type)) return node;
  for (const child of node.content ?? []) {
    const found = firstBlock(child);
    if (found) return found;
  }
  return null;
}

export default async function run() {
  const doc = await mfbe.doc.get();
  const start = firstBlock(doc.bodies[0]);
  await mfbe.selection.set({ nodeId: start.attrs.nodeId, offset: 0 });
  const result = await mfbe.scripts.run(SCRIPT);
  const selection = await mfbe.selection.get();
  const text = (await mfbe.doc.textOf(selection.anchor.nodeId)).slice(selection.anchor.offset, selection.anchor.offset + 12);
  await mfbe.clipboard.writeText(
    `from ${start.attrs.nodeId}:0: ${result === undefined ? '(nothing)' : result} ` +
      `${selection.anchor.nodeId}:${selection.anchor.offset}-${selection.head.nodeId}:${selection.head.offset} ` +
      `at ${JSON.stringify(text)}\n`,
  );
}
