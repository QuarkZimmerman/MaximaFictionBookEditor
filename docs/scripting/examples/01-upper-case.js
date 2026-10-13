// Upper-cases the selected text (needsSelection: true in script.json).
// Capabilities: selection.get, selection.replaceText, ui.message, ui.status.
export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message('Select some text first.', { caption: ctx.script.name, icon: 'info' });
    return;
  }
  await mfbe.selection.replaceText(selection.text.toUpperCase());
  await mfbe.ui.status('Upper case applied');
}
