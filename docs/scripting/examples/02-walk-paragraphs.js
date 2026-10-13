// Walks every paragraph of the book and removes double spaces.
// Capabilities: doc.getElementsByTagName, doc.textOf, doc.setText, ui.progress.
export default async function run(ctx) {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  let changed = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const ref = paragraphs[i];
    const text = await mfbe.doc.textOf(ref);
    const fixed = text.replace(/ {2,}/g, ' ');
    if (fixed !== text) {
      // setText keeps the paragraph but drops inline markup: use doc.replaceAll to keep it.
      await mfbe.doc.setText(ref, fixed);
      changed += 1;
    }
    if (i % 50 === 0) await mfbe.ui.progress(i, paragraphs.length, 'Cleaning paragraphs');
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(`${changed} paragraph(s) cleaned`, { sticky: true });
}
