// Fixture script (feature 002, US7): changes every paragraph of the book ("#<n> " in front),
// reporting progress, shows the changes (a selection call shows them) and then keeps the
// worker busy until it is cancelled.
export default async function run() {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  for (let i = 0; i < paragraphs.length; i += 1) {
    const text = await mfbe.doc.textOf(paragraphs[i]);
    await mfbe.doc.setText(paragraphs[i], `#${i} ${text}`);
    if (i % 100 === 0) await mfbe.ui.progress(i, paragraphs.length, 'Marking');
  }
  await mfbe.selection.get();
  for (let round = 1; ; round += 1) {
    const until = Date.now() + 200;
    while (Date.now() < until) {
      // busy: the editor must stay usable and Cancel must work meanwhile
    }
    await mfbe.ui.progress(round, 0, 'Busy');
  }
}
