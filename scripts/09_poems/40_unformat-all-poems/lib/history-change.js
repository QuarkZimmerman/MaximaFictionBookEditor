// The version raise and history entry of Александр Ка's poem scripts of FictionBook Editor 2.7.9
// (09/unformat-all-poems, 09/unformat-poems-shallow; byte-identical copies): their function
// HistoryChange, ported on the page of lib/fbe-dom.js. Dates are written D.MM.YY.
//
// In the history (the page's <DIV class=history>), the last line holding one of the ten last
// dates (from its last line down to its second) is the run of today when it ends with "— (Name,
// Date)": the script's name is added to it (and the word "Скрипт:" made "Скрипты:") and the date
// made today's. Otherwise the document-info version is raised (1.0 -> 1.1, 2 -> 2.1, 1.9 ->
// 1.10), a line "v.<old> — ?" is added when the history does not mention the old version, and the
// line "v.<new> —  Скрипт: <name> — (Name, Date)". The name main.js may define (fbeUserName) is
// not read: the editor has no main.js.
import { jscriptRegExp as jre } from './jscript-regexp.js';

/** The ten dates D.MM.YY from `now` (milliseconds) back, today first. */
export function recentDates(now) {
  const mDate = [];
  let D = now;
  for (let j = 0; j < 10; j++) {
    const fullDate = new Date(D);
    const Day = fullDate.getDate();
    const Month = ('0' + (1 + fullDate.getMonth())).replace(/^.*?(\d\d)$/g, '$1');
    const Year = ('0' + fullDate.getFullYear()).replace(/^.*?(\d\d)$/g, '$1');
    mDate[j] = Day + '.' + Month + '.' + Year;
    D -= 86400000;
  }
  return mDate;
}

/**
 * HistoryChange(Script_Name, youName) on `page`, with today at `now`. Returns what the result
 * window reports: { HiCh (1, 2: lines added; 3: a line changed), VersionUp, versionFile,
 * newVersion }.
 */
export function historyChange(page, Script_Name, youName, now) {
  const nbspEntity = '&nbsp;';
  const fbwBody = page.fbwBody;
  let HiCh = 0;
  let VersionUp = false;
  let versionFile = page.version;
  let newVersion = versionFile;

  // Получение раздела истории
  let History = fbwBody.firstChild;
  while (History != null && History.className != 'history') History = History.nextSibling;
  if (History == null) {
    History = page.createElement('DIV');
    let Annotation = fbwBody.firstChild;
    while (Annotation != null && Annotation.className != 'annotation') Annotation = Annotation.nextSibling;
    if (Annotation != null) Annotation.insertAdjacentElement('afterEnd', History);
    else fbwBody.insertAdjacentElement('afterBegin', History);
    History.className = 'history';
    History.insertAdjacentElement('beforeEnd', page.createElement('P'));
  }

  //  Создание массива с прошедшими датами
  const mDate = recentDates(now);

  //  Поиск недавней записи в "истории"
  let povtorD = false;
  const mP = History.getElementsByTagName('P');
  let s = '';
  let k = 0;
  let j;
  fff: for (j = mP.length - 1; j > 0; j--) {
    s = mP[j].innerHTML;
    for (k = 0; k < 10; k++) {
      if (s.search(mDate[k]) != -1) {
        povtorD = true;
        break fff;
      }
    }
  }

  //  Обновление записи в истории изменений
  let textYouName = youName + '';
  if (youName != '') textYouName += ', ';

  const reHist00s = jre('[^А-яЁёA-Za-z0-9]' + Script_Name + '[^А-яЁёA-Za-z0-9]', 'g');
  const reHist01 = jre('(.[^…\\?!\\.,;:—])(\\s|' + nbspEntity + ')(— \\(' + textYouName + mDate[k] + '\\))', 'g');
  const reHist01_ = '$1; $3';
  const reHist02 = jre('(.)(\\s|' + nbspEntity + ')(— \\(' + textYouName + mDate[k] + '\\))', 'g');
  const reHist02_ = '$1 Скрипт: $3';
  const reHist03 = jre('(.)(\\s|' + nbspEntity + ')(— \\(' + textYouName + mDate[k] + '\\))', 'g');
  const reHist03_ = '$1 ' + Script_Name + ' $3';

  if (povtorD) {
    if (s.search(reHist03) != -1) {
      if (s.search(reHist00s) == -1) {
        if (s.search(/([Сс]крипт):/) != -1) s = s.replace(/([Сс]крипт):/g, '$1ы:');
        if (s.search(reHist01) != -1) s = s.replace(reHist01, reHist01_);
        if (s.search(/[Сс]крипты?:/) == -1) s = s.replace(reHist02, reHist02_);
        s = s.replace(reHist03, reHist03_);
      }
      if (k != 0) s = s.replace(mDate[k], mDate[0]);
      if (mP[j].innerHTML != s) {
        mP[j].innerHTML = s;
        HiCh = 3;
      }
    } else povtorD = false;
  }
  if (povtorD) return { HiCh, VersionUp, versionFile, newVersion };

  //  Повышение версии
  let versionText = '';
  const ValidationVersion = versionFile.length <= 10 && versionFile.search(/^\d{0,10}(\.\d{1,8})?$/g) != -1;
  if (ValidationVersion) {
    if (versionFile == '') versionFile = '1.0';
    if (versionFile.search(/^\d+$/g) != -1) newVersion = versionFile + '.1';
    else {
      newVersion = +versionFile.replace(/^\d+\./g, '');
      newVersion++;
      newVersion = versionFile.replace(/\.\d+$/g, '') + '.' + newVersion;
    }
    if (newVersion.length <= 10) page.version = newVersion;
    VersionUp = true;
    versionText = 'v.' + newVersion + ' — ';
  }

  //   Добавление строк в историю изменений
  const reHist11 = jre('^(\\s|' + nbspEntity + '){0,}$', 'g');
  const reHist12 = jre('(^|\\n)[^0-9]{0,10}' + versionFile + '([^0-9]|$)', 'g');
  if (ValidationVersion && History.innerHTML.search(reHist12) == -1) {
    if (History.lastChild.innerHTML.search(reHist11) == -1) History.insertAdjacentElement('beforeEnd', page.createElement('P'));
    History.lastChild.innerHTML = 'v.' + versionFile + ' — ?';
    HiCh++;
  }
  if (History.lastChild.innerHTML.search(reHist11) == -1) History.insertAdjacentElement('beforeEnd', page.createElement('P'));
  History.lastChild.innerHTML = versionText + ' Скрипт: ' + Script_Name + ' — (' + textYouName + mDate[0] + ')';
  HiCh++;
  return { HiCh, VersionUp, versionFile, newVersion };
}

/** Today: the date a calling script passes as { today: "YYYY-MM-DD" }, else the clock. */
export function today(ctx) {
  const match = ctx.startedBy === 'script' && typeof ctx.args?.today === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ctx.args.today) : null;
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0).getTime() : Date.now();
}
