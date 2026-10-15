// Fixture script (feature 002, US7): changes every paragraph of the book ("#<n> " in front),
// reporting progress.
export default async function run(ctx) {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  for (let i = 0; i < paragraphs.length; i += 1) {
    const text = await mfbe.doc.textOf(paragraphs[i]);
    await mfbe.doc.setText(paragraphs[i], `#${i} ${text}`);
    if (i % 100 === 0) await mfbe.ui.progress(i, paragraphs.length, 'Marking');
    if (ctx.cancelled) return;
  }
}
