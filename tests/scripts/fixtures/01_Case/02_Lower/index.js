export default async function run() {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) return;
  await mfbe.selection.replaceText(selection.text.toLowerCase());
}
