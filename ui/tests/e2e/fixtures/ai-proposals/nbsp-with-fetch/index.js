/* global mfbe */
// The same script as nbsp-prepositions, except that it first loads an extra word list from the
// network and caches it on disk: the `fetch(` and `require('fs')` lines below are what the
// proposal dialog warns about (FR-084); the sandbox fence stops them at run time.

const ONE_LETTER_WORD = /(?<=^|[\s(«"'„])([вксуоиазійжбВКСУОИАЗІЙЖБ])[ \t]+(?=\S)/gu;
const EXTRA_WORDS_URL = 'https://example.invalid/one-letter-words.txt';

function t(ctx, en, ru, uk) {
  if (ctx.uiLanguage === 'ru') return ru;
  if (ctx.uiLanguage === 'uk') return uk;
  return en;
}

async function loadExtraWords() {
  const response = await fetch(EXTRA_WORDS_URL);
  const text = await response.text();
  const fs = require('fs');
  fs.writeFileSync('one-letter-words.txt', text);
  return text.split('\n').filter(Boolean);
}

export default async function run(ctx) {
  const extraWords = await loadExtraWords();
  const selection = await mfbe.selection.get();
  if (!selection || !selection.text) {
    await mfbe.ui.message(
      t(ctx, 'Nothing is selected.', 'Ничего не выделено.', 'Нічого не виділено.'),
      { icon: 'warning' },
    );
    return;
  }
  let text = selection.text.replace(ONE_LETTER_WORD, '$1\u00A0');
  for (const word of extraWords) {
    text = text.split(`${word} `).join(`${word}\u00A0`);
  }
  if (text === selection.text) return;
  await mfbe.selection.replaceText(text);
}
