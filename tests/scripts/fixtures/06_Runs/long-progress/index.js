// Fixture script (feature 003, US2): changes the first paragraph, then reports progress for
// at least 8 s - the first 4 s with a total (the indicator shows the phase and a percentage),
// the next 4 s as a bare count (total 0 means "no total": the phase and the count) - and
// ends normally.
const STEPS = 40;
const STEP_MS = 100;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function run(ctx) {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  if (paragraphs.length === 0) return;
  await mfbe.doc.setText(paragraphs[0], 'Changed by the long run with progress');
  for (let i = 1; i <= STEPS; i += 1) {
    await mfbe.ui.progress(i, STEPS, 'Counting');
    if (ctx.cancelled) return;
    await pause(STEP_MS);
  }
  for (let i = 1; i <= STEPS; i += 1) {
    await mfbe.ui.progress(i, 0, 'Still working');
    if (ctx.cancelled) return;
    await pause(STEP_MS);
  }
}
