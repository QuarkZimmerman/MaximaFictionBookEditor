// Converted from FictionBook Editor 2.7.9: Scripts/07_Символы/04_Валюты.js (2.7beta1's
// Scripts/07_Символы/Валюта.js before feature 007). The table of currency signs (£ ¢ € ¥ ₢ ₣ ₤ ₧ ₨
// ₩ ₪ ₫ ₠ ₡ ₥ ₦ ¤). The original opened it as a modeless HTML dialog (HTML/Валюты.html): a click on
// a cell put the symbol in place of the selection of the Body view and the caret after it, and the
// dialog stayed open for the next click; 2.7beta1's dialog (валюты.htm) kept the selected text and
// added the symbol after it. Here the table is a list in a form (modal, one symbol per run, the run
// one undo step as each click was): the chosen symbol replaces the selection, a caret gets it
// inserted, and the caret goes after it; with the caret outside the book text the script says so
// (the original did nothing).
// The original's notice, kept as written (FR-029):
//Таблица символов валют
//                                jurgennt™, май 2008 г.
//                          script engene by Sclex v.1.3

import { SYMBOLS } from './symbols.js';

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The start of a selection in document order (its caret when it is collapsed). */
function startOf(selection) {
  const { anchor, head, nodes } = selection;
  if (anchor.nodeId === head.nodeId) return anchor.offset <= head.offset ? anchor : head;
  return nodes.length && nodes[0].nodeId === head.nodeId ? head : anchor;
}

export default async function run(ctx) {
  const options = SYMBOLS.map(([symbol, title]) => ({
    value: symbol,
    // U+0301 (combining acute) is shown on a dotted circle so the row is not blank.
    label: `${symbol === '\u0301' ? '\u25CC\u0301' : symbol}${title ? `  \u2014  ${title}` : ''}`,
  }));
  const values = await mfbe.ui.form({
    title: t(ctx, 'Валюта', 'Currency'),
    width: 360,
    fields: [
      { kind: 'list', id: 'symbol', label: t(ctx, 'Символ', 'Symbol'), options, value: [options[0].value] },
    ],
    okLabel: t(ctx, 'Вставить', 'Insert'),
  });
  if (!values) return;
  const chosen = Array.isArray(values.symbol) ? values.symbol[0] : values.symbol;
  if (!chosen) return;

  const notInText = () =>
    mfbe.ui.message(t(ctx, 'Курсор должен находиться в тексте книги.', 'Place the caret in the book text first.'), {
      icon: 'warning',
    });
  const selection = await mfbe.selection.get();
  if (!selection) {
    await notInText();
    return;
  }
  // rng.pasteHTML(symbol) of the 2.7.9 dialog: the symbol takes the place of the selection
  // (2.7beta1 pasted rng.htmlText + symbol, keeping it), then the caret goes after the symbol.
  const start = startOf(selection);
  try {
    await mfbe.selection.replaceText(chosen);
  } catch (error) {
    if (!error || error.name !== 'ScriptApiError') throw error;
    await notInText();
    return;
  }
  await mfbe.selection.set({ nodeId: start.nodeId, offset: start.offset + chosen.length });
}
