// Test package of the suite (not bundled): the workflow of 40/replace-tables-with-pictures - the
// first pass (pictures and labels above the tables), then, once the pictures are set (here they
// stay "#undefined"), the second pass that deletes the tables and their labels.
export default async function run(ctx) {
  await mfbe.scripts.run('40/replace-tables-with-pictures');
  await mfbe.scripts.run('40/replace-tables-with-pictures');
}
