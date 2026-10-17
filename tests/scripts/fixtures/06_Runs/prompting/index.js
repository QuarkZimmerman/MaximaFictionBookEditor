// Fixture script (feature 003, US2): changes the second paragraph and highlights it with a
// selection call, then waits in a prompt (the highlight must stay visible and the document
// readable meanwhile) and writes the answer into the third paragraph; Cancel in the prompt
// leaves the third paragraph alone.
export default async function run() {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  if (paragraphs.length < 3) return;
  await mfbe.doc.setText(paragraphs[1], 'Highlighted by the prompting fixture');
  await mfbe.selection.selectNode(paragraphs[1]);
  const answer = await mfbe.ui.prompt('Type anything and press OK', {
    caption: 'Prompting fixture',
  });
  if (answer === null) return;
  await mfbe.doc.setText(paragraphs[2], answer);
}
