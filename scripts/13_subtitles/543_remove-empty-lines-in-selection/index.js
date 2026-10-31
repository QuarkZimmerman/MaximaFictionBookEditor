// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/543_Удалить пустые строки в выделении.js
// Removes the empty lines in the selection: from the paragraph where the selection starts to the
// one where it ends (only the caret's paragraph without a selection), every empty line, and every
// paragraph, subtitle, verse or text author of spaces and non-breaking spaces only (a picture
// counts as content), goes - unless it is the only child of its element, which keeps one. The
// paragraphs are processed from the last one, as in the original; the status bar gives the count.
//
// Differences from the original (docs/scripting/notes-279-drafts/13.md):
// - fix: empty table cells are left alone; the original took the cells of a table in the
//   selection for empty lines and removed them, which broke the table's rows;
// - fix: a selection that ends inside formatted text (bold, italics, a link) ends there; the
//   original then did not find the end of the selection and went on to the end of the book;
// - a removal the schema forbids (the empty line of a section that would keep only its title) is
//   not made and is counted in the status bar (2.7.9 wrote the invalid section);
// - the original's message for a selection inside an input field has no counterpart: a script
//   only sees the Body view.
// The original's notice, kept as written (FR-029):
// Скрипт «Удалить пустые строки в выделении»
// Автор Sclex
// Версия 1.3
 //имя тэга, который будет использован для маркеров начала и конца выделения

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** What FictionBook Editor showed as a <P>; table cells are not empty lines (fix). */
const P_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'date', 'empty-line']);

/** The original's isLineEmpty: innerHTML without its tags (pictures kept) holds only spaces. */
function isLineEmpty(node) {
  if (node.type === 'empty-line') return true;
  const content = node.content ?? [];
  if (content.some((c) => c.type !== 'text')) return false;
  return /^[  ]*$/.test(content.map((c) => c.text).join(''));
}

/** Every paragraph of the bodies in document order, with its parent. */
function paragraphs(doc) {
  const out = [];
  const visit = (node) => {
    for (const child of node.content ?? []) {
      if (child.type === 'text') continue;
      if (P_TYPES.has(child.type)) out.push({ node: child, parent: node });
      else if (child.type !== 'td' && child.type !== 'th') visit(child);
    }
  };
  for (const body of doc.bodies ?? []) visit(body);
  return out;
}

export default async function run(ctx) {
  const statusBarMsg = t(ctx, 'Удаляем пустые строки в выделении…', 'Removing the empty lines in the selection…');
  await mfbe.ui.status(statusBarMsg);
  const selection = await mfbe.selection.get();
  const doc = await mfbe.doc.get();
  const all = paragraphs(doc);
  const a = selection ? all.findIndex((p) => p.node.attrs.nodeId === selection.anchor.nodeId) : -1;
  const h = selection ? all.findIndex((p) => p.node.attrs.nodeId === selection.head.nodeId) : -1;
  const ps = a < 0 || h < 0 ? [] : all.slice(Math.min(a, h), Math.max(a, h) + 1);
  let removesCnt = 0;
  let refused = 0;
  for (let i = ps.length - 1; i >= 0; i -= 1) {
    const { node, parent } = ps[i];
    if (!isLineEmpty(node) || (parent.content ?? []).length < 2) continue;
    try {
      await mfbe.doc.removeNode(node.attrs.nodeId);
      parent.content.splice(parent.content.indexOf(node), 1);
      removesCnt += 1;
    } catch {
      refused += 1;
    }
    if (ctx.cancelled) return;
  }
  let text = t(ctx, `Было удалено пустых строк в выделении: ${removesCnt}.`, `Empty lines removed in the selection: ${removesCnt}.`);
  if (refused) text += t(ctx, ` Не удалено (запрещено структурой документа): ${refused}.`, ` Not removed (the document structure forbids it): ${refused}.`);
  await mfbe.ui.status(text, { sticky: true });
}
