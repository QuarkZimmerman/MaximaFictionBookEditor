// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/20_Обновить иллюстрации (версия Александра Ка).js
// Sets the covers with the standard names: when the title-info has no cover in its list (no
// cover, or one whose binary is no JPEG or PNG of the book), the first binary "cover.jpg" or
// "cover.png" becomes its cover; the same with "cover_src.jpg/png" for the src-title-info. A
// window gives the statistics: the pictures and the image binaries (which the original refreshed
// in its view) and the covers set.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - nothing is refreshed: the editor's views show the pictures and the binaries as they are (the
//   original reloaded every IMG of its view, its tree and its save and preview buttons); the
//   counts are reported as the original reported them;
// - the cover's binary is not moved to the front of the binary objects (the script interface
//   cannot reorder them; their order does not change the book);
// - a book without a src-title-info gets no "cover_src" cover (2.7.9 then wrote a src-title-info
//   with empty genre, author, title and language, which FB2 requires).
// The original's notice, kept as written (FR-029):
//======================================
//   Скрипт «Обновление графики» v.1.3
//   За основу взят скрипт "Обновить иллюстрации" (v.1.0)
// v.1.1 — Обновление кнопок сохранения файлов и кнопок просмотра изображений — Александр Ка (15.09.2024)
// v.1.2 — Установка обложек. Статистика. Изменено имя скрипта — Александр Ка (14.03.2025)
// v.1.3 — Мелкие правки — Александр Ка (02.05.2025)
//======================================

import { dateLine, loadPictures, t, tempusOf } from './picture-refs.js';

const ScriptName = '«Обновление графики»';
const NumerusVersion = '1.3';

/// Демонстрационный режим "Показать все строки" ("0" — отключить, "1" — включить)
const VseStroki_on_off = 0;

export default async function run(ctx) {
  const Ts = Date.now();
  const { doc, pictures } = await loadPictures();
  const description = doc.description;
  const binaries = doc.binaries ?? [];

  //  Счетчики.
  let count_Cover = 0;
  const count_Img = pictures.length; //  Все разделы "IMG" (the pictures the original refreshed)

  ///  УСТАНОВКА ОБЛОЖЕК со стандартными именами (cover.jpg ;  cover.png ;  cover_src.jpg ;  cover_src.png)
  // The cover lists of the description form offered the JPEG and PNG binaries, in their order.
  const options = binaries
    .filter((binary) => binary.id !== '' && ['image/jpeg', 'image/png'].includes(String(binary.contentType ?? '').toLowerCase()))
    .map((binary) => `#${binary.id}`);
  //  Функция для установки обложек
  const CoverAdd = (info, coverName) => {
    if (!info) return false;
    const slots = info.coverpage ?? [];
    if (slots.length > 1) return false; //  Если есть место только для одной обложки...
    const value = slots.length === 1 && options.includes(slots[0].href) ? slots[0].href : '';
    if (value !== '') return false; //  Если обложка не установлена...
    const reCover = new RegExp(`^#${coverName}\\.(jpg|png)$`, '');
    const found = options.find((option) => option.search(reCover) !== -1);
    if (!found) return false;
    info.coverpage = [{ href: found }]; //  устанавливаем этот файл как обложку.
    count_Cover += 1;
    return true;
  };
  const tiSet = CoverAdd(description.titleInfo, 'cover'); //  основная обложка
  const stiSet = CoverAdd(description.srcTitleInfo, 'cover_src'); //  обложка оригинала
  if (tiSet || stiSet) await mfbe.doc.setDescription(description);

  ///  The binaries with a save button in the original's panel: those of an image type.
  const count_Bin = binaries.filter((binary) => /image/.test(binary.contentType ?? '')).length;

  ///  ОКНО РЕЗУЛЬТАТОВ
  const tempus = tempusOf(ctx, Date.now() - Ts);
  const d = VseStroki_on_off === 1 ? 'показать всё' : 0;
  const mSt = [];
  mSt.push(` ${t(ctx, ScriptName, '"Refreshing the graphics"')} v.${NumerusVersion}`);
  mSt.push('------------------------------------------------------');
  if (d) mSt.push(t(ctx, ' Демонстрационный режим', ' Demonstration mode'));
  mSt.push('\t\t\t\t\t   ');
  mSt.push(`${t(ctx, '• Время выполнения  .  .  .  .  .  .  .  .\t', '• Time taken\t')}${tempus}`);
  mSt.push('');
  const cTaT = mSt.length;
  if (count_Img !== d) mSt.push(`${t(ctx, '• Обновлено иллюстраций .  .  .  .  .\t', '• Illustrations refreshed\t')}${count_Img}`);
  if (count_Bin !== d) mSt.push(`${t(ctx, '• Обновлено вложений   .  .  .  .  .  .\t', '• Binary objects refreshed\t')}${count_Bin}`);
  if (count_Cover !== d) mSt.push(`${t(ctx, '• Установлено обложек   .  .  .  .  .  .\t', '• Covers set\t')}${count_Cover}`);
  if (cTaT === mSt.length || d) mSt.push(t(ctx, '   >> Исправлений нет', '   >> No corrections'));
  mSt.push('', '------------------------------------------------------', dateLine());
  await mfbe.ui.message(mSt.map((line) => `${line}\n`).join(''));
}
