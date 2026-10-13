// Converted from 18_Мелочи редактирования/02_Вставить ссылку на midi....js (FictionBook Editor 2.7),
// Tier 3: the HTML dialog "диалог вставки ссылки на midi.htm" (a file name box with a Browse
// button) becomes a form. The selected text is turned into a superscript link to the file
// (`<a l:href="file:NAME"><sup>…</sup></a>`), as the dialog's "Insert link" button did. There
// is no file picker in the script sandbox, so the name is typed.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(
      t(ctx, 'Выделите текст, который станет ссылкой на midi-файл.', 'Select the text that will become the link to the midi file.'),
      { icon: 'warning' },
    );
    return;
  }
  const values = await mfbe.ui.form({
    title: t(ctx, 'Вставка ссылки на midi', 'Insert a link to a midi file'),
    width: 600,
    fields: [
      { kind: 'text', id: 'file', label: t(ctx, 'Имя midi-файла', 'Midi file name'), value: '', placeholder: 'melody.mid' },
      { kind: 'static', id: 'help', text: t(ctx, 'Выделенный текст станет надстрочной ссылкой file:<имя файла>.', 'The selected text becomes a superscript link file:<file name>.') },
    ],
    okLabel: t(ctx, 'Вставить ссылку', 'Insert link'),
    cancelLabel: t(ctx, 'Закрыть', 'Close'),
  });
  if (!values) return;
  // The dialog prefixed the name with "file:" itself; tolerate users who typed the prefix.
  const name = String(values.file ?? '').trim().replace(/^file:/i, '');
  if (!name) return;
  await mfbe.selection.wrap({ link: `file:${name}` });
  await mfbe.selection.wrap('sup');
}
