// Converted from FictionBook Editor 2.7.9: Scripts/08_Структура разделов/21_Добавить секцию в начало книги.js
// Inserts a new section holding one empty line at the start of the book's first body, after its
// picture, title and epigraphs (before its first section), and puts the caret at the start of
// the new section, before its empty line, scrolling there. The original looked for the first
// body on its page (creating one when there was none, which cannot happen here: a book has its
// main body), found the body's leading picture, title and epigraphs, inserted the section after
// the last of them and moved the caret into it (GoTo_0, which scrolled left as well); here
// doc.insertNode and selection.set do it.
// The original's notice, kept as written (FR-029):
//======================================
//             «Добавить секцию в начало книги»
// v.1.0 — Создание скрипта — Александр Ка (21.09.2024)
// v.1.1 — Мелкие правки — Александр Ка (02.05.2025)
//======================================
// ---------------------------------------------------------------
// ----------------------------------------------
// -----------------------------
                 /// ФУНКЦИЯ ПЕРЕХОДА
// * В отличии от встроенной функции "GoTo", здесь есть прокрутка влево.

function isApiError(error) {
  return Boolean(error) && error.name === 'ScriptApiError';
}

export default async function run() {
  const [bodyRef] = await mfbe.doc.getElementsByTagName('body');
  if (!bodyRef) return;
  const body = await mfbe.doc.getNode(bodyRef);
  // The body's leading picture, title and epigraphs stay before the new section.
  const first = (body.content ?? []).find((child) => !['image', 'title', 'epigraph'].includes(child.type));
  const section = { type: 'section', attrs: {}, content: [{ type: 'empty-line', attrs: {} }] };
  const ref = first
    ? await mfbe.doc.insertNode('before', first.attrs.nodeId, section)
    : await mfbe.doc.insertNode('append', bodyRef, section);
  try {
    await mfbe.selection.set({ nodeId: ref.nodeId, offset: 0 });
  } catch (error) {
    if (!isApiError(error)) throw error;
    await mfbe.selection.selectNode(ref);
  }
  await mfbe.selection.scrollIntoView();
}
