// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/04_Сохранить вложения на накопитель.js
// Asks for a confirmation and saves every binary object of the book with its original bytes,
// named by its id, through the editor (`mfbe.files.saveBinaries`, script API version 2), then
// reports how many were saved and the time taken. Dropped when 2.7beta1 was converted (no file
// access for scripts); converted under spec FR-024 of feature 007.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - the editor's folder dialog chooses where the files go (the original wrote them next to the
//   book), so the confirmation names the folder to choose; cancelling the dialog ends the run;
// - a file that exists already is the editor's question - Overwrite, Skip, Overwrite all or
//   Cancel (the original never overwrote one and only counted it as not saved).
// The original's notice, kept as written (FR-029):
//======================================
// Save all binaries
//======================================

const banner = '\t–= Alex Saveliev Script =– \n\n';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

async function askYesNo(text) {
  const answer = await mfbe.ui.message(text, {
    icon: 'question',
    buttons: [
      { id: 'yes', label: '', default: true },
      { id: 'no', label: '', cancel: true },
    ],
  });
  return answer === 'yes';
}

/** The original's time string: seconds with a precision that drops as the time grows. */
function timeString(ctx, ms) {
  const Tmin = Math.floor(ms / 60000);
  const Tsec = Math.ceil(ms / 1000 - Tmin * 60);
  const Tsek = Math.ceil(10 * (ms / 1000 - Tmin * 60)) / 10;
  const Tssek = Math.ceil(100 * (ms / 1000 - Tmin * 60)) / 100;
  const Tsssek = Math.ceil(1000 * (ms / 1000 - Tmin * 60)) / 1000;
  const sec = t(ctx, ' сек', ' s');
  if (Tssek < 1 && Tmin < 1) return `${Tsssek}${sec}`;
  if (Tsek < 10 && Tmin < 1) return `${Tssek}${sec}`;
  if (Tmin < 1) return `${Tsek}${sec}`;
  return `${Tmin}${t(ctx, ' мин ', ' min ')}${Tsec}${t(ctx, ' с', ' s')}`;
}

export default async function run(ctx) {
  const Ts = Date.now();
  const binaries = await mfbe.doc.binaries();
  if (binaries.length === 0) {
    await mfbe.ui.message(
      t(ctx, `${banner}В этом документе нет бинарных объектов. \n\n`, `${banner}This document has no binary objects. \n\n`),
    );
    return;
  }
  const confirmed = await askYesNo(
    t(
      ctx,
      `${banner}Подтвердите ваше желание извлечь все бинарные объекты \nиз этого документа и сохранить их в каталог,\nкоторый вы выберете. \n\n`,
      `${banner}Please confirm that you want to extract all binary objects \nfrom this document and save them into a folder\nyou choose. \n\n`,
    ),
  );
  if (!confirmed) return;
  const { saved, skipped } = await mfbe.files.saveBinaries({
    title: t(ctx, 'Сохранить вложения на накопитель', 'Save the binary objects to a drive'),
  });
  if (saved + skipped === 0) return; // the folder dialog was cancelled
  const TimeStr = timeString(ctx, Date.now() - Ts);
  if (saved === 0) {
    await mfbe.ui.message(
      t(
        ctx,
        `${banner} Ни один бинарник не сохранён!\n\nВозможно файлы уже существуют?   \n`,
        `${banner} Not one binary object was saved!\n\nPerhaps the files exist already?   \n`,
      ),
    );
    return;
  }
  await mfbe.ui.message(
    t(
      ctx,
      `${banner}Было сохранено ${saved} из ${binaries.length} бинарных объектов. \n\nВремя выполнения: ${TimeStr}`,
      `${banner}${saved} of ${binaries.length} binary objects were saved. \n\nTime taken: ${TimeStr}`,
    ),
  );
}
