// Converted from FictionBook Editor 2.7.9: Scripts/08_Структура разделов/10_Сбросить структуру разделов ПОЛНОСТЬЮ.js
// Resets the section structure completely. In every body except the notes and comments bodies,
// the body keeps its picture, title and epigraphs, and all its sections, at every level, become
// one section, which keeps the id of the first one: the titles, epigraphs and annotations of the
// sections are dissolved into the text - their paragraphs and empty lines stay where they were,
// as paragraphs (a text author of a section epigraph becomes a paragraph, a subtitle of an
// annotation stays a subtitle) -, while pictures, poems, cites, tables and the text itself are
// kept as they are. The caret goes to the start of the document and the status bar says that
// the reset is done. The original rebuilt the HTML of each body from the class and id of its
// elements and replaced the body; here each body is written with one doc.replaceNode.
// Fixes: the text author of a body epigraph stays a text author (the original took the class
// off every text author of an epigraph, also of the body epigraphs it kept); the titles and
// epigraphs of poems and the titles of stanzas are kept (the original dissolved them too, which
// left paragraphs inside poems - invalid FB2 - and made stanza titles verses); the attributes the
// rebuild dropped are kept (a body's name, the style of paragraphs and tables, the alignment of
// rows and cells, the spans of cells). Should the merged section start with two pictures, an
// <empty-line/> goes between them so that it stays valid FB2.
// The original's notice, kept as written (FR-029):
// Скрипт "Выполнить ПОЛНЫЙ сброс структуры разделов"
// version 1.4
// Автор Sclex

import { edgeTextBlock, isApiError, t } from './lib/text-blocks.js';

/** The section-level elements whose content is dissolved into the text. */
const DISSOLVED = new Set(['title', 'epigraph', 'annotation']);

/** Appends to `out` the content of `section` with its structure dissolved. */
function dissolveSection(section, out) {
  for (const child of section.content ?? []) {
    if (child.type === 'section') dissolveSection(child, out);
    else if (DISSOLVED.has(child.type)) {
      for (const line of child.content ?? []) {
        // A text author of a dissolved epigraph loses its class, as on the original's page.
        out.push(line.type === 'text-author' ? { ...line, type: 'p' } : line);
      }
    } else out.push(child);
  }
}

/** The merged section's content, valid: a second leading picture would be its first block. */
function validContent(content) {
  if (content.length > 1 && content[0].type === 'image' && content[1].type === 'image') {
    return [content[0], { type: 'empty-line', attrs: {} }, ...content.slice(1)];
  }
  return content;
}

/** The caret at the start of the document: the Body view's annotation block, else the first text. */
async function caretToStart() {
  let start = null;
  try {
    await mfbe.selection.selectNode('desc:annotation');
    const selection = await mfbe.selection.get();
    if (selection) start = { nodeId: selection.anchor.nodeId, offset: 0 };
  } catch (error) {
    if (!isApiError(error)) throw error;
  }
  if (!start) {
    const [body] = await mfbe.doc.getElementsByTagName('body');
    const block = body ? edgeTextBlock(await mfbe.doc.getNode(body)) : null;
    if (block?.attrs?.nodeId) start = { nodeId: block.attrs.nodeId, offset: 0 };
  }
  if (!start) return;
  await mfbe.selection.set(start);
  await mfbe.selection.scrollIntoView();
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const bodies = snapshot.bodies ?? [];
  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    const name = body.attrs?.name;
    if (name === 'notes' || name === 'comments') continue;
    const children = body.content ?? [];
    const first = children.find((child) => child.type === 'section');
    if (!first) continue;
    const head = children.filter((child) => child.type !== 'section');
    const merged = [];
    for (const child of children) if (child.type === 'section') dissolveSection(child, merged);
    const section = { type: 'section', attrs: { ...first.attrs }, content: validContent(merged) };
    const content = [...head, section];
    if (JSON.stringify(content) === JSON.stringify(children)) continue;
    await mfbe.doc.replaceNode(body.attrs.nodeId, { ...body, content });
    await mfbe.ui.progress(i + 1, bodies.length);
    if (ctx.cancelled) return;
  }
  await caretToStart();
  await mfbe.ui.status(
    t(ctx, 'Полный сброс структуры разделов успешно завершен.', 'The complete reset of the section structure is done.'),
    { sticky: true },
  );
}
