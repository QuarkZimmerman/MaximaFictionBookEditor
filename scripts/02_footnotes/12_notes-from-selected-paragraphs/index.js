// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/12_Создать сноски или комментарии из выделенных абзацев....js
// Creates footnotes or comments from the selected paragraphs: every selected paragraph is the
// first paragraph of a note text, one that starts with "++" (the continuation marker of the
// dialog) continues the note before, a poem, cite, table or epigraph is taken whole; the note
// signs are the matches of the chosen marker ([1], {1}, [~1~], {~1~}, one asterisk, a number in
// superscript - the default - or one's own) in the text before the selection. When both numbers
// agree and the user confirms, every sign becomes a link to a new section of the notes (or
// comments) body with the next text and the body is renumbered; the selected paragraphs stay
// (the original left them to the user) and so does the selection. The original's dialog
// (HTML/Создать сноски из выделенных абзацев - задание параметров.htm, v4.2) is a form whose
// choice holds its buttons; the engine is lib/paragraph-notes.js (shared with 15, 17, 19, 24).
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
//Скрипт «Создать сноски или комментарии из выделенных абзацев»
//Автор Sclex

import { t } from './lib/notes-book.js';
import {
  SIGN_PRESETS,
  actionField,
  compile,
  continuationField,
  runParagraphNotes,
} from './lib/paragraph-notes.js';

const VERSION = '4.2';

export default async function run(ctx) {
  await runParagraphNotes(ctx, {
    mode: 'selection',
    defaults: { noteSign: '6', refMarkerStr: '[*]', interpretAsRegExp: true, notFirstParagraphStr: '++', action: 'notes' },
    form: (c, v) => ({
      title: t(c, `Создать сноски из выделенных абзацев v${VERSION}. Автор Sclex.`, `Create footnotes from the selected paragraphs v${VERSION}. Author Sclex.`),
      fields: [
        {
          kind: 'radio',
          id: 'noteSign',
          label: t(c, 'Задайте маркер знака сноски:', 'The footnote sign marker:'),
          options: [
            { value: '1', label: t(c, 'вида [1]', 'like [1]') },
            { value: '2', label: t(c, 'вида {1}', 'like {1}') },
            { value: '3', label: t(c, 'вида [~1~]', 'like [~1~]') },
            { value: '4', label: t(c, 'вида {~1~}', 'like {~1~}') },
            { value: '5', label: t(c, '* (одна звездочка)', '* (one asterisk)') },
            { value: '6', label: t(c, 'число надстрочным текстом', 'a number in superscript') },
            { value: '20', label: t(c, 'задать свой:', 'my own:') },
          ],
          value: v.noteSign,
        },
        { kind: 'text', id: 'refMarkerStr', label: t(c, 'Свой маркер знака сноски:', 'My own sign marker:'), value: v.refMarkerStr },
        {
          kind: 'checkbox',
          id: 'interpretAsRegExp',
          label: t(c, 'трактовать как регулярное выражение', 'take it as a regular expression'),
          value: v.interpretAsRegExp,
        },
        continuationField(c, v.notFirstParagraphStr),
        actionField(c, t(c, 'Предпросмотр текстов сносок, содержащихся в выделении', 'Preview the footnote texts in the selection'), v.action),
      ],
    }),
    resolve: async (c, v) => {
      let sign;
      if (SIGN_PRESETS[v.noteSign]) sign = { kind: 'regexp', re: new RegExp(SIGN_PRESETS[v.noteSign].source, 'g') };
      else if (v.noteSign === '5') sign = { kind: 'regexp', re: /\*/g };
      else if (v.noteSign === '6') sign = { kind: 'superscript' };
      else if (v.interpretAsRegExp) {
        const compiled = compile(v.refMarkerStr, 'gm');
        if (compiled.error) {
          // 2.7.9 stopped with a script error here; the message is the one of 15-24
          await mfbe.ui.message(
            t(
              c,
              `Произошла ошибка при компиляции регэкспа для маркера знака сноски.\n\nИмя ошибки: ${compiled.error.name}\nСообщение об ошибке: ${compiled.error.message}`,
              `The regular expression of the footnote sign marker does not compile.\n\nError: ${compiled.error.name}\nMessage: ${compiled.error.message}`,
            ),
            { icon: 'error' },
          );
          return null;
        }
        sign = { kind: 'regexp', re: compiled.re };
      } else sign = { kind: 'text', text: v.refMarkerStr };
      return { mode: 'selection', sign, first: null, notFromStart: false, continuation: v.notFirstParagraphStr };
    },
    previewHeading: (c) =>
      t(c, 'Тексты сносок, извлеченные из выделенных абзацев', 'Footnote texts taken from the selected paragraphs'),
    previewTitle: (c) => t(c, 'Тексты сносок, извлеченные из выделенных абзацев', 'Footnote texts taken from the selected paragraphs'),
  });
}
