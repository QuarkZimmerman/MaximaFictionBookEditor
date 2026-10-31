// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/01_Вставить заголовок стиха.js
// With the caret in a poem, inserts an empty title at the start of the poem and puts the caret
// into it; when the poem has a title already, the caret goes to the start of that title. Nothing
// happens outside a poem; a selection instead of a caret is refused with the original's message.
// The book's annotation and the document's history count as part of the text, as in the original
// (their poems are changed through doc.setDescription). Differences from the original: none in
// what is inserted or where the caret goes; the original's own scrolling (the title to the middle
// of the window) is the editor's scrolling into view. See docs/scripting/notes-279-drafts/18.md.
// The original's notice, kept as written (FR-029): the original has no leading comment.
import { insertTitle } from './title-lib.js';

export default async function run(ctx) {
  await insertTitle(
    ctx,
    'poem',
    // The original looked at the poem's first child only: a poem's title is always its first.
    (poem) => (poem.content?.[0]?.type === 'title' ? 0 : -1),
    () => 0,
  );
}
