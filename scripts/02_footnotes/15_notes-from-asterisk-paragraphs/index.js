// Converted from FictionBook Editor 2.7.9: Scripts/02_Примечания/15_Создать сноски или комментарии из абзацев, помеченных звездочками....js
// Creates footnotes or comments from the paragraphs marked with asterisks ("*"): a paragraph
// that starts with them is the first paragraph of a note text, one that starts with "++" (the
// continuation marker of the dialog) continues the note before, and asterisks after other
// characters in the text are the note signs. When the numbers of signs and texts agree and the
// user confirms, every sign becomes a link to a new section of the notes (or comments) body with
// the next text, the body is renumbered and, on a second confirmation, the marked paragraphs are
// removed. The original's dialog (HTML/Создать сноски или комментарии из абзацев, помеченных
// звездочками - задание параметров.htm, v4.5) is a form whose choice holds its
// buttons; the engine is lib/paragraph-notes.js (shared with 12, 15, 17, 19 and 24).
// Only this one of the four leaves a poem, cite, table or epigraph whose first paragraph is an
// asterisk line ("* * *") alone, as the original did.
// Differences from 2.7.9: docs/scripting/conversion-notes-279-a.md (group 02).
// The original's notice, kept as written (FR-029):
//Скрипт «Создать сноски или комментарии из абзацев, помеченных звездочками»
//Автор Sclex

import { t } from './lib/notes-book.js';
import { actionField, continuationField, runParagraphNotes } from './lib/paragraph-notes.js';

const VERSION = '4.5';

export default async function run(ctx) {
  await runParagraphNotes(ctx, {
    mode: 'markers',
    defaults: { notFirstParagraphStr: '++', action: 'notes' },
    form: (c, values) => ({
      title: t(
        c,
        `Создать сноски или комментарии из абзацев, помеченных звездочками v${VERSION}. Автор Sclex.`,
        `Create footnotes or comments from paragraphs marked with asterisks v${VERSION}. Author Sclex.`,
      ),
      fields: [
        {
          kind: 'static',
          id: 'signHelp',
          text: t(
            c,
            'Подряд идущие символы «*» не в начале абзаца (а после каких-то символов — кроме простых или неразрывных пробелов) будут истолкованы как маркер знака сноски или комментария.',
            'Consecutive "*" characters not at the start of a paragraph (after other characters than spaces or non-breaking spaces) will be taken as the sign marker of a footnote or comment.',
          ),
        },
        {
          kind: 'static',
          id: 'textHelp',
          text: t(
            c,
            'Подряд идущие символы «*» в начале абзаца будут истолкованы как маркер 1-го абзаца текста сноски или комментария.',
            'Consecutive "*" characters at the start of a paragraph will be taken as the marker of the 1st paragraph of a footnote or comment text.',
          ),
        },
        continuationField(c, values.notFirstParagraphStr),
        actionField(c, t(c, 'Предпросмотр текстов сносок, помеченных звездочками', 'Preview the footnote texts marked with asterisks'), values.action),
      ],
    }),
    resolve: async (c, values) => ({
      mode: 'markers',
      sign: { kind: 'regexp', re: /\*+/g },
      first: { kind: 'regexp', re: /^[ \u00A0*]*\*[ \u00A0*]*/ },
      notFromStart: true,
      continuation: values.notFirstParagraphStr,
      asteriskContainers: true,
    }),
    previewHeading: (c) =>
      t(c, 'Тексты сносок, извлеченные из абзацев, помеченных звездочками', 'Footnote texts taken from paragraphs marked with asterisks'),
    previewTitle: (c) => t(c, 'Тексты сносок из абзацев, помеченных звездочками', 'Footnote texts from paragraphs marked with asterisks'),
  });
}
