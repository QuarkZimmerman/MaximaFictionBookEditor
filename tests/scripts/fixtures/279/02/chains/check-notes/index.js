// Test driver of the recheck of group 02 (FictionBook Editor 2.7.9, 02_Примечания), not a bundled
// script: it puts the caret at the start of the book's first body paragraph, runs the check of the
// footnotes through mfbe.scripts.run by its FictionBook Editor path and writes to the clipboard
// what it returned (null: the original returns nothing) and the selection it left - the place of
// the problem it reported, in the annotation or the history too. The harness records the
// clipboard in the snapshot's outputs.json; the document must stay as it was.
const SCRIPT = '02_Примечания\\30_Проверить корректность оформления примечаний.js';
const BLOCKS = ['p', 'v', 'subtitle', 'text-author', 'td', 'th'];

function firstBlock(node) {
  if (!node || typeof node !== 'object' || node.type === 'text') return null;
  if (BLOCKS.includes(node.type)) return node;
  for (const child of node.content ?? []) {
    const found = firstBlock(child);
    if (found) return found;
  }
  return null;
}

/** The text of a block of the annotation, the history or a body (doc.textOf knows the bodies only). */
function blockText(doc, nodeId) {
  const find = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return null;
    if (node.attrs?.nodeId === nodeId) return node;
    for (const child of node.content ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const roots = [doc.description?.titleInfo?.annotation, doc.description?.documentInfo?.history, ...doc.bodies];
  for (const root of roots) {
    const block = find(root);
    if (block) return (block.content ?? []).map((item) => (item.type === 'text' ? item.text : '\uFFFC')).join('');
  }
  return '';
}

export default async function run() {
  const before = await mfbe.doc.get();
  const start = firstBlock(before.bodies[0]);
  await mfbe.selection.set({ nodeId: start.attrs.nodeId, offset: 0 });
  const result = await mfbe.scripts.run(SCRIPT);
  const selection = await mfbe.selection.get();
  const text = blockText(await mfbe.doc.get(), selection.anchor.nodeId).slice(selection.anchor.offset, selection.anchor.offset + 12);
  await mfbe.clipboard.writeText(
    `from ${start.attrs.nodeId}:0: ${result === undefined ? '(nothing)' : result} ` +
      `${selection.anchor.nodeId}:${selection.anchor.offset}-${selection.head.nodeId}:${selection.head.offset} ` +
      `at ${JSON.stringify(text)}\n`,
  );
}
