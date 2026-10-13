// Converted from 08_Структура разделов/04_Сброс структуры разделов.js (FictionBook Editor 2.7),
// Tier 2. Flattens the top level of every body by one step: a top-level section that contains
// subsections is replaced by (a) a section carrying its id and its own children that are not
// sections (title, epigraph, image, annotation...) and (b) its subsections, now at the top level.
// Sections without subsections are left alone; the promoted subsections are not processed again
// (run the script once more to flatten the next level), exactly like the original.
// A header-only section gets an <empty-line/> so that it stays valid FB2 (the original wrote
// sections holding only a title).

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** Deep copy without nodeIds (a node moved elsewhere must get fresh ids). */
function stripIds(node) {
  if (!node || typeof node !== 'object') return node;
  const copy = { ...node };
  if (copy.attrs) {
    const attrs = { ...copy.attrs };
    delete attrs.nodeId;
    copy.attrs = attrs;
  }
  if (Array.isArray(copy.content)) copy.content = copy.content.map(stripIds);
  return copy;
}

export default async function run(ctx) {
  const doc = await mfbe.doc.get();
  let flattened = 0;
  for (const body of doc.bodies) {
    for (const child of body.content) {
      if (child.type !== 'section') continue;
      const subsections = child.content.filter((c) => c.type === 'section');
      if (subsections.length === 0) continue;
      const own = child.content.filter((c) => c.type !== 'section');
      const replacements = [];
      if (own.length > 0) {
        const hasBlocks = own.some((c) => !['title', 'epigraph', 'image', 'annotation'].includes(c.type));
        replacements.push({
          type: 'section',
          attrs: child.attrs.id ? { id: child.attrs.id } : {},
          content: hasBlocks ? own : [...own, { type: 'empty-line', attrs: {} }],
        });
      }
      replacements.push(...subsections.map(stripIds));
      // The first replacement takes the place of the section, the others follow it.
      let ref = await mfbe.doc.replaceNode(child.attrs.nodeId, replacements[0]);
      for (const next of replacements.slice(1)) ref = await mfbe.doc.insertNode('after', ref, next);
      flattened += 1;
      if (ctx.cancelled) return;
    }
  }
  await mfbe.ui.status(t(ctx, `Разделов развёрнуто: ${flattened}`, `Sections flattened: ${flattened}`), { sticky: true });
}
