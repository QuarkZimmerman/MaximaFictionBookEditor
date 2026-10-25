// Fixture script (feature 006, FR-049): reads the table that holds the caret through the script
// API and reports it in a sticky status line - the number of rows, then per row its cells' kinds
// with their spans above 1, for example "3 rows: th th th | td td colspan=2 | td td td". With
// the caret outside every table it reports "no table" and changes nothing.

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

const isCell = (node) => node.type === 'td' || node.type === 'th';

/** A span worth naming: a whole number above 1. */
const named = (value) => typeof value === 'number' && value > 1;

function describeCell(cell) {
  const attrs = cell.attrs ?? {};
  let text = cell.type;
  if (named(attrs.colspan)) text += ` colspan=${attrs.colspan}`;
  if (named(attrs.rowspan)) text += ` rowspan=${attrs.rowspan}`;
  return text;
}

export default async function run() {
  const table = await caretTable();
  if (!table) {
    await mfbe.ui.status('no table', { sticky: true });
    return;
  }
  const rows = (table.content ?? []).filter((node) => node.type === 'tr');
  const parts = rows.map((row) => (row.content ?? []).filter(isCell).map(describeCell).join(' '));
  await mfbe.ui.status(`${rows.length} rows: ${parts.join(' | ')}`, { sticky: true });
}
