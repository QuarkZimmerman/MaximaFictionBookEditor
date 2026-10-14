// Converted from 07_Символы/Иврит.js (FictionBook Editor): the modeless symbol table
// "Иврит" became a form with a list of the same symbols. The original appended the clicked
// symbol after the current selection; here the chosen symbol is inserted at the end of the
// selection (the selected text and its formatting are kept), one symbol per run.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//Таблица символов Еврейского алфавита
//                                jurgennt™, май 2008 г.
//                          script engene by Sclex v.1.2
import { SYMBOLS } from './symbols.js';

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const options = SYMBOLS.map(([symbol, title]) => ({
    value: symbol,
    // U+0301 (combining acute) is shown on a dotted circle so the row is not blank.
    label: `${symbol === '\u0301' ? '\u25CC\u0301' : symbol}${title ? `  \u2014  ${title}` : ''}`,
  }));
  const values = await mfbe.ui.form({
    title: ru ? 'Иврит' : 'Hebrew',
    width: 360,
    fields: [
      { kind: 'list', id: 'symbol', label: ru ? 'Символ' : 'Symbol', options, value: [options[0].value] },
    ],
    okLabel: ru ? 'Вставить' : 'Insert',
  });
  if (!values) return;
  const chosen = Array.isArray(values.symbol) ? values.symbol[0] : values.symbol;
  if (!chosen) return;

  const selection = await mfbe.selection.get();
  if (!selection) {
    await mfbe.ui.message(ru ? 'Курсор должен находиться в тексте книги.' : 'Place the caret in the book text first.', { icon: 'warning' });
    return;
  }
  // Collapse to the end of the selection so the selected text (with its marks) survives,
  // exactly like the legacy `pasteHTML(range.htmlText + symbol)`.
  const { anchor, head, nodes } = selection;
  let end = head;
  if (anchor.nodeId === head.nodeId) end = anchor.offset > head.offset ? anchor : head;
  else if (nodes.length && nodes[nodes.length - 1].nodeId === anchor.nodeId) end = anchor;
  await mfbe.selection.set(end);
  await mfbe.selection.replaceText(chosen);
  await mfbe.selection.set({ nodeId: end.nodeId, offset: end.offset + chosen.length });
}
