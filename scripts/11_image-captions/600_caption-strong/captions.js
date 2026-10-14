// Shared implementation of the "image title to caption" scripts (group 11).
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//author: Sclex
//version: 1.1
//Sclex, не забывай изменять номер версии в переменной versionStr

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

/** True for the legacy "empty <P>": an empty line or a text block without any text. */
function isEmptyBlock(ref, node) {
  if (ref.type === 'empty-line') return true;
  if (!TEXT_BLOCK_TYPES.has(ref.type)) return false;
  return (node.content ?? []).every((c) => c.type === 'text' && !(c.text ?? '').trim());
}

export async function captionsFromImageTitles(ctx, { blockType, mark }) {
  const ru = ctx.uiLanguage === 'ru';
  const images = await mfbe.doc.getElementsByTagName('image');
  let seen = 0;
  let changed = 0;
  let skipped = 0;
  for (let i = 0; i < images.length; i += 1) {
    const ref = images[i];
    const node = await mfbe.doc.getNode(ref);
    seen += 1;
    const title = node.attrs?.title;
    if (!title) continue;
    const parent = await mfbe.doc.parentOf(ref);
    if (!parent) continue;
    const siblings = await mfbe.doc.childrenOf(parent);
    const index = siblings.findIndex((s) => s.nodeId === ref.nodeId);
    const next = index >= 0 ? siblings[index + 1] : undefined;
    const caption = {
      type: blockType,
      attrs: {},
      content: [{ type: 'text', text: title, ...(mark ? { marks: [{ type: mark }] } : {}) }],
    };
    try {
      // Insert the empty line first, then the caption before it (the legacy insertion order).
      if (next && !isEmptyBlock(next, await mfbe.doc.getNode(next))) {
        await mfbe.doc.insertNode('after', ref, { type: 'empty-line', attrs: {} });
      }
      await mfbe.doc.insertNode('after', ref, caption);
    } catch (error) {
      // The schema forbids a caption here (e.g. the body image before the title): leave it.
      skipped += 1;
      continue;
    }
    const attrs = { ...node.attrs };
    delete attrs.title;
    await mfbe.doc.replaceNode(ref, { type: 'image', attrs });
    changed += 1;
    if (i % 20 === 0) await mfbe.ui.progress(i, images.length);
    if (ctx.cancelled) return;
  }
  const lines = ru
    ? ['--== Скрипт Sclex’а ==--', 'Заголовки картинок в подписи 1.1', '', `Встретилось картинок: ${seen}`, `Заменено заголовков картинки на подпись: ${changed}`]
    : ['--== Script by Sclex ==--', 'Image titles to captions 1.1', '', `Images found: ${seen}`, `Titles turned into captions: ${changed}`];
  if (skipped) lines.push(ru ? `Пропущено (подпись здесь недопустима): ${skipped}` : `Skipped (a caption is not allowed there): ${skipped}`);
  await mfbe.ui.message(lines.join('\n'), { caption: ctx.script.name, icon: 'info' });
}
