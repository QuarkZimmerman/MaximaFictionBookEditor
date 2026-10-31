// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/65_Замена слов по списку из буфера обмена.js
// Replaces words throughout the book - the book's annotation and the document's history included,
// as the original's settings had it - by a list of replacements on the clipboard: lines of two
// words, the word to replace and its replacement, separated by spaces (Russian and English letters
// only). After showing the list and asking whether to go on, it replaces every whole occurrence
// (case-sensitive) that lies inside one piece of text between tags: a word that continues across
// formatting (part of it in italics, bold...) is left alone. It reports the number of words
// replaced and, when some occurrences are left, the number left and offers to put on the clipboard
// a regular expression that finds them (for Edit > Find with "Match case" and "Regular
// expression"). The paragraphs are edited in the original's HTML notation (lib/legacy-html.js) so
// that the original's expressions apply as written and the formatting is kept.
// The clipboard is read and written through the editor (mfbe.clipboard), which allows reading it
// only in a run the user started - from the menu, the toolbar or a hotkey, directly or through
// other scripts. In a run the AI assistant started the script says so and stops (what it read
// would reach the AI service).
// Differences: the list is read directly instead of being turned into JavaScript code and run with
// eval (a script has no eval in the editor); the replacements are the same, in the list's order,
// and a later line for the same word changes its replacement but not its place, as with the
// original's object literal; a line the original could not turn into code (two words separated by
// a tab) is passed over instead of stopping the script with an error. Line breaks of any platform
// count as line breaks (the original knew Windows' CR LF only).
// The original's notice, kept as written (FR-029):
//Скрипт "Замена слов по списку из буфера обмена" v.1.2;
//автор — stokber (2025, сентябрь)
import { collectTextBlocks, parseInline, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';

const vers = '1.2';

//обрабатывать ли history
const ObrabotkaHistory = true;
//обрабатывать ли annotation
const ObrabotkaAnnotation = true;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// JScript's \s: [ \f\n\r\t\v] only.
const WS = ' \\f\\n\\r\\t\\v';

function helpText(ctx) {
  return t(
    ctx,
    '\n\nСправка\n\nСкрипт производит замену английских и русских слов. Перед запуском скопируйте в буфер обмена список замен. Список представляет собой любое количество строк с парой разделённых пробелом слов — то, которое меняем и то, на которое меняем. Перед, после и между ними (словами) может находиться любое количество пробелов. Пустые строки между таких строк замен игнорируются. В списке не должно быть никаких других символов, кроме пробелов и букв русского и английского алфавитов. В качестве списка замен может выступать любой скопированный текст из любой программы, включая FBE.\n\nПример строки замен:\n\nашипка ошибка\nапичатка опечатка\nмалако молоко\n',
    '\n\nHelp\n\nThe script replaces English and Russian words. Before running it, copy a list of replacements to the clipboard. The list is any number of lines holding a pair of words separated by a space - the one to replace and the one to replace it with. Any number of spaces may stand before, after and between them (the words). Empty lines between such lines are ignored. The list must hold nothing but spaces and letters of the Russian and English alphabets. Any text copied from any program, FBE included, can serve as the list.\n\nExample lines:\n\nашипка ошибка\nапичатка опечатка\nмалако молоко\n',
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

/** Text blocks of the description's annotation and history (FictionBook Editor showed them in the body view). */
function descriptionBlocks(description) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  if (ObrabotkaAnnotation) visit(description?.titleInfo?.annotation);
  if (ObrabotkaHistory) visit(description?.documentInfo?.history);
  return out;
}

/** The text innerText gave for a text block: its text, pictures giving nothing. */
function innerTextOf(node) {
  return (node.content ?? []).map((item) => (item.type === 'text' ? item.text ?? '' : '')).join('');
}

export default async function run(ctx) {
  const name = t(ctx, 'Замена слов по списку из буфера обмена', 'Replace words by a list from the clipboard');
  const help = helpText(ctx);

  let str = await clipboardText(ctx);
  if (str === null) return undefined;
  const empty = t(ctx, 'Буфер обмена пуст или в нем нет текстовых данных!', 'The clipboard is empty or holds no text!');
  if (str === '') {
    await MsgBox(empty + help, ctx.script.name);
    return undefined;
  }
  str = str.replace(/\r\n|\r|\n/g, '\r\n');
  str = str.replace(/&nbsp;/g, ' '); // норм. пробелы.
  str = str.replace(/( |□|▫|◦)+/g, ' '); // норм. пробелы.
  str = str.replace(/^ +| +$/gm, ''); // уд. нач. и кон. пробелы.
  str = str.replace(/\r\n(\r\n)+/gm, '\r\n'); // уд. пустые стр.
  str = str.replace(/^\r\n|\r\n$/gm, ''); // нач. и кон. недопереводы строки.
  // eslint-disable-next-line eqeqeq
  if (str == false) {
    await MsgBox(empty + help, ctx.script.name);
    return undefined;
  }
  if (new RegExp(`[^a-zа-яё${WS}]`, 'i').test(str)) {
    await MsgBox(
      t(ctx, 'По меньшей мере один символ в вашем списке из буфера обмена не является буквой. Проверьте свой список замен.', 'At least one character of your list on the clipboard is not a letter. Check your list of replacements.') + help,
      ctx.script.name,
    );
    return undefined;
  }
  // здесь добавить проверку правильного кол. (2) слов в одной строке.
  if (/[a-zа-яё]+ [a-zа-яё]+ [a-zа-яё]+/i.test(str)) {
    await MsgBox(
      t(ctx, 'По меньшей мере одна строка в вашем списке из буфера обмена состоит из более чем двух слов. Проверьте свой список.', 'At least one line of your list on the clipboard has more than two words. Check your list.') + help,
      ctx.script.name,
    );
    return undefined;
  }
  if (/^[a-zа-яё]+$/im.test(str)) {
    await MsgBox(
      t(ctx, 'По меньшей мере одна строка в вашем списке из буфера обмена состоит из только одного слова. Проверьте свой список замен.', 'At least one line of your list on the clipboard has only one word. Check your list of replacements.') + help,
      ctx.script.name,
    );
    return undefined;
  }
  const go = await MsgBox(
    t(ctx, `В буфере обмена обнаружен следующий список замен:\n\n${str}\n\nПродолжить выполнение скрипта?`, `The clipboard holds this list of replacements:\n\n${str}\n\nGo on with the script?`),
    ctx.script.name,
    1,
  );
  if (go !== 1) return undefined;

  // The words to look for, as alternatives, and the replacements in the list's order.
  let str2 = str.replace(/^([a-zа-яё]+) ([a-zа-яё]+)$/gim, '$1');
  str2 = str2.replace(/\r\n/gim, '|');
  const rx1 = new RegExp(`(^|[^a-zа-яё])(${str2})(?=[^a-zа-яё]|$)`, 'g');
  const words = new Map();
  for (const line of str.split('\r\n')) {
    const m = /^([a-zа-яё]+) ([a-zа-яё]+)$/i.exec(line);
    if (m) words.set(m[1], m[2]);
  }

  // Marks around a word that continues across tags, so that it is not replaced.
  const metkaStart = 'ЪЪ☺ЪЪ';
  const metkaEnd = 'ЪЪ☻ЪЪ';
  const re1 = new RegExp(`([a-zA-Zа-яёА-ЯЁ](?:</?[^>]+>)+)(${str2})`, 'ig');
  const re1_ = `$1${metkaStart}$2${metkaEnd}`;
  const re2 = new RegExp(`([^a-zA-Zа-яёА-ЯЁ])(${str2})((?:</?[^>]+>)+)(?=[a-zA-Zа-яёА-ЯЁ])`, 'g');
  const re2_ = `$1${metkaStart}$2${metkaEnd}$3`;
  const re3 = new RegExp(`^(${str2})((?:</?[^>]+>)+)(?=[a-zA-Zа-яёА-ЯЁ])`, 'g');
  const re3_ = `${metkaStart}$1${metkaEnd}$2`;
  const re5 = new RegExp(`${metkaStart}|${metkaEnd}`, 'g');
  const segments = /(^|>)[^<>]+(<|$)/g;

  const handle = (s) => {
    while (s.search(re1) !== -1) s = s.replace(re1, re1_);
    while (s.search(re2) !== -1) s = s.replace(re2, re2_);
    if (s.search(re3) !== -1) s = s.replace(re3, re3_);
    for (const [key, correct] of words) {
      s = s.replace(segments, (match) => {
        const rx = new RegExp(`(^|[^&a-zA-Z0-9а-яёА-ЯЁ])${key}(?=[^a-zA-Z0-9а-яёА-ЯЁ]|$)`, 'g');
        return match.replace(rx, `$1${correct}`);
      });
    }
    if (s.search(re5) !== -1) s = s.replace(re5, '');
    return s;
  };

  const snapshot = await mfbe.doc.get();
  const description = snapshot.description;
  const descBlocks = descriptionBlocks(description);
  const blocks = collectTextBlocks(snapshot);
  // innerText of the body view: the annotation, the history, then the bodies, a line each.
  const text = () => [...descBlocks.map(innerTextOf), ...blocks.map((b) => innerTextOf(b.node))].join('\n');
  const count1 = (text().match(rx1) || []).length; // подсчёт совпадений.

  let descriptionChanged = false;
  for (const node of descBlocks) {
    const extras = [];
    const before = serializeInline(node.content, extras);
    const after = handle(before);
    if (after !== before) {
      node.content = parseInline(after, extras);
      descriptionChanged = true;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const extras = [];
    const before = serializeInline(block.node.content, extras);
    const after = handle(before);
    if (after !== before) {
      const node = { type: block.node.type, attrs: { ...block.node.attrs }, content: parseInline(after, extras) };
      await mfbe.doc.replaceNode(block.ref, node);
      block.node = node;
    }
    if (i % 100 === 0) await mfbe.ui.progress(i, blocks.length, name);
    if (ctx.cancelled) return undefined;
  }

  const txt = text();
  const count2 = (txt.match(rx1) || []).length;
  const count = count1 - count2;
  let matches = txt.match(rx1);
  if (!matches) {
    await MsgBox(t(ctx, `Заменено слов: ${count}\n\nСкрипт '${name}' v.${vers}`, `Words replaced: ${count}\n\nScript '${name}' v.${vers}`), ctx.script.name);
    return undefined;
  }
  const result2 = await MsgBox(
    t(
      ctx,
      `Заменено слов:           \t${count}\nНе исправлено слов: \t${count2}\n\nСценарий игнорирует слова с неполным или различным начертанием (напр. смесью курсива, полужирного и(ли) обычного), т. к. не уверен в  их верном распознавании. Чтобы найти такие слова и заменить самостоятельно, вставьте в окно 'Поиск' регулярное выражение из буфера обмена. Отметьте галочками пункты 'Учитывать регистр' и 'Регулярные выражения'.\n\nПОМЕСТИТЬ В БУФЕР ОБМЕНА РЕГУЛЯРНОЕ ВЫРАЖЕНИЕ ДЛЯ ПОИСКА? \n\nСкрипт '${name}' v.${vers}`,
      `Words replaced:           \t${count}\nWords not corrected: \t${count2}\n\nThe script leaves alone words with partial or mixed formatting (a mix of italics, bold and/or regular, for example), as it is not sure they were recognised correctly. To find such words and replace them yourself, paste the regular expression from the clipboard into the Find window and tick 'Match case' and 'Regular expression'.\n\nPUT THE REGULAR EXPRESSION FOR THE SEARCH ON THE CLIPBOARD? \n\nScript '${name}' v.${vers}`,
    ),
    ctx.script.name,
    1,
  );
  if (result2 !== 1) return undefined;
  matches = matches.join('\n'); // объединить массив в строку.
  matches = matches.replace(/^[^a-zа-яё]/gim, '');
  const arr = matches.split('\n');
  arr.sort();
  matches = arr.join('\n');
  matches = matches.replace(/^([a-zа-яё]+\n)\1+/gim, '$1');
  matches = matches.replace(/^([a-zа-яё]+)\n\1$/gim, '$1');
  matches = matches.replace(/\n/gm, '|');
  matches = matches.replace(/.+/, `(?<![a-zA-Zа-яёА-ЯЁ])(${matches})(?![a-zA-Zа-яёА-ЯЁ])`);
  await mfbe.clipboard.writeText(matches); // поместить данные в буфер обмена.
  return undefined;
}
