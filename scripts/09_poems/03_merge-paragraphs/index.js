// Converted from 09_Стихи/03_Слить параграфы.js (FictionBook Editor).
// The original replaced every `</P>\s*<P>` junction inside the selected HTML with a space
// (or with nothing after a trailing hyphen: "сло-" + "во" -> "сло-во"). Here the selected
// consecutive sibling paragraphs (or verse lines) are merged into the first one the same way;
// inline formatting is kept.

const MERGEABLE = new Set(['p', 'v']);

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(ru ? 'Выделите абзацы, которые нужно слить.' : 'Select the paragraphs to merge.', { icon: 'warning' });
    return;
  }
  // Group the selected blocks into runs of adjacent siblings of a mergeable type.
  const groups = [];
  let current = null;
  for (const ref of selection.nodes) {
    const parent = await mfbe.doc.parentOf(ref);
    if (!parent || !MERGEABLE.has(ref.type)) {
      current = null;
      continue;
    }
    const siblings = await mfbe.doc.childrenOf(parent);
    const index = siblings.findIndex((s) => s.nodeId === ref.nodeId);
    if (current && current.parent === parent.nodeId && current.lastIndex === index - 1 && current.type === ref.type) {
      current.refs.push(ref);
      current.lastIndex = index;
    } else {
      current = { parent: parent.nodeId, type: ref.type, lastIndex: index, refs: [ref] };
      groups.push(current);
    }
  }

  let merged = 0;
  for (const group of groups) {
    if (group.refs.length < 2) continue;
    const first = await mfbe.doc.getNode(group.refs[0]);
    const content = [...(first.content ?? [])];
    for (const ref of group.refs.slice(1)) {
      const next = await mfbe.doc.getNode(ref);
      const last = content[content.length - 1];
      // A plain hyphen right before the junction joins the lines without a space.
      const hyphenated = last && last.type === 'text' && !(last.marks ?? []).length && /-$/.test(last.text ?? '');
      if (!hyphenated) content.push({ type: 'text', text: ' ' });
      content.push(...(next.content ?? []));
    }
    await mfbe.doc.replaceNode(group.refs[0], { type: first.type, attrs: { ...first.attrs }, content });
    for (const ref of group.refs.slice(1)) await mfbe.doc.removeNode(ref);
    merged += group.refs.length - 1;
  }
  await mfbe.ui.status(ru ? `Слито абзацев: ${merged}` : `Paragraphs merged: ${merged}`, { sticky: true });
}
