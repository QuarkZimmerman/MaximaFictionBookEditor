export default async function run() {
  const matches = await mfbe.doc.find({ text: '\\b(\\w)(\\w*)\\b', regex: true });
  const { count } = await mfbe.doc.replaceAll({ text: 'the', matchCase: false, wholeWord: true }, 'THE');
  const stats = await mfbe.doc.stats();
  await mfbe.ui.status(`${count} replacements, ${matches.length} words, ${stats.paragraphs} paragraphs`, { sticky: true });
}
