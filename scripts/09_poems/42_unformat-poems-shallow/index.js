// Converted from FictionBook Editor 2.7.9: Scripts/09_Стихи/42_Поверхностно расформатировать все стихи.js
// «Поверхностное расформатирование всех стихов» v.1.5 by Александр Ка, for the rare book whose
// whole text is formatted as poems at random. After a warning, every poem of the book (the
// annotation and the history included) that has no text author or date of its own: an empty
// line goes between two stanzas that follow each other, the stanzas and the poem are dissolved
// (verses become paragraphs, every other format is kept). With corrections made, the version is
// raised and the history gets a line (the original's settings); a result window shows the
// counts. The original's code runs here on the emulation of its page (lib/fbe-dom.js); the
// history line's date is today's, or the date a calling script passes as
// { today: "YYYY-MM-DD" } (the snapshot suite does, for a stable result).
// Differences: a poem with a title or an epigraph, or with a stanza that has a title, is left as
// it is: dissolving it would leave a title or an epigraph inside the text of a section, which FB2
// does not allow (2.7.9 did so and asked before saving the book); a stanza's subtitle that ends up
// in an epigraph becomes a paragraph (FB2 allows no subtitle there); the history line has no user
// name, by the requester's decision (2026-10-31): youName is empty, the original's own way to a
// line without a name (its «Зорро» was a placeholder; main.js's fbeUserName is not read, there is
// no main.js).
// The original's notice, kept as written (FR-029):
//======================================
//             «Поверхностное расформатирование всех стихов»
//    Скрипт предназначен для исправления одной редкой ошибки в файле FB2, при которой весь текст книги хаотично и бессистемно отформатирован как «стихи».
//    Для всех остальных файлов, скрипт может навредить.
//    Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//  * История изменений в конце скрипта
//======================================
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
         //  Автоматическое повышение версии файла и запись в историю изменений
//  Добавлять, если не сделано ни одного исправления
//   Имя используемое в добавленной записи:
//  * Можно использовать почти любые символы. Исключения:   |  "  |  \  |    Но и любой из этих знаков можно добавить, если поставить перед ним наклонную черту ("\"), например: "\\" = "\"
//  ** Или можно оставить эти кавычки пустыми (""), тогда строка в истории будет без имени.

import { FbePage, commitPage } from './lib/fbe-dom.js';
import { historyChange, today } from './lib/history-change.js';

const Version_on_off = 1; // 0 ; 1 // ("0" — отключить, "1" — включить)
const Vsegda_on_off = 0; // 0 ; 1 // ("0" — отключить, "1" — включить)
// Empty: a history line without a name (the original's "Зорро" left out, 2026-10-31).
const youName = '';

const ScriptName = '«Поверхностное расформатирование всех стихов»';
const NumerusVersion = '1.5';

function tr(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** A poem whose dissolution would leave a title or an epigraph in the text (see above). */
function keepsHeadings(pm) {
  if (pm.children.some((child) => child.className == 'title' || child.className == 'epigraph')) return true;
  return pm.children.some((child) => child.className == 'stanza' && child.children.some((c) => c.className == 'title'));
}

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  const fbwBody = page.fbwBody;
  const document = { createElement: (name) => page.createElement(name) };

  /// ПРЕДУПРЕЖДЕНИЕ
  const warning = tr(ctx,
    '     Скрипт предназначен для исправления\nодной редкой ошибки, при которой текст книги\n' +
      'хаотично и бессистемно отформатирован как «стихи».\n\n     Для исправления этой ошибки, скрипт...\n' +
      'добавляет пустые строки на стыке «строф» (<stanza>);\nудаляет почти всё форматирование «стих» (<poem>);\n' +
      'удаляет почти всё форматирование «строфа» (<stanza>);\nи изменяет почти все теги <v> на <p>.\n\n' +
      '     Все другие форматы сохраняются.\n\n                                ПРОДОЛЖИТЬ ?  ',
    '     The script fixes a rare error\nwhere the text of a book is formatted\n' +
      'as «poems» at random.\n\n     To fix it, the script...\n' +
      'adds empty lines where «stanzas» (<stanza>) meet;\nremoves almost all the «poem» formatting (<poem>);\n' +
      'removes almost all the «stanza» formatting (<stanza>);\nand changes almost all <v> tags into <p>.\n\n' +
      '     All other formats are kept.\n\n                                CONTINUE?  ');
  if ((await MsgBox(warning, ScriptName, 4 + 32)) != 6) return;

  const Ts = Date.now();

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

  /// ОБРАБОТКА ТЕКСТА : Разделы "poem" : операции № 101, 111, 112
  let count_101 = 0;
  let count_111 = 0;
  let count_112 = 0;
  aaa: for (let j = count_Pm - 1; j >= 0; j--) {
    const pm = mPm[j];
    if (!fbwBody.contains(pm)) continue;
    //  Исключение из обработки стихов, внутри которых есть тег <text-author>
    const mPtr = pm.children;
    for (let n = 0; n < mPtr.length; n++) if (mPtr[n].className == 'text-author') continue aaa;
    if (keepsHeadings(pm)) continue;

    //  Добавление пустой строки между строфами и удаление форматирования строфой ("stanza")
    const mStnz = pm.getElementsByTagName('DIV');
    for (let n = mStnz.length - 1; n >= 0; n--) {
      const stnz = mStnz[n];
      if (stnz.className != 'stanza') continue;
      if (stnz.previousSibling && stnz.previousSibling.className == 'stanza') {
        stnz.insertAdjacentElement('beforeBegin', document.createElement('P'));
        count_101++;
      }
      stnz.removeNode(false);
      count_111++;
    }

    //  Удаление форматирования стихами ("poem")
    pm.removeNode(false);
    count_112++;
  }

  const itogi = count_101 + count_111 + count_112;

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
  const T2 = Date.now() - Ts;
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
  mSt.push(' «Поверхностное');
  mSt.push(`         расформатирование  всех стихов» v.${NumerusVersion}`);
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
    [count_101, 'Вставка пустых строк на стыке строф .  .  .  .', 'Empty lines inserted where stanzas meet'],
    [count_111, 'Удаление формата строф ("stanza")  .  .  .  .  .', 'Stanza format ("stanza") removed'],
    [count_112, 'Удаление формата стихов ("poem")   .  .  .  .  .', 'Poem format ("poem") removed'],
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
// v.1.0 — Создание скрипта — Александр Ка (10.05.2024)
// v.1.1 — Исправлена ошибка с добавлением пустых строк — Александр Ка (10.06.2024)
// v.1.2 — Удаление лишних операций, изменение названия скрипта  — Александр Ка (17.06.2024)
// v.1.3 — Исключение из обработки стихов, внутри которых есть тег <text-author>   — Александр Ка (19.06.2024)
// v.1.4 — Исправлены все ошибки в окнах для win7   — Александр Ка (18.01.2025)
// v.1.5 — Добавление функции повышения версии файла и запись в историю изменений — Александр Ка (29.04.2025)
