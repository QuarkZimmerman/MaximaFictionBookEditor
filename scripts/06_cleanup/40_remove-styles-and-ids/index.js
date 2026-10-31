// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/40_Удалить теги style, id разделов, id абзацев и id картинок.js
// Does in one run what 21, 30, 35 and 38 do: removes every <style> element of the book (the
// title-info annotation and the document-info history included, which the original's page showed
// with the bodies) keeping its text, then the ids of the text blocks of every body, the ids of the
// sections of every body except the notes body (and a "comments" body) and the ids of the block
// pictures of every body. Reports the four counts.
// Differences: a run of text that carries one style counts as one <style> element (the editor keeps
// formatting as marks, so two adjacent elements of one style are one); a style named "code" or
// "image", which the original's page could not tell from <code> and an inline picture and therefore
// kept, is removed like any other style. Inline elements the editor keeps as raw XML (unknown to
// FB2), which the original's page showed as <span> and unwrapped too, are kept. The run is one undo
// step (the original left its undo unit open when only the first three phases changed something).
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить теги style, id разделов, id абзацев и id картинок v1.2" 
// Автор Sclex

import { Changes, TEXT_BLOCK_TYPES, bodyName, forEachNode, hasId, pageParts, stripMarks, t } from './lib/book.js';

const PARAGRAPHS = new Set(['p', 'v', 'subtitle', 'text-author', 'td', 'th']);

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  const isStyle = (mark) => mark.type === 'style';

  // 1. Every <span> of the page that is neither code nor an inline picture: the <style> elements.
  let styles = 0;
  for (const part of pageParts(snapshot)) {
    forEachNode(part.node, (node, ancestors) => {
      if (!TEXT_BLOCK_TYPES.has(node.type) || !node.content) return;
      const { content, removed } = stripMarks(node.content, isStyle);
      if (!removed) return;
      node.content = content;
      changes.mark(node, ancestors, part);
      styles += removed;
    });
  }

  // 2. The ids of the <P> elements of every body.
  let paragraphs = 0;
  // 3. The ids of the sections of every body but the notes (and comments) body.
  let sections = 0;
  // 4. The ids of the block pictures of every body.
  let pictures = 0;
  for (const body of snapshot.bodies ?? []) {
    const name = bodyName(body);
    const notes = name === 'notes' || name === 'comments';
    forEachNode(body, (node, ancestors) => {
      if (!hasId(node)) return;
      if (PARAGRAPHS.has(node.type)) paragraphs += 1;
      else if (node.type === 'section' && !notes) sections += 1;
      else if (node.type === 'image') pictures += 1;
      else return;
      delete node.attrs.id;
      changes.mark(node, ancestors);
    });
  }

  if (!(await changes.commit(ctx, ctx.script.name))) return;
  await mfbe.ui.message(
    t(
      ctx,
      `Всего удалено тегов style: ${styles}\nВсего удалено id абзацев: ${paragraphs}\nВсего удалено id разделов: ${sections}\nВсего удалено id картинок: ${pictures}`,
      `Style tags removed in all: ${styles}\nParagraph ids removed in all: ${paragraphs}\nSection ids removed in all: ${sections}\nPicture ids removed in all: ${pictures}`,
    ),
    { caption: ctx.script.name, icon: 'info' },
  );
}
