// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/64_Замена символов по списку из буфера обмена.js
// Replaces characters in the selected text by a list of replacements on the clipboard: every line
// of the list is a pair of characters, the one to replace and its replacement; spaces anywhere and
// empty lines are ignored, a line of one or of three or more characters stops the script with a
// message. The pairs are applied one after another, in the order of the list, to the selected
// text of every paragraph the selection touches (formatting and links are kept: one character
// becomes one character). Afterwards the caret stands at the end of the former selection.
// The clipboard is read through the editor (mfbe.clipboard.readText), which allows it only in a
// run the user started - from the menu, the toolbar or a hotkey, directly or through other
// scripts. In a run the AI assistant started the script says so and stops (what it read would
// reach the AI service).
// Differences: the list is read directly instead of being turned into JavaScript code and run with
// eval (a script has no eval in the editor); the replacements are the same - in the list's order,
// and a later line for the same character changes its replacement but not its place, as with the
// original's object literal - except that a list the original could not turn into valid code
// (a pair of two straight quotes) is applied instead of stopping with an error. Line breaks of any
// platform count as line breaks (the original knew Windows' CR LF only).
// The original's notice, kept as written (FR-029):
//скрипт "Замена символов по списку из буфера обмена"  by Sclex
// доработка до заявленного функционала - stokber.
//v1.0
// создан на базе скрипта замены регистра за авторством Sclex-а.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function helpText(ctx) {
  return t(
    ctx,
    '\n\nСправка\n\nСкрипт производит замену любых символов (кроме пробелов) в выделенном тексте. Перед запуском скопируйте в буфер обмена список замен. Список представляет собой любое количество строк с парой символов — тот, который меняем и тот, на который меняем. Перед, после и между ними может находиться любое количество пробелов, включая их полное отсутствие. Пустые строки между таких строк замен игнорируются. В качестве списка замен может выступать любой скопированный текст из любой программы, включая FBE.\n\nПример строки замен:\nаА\nоО\n#+',
    '\n\nHelp\n\nThe script replaces any characters (except spaces) in the selected text. Before running it, copy a list of replacements to the clipboard. The list is any number of lines holding a pair of characters - the one to replace and the one to replace it with. Any number of spaces may stand before, after and between them, none included. Empty lines between such lines are ignored. Any text copied from any program, FBE included, can serve as the list.\n\nExample lines:\naА\nоО\n#+',
  );
}

/** The clipboard's text, or null when the editor refuses to read it in this run. */
async function clipboardText(ctx) {
  try {
    return await mfbe.clipboard.readText();
  } catch (error) {
    if (error?.code !== 'clipboard.readNotAllowed') throw error;
    await MsgBox(
      t(
        ctx,
        'Этот скрипт берёт список замен из буфера обмена, а буфер обмена можно прочитать, только когда скрипт запущен пользователем (из меню, с панели скриптов или горячей клавишей), а не помощником ИИ.',
        'This script takes its list of replacements from the clipboard, and the clipboard can be read only when the user starts the script (from the menu, the Scripts toolbar or a hotkey), not the AI assistant.',
      ),
      ctx.script.name,
    );
    return null;
  }
}

/** Start and end of the selection in document order: [{nodeId, offset}, {nodeId, offset}]. */
function orderedEnds(selection) {
  const { anchor, head, nodes } = selection;
  if (anchor.nodeId === head.nodeId) {
    return anchor.offset <= head.offset ? [anchor, head] : [head, anchor];
  }
  const firstId = nodes[0]?.nodeId;
  return firstId === head.nodeId ? [head, anchor] : [anchor, head];
}

/** Applies the pairs in order to [from, to) of a text block, keeping every run's marks. */
function replaceInBlock(node, from, to, pairs) {
  let offset = 0;
  let changed = false;
  const content = (node.content ?? []).map((item) => {
    if (item.type !== 'text') {
      offset += 1;
      return item;
    }
    const text = item.text ?? '';
    const start = offset;
    offset += text.length;
    const a = Math.max(from, start) - start;
    const b = Math.min(to, offset) - start;
    if (a >= b) return item;
    let s = text.slice(a, b);
    for (const [key, value] of pairs) s = s.split(key).join(value);
    const next = text.slice(0, a) + s + text.slice(b);
    if (next === text) return item;
    changed = true;
    return { ...item, text: next };
  });
  return changed ? { ...node, content } : null;
}

export default async function run(ctx) {
  const help = helpText(ctx);
  const selection = await mfbe.selection.get();
  if (!selection || selection.text === '') {
    await MsgBox(
      t(ctx, 'Выделите текст!\nСкрипт производит замену символов только в выделенном тексте!', 'Select some text!\nThe script replaces characters in the selected text only!') + help,
      ctx.script.name,
    );
    return false;
  }

  let str = await clipboardText(ctx);
  if (str === null) return undefined;
  const empty = t(ctx, 'Буфер обмена пуст или в нем нет текстовых данных!', 'The clipboard is empty or holds no text!');
  if (str === '') {
    await MsgBox(empty + help, ctx.script.name);
    return undefined;
  }
  str = str.replace(/\r\n|\r|\n/g, '\r\n');
  str = str.replace(/ +/g, ''); // уд. пробелы.
  str = str.replace(/\r\n(\r\n)+/gm, '\r\n'); // уд. пустые стр.
  str = str.replace(/^\r\n|\r\n$/gm, ''); // нач. и кон. недопереводы строки.
  // eslint-disable-next-line eqeqeq
  if (str == false) {
    await MsgBox(empty + help, ctx.script.name);
    return undefined;
  }
  if (/^[^\r\n]$|^[^\r\n]{3,}$/m.test(str)) {
    await MsgBox(
      t(
        ctx,
        'По меньшей мере одна строка в вашем списке из буфера обмена имеет меньше или больше чем два символа. Проверьте свой список.',
        'At least one line of your list on the clipboard has fewer or more than two characters. Check your list.',
      ) + help,
      ctx.script.name,
    );
    return undefined;
  }
  // The original's object literal {"X": "Y", ...}: insertion order, a repeated key keeps its place.
  const pairs = new Map();
  for (const line of str.split('\r\n')) {
    if (line.length === 2) pairs.set(line[0], line[1]);
  }

  const [start, end] = orderedEnds(selection);
  const ids = selection.nodes.length ? selection.nodes.map((n) => n.nodeId) : [start.nodeId];
  for (let i = 0; i < ids.length; i += 1) {
    const node = await mfbe.doc.getNode(ids[i]);
    if (!node || !TEXT_BLOCKS.has(node.type)) continue;
    const from = ids[i] === start.nodeId ? start.offset : 0;
    const to = ids[i] === end.nodeId ? end.offset : Number.MAX_SAFE_INTEGER;
    const replaced = replaceInBlock(node, from, to, pairs);
    if (replaced) await mfbe.doc.replaceNode(ids[i], replaced);
    if (ctx.cancelled) return undefined;
  }
  // The original left the caret at the end of the processed block.
  await mfbe.selection.set({ nodeId: end.nodeId, offset: end.offset });
  return undefined;
}
