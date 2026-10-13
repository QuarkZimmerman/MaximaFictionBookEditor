// Fixture script (Tier 3): a declarative form replaces the legacy HTML dialog.
export default async function run() {
  const values = await mfbe.ui.form({
    title: 'Footnote options',
    fields: [
      { kind: 'static', id: 'info', text: 'Choose how footnotes are created.' },
      { kind: 'text', id: 'prefix', label: 'Prefix', value: 'n_' },
      { kind: 'number', id: 'start', label: 'Start number', value: 1, min: 1, max: 999 },
      { kind: 'checkbox', id: 'bold', label: 'Bold references', value: true },
      { kind: 'select', id: 'where', label: 'Body', options: [
        { value: 'notes', label: 'notes' }, { value: 'comments', label: 'comments' } ], value: 'notes' },
      { kind: 'radio', id: 'style', label: 'Style', options: [
        { value: 'square', label: '[1]' }, { value: 'round', label: '(1)' } ], value: 'square' },
      { kind: 'list', id: 'langs', label: 'Languages', multiple: true, options: [
        { value: 'ru', label: 'Russian' }, { value: 'en', label: 'English' } ], value: ['ru'] },
    ],
  });
  if (!values) {
    await mfbe.ui.status('Form cancelled', { sticky: true });
    return;
  }
  const [section] = await mfbe.doc.getElementsByTagName('section');
  const text = `form: ${values.prefix} ${values.start} ${values.bold} ${values.where} ${values.style} ${values.langs.join('+')}`;
  await mfbe.doc.insertNode('append', section, {
    type: 'p', attrs: {}, content: [{ type: 'text', text }],
  });
}
