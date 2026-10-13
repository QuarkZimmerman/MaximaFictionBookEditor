export default async function run() {
  const [section] = await mfbe.doc.getElementsByTagName('section');
  await mfbe.doc.insertNode('append', section, { type: 'p', attrs: {}, content: [{ type: 'text', text: 'before the error' }] });
  throw new Error('boom');
}
