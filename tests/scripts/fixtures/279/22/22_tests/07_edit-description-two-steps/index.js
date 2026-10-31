// Test package of the suite (not bundled): runs 22/edit-description-as-text twice as a user does.
// The first run puts the description into its body; the edits below are those a user makes there
// (a changed title, keywords and sequence, new names in the three forms the script reads, a
// repeated name, a name with one separator too many, removed sections, edited custom-info); the
// second run writes the body back. `args` passes the settings (all as shipped, unless the caller
// gives others) and the date taken as today.
const TARGET = '22/edit-description-as-text';
const NB = ' ';

const textOf = (node) => (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
const p = (text, marks) => ({ type: 'p', attrs: {}, content: text ? [marks ? { type: 'text', text, marks } : { type: 'text', text }] : [] });

export default async function run(ctx) {
  const settings = { today: '2026-10-31', ...(ctx.args ?? {}) };
  await mfbe.scripts.run(TARGET, settings);

  const doc = await mfbe.doc.get();
  const body = doc.bodies.find((b) => /^Раздел «description-/.test(b.attrs?.name ?? ''));
  // Every node of the body in document order, with its parent.
  const all = [];
  const visit = (node, parent) => {
    all.push({ node, parent });
    if (node.type === 'p' || node.type === 'subtitle') return;
    for (const child of node.content ?? []) if (child.type !== 'text') visit(child, node);
  };
  visit(body, null);
  const section = (marker) => all.find((e) => e.node.type === 'section' && e.node.content?.[0]?.type === 'title' && textOf(e.node.content[0].content[0]) === marker).node;
  const inPart = (part, test) => {
    const found = [];
    const walk = (node) => {
      if (test(node)) found.push(node);
      if (node.type !== 'p') for (const child of node.content ?? []) if (child.type !== 'text') walk(child);
    };
    walk(part);
    return found;
  };
  const lineIn = (part, text) => inPart(part, (n) => n.type === 'p' && textOf(n) === text)[0];
  const ref = (node) => node.attrs.nodeId;

  const ti = section('===<title-info>===');
  const sti = section('===<src-title-info>===');
  const di = section('===<document-info>===');
  const pi = section('===<publish-info>===');
  const ci = section('===<custom-info>===');

  // title-info
  await mfbe.doc.setText(ref(lineIn(ti, `•${NB}Название: Редакция  описания`)), `•${NB}Название: Новая  редакция  описания `);
  let after = lineIn(ti, 'Ёлкина | Анна | | Ник: | Почта: | Сайт: | ID:');
  for (const node of [
    p('Толстой Лев Николаевич'),
    p('де Сент-Экзюпери Антуан'),
    { type: 'p', attrs: {}, content: [{ type: 'text', text: 'Сидоров | Иван | Петрович | Ник: | Почта: ivan@example.com | Сайт: http://sidorov.example | ' }, { type: 'text', text: 'ID: AUTHOR-1', marks: [{ type: 'code' }] }] },
    { type: 'empty-line', attrs: {} },
    p('Один | Два | Три | Четыре'),
  ]) {
    after = { attrs: { nodeId: (await mfbe.doc.insertNode('after', ref(after), node)).nodeId } };
  }
  await mfbe.doc.setText(ref(lineIn(ti, 'редакция,  описание ')), 'редакция, описание, проверка');
  await mfbe.doc.setText(ref(lineIn(ti, `•${NB}Серия: Подцикл`)), `•${NB}Серия: Подцикл второй`);
  const number = inPart(ti, (n) => n.type === 'p' && textOf(n) === `•${NB}Номер: 1`)[0];
  await mfbe.doc.replaceNode(ref(number), p(`•${NB}Номер: 3`, [{ type: 'sup' }]));
  const cycle = ti.content.find((c) => c.type === 'section' && c.content?.[0]?.type === 'title' && textOf(c.content[0].content[0]) === `•${NB}Серия: Цикл`);
  await mfbe.doc.insertNode('after', ref(cycle), {
    type: 'section',
    attrs: {},
    content: [
      { type: 'title', attrs: {}, content: [p(`•${NB}Серия: Новая серия`), p(`•${NB}Номер: 5а`, [{ type: 'sup' }])] },
      { type: 'empty-line', attrs: {} },
    ],
  });

  // src-title-info: a title and an author typed in
  await mfbe.doc.setText(ref(lineIn(sti, `•${NB}Название:`)), `•${NB}Название: Original Title`);
  const stiAuthors = sti.content.find((c) => c.type === 'section' && c.content?.[0] && textOf(c.content[0]) === `•${NB}Авторы:`);
  await mfbe.doc.setText(ref(stiAuthors.content[1]), 'Smith John');

  // document-info: the Source OCR part removed
  await mfbe.doc.removeNode(ref(di.content.find((c) => c.type === 'section' && textOf(c.content[0]) === `•${NB}Source OCR:`)));

  // publish-info: a new year, the city removed
  await mfbe.doc.setText(ref(lineIn(pi, '2020')), '  2021  ');
  await mfbe.doc.removeNode(ref(pi.content.find((c) => c.type === 'section' && textOf(c.content[0]) === `•${NB}Город:`)));

  // custom-info: an edited line, one more empty line, a new entry
  await mfbe.doc.setText(ref(lineIn(ci, 'Вторая строка')), '  Вторая  строка  ');
  const entry = ci.content.find((c) => c.type === 'section');
  const empty = entry.content.find((c) => c.type === 'p' && textOf(c) === '');
  await mfbe.doc.insertNode('after', ref(empty), { type: 'empty-line', attrs: {} });
  await mfbe.doc.insertNode('after', ref(entry), {
    type: 'section',
    attrs: {},
    content: [p('•' + NB + 'Тип:', [{ type: 'strong' }]), p('added'), p('•' + NB + 'Значение:', [{ type: 'strong' }]), p('Новое значение')],
  });

  return mfbe.scripts.run(TARGET, settings);
}
