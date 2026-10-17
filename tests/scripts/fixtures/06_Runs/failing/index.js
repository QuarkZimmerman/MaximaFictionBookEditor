// Fixture script (feature 003, US2): changes the first paragraph, waits 2 s (the change and
// the indicator are visible meanwhile) and then fails with an error; the editor must report
// the error and restore the document as it was before the run.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function run() {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  if (paragraphs.length > 0) await mfbe.doc.setText(paragraphs[0], 'Changed by the failing run');
  await pause(2000);
  throw new Error('Failing fixture: deliberate failure');
}
