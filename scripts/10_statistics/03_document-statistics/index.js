// Converted from 10_Статистика/03_Статистика документа.js (FictionBook Editor).
// Reports what the original message box reported: the number of paragraphs (every rendered
// <P>, i.e. all text blocks and empty lines), the size of the text, cover / illustrations /
// footnote references, and the attached binaries with their decoded size and an estimate of
// their size in the FB2 file (base64 with 72-character lines, the legacy formula).

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

/** Legacy `divisors()`: thousands separated by commas, right-aligned to 12 characters. */
function divisors(value) {
  let out = '';
  const digits = String(value);
  for (let i = digits.length - 1, j = 0; i >= 0; i -= 1, j += 1) {
    let ch = digits.charAt(i);
    if (j && j % 3 === 0) ch += ',';
    out = ch + out;
  }
  while (out.length < 12) out = `   ${out}`;
  return out;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const snapshot = await mfbe.doc.get();
  const stats = await mfbe.doc.stats();
  const binaries = await mfbe.doc.binaries();

  // Paragraph and footnote counts follow the legacy definitions (rendered <P> elements and
  // <a class="note"> elements), which differ from doc.stats() (fb2 <p> and note sections).
  let paragraphs = 0;
  let notes = 0;
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (node.type === 'empty-line') paragraphs += 1;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      paragraphs += 1;
      let inNote = false;
      for (const item of node.content ?? []) {
        const isNote = item.type === 'text' && (item.marks ?? []).some((m) => m.type === 'link' && m.attrs?.type === 'note');
        if (isNote && !inNote) notes += 1;
        inNote = isNote;
      }
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of snapshot.bodies ?? []) visit(body);

  const hasCover = (snapshot.description?.titleInfo?.coverpage ?? []).length > 0;
  let total = 0;
  let totalBase64 = 0;
  for (const binary of binaries) {
    total += binary.size;
    const b64 = Math.floor((binary.size * 4) / 3);
    totalBase64 += b64 + Math.floor(b64 / 72) * 2 + 60;
  }

  let msg = '';
  if (ru) {
    msg += `Настоящий документ содержит ${paragraphs} параграф${paragraphs !== 1 ? 'ов' : ''}.\n\n`;
    msg += `Общий размер текста: ${divisors(stats.characters)} символов\n\n`;
    msg += hasCover ? 'Обложка, ' : 'Нет обложки, ';
    msg += stats.images === 1 ? 'одна иллюстрация, ' : `иллюстраций - ${stats.images}, `;
    msg += notes === 1 ? 'одна сноска\n' : `сносок - ${notes}`;
    msg += '\n\n------------------------------------------------------  \n\n';
    msg += binaries.length === 1
      ? 'Присутствует один присоединённый бинарник.\n\n'
      : `Прикреплённые бинарные объекты:     ${binaries.length} штук.\n\n`;
    msg += `Общий объём бинарников:      ${divisors(total)} байт\n`;
    msg += `Общий размер в формате FB2: ${divisors(totalBase64)} байт\n`;
  } else {
    msg += `This document contains ${paragraphs} paragraph${paragraphs !== 1 ? 's' : ''}.\n\n`;
    msg += `Total text size: ${divisors(stats.characters)} characters\n\n`;
    msg += hasCover ? 'Cover, ' : 'No cover, ';
    msg += stats.images === 1 ? 'one illustration, ' : `illustrations - ${stats.images}, `;
    msg += notes === 1 ? 'one footnote\n' : `footnotes - ${notes}`;
    msg += '\n\n------------------------------------------------------  \n\n';
    msg += binaries.length === 1
      ? 'One attached binary object.\n\n'
      : `Attached binary objects:     ${binaries.length}.\n\n`;
    msg += `Total size of binaries:      ${divisors(total)} bytes\n`;
    msg += `Total size in FB2 format:    ${divisors(totalBase64)} bytes\n`;
  }
  await mfbe.ui.message(msg, { caption: ctx.script.name, icon: 'info' });
}
