// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/75_Поиск текста из буфера обмена.js
// Searches for the text on the clipboard: one line, matched case-sensitively, its leading and
// trailing spaces dropped and every run of spaces matching any run of spaces or non-breaking
// spaces (copied from an HTML table, say). Each run selects the next occurrence after the end of
// the selection; when there is none up to the end of the book it offers to put the caret at the
// start of the book, so that the next run searches from there. Returns "Found" or "NotFound" to
// a script that runs it. The search is the engine of "Поиск по набору регэкспов" (regexp-set.js)
// with the text as its only expression, as in the original.
// The clipboard is read through the editor (mfbe.clipboard.readText), which allows it only in a
// run the user started - from the menu, the toolbar or a hotkey, directly or through other
// scripts. In a run the AI assistant started the script says so and stops (what it read would
// reach the AI service).
// Differences: line breaks of any platform count as line breaks (the original knew Windows'
// CR LF only); the start of the book is the start of its first body (FictionBook Editor's body
// view began with the book's annotation and history); the hit is selected exactly where it is
// and scrolled into sight.
// Fix: answering Cancel to "Перейти в начало документа?" made the original search again from the
// start of the paragraph it began in and, finding nothing, ask again - the question came back
// until OK was pressed. Cancel now ends the run.
// The original's notice, kept as written (FR-029):
// Скрипт «Поиск текста из буфера обмена» для редактора Fiction Book Editor (FBE).
// Версия 1.3 (январь 2025)
// Скрипт создан из заготовки скрипта «Поиск по набору регекспов» ув. Sclex-а.
// Автор добавленного кода — stokber.
// Добавлено три фрагмента, обрамленные закомментироваными строками состоящими из дефисов и знаков равенства,
// сверху и снизу соответственно. (строки 8-34, 90-96, 558-574). (stokber).
import { createRegExpSet, searchRegExpSet, t } from './regexp-set.js';

// JScript's \s: [ \f\n\r\t\v] only - a non-breaking space in the clipboard text stays itself.
const WS = '[ \\f\\n\\r\\t\\v]';
const SPACE_RUN_START = new RegExp(`^(&#160;| |${WS}|□|▫|◦)+`, 'g');
const SPACE_RUN_END = new RegExp(`(&#160;| |${WS}|□|▫|◦)+$`, 'g');
const SPACE_RUN = new RegExp(`(&#160;| |${WS}|□|▫|◦)+`, 'g');

/** The clipboard's text, or null when the editor refuses to read it in this run. */
async function clipboardText(ctx) {
  try {
    return await mfbe.clipboard.readText();
  } catch (error) {
    if (error?.code !== 'clipboard.readNotAllowed') throw error;
    await MsgBox(
      t(
        ctx,
        'Этот скрипт ищет текст из буфера обмена, а буфер обмена можно прочитать, только когда скрипт запущен пользователем (из меню, с панели скриптов или горячей клавишей), а не помощником ИИ.',
        'This script searches for the text on the clipboard, and the clipboard can be read only when the user starts the script (from the menu, the Scripts toolbar or a hotkey), not the AI assistant.',
      ),
      ctx.script.name,
    );
    return null;
  }
}

/** The first text block of the book: where FictionBook Editor put the caret for "the start". */
async function firstTextBlock() {
  const find = (node) => {
    if (!node || node.type === 'text') return null;
    if (['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date'].includes(node.type)) return node.attrs?.nodeId ?? null;
    for (const child of node.content ?? []) {
      const id = find(child);
      if (id) return id;
    }
    return null;
  };
  for (const body of await mfbe.doc.getElementsByTagName('body')) {
    const id = find(await mfbe.doc.getNode(body));
    if (id) return id;
  }
  return null;
}

export default async function run(ctx) {
  let str = await clipboardText(ctx);
  if (str === null) return undefined;
  if (str === '') {
    // getData('Text') gave null without text on the clipboard.
    await MsgBox(t(ctx, 'Буфер обмена пуст или в нем нет текстовых данных!', 'The clipboard is empty or holds no text!'), ctx.script.name);
    return undefined;
  }
  str = str.replace(/\r\n|\r|\n/g, '\r\n');
  str = str.replace(/(\r\n)[\r\n]*/gm, '$1'); // отфильтровываем выделение многострочного текста.
  const strCol = (str.match(/\r\n./gm) || []).length;
  if (strCol > 0) {
    await MsgBox(
      t(ctx, 'Вы скопировали больше одной строки. Этот скрипт не работает с многострочным текстом!!', 'You have copied more than one line. This script does not work with multi-line text!!'),
      ctx.script.name,
    );
    return undefined;
  }
  str = str.replace(/[\r\n]/gm, '');
  let strRX = str.replace(/(\.|\?|\-|\+|\*|\\|\/|"|\(|\)|\[|\]|\{|\}|\^|\$|\|)/g, '\\$1'); // экранируем спецсимволы.
  strRX = strRX.replace(SPACE_RUN_START, ''); // удаляем начальные пробелы.
  strRX = strRX.replace(SPACE_RUN_END, ''); // удаляем конечные пробелы.
  strRX = strRX.replace(SPACE_RUN, '[\\x20\\xA0]+'); // один пробел или несколько подряд - одно и то же.

  const set = createRegExpSet();
  set.addRegExp(strRX, '', 'Найдено: текст из буфера обмена.');

  return searchRegExpSet(ctx, set, {
    image: '~~~',
    decodeShy: true,
    async notFound() {
      const answer = await MsgBox(
        t(
          ctx,
          `От позиции курсора до конца документа строки: \n\n'${str}'\n\n не найдено. Перейти в начало документа?`,
          `The line\n\n'${str}'\n\nwas not found between the caret and the end of the document. Go to the start of the document?`,
        ),
        ctx.script.name,
        1,
      );
      if (answer === 1) {
        const first = await firstTextBlock();
        if (first) {
          await mfbe.selection.set({ nodeId: first, offset: 0 });
          await mfbe.selection.scrollIntoView();
        }
      }
      return 'NotFound';
    },
  });
}
