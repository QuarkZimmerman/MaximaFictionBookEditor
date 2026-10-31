// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/17_Исключение копий вложенных файлов.js
// Finds the copies among the binary objects - same size in bytes, same width and height of the
// image; the covers of the title-info and src-title-info take no part - and points every picture
// of the book (the book annotation, the history, the bodies) that uses a copy to the binary found
// first. The copies are left unused, for "Удалить неиспользуемые вложения..." to remove after a
// check. A window gives the statistics and the original's warning about the imprecise search.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - the copies keep their ids: the script interface cannot rename a binary object (the original
//   renamed each copy whose pictures it moved to "<original>_COPY_01.<ext>", "_COPY_02" and so on).
// The original's notice, kept as written (FR-029):
//======================================
//             «Исключение копий вложенных файлов»
// Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
// Скрипт предназначен для поиска копий вложенных файлов, и исключение имен этих копий из текста книги, путем их замены на имя оригинала.
//    После этого, копии файла становятся "неиспользованными бинарными объектами", и их можно удалить с помощью скрипта "Удалить неиспользуемые вложения..."
//    Однако перед этим желательно проверить правильность работы скрипта*.
//    Для удобства, файлам, которые определены скриптом как "копия", дано имя оригинального файла с выделяющимся дополнительным индексом.
// * При неблагоприятных условиях, например, если книга содержит 100 откалиброванных иллюстраций под одинаковую высоту и ширину, с размерами от 15 до 25 кБ, вероятность ошибочного "исключения" уникальной иллюстрации резко возрастает примерно до 40%
// ** Копии обложек не обрабатываются
// v.1.0 — Создание скрипта — Александр Ка (20.09.2024)
// v.1.1 — Исправлены все ошибки в окнах для win7 — Александр Ка (25.01.2025)
// v.1.2 — Мелкие правки — Александр Ка (01.05.2025)
//======================================

import { coverNames, dateLine, hasDims, loadPictures, nameOf, rename, t, tempusOf } from './picture-refs.js';

const ScriptName = '«Исключение копий вложенных файлов»';
const NumerusVersion = '1.2';

/// Демонстрационный режим "Показать все строки" ("0" — отключить, "1" — включить)
const VseStroki_on_off = 0;

const PRIMECHANIE = {
  ru: '* В скрипте используется неточный поиск копий. Сравнивается размер в байтах, а также высота и ширина изображения. Поэтому есть небольшая вероятность идентификации уникальной иллюстрации как копии. И поэтому, перед окончательным удалением повторных файлов, рекомендуется "Сохранить вложения на накопитель" и на всякий случай проверить результат обработки.',
  en: '* The script finds copies imprecisely: it compares the size in bytes and the height and width of the image. So there is a small chance that a unique illustration is taken for a copy. Before removing the repeated files for good, it is therefore recommended to "Save the binary objects to a drive" and to check the result, just in case.',
};

export default async function run(ctx) {
  const Ts = Date.now();
  const ru = ctx.uiLanguage === 'ru';

  ///  ПОИСК  :  Разделы "IMG", обложки, вложенные файлы
  const { doc, pictures } = await loadPictures();
  const mImgL = pictures.length;
  const mImgHref = pictures.map(nameOf);
  const mCovValue = coverNames(doc.description);
  const mCovValueL = mCovValue.length;
  const binaries = doc.binaries ?? [];
  const mBinL = binaries.length;
  const mBinName = binaries.map((binary) => binary.id);
  const mBinSize = binaries.map((binary) => String(binary.size));
  //  Для невалидных файлов нет записей о размере изображения
  const mBinDims = binaries.map((binary) => (hasDims(binary) ? `${binary.width}x${binary.height}` : 'х'));
  const isCover = (name) => mCovValue.includes(name);

  ///  ОБРАБОТКА  :  Поиск копий файлов ; переименования
  const mNumRepit = []; //  Массив с номерами повторных файлов
  let count_reName = 0; //  Счетчик измененных имен иллюстраций
  let descriptionChanged = false;
  for (let n = 0; n < mBinL; n += 1) {
    if (mNumRepit.includes(n)) continue; // пропуск уже найденных копий
    if (isCover(mBinName[n])) continue; //  исключение обложек
    for (let k = n + 1; k < mBinL; k += 1) {
      if (isCover(mBinName[k])) continue; //  исключение обложек
      if (mBinDims[n] !== 'х' && mBinDims[n] === mBinDims[k] && mBinSize[n] === mBinSize[k]) {
        mNumRepit.push(k); //  сохранение найденного номера
        for (let j = 0; j < mImgL; j += 1) {
          if (mBinName[k] === mImgHref[j]) {
            //  замена имени копии на имя оригинала
            if (await rename(pictures[j], mBinName[n])) descriptionChanged = true;
            count_reName += 1;
          }
        }
        // The original then renamed the copy (mBinName[k]) to "<original>_COPY_NN.<ext>": the
        // script interface cannot rename a binary object, so the copy keeps its id.
      }
    }
    if (ctx.cancelled) return;
    await mfbe.ui.progress(n + 1, mBinL);
  }
  if (descriptionChanged) await mfbe.doc.setDescription(doc.description);

  ///  ОКНО РЕЗУЛЬТАТОВ
  const tempus = tempusOf(ctx, Date.now() - Ts);
  const d = VseStroki_on_off === 1 ? 'показать нули' : 0;
  const shown = (count) => d !== 0 || count !== 0;
  let mSt = [];
  mSt.push(` ${t(ctx, ScriptName, '"Exclusion of copies of the binary objects"')} v.${NumerusVersion}`);
  mSt.push('-----------------------------------------------------------------');
  if (d) mSt.push(t(ctx, ' Демонстрационный режим', ' Demonstration mode'));
  mSt.push('\t\t\t\t\t\t');
  mSt.push(`${t(ctx, '• Время выполнения  .  .  .  .  .  .  .  .\t', '• Time taken\t')}${tempus}`);
  mSt.push(`${t(ctx, 'Вложенных файлов   .  .  .  .  .  .  .  .\t', 'Binary objects\t')}${mBinL}`);
  if (shown(mCovValueL)) mSt.push(`${t(ctx, 'Обложек  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Covers\t')}${mCovValueL}`);
  if (shown(mImgL)) mSt.push(`${t(ctx, 'Иллюстраций .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustrations\t')}${mImgL}`);
  if (count_reName === 0 || d) mSt.push('', t(ctx, '   >> Исправлений нет', '   >> No corrections'));
  if (shown(count_reName)) {
    mSt.push('', `${t(ctx, '• Изменено имен иллюстраций* .  .\t', '• Illustration names changed*\t')}${count_reName}`, '____________');
    //  Примечание (разделение на строки)
    const ind = mSt.length;
    const reZit = new RegExp('([^ ].{0,43})(?=\\s\\s.{0,}|$)', 'g'); // Рег. выражение для разделения цитаты на строки.
    mSt = mSt.concat((ru ? PRIMECHANIE.ru : PRIMECHANIE.en).replace(/ /g, '  ').match(reZit));
    for (let j = mSt.length - 1; j >= ind; j -= 1) mSt[j] = `  ${mSt[j]}`; //  Добавление отступа.
  }
  mSt.push('', '-----------------------------------------------------------------', dateLine());
  await mfbe.ui.message(`${mSt.join('\n')}\n`);
}
