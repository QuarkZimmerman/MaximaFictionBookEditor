// Shared engine of "Точка, тире, буква" (group 06, scripts 15 and 16), converted from the
// FictionBook Editor dialog scripts. From the caret onwards it looks for a punctuation mark
// (full stop, comma, optionally an ellipsis) followed - across spaces - by a dash and then a
// letter whose case does not fit: a lower-case letter after a full stop / ellipsis, a capital
// after a comma. Each finding is selected in the Body view and offered in a form: skip, swap
// the punctuation (. <-> ,), change the letter's case, or just go there and stop.

const TEXT_BLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const SPACE = /[ \u00A0]/;
const DASH = /[-–—]/;
const BIG = /[A-ZА-ЯЁÀÁÂÃÄÅÇÈÉÊËÌÍÏÐÑÒÓÔÕÖÙÚÛÜÝĀĄĆĈĊČĎĐĒĔĖĘĚĜĞĠĢĤĦĨĪĬĮİĴĶĹĻĽĿŁŃŅŇŊŌŎŐŔŖŘŚŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŹŻŽǺǼȘȚ]/;
const SMALL = /[a-zа-яёàáâãäåçèéêëìíïðñòóôõöùúûüýāąćĉċčďđēĕėęěĝğġģĥħĩīĭįiĵķĺļľŀłńņňŋōŏőŕŗřśŝşšţťŧũūŭůűųŵŷÿźżžǻǽșț]/;

function isNote(run) {
  return run.type === 'text' && (run.marks ?? []).some((m) => m.type === 'link' && m.attrs?.type === 'note');
}

/** Characters of a block outside footnote links with their plain-text offsets. */
function visibleChars(node) {
  const out = [];
  let pos = 0;
  for (const run of node.content ?? []) {
    if (run.type !== 'text') {
      pos += 1;
      continue;
    }
    const text = run.text ?? '';
    if (!isNote(run)) for (let k = 0; k < text.length; k += 1) out.push({ ch: text[k], pos: pos + k });
    pos += text.length;
  }
  return out;
}

function textBlocks(snapshot) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.has(node.type)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of snapshot.bodies ?? []) visit(body);
  return out;
}

/** Finds the letter after the dash following position i; -1 when the combination fails. */
function lookAhead(chars, i, kind) {
  let stage = 1;
  for (let j = i + 1; j < chars.length; j += 1) {
    const ch = chars[j].ch;
    if (stage === 1) {
      if (DASH.test(ch)) stage = 2;
      else if (!SPACE.test(ch)) return -1;
    } else if ((kind !== 'comma' && SMALL.test(ch)) || (kind === 'comma' && BIG.test(ch))) return j;
    else if (!SPACE.test(ch)) return -1;
  }
  return -1;
}

export async function dotDashLetter(ctx, { withEllipsis }) {
  const ru = ctx.uiLanguage === 'ru';
  const L = (r, e) => (ru ? r : e);
  const snapshot = await mfbe.doc.get();
  const blocks = textBlocks(snapshot);
  const selection = await mfbe.selection.get();
  let blockIndex = 0;
  let startPos = 0;
  if (selection) {
    const index = blocks.findIndex((b) => b.attrs.nodeId === selection.head.nodeId);
    if (index >= 0) {
      blockIndex = index;
      startPos = Math.max(selection.anchor.nodeId === selection.head.nodeId ? selection.anchor.offset : 0, selection.head.offset);
    }
  }
  let found = 0;
  for (let b = blockIndex; b < blocks.length; b += 1) {
    const node = blocks[b];
    const id = node.attrs.nodeId;
    const chars = visibleChars(node);
    let i = chars.findIndex((c) => c.pos >= (b === blockIndex ? startPos : 0));
    if (i < 0) continue;
    for (; i < chars.length; i += 1) {
      if (ctx.cancelled) return;
      const ch = chars[i].ch;
      let kind = ch === '.' ? 'dot' : ch === ',' ? 'comma' : ch === '…' && withEllipsis ? 'ellipsis' : null;
      if (!kind) continue;
      let dotIndex = i;
      if (kind === 'dot') {
        // A dot preceded by another dot: "..." counts as an ellipsis (script 15 only), ".." is skipped.
        const prev1 = chars[i - 1]?.ch;
        const prev2 = chars[i - 2]?.ch;
        if (prev1 === '.') {
          if (!withEllipsis || prev2 !== '.') continue;
          kind = 'ellipsis';
          dotIndex = i - 2;
        }
      }
      const letterIndex = lookAhead(chars, i, kind);
      if (letterIndex < 0) continue;
      found += 1;
      const letter = chars[letterIndex].ch;
      const mark = chars[dotIndex];
      try {
        await mfbe.selection.set({ nodeId: id, offset: mark.pos }, { nodeId: id, offset: chars[letterIndex].pos + 1 });
        await mfbe.selection.scrollIntoView();
      } catch {
        // best effort
      }
      const text = chars.map((c) => c.ch).join('');
      const shown = `${text.slice(Math.max(0, mark.pos - 60), mark.pos)}⟦${text.slice(mark.pos, chars[letterIndex].pos + 1)}⟧${text.slice(chars[letterIndex].pos + 1, chars[letterIndex].pos + 61)}`;
      const options = [{ value: 'skip', label: L('Пропуск', 'Skip') }];
      if (kind !== 'ellipsis') options.push({ value: 'punct', label: L(`Заменить знак пунктуации (${ch} → ${ch === '.' ? ',' : '.'})`, `Swap the punctuation (${ch} → ${ch === '.' ? ',' : '.'})`) });
      options.push({ value: 'letter', label: L(`Изменить регистр буквы (${letter} → ${kind === 'comma' ? letter.toLowerCase() : letter.toUpperCase()})`, `Change the letter's case (${letter} → ${kind === 'comma' ? letter.toLowerCase() : letter.toUpperCase()})`) });
      options.push({ value: 'go', label: L('Перейти без замены (и закончить)', 'Go there without changes (and stop)') });
      const answer = await mfbe.ui.form({
        title: L('Точка, тире, буква', 'Dot, dash, letter'),
        width: 560,
        fields: [
          { kind: 'static', id: 'ctx', text: shown },
          { kind: 'radio', id: 'action', label: L('Действие', 'Action'), options, value: 'skip' },
          { kind: 'checkbox', id: 'goAfter', label: L('После замены перейти к этому месту', 'Go to this place after the change (and stop)'), value: false },
        ],
        okLabel: L('ОК', 'OK'),
        cancelLabel: L('Выход', 'Exit'),
      });
      if (!answer) return;
      if (answer.action === 'go') {
        await mfbe.selection.set({ nodeId: id, offset: mark.pos });
        return;
      }
      if (answer.action === 'punct') {
        await mfbe.selection.set({ nodeId: id, offset: chars[i].pos }, { nodeId: id, offset: chars[i].pos + 1 });
        await mfbe.selection.replaceText(ch === '.' ? ',' : '.');
        chars[i].ch = ch === '.' ? ',' : '.';
      } else if (answer.action === 'letter') {
        const changed = kind === 'comma' ? letter.toLowerCase() : letter.toUpperCase();
        await mfbe.selection.set({ nodeId: id, offset: chars[letterIndex].pos }, { nodeId: id, offset: chars[letterIndex].pos + 1 });
        await mfbe.selection.replaceText(changed);
        chars[letterIndex].ch = changed;
      }
      if (answer.action !== 'skip' && answer.goAfter) {
        await mfbe.selection.set({ nodeId: id, offset: mark.pos });
        return;
      }
    }
  }
  await mfbe.ui.message(
    found === 0
      ? L('Искомых комбинаций символов в документе от позиции курсора нет.', 'No such combination of characters was found after the caret.')
      : L('Обработка закончена.\n\nВ документе больше нет искомых комбинаций символов от позиции курсора.', 'Done.\n\nThere are no more such combinations after the caret.'),
    { caption: ctx.script.name, icon: 'info' },
  );
}
