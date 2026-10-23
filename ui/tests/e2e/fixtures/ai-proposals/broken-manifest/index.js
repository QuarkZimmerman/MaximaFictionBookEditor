/* global mfbe */
// Entry module of the broken-manifest proposal: valid on its own, never written because the
// manifest next to it has no name.en.

export default async function run() {
  await mfbe.ui.status('broken manifest');
}
