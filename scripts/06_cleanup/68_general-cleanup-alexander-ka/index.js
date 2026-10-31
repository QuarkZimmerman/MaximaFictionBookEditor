// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/68_Генеральная уборка (версия Александра Ка).js
// «Текст-корректор» v.3.15 by Александр Ка, built on Генеральная уборка: a typographic clean-up of
// every text block of the book (the title-info annotation and the document-info history included,
// the original's setting ObrabotkaHistory_on_off = 1) in some 200 operations, repeated on a block
// until it no longer changes: special characters, apostrophes, fractions and super/subscript digits
// written with tags, spaces, ellipses, _underlining_ made italic or bold, joined and untangled
// italic and bold tags, stress marks, quotes and punctuation, hyphens, en and em dashes (with
// questions on the doubtful kinds before it starts), non-breaking spaces (dangling words,
// abbreviations, units, numbers), final dots in titles. E-mail and web addresses, links and,
// if the user says so, the <code> format are left alone. Then, one place at a time in an input box
// (Yes takes its text, No skips the place and every equal one, Cancel ends that pass): a wrong °C,
// a stress typed in capitals, l e t t e r  s p a c i n g made italic. Shows its statistics, page by
// page. With the settings at the top of the original (Version_on_off = 0) the version and the
// history are not touched.
// The original's code runs as written in engine.js (generated, its rewrites listed there) on the page
// emulated by lib/fbe-page.js; lib/jscript-regexp.js keeps the meaning JScript gave \s and . (the
// code works with the non-breaking spaces as U+00A0 characters, which ECMAScript's \s matches).
// Differences: the place in question is selected instead of being coloured; in an input box, Yes with
// an empty text counts as No (the original applied the proposal); a block formatted with both italic
// and bold is seen with the bold outside the italic (the editor keeps formatting as marks, so the
// nesting of the source is not kept), which the expressions that untangle <EM><STRONG> treat
// accordingly; the result window shows no proverb: left out pending the requester's decision.
// The original's notice, kept as written (FR-029):
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//             «Текст-корректор»
// Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
// * История изменений в конце скрипта
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
         //   •  Максимум строк в окне результатов
//  * Скрипт постарается не превышать это значение, и при необходимости добавит необходимое количество страниц.
// * Для монитора 1024х768 максимальная высота окна равна 52 строкам (в win XP) и 50 строк (в win 7).
// ---------------------------------------------------------------
         //   •  Обработка текста внутри "Истории изменений файла"
// ---------------------------------------------------------------

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
    /** Today, for a history entry: the date a calling script passes as { today: "YYYY-MM-DD" }, else the clock. */
    now() {
      const today = ctx.startedBy === 'script' && typeof ctx.args?.today === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.args.today) : null;
      return today ? new Date(Number(today[1]), Number(today[2]) - 1, Number(today[3]), 12, 0, 0).getTime() : Date.now();
    },
    /** The <P> of fbw_body in document order (the history's when `withHistory`). */
    paragraphs: (withHistory) => page.allParagraphs(withHistory),
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
