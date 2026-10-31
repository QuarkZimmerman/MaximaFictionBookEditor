// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/45_Удалить атрибуты id, на которые нет ссылок, и теги style.js
// Removes the ids no link points to, and every <style> element (keeping its text). First the ids the
// links of the book point to are collected (any letter case: "#P3" keeps the id "p3"); then the
// styles are removed in the whole book (the title-info annotation and the document-info history
// included), then the unreferenced ids of the text blocks of every body, of the block pictures of
// every body and of the other block elements (sections, epigraphs, section annotations, cites,
// poems, tables) of every body except the notes body (and a "comments" body). Reports the four
// counts.
// A link points to an id when its address starts with "#" (spaces before it ignored, as the
// original's page resolved the address) or contains "main.html#" (the original read the resolved
// address of its page, file:///.../main.html#id).
// Differences: a run of text that carries one style counts as one <style> element; a style named
// "code" or "image" is removed like any other style (the original's page could not tell it from
// <code> and an inline picture); inline raw XML (elements unknown to FB2) is kept, where the page
// unwrapped it. The run is one undo step.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить атрибуты id, на которые нет ссылок, и теги style v1.1" 
// Автор Sclex
 //соберем id-ы, на которые есть ссылки
 //удалим теги style

import { Changes, TEXT_BLOCK_TYPES, bodyName, forEachNode, hasId, pageParts, stripMarks, t } from './lib/book.js';

const PARAGRAPHS = new Set(['p', 'v', 'subtitle', 'text-author', 'td', 'th']);
// The div elements of the page that could carry an id, pictures aside.
const BLOCKS = new Set(['section', 'epigraph', 'annotation', 'cite', 'poem', 'stanza', 'title', 'table', 'tr']);

/** The id a link's address points to (the part after the first "#"), or null. */
function linkTarget(href) {
  const address = String(href ?? '').trim();
  if (address.indexOf('#') === 0 || address.search('main.html#') >= 0) return address.substr(address.search('#') + 1);
  return null;
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const changes = new Changes(snapshot);
  const parts = pageParts(snapshot);

  // The ids the links point to (document.links), in lower case.
  const usingIds = new Set();
  for (const part of parts) {
    forEachNode(part.node, (node) => {
      if (!TEXT_BLOCK_TYPES.has(node.type)) return;
      for (const item of node.content ?? []) {
        for (const mark of item.marks ?? []) {
          if (mark.type !== 'link') continue;
          const target = linkTarget(mark.attrs?.href);
          if (target !== null) usingIds.add(target.toLowerCase());
        }
      }
    });
  }
  const unreferenced = (node) => hasId(node) && !usingIds.has(node.attrs.id.toLowerCase());

  // The <style> elements of the whole page.
  let styles = 0;
  for (const part of parts) {
    forEachNode(part.node, (node, ancestors) => {
      if (!TEXT_BLOCK_TYPES.has(node.type) || !node.content) return;
      const { content, removed } = stripMarks(node.content, (mark) => mark.type === 'style');
      if (!removed) return;
      node.content = content;
      changes.mark(node, ancestors, part);
      styles += removed;
    });
  }

  const bodies = snapshot.bodies ?? [];
  const drop = (node, ancestors) => {
    delete node.attrs.id;
    changes.mark(node, ancestors);
  };
  // The ids of the <P> elements of every body.
  let paragraphs = 0;
  for (const body of bodies) {
    forEachNode(body, (node, ancestors) => {
      if (PARAGRAPHS.has(node.type) && unreferenced(node)) {
        drop(node, ancestors);
        paragraphs += 1;
      }
    });
  }
  // The ids of the block pictures of every body.
  let pictures = 0;
  for (const body of bodies) {
    forEachNode(body, (node, ancestors) => {
      if (node.type === 'image' && unreferenced(node)) {
        drop(node, ancestors);
        pictures += 1;
      }
    });
  }
  // The ids of the block elements of every body but the notes (and comments) body.
  let blocks = 0;
  for (const body of bodies) {
    const name = bodyName(body);
    if (name === 'notes' || name === 'comments') continue;
    forEachNode(body, (node, ancestors) => {
      if (node === body) return;
      if ((BLOCKS.has(node.type) || node.type === 'image') && unreferenced(node)) {
        drop(node, ancestors);
        blocks += 1;
      }
    });
  }

  if (!(await changes.commit(ctx, ctx.script.name))) return;
  await mfbe.ui.message(
    t(
      ctx,
      `Всего удалено тегов style: ${styles}\nВсего удалено атрибутов id абзацных тегов: ${paragraphs}\nВсего удалено атрибутов id блочных элементов: ${blocks}\nВсего удалено атрибутов id картинок: ${pictures}`,
      `Style tags removed in all: ${styles}\nId attributes of paragraph tags removed in all: ${paragraphs}\nId attributes of block elements removed in all: ${blocks}\nId attributes of pictures removed in all: ${pictures}`,
    ),
    { caption: ctx.script.name, icon: 'info' },
  );
}
