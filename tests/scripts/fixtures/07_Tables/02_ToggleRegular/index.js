// Fixture script (feature 006, FR-049, US8 sc.10): toggles a short last row in the table that
// holds the caret, through the script API. When the last row holds as many cells as the first,
// its last cell is removed; otherwise an empty cell is appended to it. On a table of two or more
// rows and columns without spans the first run leaves a short row (an irregular table) and the
// second makes the table regular again. With the caret outside every table it reports
// "no table" and changes nothing.

/** The table that holds the caret: the anchor's node, then its parents up to a `table`. */
async function caretTable() {
  const selection = await mfbe.selection.get();
  if (!selection) return null;
  const anchor = selection.anchor.nodeId;
  const own = await mfbe.doc.getNode(anchor);
  if (own && own.type === 'table') return own;
  let ref = await mfbe.doc.parentOf(anchor);
  while (ref && ref.type !== 'table') ref = await mfbe.doc.parentOf(ref);
  if (!ref) return null;
  const table = await mfbe.doc.getNode(ref);
  return table && table.type === 'table' ? table : null;
}

const cellsOf = (row) => (row.content ?? []).filter((n) => n.type === 'td' || n.type === 'th');

export default async function run() {
  const table = await caretTable();
  const rows = table ? (table.content ?? []).filter((node) => node.type === 'tr') : [];
  if (rows.length === 0) {
    await mfbe.ui.status('no table', { sticky: true });
    return;
  }
  const lastRow = rows[rows.length - 1];
  const first = cellsOf(rows[0]);
  const last = cellsOf(lastRow);
  if (last.length > 0 && last.length === first.length) {
    await mfbe.doc.removeNode(last[last.length - 1].attrs.nodeId);
  } else {
    await mfbe.doc.insertNode('append', lastRow.attrs.nodeId, { type: 'td', content: [] });
  }
}
