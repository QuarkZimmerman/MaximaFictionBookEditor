// The original's HistoryChange (35_Разночтения Ё-Е.js, "ФУНКЦИЯ ПОВЫШЕНИЯ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В
// ИСТОРИЮ ИЗМЕНЕНИЙ") on the document model: it raises the version of the file and writes a line
// "v.<new version> —  Скрипт: <name> — <user>, <date>" into the document's history (first a line
// "v.<old version> — ?" when the history does not mention the old version); when a line of the
// last ten days names the same user and date form, it adds the script to that line instead and
// gives it today's date. FictionBook Editor showed the history as a block of paragraphs above the
// bodies, with one empty paragraph when the book had none; the lines are edited in the legacy
// inline-HTML notation of lib/legacy-html.js, as the original edited their HTML.
import { parseInline, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';

const nbspEntity = '&nbsp;';
// JScript's \s: the ASCII white space only.
const S = '[\\t\\n\\v\\f\\r ]';

/** The original's inCode: text into the notation (only the non-breaking space becomes &nbsp;). */
function inCode(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/ /g, nbspEntity)
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/­/g, '&shy;');
}

/** The history's paragraphs in order (what getElementsByTagName("P") gave), as records. */
function paragraphsOf(history) {
  const out = [];
  const visit = (node, parent, index) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type) || node.type === 'empty-line') {
      out.push({ node, parent, index });
      return;
    }
    (node.content ?? []).forEach((child, i) => visit(child, node, i));
  };
  (history.content ?? []).forEach((child, i) => visit(child, history, i));
  return out;
}

function innerHTML(node) {
  return node.type === 'empty-line' ? '' : serializeInline(node.content ?? [], []);
}

function innerText(history) {
  return paragraphsOf(history)
    .map(({ node }) => (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(''))
    .join('\r\n');
}

/** Writes HTML into a paragraph of the history (an empty line becomes a paragraph). */
function setInnerHTML(record, html) {
  const node = { type: 'p', attrs: { ...(record.node.attrs ?? {}) }, content: parseInline(html, []) };
  if (record.node.type !== 'p') delete node.attrs.nodeId;
  record.parent.content[record.index] = node;
  record.node = node;
}

/**
 * Applies the original's HistoryChange to `description` (changed in place). Returns
 * `{ HiCh, VersionUp, versionFile, newVersion }` as the original's variables were afterwards.
 */
export function historyChange(description, scriptName, youName, now = Date.now()) {
  const info = description.documentInfo;
  let versionFile = info.version ?? '';
  let newVersion = versionFile;
  const result = { HiCh: 0, VersionUp: false };
  // FictionBook Editor always showed the history, with one empty paragraph when there was none.
  if (!info.history || (info.history.content ?? []).length === 0) {
    info.history = { type: 'annotation', attrs: { ...(info.history?.attrs ?? {}) }, content: [{ type: 'empty-line', attrs: {} }] };
  }
  const History = info.history;

  //  Создание массива с прошедшими датами
  const mDate = [];
  let D = now;
  for (let j = 0; j < 10; j += 1) {
    const fullDate = new Date(D);
    const Day = fullDate.getDate();
    const Month = `0${1 + fullDate.getMonth()}`.replace(/^.*?(\d\d)$/g, '$1');
    const Year = fullDate.getFullYear();
    mDate[j] = `${Day}.${Month}.${Year}`;
    D -= 86400000;
  }

  //  Поиск недавней записи в "истории"
  let povtorD = false;
  const mP = paragraphsOf(History);
  let s = '';
  let j = mP.length - 1;
  let k = 0;
  fff: for (; j >= 0; j -= 1) {
    s = innerHTML(mP[j].node);
    for (k = 0; k < 10; k += 1) {
      if (s.search(mDate[k]) !== -1) {
        povtorD = true;
        break fff;
      }
    }
  }
  if (!povtorD) k = 10;

  //  Обновление записи в истории изменений
  let textYouName = inCode(`${youName}`);
  if (youName !== '') textYouName += ', ';
  const Script_Name = inCode(scriptName);
  const date = mDate[k] ?? 'undefined';
  const reHist00s = new RegExp(`[^А-яЁёA-Za-z0-9]${Script_Name}[^А-яЁёA-Za-z0-9]`, '');
  const reHist01 = new RegExp(`(.[^…\\?!\\.,;:—])(${S}|${nbspEntity})(— ${textYouName}${date})`, '');
  const reHist02 = new RegExp(`(.[^…\\?!\\.,;:—])[,;:]{0,1}(${S}|${nbspEntity})(— ${textYouName}${date})`, '');
  const reHist03 = new RegExp(`(.)(${S}|${nbspEntity})(— ${textYouName}${date})`, '');
  const reHist04 = new RegExp(`(.)(${S}|${nbspEntity})(— ${textYouName}${date})`, '');
  if (povtorD) {
    if (s.search(reHist04) !== -1) {
      if (s.search(reHist00s) === -1) {
        if (s.search(/([Сс]крипт):/) !== -1) s = s.replace(/([Сс]крипт):/g, '$1ы:');
        if (s.search(reHist01) !== -1) s = s.replace(reHist01, '$1; $3');
        if (s.search(/[Сс]крипты?:/) === -1) s = s.replace(reHist02, '$1. $3').replace(reHist03, '$1 Скрипт: $3');
        s = s.replace(reHist04, `$1 ${Script_Name} $3`);
      }
      if (k !== 0) s = s.replace(mDate[k], mDate[0]);
      if (innerHTML(mP[j].node) !== s) {
        setInnerHTML(mP[j], s);
        result.HiCh = 3;
      }
    } else povtorD = false;
  }
  if (povtorD) return { ...result, versionFile, newVersion };

  //  Повышение версии
  let versionText = '';
  const ValidationVersion = versionFile.length <= 10 && versionFile.search(/^\d{0,10}(\.\d{1,8})?$/g) !== -1;
  if (ValidationVersion) {
    if (versionFile === '') versionFile = '1.0';
    if (versionFile.search(/^\d+$/g) !== -1) newVersion = `${versionFile}.1`;
    else {
      let next = +versionFile.replace(/^\d+\./g, '');
      next += 1;
      newVersion = `${versionFile.replace(/\.\d+$/g, '')}.${next}`;
    }
    if (newVersion.length <= 10) info.version = newVersion;
    result.VersionUp = true;
    versionText = `v.${newVersion} — `;
  }

  //   Добавление строк в историю изменений
  const reHist11 = new RegExp(`^(${S}|${nbspEntity}){0,}$`, '');
  const reHist12 = new RegExp(`(^|\\n)[^0-9]{0,12}${versionFile.replace(/\./, '\\.')}([^0-9]|$)`, '');
  const lastRecord = () => {
    const last = History.content.length - 1;
    const node = History.content[last];
    return { node, parent: History, index: last };
  };
  const lastIsEmpty = () => {
    const { node } = lastRecord();
    return (TEXT_BLOCK_TYPES.includes(node.type) || node.type === 'empty-line') && innerHTML(node).search(reHist11) !== -1;
  };
  //   Добавление строки с информацией о старой версии
  if (ValidationVersion && innerText(History).search(reHist12) === -1) {
    if (!lastIsEmpty()) History.content.push({ type: 'empty-line', attrs: {} });
    setInnerHTML(lastRecord(), `v.${versionFile} — ?`);
    result.HiCh += 1;
  }
  //   Добавление строки с информацией о новой версии
  if (!lastIsEmpty()) History.content.push({ type: 'empty-line', attrs: {} });
  setInnerHTML(lastRecord(), `${versionText} Скрипт: ${Script_Name} — ${textYouName}${mDate[0]}`);
  result.HiCh += 1;
  return { ...result, versionFile, newVersion };
}
