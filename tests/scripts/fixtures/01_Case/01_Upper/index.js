// Fixture script: upper-cases the selected text (one undo step).
export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message('Select some text first.', { caption: ctx.script.name });
    return;
  }
  await mfbe.selection.replaceText(selection.text.toUpperCase());
  await mfbe.ui.status('Upper case applied');
}
