// Converted from FictionBook Editor 2.7.9: Scripts/95_Для программистов/03_Код в буфер.js (dropped
// by the conversion of 2.7beta1, where it was 20_Инструменты отладки/03_Код в буфер.js, for want
// of the clipboard; converted with script API version 2).
// The original copied the HTML of the editor's whole page (document.documentElement.outerHTML) to
// the clipboard, a debugging aid for writing scripts against the editor's internal
// representation. Scripts now see the book as the JSON document model, so that is what is copied,
// with mfbe.clipboard.writeText: the whole book as mfbe.doc.get() gives it - the description, the
// bodies with their node ids, the binaries' metadata - indented by two spaces, as "Показать весь
// код" (95/02) shows one element. The original's Run() returned nothing, nor does run().
// Differences from the original: the document model's JSON instead of the page's HTML (the
// editor's page is not open to scripts), without the open file's path, which is no part of the
// book's code; a book whose snapshot is over the API's 64 MB is not copied, a message says why.
// The original has no notice of its own (FR-029: nothing to keep).

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  let book;
  try {
    book = await mfbe.doc.get();
  } catch (error) {
    if (error?.name !== 'ScriptApiError') throw error;
    await mfbe.ui.message(
      t(ctx, `Код книги не скопирован: ${error.message}`, `The code of the book was not copied: ${error.message}`),
      { icon: 'warning' },
    );
    return;
  }
  if (!book) return;
  // The file's place on the disk is the editor's, not the book's.
  const { path, ...code } = book;
  await mfbe.clipboard.writeText(JSON.stringify(code, null, 2));
}
