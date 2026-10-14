// Converted from 06_Чистка/21_Удаление тегов style.js (FictionBook Editor).
// The original removed every <SPAN> of the rendered book except the ones standing for <code>
// and inline images, i.e. the FB2 <style name="..."> elements. Here the `style` mark is
// stripped from every text run; the text itself is kept.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Скрипт «Удаление тегов style» v1.0
//Автор Sclex

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const snapshot = await mfbe.doc.get();
  const blocks = [];
  const collect = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      blocks.push(node);
      return;
    }
    for (const child of node.content ?? []) collect(child);
  };
  for (const body of snapshot.bodies ?? []) collect(body);

  let removed = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const node = blocks[i];
    let changed = false;
    let previous = null;
    const content = (node.content ?? []).map((run) => {
      const style = run.type === 'text' ? (run.marks ?? []).find((m) => m.type === 'style') : null;
      if (!style) {
        previous = null;
        return run;
      }
      // Consecutive runs with the same style are one removed <style> element.
      if (previous !== (style.attrs?.name ?? '')) removed += 1;
      previous = style.attrs?.name ?? '';
      changed = true;
      const marks = run.marks.filter((m) => m !== style);
      return marks.length ? { ...run, marks } : { type: 'text', text: run.text };
    });
    if (changed) await mfbe.doc.replaceNode({ nodeId: node.attrs.nodeId, type: node.type }, { type: node.type, attrs: { ...node.attrs }, content });
    if (i % 100 === 0) await mfbe.ui.progress(i, blocks.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(ru ? `Удалено тегов style: ${removed}` : `Style tags removed: ${removed}`, { sticky: true });
}
