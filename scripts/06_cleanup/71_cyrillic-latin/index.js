// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/71_Кириллица-латиница.js
// Restores text typed in a mix of Latin, Cyrillic, Greek letters and digits, in every text block of
// the book (the title-info annotation and the document-info history included). Automatically: Roman
// numerals typed with Cyrillic or Greek letters (ХХ -> XX), Russian, Latin and Greek words with
// letters of another alphabet (Mocквa -> Москва), the digits 3 and 0 for З and О, the stand-alone
// letters before chapter numbers and centuries; after a Yes / No question, foreign one-letter
// prepositions (a, c, o, y... between Russian words). Then, word by word in an input box (Yes takes
// its text, No skips the word and every equal one, Cancel ends that pass), the words left mixed.
// Finally it raises the document version and writes a line into the history (the original's
// setting Version_on_off = 1; the line names no user, by the requester's decision of 2026-10-31,
// where the original's default youName was the placeholder «Зорро»), and shows its statistics.
// The original's code runs as written in engine.js (generated, its rewrites listed there) on the page
// emulated by lib/fbe-page.js; lib/jscript-regexp.js keeps the meaning JScript gave \s and . .
// Differences: the word to correct is selected instead of being framed and coloured red (the question
// still names the red characters); in an input box, Yes with an empty text counts as No (the
// original applied the proposal); the result window shows no proverb: left out pending the
// requester's decision; the history line has no user name (the requester's decision,
// 2026-10-31). A script that runs this one through mfbe.scripts.run may pass
// { today: "YYYY-MM-DD" }, the date of the history entry (for tests); otherwise it is today's date,
// as in the original.
// The original's notice, kept as written (FR-029):
//======================================
//             «Кириллица-латиница»
//  Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//======================================
//  Скрипт предназначен для восстановления текста, написанного смесью латиницы, кириллицы, цифр и греческих букв.
//  * История изменений в конце скрипта
//======================================
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
// Обработка текста внутри «Истории изменений файла»
// ---------------------------------------------------------------
// Преобразовывать отдельностоящие буквы (A, B, C, K, O, Α, Β, Κ, Ο, a, c, o, u, y, ĸ, κ, ο) в русские
// * Это могут быть как предлоги, так и переменные или какие-то обозначения
// ** Если текст книги никак не соприкасается с математикой или лингвистикой, то ошибки обработки крайне маловероятны

import { Run } from './engine.js';
import { FbePage } from './lib/fbe-page.js';

/** The host of the original's code: the emulated page and the editor's dialogs. */
function makeHost(ctx, page) {
  let modalResult = 2;
  const snapshotVersion = page.snapshot.description?.documentInfo?.version ?? '';
  let version = snapshotVersion;
  const caption = ctx.script.name;
  const message = (text) => mfbe.ui.message(String(text), { caption, icon: 'info' });
  const host = {
    document: {
      getElementById(id) {
        if (id === 'fbw_body') return page.fbwBody;
        if (id === 'diVersion') {
          return {
            get value() {
              return version;
            },
            set value(v) {
              version = String(v);
            },
          };
        }
        return null;
      },
      createElement(tag) {
        if (String(tag).toUpperCase() === 'P') return page.createParagraph();
        throw new Error(`createElement(${tag}): not part of the emulated page`);
      },
    },
    window: {
      external: {
        GetNBSP: () => ' ',
        // InputBox(prompt, title, value): the text on Yes, "" on No and Cancel; GetModalResult()
        // tells the button (6 Yes, 7 No, 2 Cancel).
        async InputBox(prompt, title, value) {
          const answer = await mfbe.ui.prompt(String(prompt), { caption: String(title), defaultValue: String(value ?? ''), yesNoCancel: true });
          if (answer === null) {
            modalResult = 2;
            return '';
          }
          modalResult = answer === '' ? 7 : 6;
          return answer;
        },
        GetModalResult: () => modalResult,
        getViewHeight: () => 600,
        BeginUndoUnit() {},
        EndUndoUnit() {},
        SetStatusBarText: (text) => mfbe.ui.status(String(text)),
        inflateBlock() {},
      },
      scrollBy() {},
    },
    // AskYesNo(text): Yes / No (the façade's MsgBox with the flags 4 + 32 resolves 6 for Yes).
    AskYesNo: async (text) => (await MsgBox(String(text), caption, 4 + 32)) === 6,
    MsgBox: message,
    /** Selects a <LABEL> the code put around a word. */
    async goTo(label) {
      const range = page.labelRange(label);
      if (!range.inBody || !range.nodeId) return;
      try {
        await mfbe.selection.set({ nodeId: range.nodeId, offset: range.from }, { nodeId: range.nodeId, offset: range.to });
        await mfbe.selection.scrollIntoView();
      } catch {
        // showing the place is best effort
      }
    },
    /** Today: the date a calling script passes as { today: "YYYY-MM-DD" }, else the clock. */
    now() {
      const today = ctx.startedBy === 'script' && typeof ctx.args?.today === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.args.today) : null;
      return today ? new Date(Number(today[1]), Number(today[2]) - 1, Number(today[3]), 12, 0, 0).getTime() : Date.now();
    },
    progress: () => mfbe.ui.progress(0, undefined, caption),
    commit: () => page.commit(ctx, version !== snapshotVersion ? version : undefined),
  };
  return host;
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  await Run(ctx, makeHost(ctx, page));
}
