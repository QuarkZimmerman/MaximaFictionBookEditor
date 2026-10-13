// Fixture script (Tier 1 port): legacy MsgBox / InputBox / undo units.
export default async function run() {
  await BeginUndoUnit('Message and input');
  const answer = await MsgBox('Insert a paragraph?', 'Fixture', 4 + 32); // vbYesNo + vbQuestion
  if (answer !== 6) {
    await EndUndoUnit();
    return;
  }
  const text = await InputBox('Paragraph text:', 'Fixture', 'Hello from InputBox');
  if (text === null) return;
  const [section] = await mfbe.doc.getElementsByTagName('section');
  await mfbe.doc.insertNode('append', section, {
    type: 'p', attrs: {}, content: [{ type: 'text', text }],
  });
  await EndUndoUnit();
}
