// Fixture script (Tier 2): structural edits through mfbe.doc.
export default async function run() {
  const sections = await mfbe.doc.getElementsByTagName('section');
  const first = sections[0];
  const paragraphs = await mfbe.doc.getElementsByTagName('p', first);
  const count = paragraphs.length;
  const added = await mfbe.doc.insertNode('append', first, {
    type: 'p', attrs: {}, content: [{ type: 'text', text: `Added by script (${count} paragraphs before)` }],
  });
  await mfbe.doc.insertNode('after', added, { type: 'empty-line', attrs: {} });
  await mfbe.ui.status(`Appended after ${count} paragraphs`, { sticky: true });
}
