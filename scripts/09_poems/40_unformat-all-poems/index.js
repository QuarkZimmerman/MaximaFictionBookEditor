// Converted from FictionBook Editor 2.7.9: Scripts/09_Стихи/40_Расформатировать все стихи.js
// «Расформатирование всех стихов» v.1.5 by Александр Ка: removes the poem formatting of the whole
// book (the annotation and the history included). After a warning, every poem in document order:
// its stanzas, titles and epigraphs (the last first) get an empty line before and after them -
// unless the neighbour is empty or a subtitle - and are dissolved; its text authors (dates too)
// lose their format; an empty line that is the third in a row, stands before a subtitle or follows
// one goes; the poem gets an empty line before it (not after a title or subtitle) and after it,
// loses leading and trailing empty lines that come two in a row (the leading ones also after a
// title or subtitle), and is dissolved; verses become paragraphs. With corrections made, the
// version is raised and the history gets a line (the original's settings); a result window
// shows the counts. The original's code runs here on the emulation of its page
// (lib/fbe-dom.js); the history line's date is today's, or the date a calling script passes as
// { today: "YYYY-MM-DD" } (the snapshot suite does, for a stable result).
// Differences: a subtitle of a dissolved stanza that ends up in an epigraph becomes a paragraph
// (FB2 allows no subtitle there; the original left it); the name of main.js's fbeUserName is not
// read (there is no main.js): the history line is signed «Зорро», as the settings say.
// The original's notice, kept as written (FR-029):
//======================================
//             «Расформатирование всех стихов»
//  Скрипт предназначен для полного расформатирования всех стихов.
//
//  Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//  * История изменений в конце скрипта
//======================================
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
//     Добавление пустых строк между расформатированными стихами (<poem>) и текстом книги
// ---------------------------------------------------------------
         //  Автоматическое повышение версии файла и запись в историю изменений
//  Добавлять, если не сделано ни одного исправления
//   Имя используемое в добавленной записи:

import { FbePage, commitPage } from './lib/fbe-dom.js';
import { historyChange, today } from './lib/history-change.js';
import { jscriptRegExp as jre } from './lib/jscript-regexp.js';

const Add_emptyLine_on_off = 1; // 0 ; 1 // ("0" — никогда не добавлять, "1" — всегда добавлять)
const Version_on_off = 1; // 0 ; 1 // ("0" — отключить, "1" — включить)
const Vsegda_on_off = 0; // 0 ; 1 // ("0" — отключить, "1" — включить)
const youName = 'Зорро';

const ScriptName = '«Расформатирование всех стихов»';
const NumerusVersion = '1.5';

function tr(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const nbspEntity = '&nbsp;';
  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  const fbwBody = page.fbwBody;
  const document = { createElement: (name) => page.createElement(name) };

  /// ПРЕДУПРЕЖДЕНИЕ
  const warning = tr(ctx,
    '     Скрипт предназначен для полного удаления\nформатирования «стих».\n\n' +
      '     Для этого скрипт...\n1. удаляет форматирование внутри стихов:\n          «строфа» (<stanza>)\n' +
      '          «заголовок» (<title>)\n          «эпиграф» (<epigraph>)\n          «автор текста» (<text-author>);\n' +
      '2. удаляет всё форматирование «стих» (<poem>);\n3. изменяет все теги <v> на <p>;\n' +
      '4. при этом скрипт может добавлять или удалять\n     пустые строки внутри расформатированных\n' +
      '     разделов, или рядом с ними.\n\n                          ПРОДОЛЖИТЬ ?',
    '     The script removes the «poem» formatting\ncompletely.\n\n' +
      '     To do so, the script...\n1. removes the formatting inside poems:\n          «stanza» (<stanza>)\n' +
      '          «title» (<title>)\n          «epigraph» (<epigraph>)\n          «text author» (<text-author>);\n' +
      '2. removes all the «poem» formatting (<poem>);\n3. changes every <v> tag into <p>;\n' +
      '4. on the way it may add or remove\n     empty lines inside the unformatted\n' +
      '     parts, or next to them.\n\n                          CONTINUE?');
  if ((await MsgBox(warning, ScriptName, 4 + 32)) != 6) return;

  const Ts1 = Date.now();

  /// СОЗДАНИЕ МАССИВА с разделами "poem"
  const mDiv = fbwBody.getElementsByTagName('DIV');
  const mPm = [];
  let count_Pm = 0;
  for (let j = mDiv.length - 1; j >= 0; j--) {
    if (mDiv[j].className == 'poem') {
      mPm[count_Pm] = mDiv[j];
      count_Pm++;
    }
  }

  /// ОБРАБОТКА ТЕКСТА : Разделы "poem" : операции № 1хх
  let count_101 = 0;
  let count_102 = 0;
  let count_103 = 0;
  let count_111 = 0;
  let count_112 = 0;
  let count_113 = 0;
  let count_114 = 0;
  let count_115 = 0;
  const reFormat = jre('^(stanza|title|epigraph)$', 'g');
  const reSpase = jre('^(\\s|' + nbspEntity + '|&nbsp;|</{0,1}EM>|</{0,1}STRONG>){0,}$', 'g');

  for (let j = count_Pm - 1; j >= 0; j--) {
    const pm = mPm[j];
    if (!fbwBody.contains(pm)) continue;

    //  Разделы внутри "poem"
    const mStnz = pm.getElementsByTagName('DIV');
    for (let n = mStnz.length - 1; n >= 0; n--) {
      const stnz = mStnz[n];
      if (stnz.className.search(reFormat) != -1) {
        //  Добавление пустой строки перед разделом
        if (stnz.previousSibling && stnz.previousSibling.innerHTML.search(reSpase) == -1 && stnz.previousSibling.className != 'subtitle') {
          stnz.insertAdjacentElement('beforeBegin', document.createElement('P'));
          count_101++;
        }
        //  Добавление пустой строки после раздела
        if (stnz.nextSibling && stnz.nextSibling.innerHTML.search(reSpase) == -1 && stnz.nextSibling.className != 'subtitle') {
          stnz.insertAdjacentElement('afterEnd', document.createElement('P'));
          count_101++;
        }
        //  Учёт и Удаление оболочки раздела
        if (stnz.className == 'stanza') count_111++;
        if (stnz.className == 'title') count_112++;
        if (stnz.className == 'epigraph') count_113++;
        stnz.removeNode(false);
      }
    }

    const mPtr = pm.getElementsByTagName('P');
    for (let n = mPtr.length - 1; n >= 0; n--) {
      const ptr = mPtr[n];
      if (!ptr.parentNode) continue;
      //  Учёт и Удаление тега "text-author"
      if (ptr.className == 'text-author') {
        ptr.removeAttribute('className');
        count_114++;
      }
      if (ptr.innerHTML.search(reSpase) != -1) {
        //  Удаление третьей пустой строки подряд
        if (ptr.previousSibling && ptr.previousSibling.innerHTML.search(reSpase) != -1 &&
            ptr.previousSibling.previousSibling && ptr.previousSibling.previousSibling.innerHTML.search(reSpase) != -1) {
          ptr.removeNode(true);
          count_103++;
          continue;
        }
        //  Удаление пустой строки перед подзаголовком
        if (ptr.nextSibling && ptr.nextSibling.className == 'subtitle') {
          ptr.removeNode(true);
          count_103++;
          continue;
        }
        //  Удаление одной-двух пустых строк после подзаголовка
        if (ptr.previousSibling && ptr.previousSibling.className == 'subtitle') {
          if (ptr.nextSibling && ptr.nextSibling.innerHTML.search(reSpase) != -1) {
            ptr.nextSibling.removeNode(true);
            count_103++;
          }
          ptr.removeNode(true);
          count_103++;
        }
      }
    }

    //  Добавление пустой строки между стихами и текстом
    if (Add_emptyLine_on_off == 1) {
      if (pm.previousSibling && pm.previousSibling.innerHTML.search(reSpase) == -1 && pm.previousSibling.className != 'subtitle' && pm.previousSibling.className != 'title') {
        pm.insertAdjacentElement('beforeBegin', document.createElement('P'));
        count_102++;
      }
      if (pm.nextSibling && pm.nextSibling.innerHTML.search(reSpase) == -1) {
        pm.insertAdjacentElement('afterEnd', document.createElement('P'));
        count_102++;
      }
    }

    //  Удаление первых пустых строк "poem"
    while (pm.firstChild && pm.firstChild.innerHTML.search(reSpase) != -1 &&
        ((pm.previousSibling && (pm.previousSibling.className == 'subtitle' || pm.previousSibling.className == 'title')) ||
          (pm.firstChild.nextSibling && pm.firstChild.nextSibling.innerHTML.search(reSpase) != -1))) {
      pm.firstChild.removeNode(true);
      count_103++;
    }

    //  Удаление последних пустых строк "poem"
    while (pm.lastChild && pm.lastChild.innerHTML.search(reSpase) != -1 &&
        pm.lastChild.previousSibling && pm.lastChild.previousSibling.innerHTML.search(reSpase) != -1) {
      pm.lastChild.removeNode(true);
      count_103++;
    }

    //  Удаление форматирования стихами ("poem")
    pm.removeNode(false);
    count_115++;
  }

  const itogi = count_101 + count_102 + count_103 + count_111 + count_112 + count_113 + count_114 + count_115;

  ///  ПОВЫШЕНИЕ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В ИСТОРИЮ ИЗМЕНЕНИЙ
  let history = { HiCh: 0, VersionUp: false, versionFile: page.version, newVersion: page.version };
  if (Version_on_off == 1 && (itogi || Vsegda_on_off == 1)) {
    history = historyChange(page, ScriptName + ' ' + NumerusVersion, youName, today(ctx));
  }
  await commitPage(page);

  /// ОКНО РЕЗУЛЬТАТОВ
  const now = new Date();
  const two = (n) => (n < 10 ? `0${n}` : `${n}`);
  const currentTime = `${now.getHours()}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const currentDate = `${now.getDate()}.${two(now.getMonth() + 1)}.${String(now.getFullYear()).replace(/^.*?(\d{1,2})$/g, '$1')}`;
  const T2 = Date.now() - Ts1;
  const Tmin = Math.floor(T2 / 60000);
  const TsecD = (T2 % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  let tempus;
  if (Tmin == 0) {
    const sec = String(+String(TsecD).replace(/(.{1,5}).*/g, '$1'));
    tempus = tr(ctx, `${sec.replace('.', ',')} сек`, `${sec} s`);
  } else {
    tempus = tr(ctx, `${Tmin} мин`, `${Tmin} min`);
    if (Tsec != 0) tempus += tr(ctx, ` ${Tsec} с`, ` ${Tsec} s`);
  }

  const mSt = [];
  mSt.push(` ${ScriptName} v.${NumerusVersion}`);
  mSt.push('--------------------------------------------------------------');
  mSt.push('');
  mSt.push(tr(ctx, '• СТАТИСТИКА:', '• STATISTICS:'));
  mSt.push(tr(ctx, 'Время выполнения .  .  .  .  .  .  .  .  .\t', 'Time taken .  .  .  .  .  .  .  .  .  .  .\t') + tempus);
  if (itogi != 0) mSt.push(tr(ctx, 'Всего исправлений .  .  .  .  .  .  .  .  .\t', 'Corrections in all .  .  .  .  .  .  .  .\t') + itogi);
  if (itogi == 0) {
    mSt.push('');
    mSt.push(tr(ctx, '   >> Исправлений нет', '   >> No corrections'));
  }
  const rows = [
    [count_101, 'Вставка пустых строк внутри стихов   .  .  .  .', 'Empty lines inserted inside poems'],
    [count_102, 'Вставка пустых строк рядом со стихами .  .  .', 'Empty lines inserted next to poems'],
    [count_103, 'Удаление пустых строк внутри стихов .  .  .  .', 'Empty lines removed inside poems'],
    [count_111, 'Удаление формата строф   .  .  .  .  .  .  .  .  .  .', 'Stanza format removed'],
    [count_112, 'Удаление формата заголовков .  .  .  .  .  .  .  .', 'Title format removed'],
    [count_113, 'Удаление формата эпиграфов  .  .  .  .  .  .  .  .', 'Epigraph format removed'],
    [count_114, 'Удаление формата "автор текста" .  .  .  .  .  .', '"Text author" format removed'],
    [count_115, 'Удаление формата стихов ("poem")   .  .  .  .  .', 'Poem format ("poem") removed'],
  ].filter(([count]) => count != 0);
  if (rows.length) {
    mSt.push('');
    mSt.push(tr(ctx, '• ИСПРАВЛЕНИЯ:', '• CORRECTIONS:'));
    for (const [count, ru, en] of rows) mSt.push(`${tr(ctx, ru, en)}\t${count}`);
  }
  if (history.VersionUp || history.HiCh) mSt.push('');
  if (history.VersionUp) mSt.push(tr(ctx, '• Версия файла:  ', '• File version:  ') + `${history.versionFile}  ›››  ${history.newVersion}`);
  if (history.HiCh == 1) mSt.push(tr(ctx, '• Добавлена новая строка в историю', '• A new line was added to the history'));
  if (history.HiCh == 2) mSt.push(tr(ctx, '• Добавлены две строки в историю', '• Two lines were added to the history'));
  if (history.HiCh == 3) mSt.push(tr(ctx, '• Изменены данные в строке истории', '• A line of the history was changed'));
  mSt.push('');
  mSt.push('--------------------------------------------------------------');
  mSt.push(`• ${currentDate} • ${currentTime} •`);
  await MsgBox(mSt.join('\n'), ScriptName, 64);
}

//                 ///  ИСТОРИЯ ИЗМЕНЕНИЙ (of the original, kept as written)
//~~~~~~~~~~~~~~~~~~
// v.1.0 — Создание скрипта — Александр Ка (10.05.2024)
// v.1.1 — Исправлена ошибка с добавлением пустых строк — Александр Ка (10.06.2024)
// v.1.2 —  Александр Ка (17.06.2024)
// + Добавление расформатирования внутри стиха:  заголовков, "автор текста", эпиграфов
// + Добавление пустых строк рядом с расформатированными разделами
// v.1.3 — Удаление лишних пустых строк внутри стиха  —  Александр Ка (21.06.2024)
// v.1.4 — Исправлены все ошибки в окнах для win7  —  Александр Ка (19.01.2025)
// v.1.5 — Добавление функции повышения версии файла и запись в историю изменений — Александр Ка (29.04.2025)
//~~~~~~~~~~~~~~~~~~
