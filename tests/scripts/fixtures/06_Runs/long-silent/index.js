// Fixture script (feature 003, US2): changes the first paragraph, then keeps the worker busy
// for 40 s without any progress report or dialog (the editor marks the run silent after 30 s)
// and ends normally. Cancel must work throughout: the editor terminates the worker, and the
// slices below also let a cooperative cancel through without a single editor call.
const BUSY_MS = 40_000;
const SLICE_MS = 50;

export default async function run(ctx) {
  const paragraphs = await mfbe.doc.getElementsByTagName('p');
  if (paragraphs.length === 0) return;
  await mfbe.doc.setText(paragraphs[0], 'Changed by the long silent run');
  const end = Date.now() + BUSY_MS;
  while (Date.now() < end) {
    const slice = Date.now() + SLICE_MS;
    while (Date.now() < slice) {
      // busy: no progress, no dialog - the editor must stay usable and Cancel must work
    }
    // A timer, not an editor call: the run stays silent, but a pending cancel can arrive.
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (ctx.cancelled) return;
  }
}
