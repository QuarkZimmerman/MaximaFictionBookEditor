// Fixture script (feature 002, US7): changes the first ten paragraphs, asks whether to go on
// (the changes so far must be visible meanwhile) and changes the next ten on OK.
export default async function run() {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  for (let i = 0; i < 10; i += 1) await mfbe.doc.setText(paragraphs[i], `Changed ${i}`);
  const answer = await mfbe.ui.message('The first ten paragraphs were changed. Go on?', {
    buttons: [
      { id: 'ok', label: '', default: true },
      { id: 'cancel', label: '', cancel: true },
    ],
  });
  if (answer !== 'ok') return;
  for (let i = 10; i < 20; i += 1) await mfbe.doc.setText(paragraphs[i], `Second ${i}`);
}
