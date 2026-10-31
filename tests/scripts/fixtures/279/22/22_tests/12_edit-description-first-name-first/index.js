// Test package of the suite (not bundled): 22/edit-description-as-text with names written
// "first middle last" (FIO = 0) and divided again by the script (Delenie = 0), empty data hidden.
// Between the two runs a user adds names in the forms the script reads.
const TARGET = '22/edit-description-as-text';
const SETTINGS = { FIO: 0, Delenie: 0, ShowEmpty: 0, Version_on_off: 0 };
const textOf = (node) => (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');

export default async function run(ctx) {
  await mfbe.scripts.run(TARGET, SETTINGS);
  const doc = await mfbe.doc.get();
  const body = doc.bodies.find((b) => /^Раздел «description-/.test(b.attrs?.name ?? ''));
  const part = body.content.find((c) => c.type === 'section' && c.content?.[0]?.type === 'title' && textOf(c.content[0].content[0]) === '===<title-info>===');
  const authors = part.content.find((c) => c.type === 'section' && c.content?.[0] && textOf(c.content[0]) === '• Авторы:');
  let after = authors.content[authors.content.length - 1].attrs.nodeId;
  for (const text of ['Лев Николаевич Толстой', 'Антуан де Сент-Экзюпери', 'Ли | Бо', 'Иван | Петрович | Сидоров | Ник: Ваня', 'Жюль Верн | Почта: verne@example.com']) {
    after = (await mfbe.doc.insertNode('after', after, { type: 'p', attrs: {}, content: [{ type: 'text', text }] })).nodeId;
  }
  return mfbe.scripts.run(TARGET, SETTINGS);
}
