// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/40_Сделать выделенный
// текст ссылкой на MIDI-файл (для AlReader'а).js (first converted from 2.7beta1's 02_Вставить
// ссылку на midi....js). The original has no notice of its own.
// The HTML dialog "HTML/Сделать выделенный текст ссылкой на MIDI-файл (для AlReader'а).html" (a
// box that starts with "file:", a Browse button that puts the chosen file's name into it, and
// the buttons "Сделать выделенный текст ссылкой" and "Закрыть") becomes a form. Its button turns
// the selected text into a superscript link to the file (`<a l:href="file:NAME"><sup>…</sup></a>`;
// superscripts inside the selection merge into it). Differences from the original: there is no
// file picker in the script sandbox, so the name is typed; a name typed after the box's "file:"
// (or with it) gives "file:NAME", where the original wrote "file:file:NAME", and an empty name
// changes nothing.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(
      t(
        ctx,
        'Вы ничего не выделили.\n\nПеред запуском скрипта нужно выделить текст, который требуется превратить в ссылку.',
        'Nothing is selected.\n\nBefore running the script, select the text that is to become the link.',
      ),
      { icon: 'info' },
    );
    return;
  }
  const values = await mfbe.ui.form({
    title: t(ctx, "Сделать выделенный текст ссылкой на MIDI-файл (для AlReader'а)", 'Make the selected text a link to a MIDI file (for AlReader)'),
    width: 600,
    fields: [
      { kind: 'text', id: 'file', label: t(ctx, 'Имя MIDI-файла', 'MIDI file name'), value: 'file:', placeholder: 'melody.mid' },
      {
        kind: 'static',
        id: 'help',
        text: t(ctx, 'Выделенный текст станет надстрочной ссылкой file:<имя файла>.', 'The selected text becomes a superscript link file:<file name>.'),
      },
    ],
    okLabel: t(ctx, 'Сделать выделенный текст ссылкой', 'Make the selected text a link'),
    cancelLabel: t(ctx, 'Закрыть', 'Close'),
  });
  if (!values) return;
  // The dialog put "file:" in front of the name itself; a name typed after the box's "file:" keeps one.
  const name = String(values.file ?? '').trim().replace(/^file:/i, '');
  if (!name) return;
  await mfbe.selection.wrap({ link: `file:${name}` });
  await mfbe.selection.wrap('sup');
}
