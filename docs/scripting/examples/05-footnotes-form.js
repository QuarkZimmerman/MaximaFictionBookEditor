// A declarative form replaces the legacy HTML dialogs (Tier 3 conversions).
// Capabilities: ui.form, selection.get, selection.wrap, doc.insertNode, edit.label.
export default async function run(ctx) {
  const values = await mfbe.ui.form({
    title: 'Create footnote',
    width: 420,
    fields: [
      { kind: 'static', id: 'help', text: 'The selected text becomes a footnote reference.' },
      { kind: 'text', id: 'text', label: 'Footnote text', multiline: true, value: '' },
      { kind: 'text', id: 'prefix', label: 'Id prefix', value: 'n_' },
      { kind: 'number', id: 'number', label: 'Number', value: 1, min: 1, max: 9999 },
      { kind: 'checkbox', id: 'bold', label: 'Make the reference bold', value: false },
      { kind: 'select', id: 'body', label: 'Notes body', value: 'notes',
        options: [{ value: 'notes', label: 'notes' }, { value: 'comments', label: 'comments' }] },
      { kind: 'radio', id: 'brackets', label: 'Reference style', value: 'square',
        options: [{ value: 'square', label: '[1]' }, { value: 'round', label: '(1)' }] },
      { kind: 'list', id: 'tags', label: 'Tags', multiple: true, value: [],
        options: [{ value: 'translator', label: 'Translator' }, { value: 'author', label: 'Author' }] },
    ],
    okLabel: 'Create',
  });
  if (!values) return; // Cancel
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message('Select the text to reference.', { icon: 'warning' });
    return;
  }
  const id = `${values.prefix}${values.number}`;
  await mfbe.edit.label('Create footnote');
  await mfbe.selection.wrap({ link: `#${id}`, note: true });
  if (values.bold) await mfbe.selection.wrap('strong');
  // Find (or expect) the notes body and append the note section.
  const doc = await mfbe.doc.get();
  const notes = doc.bodies.find((b) => b.attrs.name === values.body);
  if (!notes) {
    await mfbe.ui.message(`There is no "${values.body}" body yet.`, { caption: ctx.script.name });
    return;
  }
  await mfbe.doc.insertNode('append', notes.attrs.nodeId, {
    type: 'section', attrs: { id },
    content: [
      { type: 'title', attrs: {}, content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: String(values.number) }] }] },
      { type: 'p', attrs: {}, content: [{ type: 'text', text: String(values.text) }] },
    ],
  });
}
