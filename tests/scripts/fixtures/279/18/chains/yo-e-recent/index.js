// Test driver of "Разночтения Ё-Е" (FictionBook Editor 2.7.9, 18_Мелочи редактирования\35), not a
// bundled script: as chains/yo-e, but the history first gets a line of another script written
// two days ago by the same user, version 1.1 - the line the script must extend rather than add
// one of its own (the original's search of the last ten days). The line names no user, as the
// script's own lines do since the requester's decision of 2026-10-31.
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
  const description = (await mfbe.doc.get()).description;
  description.documentInfo.version = '1.1';
  description.documentInfo.history.content.push({
    type: 'p',
    attrs: {},
    content: [{ type: 'text', text: `v.1.1 — Скрипт: «Генеральная уборка» — ${day(2)}` }],
  });
  await mfbe.doc.setDescription(description);
  const result = await mfbe.scripts.run(SCRIPT);
  await normaliseHistory();
  await mfbe.clipboard.writeText(`run() returned ${JSON.stringify(result)}\n`);
}
