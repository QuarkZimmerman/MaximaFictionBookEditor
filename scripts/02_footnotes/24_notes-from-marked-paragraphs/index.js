// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/24_Создать сноски или комментарии из абзацев, помеченных маркерами....js
// Creates footnotes or comments from marked paragraphs, the markers chosen in the dialog: the
// marker of a note sign in the text ([1], {1}, [~1~], {~1~}, *, a number in superscript - the
// default - or one's own, a regular expression or plain text), whether it may stand at the start
// of a paragraph, the marker of the first paragraph of a note text (the same choices, matched at
// the start of the paragraph) and the plain-text marker of the paragraphs that continue a note
// ("++"). When the numbers of signs and texts agree and the user confirms, every sign becomes a
// link to a new section of the notes (or comments) body with the next text, the body is
// renumbered and, on a second confirmation, the marked paragraphs are removed. The original's
// dialog (HTML/Создать сноски или комментарии из абзацев, помеченных маркерами - задание
// параметров.htm, v7.3) is a form whose choice holds its buttons; the engine is
// lib/paragraph-notes.js (shared with 12, 15, 17 and 19).
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
//Скрипт «Создать сноски или комментарии из абзацев, помеченных маркерами»
//Автор Sclex

import { t } from './lib/notes-book.js';
import {
  SIGN_PRESETS,
  actionField,
  compile,
  continuationField,
  runParagraphNotes,
} from './lib/paragraph-notes.js';

const VERSION = '7.3';

/** The "first paragraph" presets (firstNotePMarkerREStr of adjustVars), compiled with "gm". */
const FIRST_PRESETS = {
  '30': '\\[\\d+\\]',
  '31': '\\{\\d+\\}',
  '32': '\\[\\~\\d+\\~\\]',
  '33': '\\{\\~\\d+\\~\\}',
  '34': '[*]+',
};

function markerOptions(c, first) {
  const values = first ? ['30', '31', '32', '33', '34', '38', '35'] : ['1', '2', '3', '4', '5', '36', '20'];
  const labels = [
    t(c, 'вида [1]', 'like [1]'),
    t(c, 'вида {1}', 'like {1}'),
    t(c, 'вида [~1~]', 'like [~1~]'),
    t(c, 'вида {~1~}', 'like {~1~}'),
    t(c, 'вида *', 'like *'),
    t(c, 'число надстрочным текстом', 'a number in superscript'),
    t(c, 'задать свой:', 'my own:'),
  ];
  return values.map((value, i) => ({ value, label: labels[i] }));
}

async function regexpError(c, what, error) {
  await mfbe.ui.message(
    t(
      c,
      `Произошла ошибка при компиляции регэкспа для ${what === 'sign' ? 'маркера знака сноски' : 'маркера первого абзаца текста сноски'}.\n\nИмя ошибки: ${error.name}\nСообщение об ошибке: ${error.message}`,
      `The regular expression of the ${what === 'sign' ? 'footnote sign marker' : 'first paragraph marker of a footnote text'} does not compile.\n\nError: ${error.name}\nMessage: ${error.message}`,
    ),
    { icon: 'error' },
  );
}

export default async function run(ctx) {
  await runParagraphNotes(ctx, {
    mode: 'markers',
    defaults: {
      noteSign: '36',
      refMarkerStr: '\\*+',
      interpretAsRegExp: true,
      matchNotFromBeginning: true,
      firstNoteP: '38',
      firstNotePMarkerStr: '\\*+',
      interpretAsRegExp2: true,
      notFirstParagraphStr: '++',
      action: 'notes',
    },
    form: (c, v) => ({
      title: t(
        c,
        `Создать сноски или комментарии из абзацев, помеченных маркерами v${VERSION}. Автор Sclex.`,
        `Create footnotes or comments from paragraphs marked with markers v${VERSION}. Author Sclex.`,
      ),
      fields: [
        {
          kind: 'radio',
          id: 'noteSign',
          label: t(c, 'Задайте маркер знака сноски:', 'The footnote sign marker:'),
          options: markerOptions(c, false),
          value: v.noteSign,
        },
        { kind: 'text', id: 'refMarkerStr', label: t(c, 'Свой маркер знака сноски:', 'My own sign marker:'), value: v.refMarkerStr },
        {
          kind: 'checkbox',
          id: 'interpretAsRegExp',
          label: t(c, 'трактовать как регулярное выражение', 'take it as a regular expression'),
          value: v.interpretAsRegExp,
        },
        {
          kind: 'checkbox',
          id: 'matchNotFromBeginning',
          label: t(c, 'совпадение должно быть не от начала абзаца', 'the match must not be at the start of the paragraph'),
          value: v.matchNotFromBeginning,
        },
        {
          kind: 'radio',
          id: 'firstNoteP',
          label: t(c, 'Задайте маркер первого абзаца текста сноски:', 'The marker of the first paragraph of a footnote text:'),
          options: markerOptions(c, true),
          value: v.firstNoteP,
        },
        {
          kind: 'text',
          id: 'firstNotePMarkerStr',
          label: t(c, 'Свой маркер первого абзаца:', 'My own first paragraph marker:'),
          value: v.firstNotePMarkerStr,
        },
        {
          kind: 'checkbox',
          id: 'interpretAsRegExp2',
          label: t(c, 'трактовать как регулярное выражение', 'take it as a regular expression'),
          value: v.interpretAsRegExp2,
        },
        {
          kind: 'static',
          id: 'firstHelp',
          text: t(c, 'Совпадение должно быть от начала абзаца.', 'The match must be at the start of the paragraph.'),
        },
        continuationField(c, v.notFirstParagraphStr),
        actionField(c, t(c, 'Предпросмотр текстов сносок, помеченных маркерами', 'Preview the footnote texts marked with markers'), v.action),
      ],
    }),
    // adjustVars: the sign marker first, then the first paragraph marker
    resolve: async (c, v) => {
      let sign;
      if (SIGN_PRESETS[v.noteSign]) sign = { kind: 'regexp', re: new RegExp(SIGN_PRESETS[v.noteSign].source, 'g') };
      else if (v.noteSign === '5') sign = { kind: 'regexp', re: /[*]+/g };
      else if (v.noteSign === '36') sign = { kind: 'superscript' };
      else if (v.interpretAsRegExp) {
        const compiled = compile(v.refMarkerStr, 'gm');
        if (compiled.error) {
          await regexpError(c, 'sign', compiled.error);
          return null;
        }
        sign = { kind: 'regexp', re: compiled.re };
      } else sign = { kind: 'text', text: v.refMarkerStr };
      let first;
      if (FIRST_PRESETS[v.firstNoteP]) first = { kind: 'regexp', re: new RegExp(FIRST_PRESETS[v.firstNoteP], 'gm') };
      else if (v.firstNoteP === '38') first = { kind: 'superscript' };
      else if (v.interpretAsRegExp2) {
        const compiled = compile(v.firstNotePMarkerStr, 'gm');
        if (compiled.error) {
          await regexpError(c, 'first', compiled.error);
          return null;
        }
        first = { kind: 'regexp', re: compiled.re };
      } else first = { kind: 'text', text: v.firstNotePMarkerStr };
      return {
        mode: 'markers',
        sign,
        first,
        notFromStart: Boolean(v.matchNotFromBeginning),
        continuation: v.notFirstParagraphStr,
        asteriskContainers: false,
      };
    },
    previewHeading: (c) =>
      t(c, 'Тексты сносок, извлеченные из абзацев, помеченных маркерами', 'Footnote texts taken from paragraphs marked with markers'),
    previewTitle: (c) => t(c, 'Тексты сносок из абзацев, помеченных маркерами', 'Footnote texts from paragraphs marked with markers'),
  });
}
