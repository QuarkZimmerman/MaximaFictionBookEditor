// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/25_Коррекция jpg-png.js
// For every picture of the book (the book annotation, the history, the bodies) whose address
// names no binary object, takes the name without its extension (jpg, jpeg, png, tif, gif or bmp,
// with or without a "_N" after it) and, when an unused binary of that name with the extension
// jpg, jpeg or png exists, points the picture to it - as needed after the binaries were converted
// to jpg/png. A window gives the statistics: the binaries and the unused ones, the covers, the
// pictures and those without a binary, the changes by kind. No differences from the original's
// result (docs/scripting/notes-279-drafts/05.md).
// The original's notice, kept as written (FR-029):
//======================================
//             «Коррекция jpg/png»
// Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
// Скрипт предназначен для коррекции имен иллюстраций путем изменения расширения файла.
// Такая операция необходима после переформатирования вложенных файлов в "jpg/png".
// v.1.0 — Создание скрипта — Александр Ка (20.09.2024)
// v.1.1 — Исправлены все ошибки в окнах для win7 — Александр Ка (27.01.2025)
// v.1.2 — Мелкие правки — Александр Ка (01.05.2025)
//======================================

import { coverNames, dateLine, loadPictures, nameOf, rename, t, tempusOf } from './picture-refs.js';

const ScriptName = '«Коррекция jpg/png»';
const NumerusVersion = '1.2';

/// Демонстрационный режим "Показать все строки" ("0" — отключить, "1" — включить)
const VseStroki_on_off = 0;

// The kinds of change, as the original counted them (the picture's format, then the binary's).
const KINDS = [
  ['      • jpg-формат  ›››  jpg   .  .  .  .  .  .\t', '      • jpg format  ›››  jpg\t'],
  ['      • jpg-формат  ›››  jpeg .  .  .  .  .  .\t', '      • jpg format  ›››  jpeg\t'],
  ['      • jpg-формат  ›››  png  .  .  .  .  .  .\t', '      • jpg format  ›››  png\t'],
  ['      • jpeg-формат  ›››  jpg .  .  .  .  .  .\t', '      • jpeg format  ›››  jpg\t'],
  ['      • jpeg-формат  ›››  jpeg  .  .  .  .  .\t', '      • jpeg format  ›››  jpeg\t'],
  ['      • jpeg-формат  ›››  png   .  .  .  .  .\t', '      • jpeg format  ›››  png\t'],
  ['      • png-формат  ›››  jpg  .  .  .  .  .  .\t', '      • png format  ›››  jpg\t'],
  ['      • png-формат  ›››  jpeg   .  .  .  .  .\t', '      • png format  ›››  jpeg\t'],
  ['      • png-формат  ›››  png .  .  .  .  .  .\t', '      • png format  ›››  png\t'],
  ['      • tif-формат  ›››  jpg .  .  .  .  .  .  .\t', '      • tif format  ›››  jpg\t'],
  ['      • tif-формат  ›››  jpeg  .  .  .  .  .  .\t', '      • tif format  ›››  jpeg\t'],
  ['      • tif-формат  ›››  png   .  .  .  .  .  .\t', '      • tif format  ›››  png\t'],
  ['      • gif-формат  ›››  jpg .  .  .  .  .  .  .\t', '      • gif format  ›››  jpg\t'],
  ['      • gif-формат  ›››  jpeg  .  .  .  .  .  .\t', '      • gif format  ›››  jpeg\t'],
  ['      • gif-формат  ›››  png   .  .  .  .  .  .\t', '      • gif format  ›››  png\t'],
  ['      • bmp-формат  ›››  jpg .  .  .  .  .  .\t', '      • bmp format  ›››  jpg\t'],
  ['      • bmp-формат  ›››  jpeg  .  .  .  .  .\t', '      • bmp format  ›››  jpeg\t'],
  ['      • bmp-формат  ›››  png   .  .  .  .  .\t', '      • bmp format  ›››  png\t'],
  ['      • без формата  ›››  jpg .  .  .  .  .  .\t', '      • no format  ›››  jpg\t'],
  ['      • без формата  ›››  jpeg  .  .  .  .  .\t', '      • no format  ›››  jpeg\t'],
  ['      • без формата  ›››  png   .  .  .  .  .\t', '      • no format  ›››  png\t'],
];

const FIRST = { jpg: 0, jpeg: 3, png: 6, tif: 9, gif: 12, bmp: 15, '': 18 };
const SECOND = { jpg: 0, jpeg: 1, png: 2 };

export default async function run(ctx) {
  const Ts = Date.now();
  const ru = ctx.uiLanguage === 'ru';

  ///  ПОИСК  :  Разделы "IMG", обложки, вложенные файлы
  const { doc, pictures } = await loadPictures();
  const mImgL = pictures.length;
  const mImgHref = pictures.map(nameOf);
  const mCovValue = coverNames(doc.description);
  const mCovValueL = mCovValue.length;
  const mCovImgValue = mImgHref.concat(mCovValue); //  Массив с именами всех обложек и иллюстраций
  const mBinName = (doc.binaries ?? []).map((binary) => binary.id);
  const mBinL = mBinName.length;

  ///  ПОИСК  :  Поиск неиспользованных вложений
  const mBinName2 = mBinName.filter((name) => !mCovImgValue.includes(name));
  const mBinN2L = mBinName2.length;
  const mBinName2_ = mBinName2.map(() => 1); // массив с метками неиспользованных вложений

  ///  ОБРАБОТКА  :  Поиск безбинарных иллюстраций и их переименование
  const reXXX = new RegExp('^(.+?)(\\.(JPG|JPEG|PNG|TIF|GIF|BMP)(_\\d{1,}){0,1}){0,1}$', 'gi');
  const reYYY = new RegExp('^(.+)\\.(JPG|JPEG|PNG)$', 'gi');
  const count = KINDS.map(() => 0);
  let count_Img_noBin = 0; //  Счетчик безбинарных иллюстраций
  let descriptionChanged = false;
  for (let n = 0; n < mImgL; n += 1) {
    if (mBinName.includes(mImgHref[n])) continue; // если имя иллюстрации есть среди имен файлов
    count_Img_noBin += 1;
    const newName = mImgHref[n].replace(reXXX, '$1'); // если же иллюстрация безбинарная, убираем у неё расширение
    for (let j = 0; j < mBinN2L; j += 1) {
      if (mBinName2[j].search(reYYY) !== -1 && newName === mBinName2[j].replace(reYYY, '$1')) {
        const num = FIRST[mImgHref[n].replace(reXXX, '$3').toLowerCase()] + SECOND[mBinName2[j].replace(reYYY, '$2').toLowerCase()];
        if (await rename(pictures[n], mBinName2[j])) descriptionChanged = true;
        count[num] += 1;
        mBinName2_[j] = 0; // снимаем метку "неиспользованное вложение" с файла
        break;
      }
    }
    if (ctx.cancelled) return;
    if ((n + 1) % 50 === 0) await mfbe.ui.progress(n + 1, mImgL);
  }
  if (descriptionChanged) await mfbe.doc.setDescription(doc.description);

  ///  ДОПОЛНИТЕЛЬНЫЕ ВЫЧИСЛЕНИЯ
  const count_Bin2 = mBinName2_.reduce((sum, mark) => sum + mark, 0); // неиспользованных вложений : стало
  const count_Img_noBin2 = count_Img_noBin - count.reduce((sum, c) => sum + c, 0); // безбинарных иллюстраций : стало

  ///  ОКНО РЕЗУЛЬТАТОВ
  const tempus = tempusOf(ctx, Date.now() - Ts);
  const d = VseStroki_on_off === 1 ? 'показать нули' : 0;
  const differs = (value) => value !== d;
  const mSt = [];
  mSt.push(` ${t(ctx, ScriptName, '"jpg/png correction"')} v.${NumerusVersion}`);
  mSt.push('--------------------------------------------------------------');
  if (d) mSt.push(t(ctx, ' Демонстрационный режим', ' Demonstration mode'));
  mSt.push('\t\t\t\t\t\t');
  mSt.push(`${t(ctx, '• Время выполнения  .  .  .  .  .  .  .  .\t', '• Time taken\t')}${tempus}`);
  // A part whose lines all stayed out is dropped with its heading lines (the original's cTaT).
  let cTaT = mSt.length;
  mSt.push('');
  if (differs(mBinL)) mSt.push(`${t(ctx, 'Вложенных файлов  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Binary objects\t')}${mBinL}`);
  if (differs(mBinN2L)) {
    if (mBinN2L === count_Bin2 || d) mSt.push(`${t(ctx, '        Неиспользованных вложений   .  .  .  .  .\t', '        Unused binary objects\t')}${mBinN2L}`);
    if (mBinN2L !== count_Bin2 || d) {
      mSt.push(`${t(ctx, '        Неиспользованных вложений, было .  .\t', '        Unused binary objects, before\t')}${mBinN2L}`);
      mSt.push(`${t(ctx, '                стало .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '                after\t')}${count_Bin2}`);
    }
  }
  if (cTaT === mSt.length - 1) mSt.pop();
  cTaT = mSt.length;
  mSt.push('');
  if (differs(mCovValueL)) mSt.push(`${t(ctx, 'Обложек   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Covers\t')}${mCovValueL}`);
  if (differs(mImgL)) mSt.push(`${t(ctx, 'Иллюстраций  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Illustrations\t')}${mImgL}`);
  if (differs(count_Img_noBin)) {
    if (count_Img_noBin === count_Img_noBin2 || d) mSt.push(`${t(ctx, '        Безбинарных иллюстраций  .  .  .  .  .  .  .\t', '        Illustrations without a binary\t')}${count_Img_noBin}`);
    if (count_Img_noBin !== count_Img_noBin2 || d) {
      mSt.push(`${t(ctx, '        Безбинарных иллюстраций, было   .  .  .\t', '        Illustrations without a binary, before\t')}${count_Img_noBin}`);
      mSt.push(`${t(ctx, '                стало .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .\t', '                after\t')}${count_Img_noBin2}`);
    }
  }
  if (cTaT === mSt.length - 1) mSt.pop();
  cTaT = mSt.length;
  mSt.push('', t(ctx, 'Изменения  в  именах  иллюстраций :', 'Changes  in  the  illustration  names :'));
  KINDS.forEach(([lineRu, lineEn], i) => {
    if (differs(count[i])) mSt.push(`${ru ? lineRu : lineEn}${count[i]}`);
  });
  if (cTaT === mSt.length - 2) mSt.splice(cTaT, 2); //  Если нет строк с исправлениями - удаляем две последние строки
  if (cTaT === mSt.length || d) mSt.push('', t(ctx, '   >> Исправлений нет', '   >> No corrections'));
  mSt.push('', '--------------------------------------------------------------', dateLine());
  await mfbe.ui.message(`${mSt.join('\n')}\n`);
}
