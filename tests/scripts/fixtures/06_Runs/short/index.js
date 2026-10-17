// Fixture script (feature 003, US2): changes one paragraph and ends within 2 s without any
// progress report - about 1 s, long enough for the indicator to be seen and too short for a
// completion notice.
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function run() {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  if (paragraphs.length === 0) return;
  await mfbe.doc.setText(paragraphs[0], 'Changed by the short run');
  await pause(1000);
}
