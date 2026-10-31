// Test package of the suite (not bundled): a book saved by FictionBook Editor between the two steps
// holds the description body before its own body (2.7.9 placed it there). This test puts such a
// body, made with other settings ("…1.z.1"), first, and runs 22/edit-description-as-text with
// Pause = 0: the old body goes, although it is the first body, and the book's body stays.
export default async function run(ctx) {
  const bodies = await mfbe.doc.getElementsByTagName('body');
  await mfbe.doc.insertNode('before', bodies[0], {
    type: 'body',
    attrs: { name: 'Раздел «description-1.z.1»' },
    content: [{ type: 'section', attrs: {}, content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text: 'Старое тело описания.' }] }] }],
  });
  return mfbe.scripts.run('22/edit-description-as-text', { Pause: 0, today: '2026-10-31' });
}
