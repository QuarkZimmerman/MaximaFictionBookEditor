/* global mfbe */
// Inserts a non-breaking space (U+00A0) after the one-letter prepositions and conjunctions of
// the selected text (Russian and Ukrainian: в к с у о и а з і й ж б), so that a line never ends
// with one of them. Works on the selection through mfbe.selection.* only.

const ONE_LETTER_WORD = /(?<=^|[\s(«"'„])([вксуоиазійжбВКСУОИАЗІЙЖБ])[ \t]+(?=\S)/gu;

function t(ctx, en, ru, uk) {
  if (ctx.uiLanguage === 'ru') return ru;
  if (ctx.uiLanguage === 'uk') return uk;
  return en;
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(
      t(ctx, 'Nothing is selected.', 'Ничего не выделено.', 'Нічого не виділено.'),
      { icon: 'warning' },
    );
    return;
  }
  const text = selection.text.replace(ONE_LETTER_WORD, '$1\u00A0');
  if (text === selection.text) {
    await mfbe.ui.status(
      t(
        ctx,
        'No one-letter preposition in the selection.',
        'В выделенном тексте нет однобуквенных предлогов.',
        'У виділеному тексті немає однолітерних прийменників.',
      ),
    );
    return;
  }
  await mfbe.selection.replaceText(text);
}
