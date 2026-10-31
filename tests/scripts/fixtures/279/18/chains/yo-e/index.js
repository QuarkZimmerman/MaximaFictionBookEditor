// Test driver of "Разночтения Ё-Е" (FictionBook Editor 2.7.9, 18_Мелочи редактирования\35), not a
// bundled script: it runs the conversion through mfbe.scripts.run by its 2.7.9 path - the
// harness answers its dialogs - and then writes "<сегодня>" for today's date in the document's
// history, where the script wrote the line of its run, so that the snapshot does not depend on
// the day (yesterday's date too, should the run cross midnight). The clipboard says what run()
// returned.
const SCRIPT = '18_Мелочи редактирования\\35_Разночтения Ё-Е.js';

function day(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86400000);
  return `${d.getDate()}.${`0${d.getMonth() + 1}`.slice(-2)}.${d.getFullYear()}`;
}

async function normaliseHistory() {
  const description = (await mfbe.doc.get()).description;
  const dates = [day(0), day(1)];
  const visit = (node) => {
    for (const child of node?.content ?? []) {
      if (child.type === 'text') {
        for (const date of dates) child.text = child.text.split(date).join('<сегодня>');
      } else visit(child);
    }
  };
  visit(description.documentInfo.history);
  await mfbe.doc.setDescription(description);
}

export default async function run() {
  const result = await mfbe.scripts.run(SCRIPT);
  await normaliseHistory();
  await mfbe.clipboard.writeText(`run() returned ${JSON.stringify(result)}\n`);
}
