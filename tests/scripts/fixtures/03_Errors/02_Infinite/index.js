export default async function run() {
  const [section] = await mfbe.doc.getElementsByTagName('section');
  await mfbe.doc.insertNode('append', section, { type: 'p', attrs: {}, content: [{ type: 'text', text: 'LOOP' }] });
  for (;;) {
    // never calls progress(): the host offers "wait / cancel" and Cancel terminates the worker
  }
}
