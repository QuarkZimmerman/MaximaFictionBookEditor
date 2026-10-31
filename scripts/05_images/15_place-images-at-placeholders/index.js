// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/15_Расставить иллюстрации по заданным местам.js
// 2.7.9 ships this script twice, as this file and as "15_Расставить иллюстрации по заданным местам 1.3.js",
// byte for byte the same; both are kept, with one engine (place-images.js, identical in both).
// Fills the places set aside for illustrations - the empty pictures, "#undefined" or
// "#nobin_undefined", that "Вставить пустые картинки в началах и концах секций" inserts - with the
// binaries attached for them: when there are as many places as unused binaries (probable covers
// and copies such as "cover.jpg" or "x.jpg_1" left out), the i-th place of the first body gets
// the i-th unused binary, in the order of the binary objects; then the paragraphs of the first
// body that hold nothing but white space become empty lines. Otherwise it gives both counts and,
// on request, the lists in a report window.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - fixes: the covers of the src-title-info count as covers too, and covers are compared by their
//   address (the original read the title-info's only, as a text the id had to occur in); the
//   cover-like names left out are "cover_src.*" (the original's expression read "cover_crs");
//   a place is found by its address, also with an id or a title (the original's expression over
//   the body's HTML missed those, and the next place got that binary); the message counts the
//   pictures placed (the original reported the smaller count, whatever was placed);
// - the lists, which the original showed in a message box (its window HTML/Расставить
//   иллюстрации по заданным местам.html, which 2.7.9 lacks, is commented out), open in a report
//   window; the original's refresh of the view and of the cover lists has no counterpart.
// The original's notice, kept as written (FR-029):
// ----------------------------------------------------------------
// "Расставить иллюстрации по заданным местам" 
// для редактора Fiction Book Editor (FBE).
// Использованы фрагменты кода из скриптов AlexS и Александра Ка.
// Версия 1.3 (август 2025), автор: stokber
// 
//======================================

import { placeImages } from './place-images.js';

export default async function run(ctx) {
  return placeImages(ctx);
}
