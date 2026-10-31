// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/19_Создать сноски или комментарии из абзацев, помеченных знаками карет....js
// Creates footnotes or comments from the paragraphs marked with carets ("^"): a paragraph
// that starts with them is the first paragraph of a note text, one that starts with "++" (the
// continuation marker of the dialog) continues the note before, and carets after other
// characters in the text are the note signs. When the numbers of signs and texts agree and the
// user confirms, every sign becomes a link to a new section of the notes (or comments) body with
// the next text, the body is renumbered and, on a second confirmation, the marked paragraphs are
// removed. The original's dialog (HTML/Создать сноски или комментарии из абзацев, помеченных
// знаками карет - задание параметров.htm, v4.4) is a form whose choice holds its
// buttons; the engine is lib/paragraph-notes.js (shared with 12, 15, 17, 19 and 24).
// A paragraph of asterisks and spaces only ("* * *") is left alone here too, as the original's
// check (written for asterisks) did.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
//Скрипт «Создать сноски или комментарии из абзацев, помеченных знаками карет»
//Автор Sclex

import { t } from './lib/notes-book.js';
import { actionField, continuationField, runParagraphNotes } from './lib/paragraph-notes.js';

const VERSION = '4.4';

export default async function run(ctx) {
  await runParagraphNotes(ctx, {
    mode: 'markers',
    defaults: { notFirstParagraphStr: '++', action: 'notes' },
    form: (c, values) => ({
      title: t(
        c,
        `Создать сноски или комментарии из абзацев, помеченных знаками карет v${VERSION}. Автор Sclex.`,
        `Create footnotes or comments from paragraphs marked with carets v${VERSION}. Author Sclex.`,
      ),
      fields: [
        {
          kind: 'static',
          id: 'signHelp',
          text: t(
            c,
            'Подряд идущие символы «^» не в начале абзаца (а после каких-то символов — кроме простых или неразрывных пробелов) будут истолкованы как маркер знака сноски или комментария.',
            'Consecutive "^" characters not at the start of a paragraph (after other characters than spaces or non-breaking spaces) will be taken as the sign marker of a footnote or comment.',
          ),
        },
        {
          kind: 'static',
          id: 'textHelp',
          text: t(
            c,
            'Подряд идущие символы «^» в начале абзаца будут истолкованы как маркер 1-го абзаца текста сноски или комментария.',
            'Consecutive "^" characters at the start of a paragraph will be taken as the marker of the 1st paragraph of a footnote or comment text.',
          ),
        },
        continuationField(c, values.notFirstParagraphStr),
        actionField(c, t(c, 'Предпросмотр текстов сносок, помеченных знаками карет', 'Preview the footnote texts marked with carets'), values.action),
      ],
    }),
    resolve: async (c, values) => ({
      mode: 'markers',
      sign: { kind: 'regexp', re: /\^+/g },
      first: { kind: 'regexp', re: /^[ \u00A0^]*\^[ \u00A0^]*/ },
      notFromStart: true,
      continuation: values.notFirstParagraphStr,
      asteriskContainers: false,
    }),
    previewHeading: (c) =>
      t(c, 'Тексты сносок, извлеченные из абзацев, помеченных знаками карет', 'Footnote texts taken from paragraphs marked with carets'),
    previewTitle: (c) => t(c, 'Тексты сносок из абзацев, помеченных знаками карет', 'Footnote texts from paragraphs marked with carets'),
  });
}
