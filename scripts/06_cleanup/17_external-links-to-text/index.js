// Converted from 06_Чистка/17_Превращение внешних ссылок в текст.js (FictionBook Editor).
// Every link whose address does not start with "#" or "file://" (the original test
// `^ *?(file://|#)`, case-insensitive) is unwrapped: the link mark is removed, the text stays.

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const KEEP = /^ *?(file:\/\/|#)/i;

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const snapshot = await mfbe.doc.get();
  let removed = 0;
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

  for (let i = 0; i < blocks.length; i += 1) {
    const node = blocks[i];
    let changed = false;
    let previousHref = null;
    const content = (node.content ?? []).map((run) => {
      if (run.type !== 'text') {
        previousHref = null;
        return run;
      }
      const link = (run.marks ?? []).find((m) => m.type === 'link');
      if (!link || KEEP.test(link.attrs?.href ?? '')) {
        previousHref = null;
        return run;
      }
      // Consecutive runs of one link count as one removed <a>, like document.links did.
      if (previousHref !== (link.attrs?.href ?? '')) removed += 1;
      previousHref = link.attrs?.href ?? '';
      changed = true;
      const marks = run.marks.filter((m) => m !== link);
      return marks.length ? { ...run, marks } : { type: 'text', text: run.text };
    });
    if (changed) await mfbe.doc.replaceNode({ nodeId: node.attrs.nodeId, type: node.type }, { type: node.type, attrs: { ...node.attrs }, content });
    if (i % 100 === 0) await mfbe.ui.progress(i, blocks.length);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(ru ? `Внешних ссылок превращено в текст: ${removed}` : `External links turned into text: ${removed}`, { sticky: true });
}
