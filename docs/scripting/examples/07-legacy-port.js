// Porting a legacy FBE script: the façade keeps MsgBox / InputBox / undo units working.
// Legacy (JScript, Internet Explorer DOM):
//   function Run() {
//     window.external.BeginUndoUnit(document, "Replace");
//     var s = InputBox("Text to find:", "Find", "");
//     if (s == null) return;
//     ... document.all.tags("P") loop with innerText ...
//     window.external.EndUndoUnit(document);
//     MsgBox("Done");
//   }
// Converted:
export default async function run() {
  await BeginUndoUnit('Replace');                       // no-op: the run is one undo unit
  const needle = await InputBox('Text to find:', 'Find', '');
  if (needle === null) return;                          // Cancel
  const replacement = await InputBox('Replace with:', 'Find', '');
  if (replacement === null) return;
  const { count } = await mfbe.doc.replaceAll({ text: needle, matchCase: true }, replacement);
  await EndUndoUnit();
  const answer = await MsgBox(`${count} replacement(s). Show statistics?`, 'Done', 4 + 32); // vbYesNo + vbQuestion
  if (answer === 6) {                                   // vbYes
    const stats = await mfbe.doc.stats();
    await MsgBox(`${stats.words} words in ${stats.paragraphs} paragraphs.`, 'Statistics', 64);
  }
}
