// Converted from TreeCmd/Пример 1.js (FictionBook Editor 2.7), Tier 2. The original was the
// sample "document marking" tree command: it wrapped every paragraph whose text contains no
// full stop in <DIV class="abc"> so that the Document Tree listed those paragraphs under the
// title "Пример 1" (GetClassName / GetTitle / ProcessCmd). Since feature 011 the Document tree
// bar's Scripts menu runs it as the original did: the tree lists those paragraphs as rows in
// their places, with this script's icon, until Clean - without marking or changing the book
// (mfbe.tree.showRows, script API version 3).

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function t(ctx, ru, uk, en) {
  if (ctx.uiLanguage === 'ru') return ru;
  if (ctx.uiLanguage === 'uk') return uk;
  return en;
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
      if (!text.includes('.')) out.push({ nodeId: node.attrs?.nodeId, text });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(root);
  return out;
}

export default async function run(ctx) {
  const found = [];
  for (const body of await mfbe.doc.getElementsByTagName('body')) {
    found.push(...paragraphsWithoutFullStop(await mfbe.doc.getNode(body)));
  }
  // One row per paragraph, captioned with its text (the tree cuts it to 80 characters).
  const shown = await mfbe.tree.showRows(
    found
      .filter((p) => p.nodeId)
      .map((p) => (p.text.trim() ? { node: p.nodeId, caption: p.text } : { node: p.nodeId })),
  );
  await mfbe.ui.status(
    shown
      ? t(
          ctx,
          `Абзацев без точки: ${shown}`,
          `Абзаців без крапки: ${shown}`,
          `Paragraphs without a full stop: ${shown}`,
        )
      : t(
          ctx,
          'Абзацев без точки не найдено.',
          'Абзаців без крапки не знайдено.',
          'No paragraphs without a full stop were found.',
        ),
    { sticky: true },
  );
}
