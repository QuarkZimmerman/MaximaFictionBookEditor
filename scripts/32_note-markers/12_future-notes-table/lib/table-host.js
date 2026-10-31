// The host of the marker-table scripts converted from FictionBook Editor 2.7.9 (group 32: 11 and
// 12 carry byte-identical copies; the sandbox only loads modules from the script's own folder).
// engine.js of each package is the original's code; this module gives it what the original took
// from FictionBook Editor's page, window and Windows:
//   innerHTML      fbw_body.innerHTML, rebuilt from the book (lib/marker-page.js);
//   chooseMarker() the dialog "HTML/Создать таблицу маркеров-сносок.htm" as a form: the kind of
//                  markers, as the strings the dialog returned; label() names a kind in a message;
//   msgBox, alert  a message box; clipboard: the clipboard's text (window.clipboardData);
//   report(html)   MyMsgWindow: the table in a report window;
//   writeFile()    WriteFile: the table written into a file - the editor's Save dialog proposes
//                  the original's name, the user chooses where; FileSystemObject's text file was
//                  in the system's ANSI code page, here windows-1251, the code page of the Russian
//                  Windows the script was written for, with WriteLine's line break - and, in place
//                  of the default browser the original opened it in, the report window.
//   js(re)         the expression compiled with JScript's meaning (lib/jscript-regexp.js).

import { jscriptSource } from './jscript-regexp.js';
import { pageHtml } from './marker-page.js';

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** A regular expression with JScript's \s, \S and . (a new object, as a literal is). */
export function js(re) {
  return new RegExp(jscriptSource(re.source), re.flags);
}

// The dialog's choices, in its order, and the strings it returned (markerFunc).
const KINDS = [
  { value: 'sup', sign: 'надстрочным текстом', en: 'superscript' },
  { value: 'asterisks', sign: 'вида *', en: 'like *' },
  { value: 'hash', sign: 'вида #', en: 'like #' },
  { value: 'square', sign: 'вида [1]', en: 'like [1]' },
  { value: 'curly', sign: 'вида {1}', en: 'like {1}' },
  { value: 'square-tilde', sign: 'вида [~1~]', en: 'like [~1~]' },
  { value: 'curly-tilde', sign: 'вида {~1~}', en: 'like {~1~}' },
];

async function chooseMarker(ctx) {
  const answer = await mfbe.ui.form({
    title: t(ctx, 'Создать таблицу маркеров-сносок', 'Create a table of footnote markers'),
    fields: [
      {
        kind: 'radio',
        id: 'kind',
        label: t(ctx, 'Выберите вид маркеров сносок:', 'Choose the kind of footnote markers:'),
        options: KINDS.map((k) => ({ value: k.value, label: t(ctx, k.sign, k.en) })),
        value: KINDS[0].value,
      },
    ],
    okLabel: t(ctx, 'Создать таблицу сносок', 'Create the table of footnotes'),
    cancelLabel: t(ctx, 'Отмена', 'Cancel'),
  });
  if (!answer) return null;
  return KINDS.find((k) => k.value === answer.kind)?.sign ?? null;
}

/** The host object engine(host, tx, js) works with, over a snapshot of the book. */
export function tableHost(ctx, snapshot) {
  const title = t(ctx, 'Создать таблицу маркеров-сносок', 'Create a table of footnote markers');
  const report = async (html) => {
    await mfbe.ui.report({ title, html: String(html) });
  };
  return {
    innerHTML: pageHtml(snapshot).html.toString(),
    chooseMarker: () => chooseMarker(ctx),
    label: (sign) => {
      const kind = KINDS.find((k) => k.sign === sign);
      return kind ? t(ctx, kind.sign, kind.en) : sign;
    },
    msgBox: async (text) => {
      await mfbe.ui.message(String(text));
    },
    alert: async (text) => {
      await mfbe.ui.message(String(text));
    },
    clipboard: async (text) => {
      await mfbe.clipboard.writeText(String(text));
    },
    report,
    writeFile: async (name, html) => {
      await mfbe.files.saveText({
        suggestedName: String(name),
        text: `${html}\r\n`,
        encoding: 'windows-1251',
        title: t(ctx, 'Сохранить таблицу маркеров сносок', 'Save the table of footnote markers'),
      });
      await report(html);
    },
  };
}
