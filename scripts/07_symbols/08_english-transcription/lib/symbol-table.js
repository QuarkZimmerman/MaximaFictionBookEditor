// Shared helper of the symbol tables of "Символы" converted from FictionBook Editor 2.7.9
// (07/english-transcription, 07/math-symbols); each package carries its own copy, since the
// sandbox only allows imports from inside the script's folder.
//
// The 2.7.9 tables were modeless HTML dialogs: a click on a cell pasted its symbol over the
// selection of the Body view (rng.pasteHTML(symbol): selected text is replaced, a caret gets the
// symbol inserted) and put the caret after it, one undo step per click. Here the table is a list
// in a form; the chosen symbol replaces the selection and the caret goes after it, one symbol per
// run (the run is one undo step).

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function isApiError(error) {
  return Boolean(error) && error.name === 'ScriptApiError';
}

/** The start of a selection in document order (its caret when it is collapsed). */
function startOf(selection) {
  const { anchor, head, nodes } = selection;
  if (anchor.nodeId === head.nodeId) return anchor.offset <= head.offset ? anchor : head;
  return nodes.length && nodes[0].nodeId === head.nodeId ? head : anchor;
}

/**
 * Shows the table `symbols` ([symbol, Russian title, English title]) as a list and puts the
 * chosen symbol in place of the selection.
 */
export async function insertFromTable(ctx, title, symbols) {
  const options = symbols.map(([symbol, ru, en]) => ({
    value: symbol,
    label: `${symbol}  —  ${t(ctx, ru, en).trim()}`,
  }));
  const values = await mfbe.ui.form({
    title,
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
  const start = startOf(selection);
  try {
    await mfbe.selection.replaceText(chosen);
  } catch (error) {
    if (!isApiError(error)) throw error;
    await notInText();
    return;
  }
  await mfbe.selection.set({ nodeId: start.nodeId, offset: start.offset + chosen.length });
}
