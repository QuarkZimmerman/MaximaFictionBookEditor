// Converted from 06_Чистка/21_Удаление тегов style.js (FictionBook Editor).
// The original removed every <SPAN> of the rendered book except the ones standing for <code>
// and inline images, i.e. the FB2 <style name="..."> elements. Here every `style` mark is
// stripped from every run - text and inline pictures alike, nested styles included (feature
// 006) -; the text itself is kept. Each style a run starts that the previous run did not carry
// counts as one removed <style> element.
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

  const sameStyle = (a, b) => JSON.stringify(a.attrs ?? {}) === JSON.stringify(b.attrs ?? {});
  let removed = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    const node = blocks[i];
    let changed = false;
    let previous = [];
    const content = (node.content ?? []).map((run) => {
      const styles = (run.marks ?? []).filter((m) => m.type === 'style');
      // Consecutive runs with the same style are one removed <style> element.
      for (const style of styles) {
        if (!previous.some((other) => sameStyle(other, style))) removed += 1;
      }
      previous = styles;
      if (!styles.length) return run;
      changed = true;
      const marks = run.marks.filter((m) => m.type !== 'style');
      if (run.type === 'text') return marks.length ? { ...run, marks } : { type: 'text', text: run.text };
      const atom = { ...run, marks };
      if (!marks.length) delete atom.marks;
      return atom;
    });
    if (changed) await mfbe.doc.replaceNode({ nodeId: node.attrs.nodeId, type: node.type }, { type: node.type, attrs: { ...node.attrs }, content });
    if (i % 100 === 0) await mfbe.ui.progress(i, blocks.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(ru ? `Удалено тегов style: ${removed}` : `Style tags removed: ${removed}`, { sticky: true });
}
