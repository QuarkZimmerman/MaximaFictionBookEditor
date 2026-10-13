// Cooperative long run: report progress (a cancel point) and stop when the user cancels.
// Capabilities: ui.progress, ctx.cancelled, selection.set, edit.nbsp.
export default async function run(ctx) {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  for (let i = 0; i < paragraphs.length; i += 1) {
    const text = await mfbe.doc.textOf(paragraphs[i]);
    // Insert a non-breaking space after one-letter prepositions (Russian typography).
    const fixed = text.replace(/(^|\s)([вксуоиа])\s/giu, `$1$2${mfbe.edit.nbsp}`);
    if (fixed !== text) await mfbe.doc.setText(paragraphs[i], fixed);
    await mfbe.ui.progress(i + 1, paragraphs.length, 'Non-breaking spaces');
    if (ctx.cancelled) break; // the host may also terminate the worker outright
  }
  if (paragraphs.length > 0) await mfbe.selection.set({ nodeId: paragraphs[0].nodeId, offset: 0 });
}
