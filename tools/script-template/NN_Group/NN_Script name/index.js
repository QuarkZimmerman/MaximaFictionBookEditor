// Template script. See docs/scripting/en.md (English) or docs/scripting/ru.md (Russian).
// Every mfbe call returns a Promise: always `await` it. The whole run is one undo step.

export default async function run(ctx) {
  // 1. Read what you need.
  const selection = await mfbe.selection.get();
  const paragraphs = await mfbe.doc.getElementsByTagName('p');

  // 2. Ask the user (message box, prompt or a form).
  const answer = await mfbe.ui.prompt('Text to append:', { caption: ctx.script.name, defaultValue: '' });
  if (answer === null) return; // Cancel

  // 3. Change the document.
  for (let i = 0; i < paragraphs.length; i += 1) {
    const ref = paragraphs[i];
    const text = await mfbe.doc.textOf(ref);
    if (text.trim() === '') continue;
    await mfbe.doc.setText(ref, `${text}${answer}`);
    if (i % 100 === 0) await mfbe.ui.progress(i, paragraphs.length);
    if (ctx.cancelled) return;
  }

  // 4. Report.
  await mfbe.ui.status(
    selection ? `Done (selection was "${selection.text}")` : 'Done',
    { sticky: true },
  );
}
