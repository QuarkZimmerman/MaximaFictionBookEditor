// Converted from TreeCmd/Пример 1.js (FictionBook Editor 2.7), Tier 2. The original was the
// sample "document marking" tree command: it wrapped every paragraph whose text contains no
// full stop in <DIV class="abc"> so that the Document Tree listed those paragraphs under the
// title "Пример 1" (GetClassName / GetTitle / ProcessCmd). Tree commands are now context-menu
// entries that receive the clicked node, and highlighting classes do not exist, so the script
// lists the paragraphs without a full stop inside the clicked node (the whole book when it is
// run without a node) and selects the one the user picks.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function inlineText(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
}

/** Text blocks without a "." inside `root`, in document order (the original scanned every <P>). */
function paragraphsWithoutFullStop(root) {
  const out = [];
  const visit = (node) => {
    if (node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      const text = inlineText(node);
      if (!text.includes('.')) out.push({ nodeId: node.attrs?.nodeId, type: node.type, text });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(root);
  return out;
}

export default async function run(ctx) {
  const roots = ctx.treeNode ? [ctx.treeNode] : await mfbe.doc.getElementsByTagName('body');
  const found = [];
  for (const root of roots) found.push(...paragraphsWithoutFullStop(await mfbe.doc.getNode(root)));
  if (!found.length) {
    await mfbe.ui.message(t(ctx, 'Абзацев без точки не найдено.', 'No paragraphs without a full stop were found.'));
    return;
  }
  const values = await mfbe.ui.form({
    title: t(ctx, 'Пример 1: абзацы без точки', 'Example 1: paragraphs without a full stop'),
    width: 520,
    fields: [
      { kind: 'static', id: 'count', text: t(ctx, `Найдено абзацев без точки: ${found.length}`, `Paragraphs without a full stop: ${found.length}`) },
      {
        kind: 'list', id: 'target', label: t(ctx, 'Перейти к абзацу', 'Go to paragraph'), value: [found[0].nodeId],
        options: found.map((p, i) => ({ value: p.nodeId, label: `${i + 1}. ${p.text.length > 60 ? `${p.text.slice(0, 60)}…` : p.text || ' '}` })),
      },
    ],
    okLabel: t(ctx, 'Перейти', 'Go'),
  });
  if (!values) return;
  const target = Array.isArray(values.target) ? values.target[0] : values.target;
  if (!target) return;
  await mfbe.selection.selectNode(target);
  await mfbe.selection.scrollIntoView();
  await mfbe.ui.status(t(ctx, `Абзацев без точки: ${found.length}`, `Paragraphs without a full stop: ${found.length}`), { sticky: true });
}
