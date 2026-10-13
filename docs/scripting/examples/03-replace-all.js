// Search and replace with the editor's engine (regular expressions, $1 groups, $U upper case).
// Capabilities: doc.find, doc.replaceAll, ui.message.
export default async function run() {
  const matches = await mfbe.doc.find({ text: '--', regex: false });
  if (matches.length === 0) {
    await mfbe.ui.message('Nothing to replace.');
    return;
  }
  // "word -- word" -> "word — word" (em dash), only inside the first body section.
  const [first] = await mfbe.doc.getElementsByTagName('section');
  const { count } = await mfbe.doc.replaceAll(
    { text: '(\\S) -- (\\S)', regex: true, within: first },
    '$1 \u2014 $2',
  );
  await mfbe.ui.message(`${count} replacement(s) done.`, { icon: 'info' });
}
