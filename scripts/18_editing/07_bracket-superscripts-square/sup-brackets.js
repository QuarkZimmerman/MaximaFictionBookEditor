// Shared by "Обрамить верхние индексы скобками []" and "… {}" (18_Мелочи редактирования 07 and
// 08, FictionBook Editor 2.7, Tier 2). The originals walked every <SUP> element of the book and
// put an opening bracket before its first text and a closing bracket after its last text (inside
// the superscript). A <SUP> element corresponds to a maximal run of superscript text here, so
// `<sup>3</sup><sup>4</sup>` written side by side counts as one run (the editor merges them).

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const isSup = (item) => (item.marks ?? []).some((m) => m.type === 'sup');

/** Adds the brackets around every superscript run of `content`; returns [content, runs]. */
export function bracketRuns(content, open, close) {
  const out = [];
  let runs = 0;
  let i = 0;
  while (i < content.length) {
    if (!isSup(content[i])) {
      out.push(content[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < content.length && isSup(content[j])) j += 1;
    const run = content.slice(i, j);
    // Text gets the bracket glued on; an inline image gets a new text node beside it.
    const head = run[0];
    if (head.type === 'text') run[0] = { ...head, text: open + head.text };
    else run.unshift({ type: 'text', text: open, marks: head.marks });
    const tail = run[run.length - 1];
    if (tail.type === 'text') run[run.length - 1] = { ...tail, text: tail.text + close };
    else run.push({ type: 'text', text: close, marks: tail.marks });
    out.push(...run);
    runs += 1;
    i = j;
  }
  return [out, runs];
}

export async function bracketSuperscripts(ctx, open, close) {
  let count = 0;
  for (const block of await mfbe.doc.getElementsByTagName('sup')) {
    const node = await mfbe.doc.getNode(block);
    const [content, runs] = bracketRuns(node.content ?? [], open, close);
    if (!runs) continue;
    await mfbe.doc.replaceNode(block, { ...node, content });
    count += runs;
  }
  if (count === 0) {
    await mfbe.ui.message(t(ctx, 'Верхних индексов в документе не обнаружено.', 'No superscripts were found in the document.'));
    return;
  }
  await mfbe.ui.message(
    t(ctx, `Обрамлено скобками ${open}${close} содержимое\nследующего количества верхних индексов:\n   ${count}`,
      `The content of this many superscripts\nwas enclosed in ${open}${close} brackets:\n   ${count}`),
  );
}
