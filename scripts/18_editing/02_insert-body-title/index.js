// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/02_Вставить заголовок body.js
// With the caret in a body (the main one, a notes body or any other), inserts an empty title into
// the body and puts the caret into it; when the body has a title already, the caret goes to the
// start of that title. Nothing happens outside a body (in the book's annotation or the history);
// a selection instead of a caret is refused with the original's message.
// Difference from the original (a fix): a body that starts with a picture gets its title after
// the picture, where FB2 has it (image?, title?, epigraph*, section+), and a title that follows
// such a picture is found; the original looked at the body's first child only, so it put the new
// title before the picture - an invalid book - or added a second title. The original's own
// scrolling is the editor's scrolling into view. See docs/scripting/notes-279-drafts/18.md.
// The original's notice, kept as written (FR-029): the original has no leading comment.
import { insertTitle } from './title-lib.js';

export default async function run(ctx) {
  await insertTitle(
    ctx,
    'body',
    (body) => {
      const content = body.content ?? [];
      if (content[0]?.type === 'title') return 0;
      if (content[0]?.type === 'image' && content[1]?.type === 'title') return 1;
      return -1;
    },
    (body) => (body.content?.[0]?.type === 'image' ? 1 : 0),
  );
}
