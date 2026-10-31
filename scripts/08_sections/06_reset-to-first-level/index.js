// Converted from FictionBook Editor 2.7.9: Scripts/08_Структура разделов/06_Cбросить структуру до разделов первого уровня.js
// Makes every section of the book a first-level section. In every body except the notes and
// comments bodies, each section contributes, in document order, one first-level section holding
// its own title, epigraphs, picture, annotation and text (whatever is not a subsection); its
// subsections follow, flattened the same way. A section that held only subsections leaves
// nothing behind. The original rebuilt each body's HTML from these runs (an outerHTML walk) and
// wrote it back in one step; here the new content of a body is written with one doc.replaceNode.
// Differences: a section left with its title, epigraphs, picture or annotation only (a section
// whose text was all in subsections) gets an <empty-line/>, so that it stays valid FB2 (the
// original wrote it with its heading only). Fixes: the body's own picture, title and epigraphs
// stay in the body (the original wrapped them in a first section of their own, which made the
// book title a chapter title and, the picture coming first, an invalid section); each new section
// keeps the id of the section it comes from (the original wrote every section without its id,
// breaking the links to them).
// The original's notice, kept as written (FR-029):
// Скрипт "сброс структуры до разделов первого уровня"
// Версия 1.1
         //alert("Результат:\n\n"+htmlStr);

/** The children of a section that may stand before its subsections or its text. */
const HEADER = new Set(['title', 'epigraph', 'image', 'annotation']);

/**
 * Appends to `out` the first-level sections that `section` turns into: its own children (if
 * any) as one section with its attributes, then each of its subsections, recursively.
 */
function flatten(section, out) {
  const own = (section.content ?? []).filter((child) => child.type !== 'section');
  if (own.length > 0) {
    const hasText = own.some((child) => !HEADER.has(child.type));
    out.push({
      type: 'section',
      attrs: { ...section.attrs },
      content: hasText ? own : [...own, { type: 'empty-line', attrs: {} }],
    });
  }
  for (const child of section.content ?? []) {
    if (child.type === 'section') flatten(child, out);
  }
}

/** Whether every section of the body is already a first-level section without subsections. */
function isFlat(body) {
  return (body.content ?? []).every(
    (child) => child.type !== 'section' || !(child.content ?? []).some((c) => c.type === 'section'),
  );
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const bodies = snapshot.bodies ?? [];
  for (let i = 0; i < bodies.length; i += 1) {
    const body = bodies[i];
    const name = body.attrs?.name;
    if (name === 'notes' || name === 'comments') continue;
    if (!(body.content ?? []).length || isFlat(body)) continue;
    const head = [];
    const sections = [];
    for (const child of body.content) {
      if (child.type === 'section') flatten(child, sections);
      else head.push(child);
    }
    await mfbe.doc.replaceNode(body.attrs.nodeId, { ...body, content: [...head, ...sections] });
    await mfbe.ui.progress(i + 1, bodies.length);
    if (ctx.cancelled) return;
  }
}
