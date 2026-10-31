// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/529_Удалить форматирование в заголовках и подзаголовках.js
// Removes unwanted formatting inside titles and subtitles: bold, italics, subscript, superscript,
// strikethrough, code or a named style is removed from a title line or a subtitle when every
// letter of the line carries it (a line that is bold as a whole loses the bold; a bold word in a
// title stays). Titles of the notes and comments bodies are treated on their own: each kind of
// formatting that covers all their letters goes. The book's annotation and the document's
// history are part of the text, as in the original. A window gives the statistics.
// The settings below are the original's, with its values: each kind can be never removed (0),
// always removed (1, the default) or shown line by line with a question (2); the version of the
// file can be raised with a line in the history (off by default). The original's expressions run,
// as written, on the legacy inline-HTML notation of lib/legacy-html.js.
//
// Differences from the original (docs/scripting/notes-279-drafts/13.md):
// - fix: the code and style checks of the notes titles test the title itself; the original tested
//   a variable left over from the previous line, so a title in code kept it;
// - the random proverb the original appended to its results window is left out, pending the
//   requester's decision (277 sayings: those of the book «Пословицы и поговорки Великой
//   Отечественной войны» and six about Kursk and Sudzha, calls to kill "fascists" among them);
// - in the "show" mode (2) the line is selected in the Body view instead of being underlined, and
//   the original's "B mode" check (the Body view) has no counterpart: scripts edit the book itself;
// - the history line (setting Version_on_off, off by default) has no user name, by the requester's
//   decision (2026-10-31): youName is empty, the original's own way to a line without a name (its
//   «Зорро» was a placeholder; main.js's fbeUserName, which could override it, does not exist).
// The original's notice, kept as written (FR-029):
//======================================
//  «Удалить форматирование в заголовках и подзаголовках»
//  Скрипт тестировался в FBE v.2.7.8 (win XP, IE8 и win 7, IE11)
//======================================
//   Скрипт предназначен для удаления нежелательного форматирования внутри заголовков и подзаголовков
//======================================
//  * История изменений в конце скрипта
//======================================
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
         //  Удаление форматирования
//     Удаление жирности во всех обычных заголовках
//     Удаление курсива во всех обычных заголовках
//     Удаление нижнего индекса во всех обычных заголовках
import { parseInline, serializeInline } from './lib/legacy-html.js';

const ScriptName = '«Удаление форматирования в заголовках и подзаголовках»';
const NumerusVersion = '2.4';

//--------------------------------------------------------------------
//  НАСТРОЙКИ (settings)
//--------------------------------------------------------------------
//  "0" — никогда не удалять (never remove), "1" — всегда удалять (always remove),
//  "2" — всегда спрашивать и показывать (show the lines and ask)
const Obrabotka_Title_St = 1; //     Удаление жирности во всех обычных заголовках
const Obrabotka_Title_Em = 1; //     Удаление курсива во всех обычных заголовках
const Obrabotka_Title_Sub = 1; //     Удаление нижнего индекса во всех обычных заголовках
const Obrabotka_Title_Sup = 1; //     Удаление верхнего индекса во всех обычных заголовках
const Obrabotka_Title_Strike = 1; //     Удаление зачеркивания во всех обычных заголовках
const Obrabotka_Title_Code = 1; //     Удаление кода во всех обычных заголовках
const Obrabotka_Title_Style = 1; //     Удаление формата стиль во всех обычных заголовках
const Obrabotka_Subtitle_St = 1; //     Удаление жирности во всех подзаголовках
const Obrabotka_Subtitle_Em = 1; //     Удаление курсива во всех подзаголовках
const Obrabotka_Subtitle_Sub = 1; //     Удаление нижнего индекса во всех подзаголовках
const Obrabotka_Subtitle_Sup = 1; //     Удаление верхнего индекса во всех подзаголовках
const Obrabotka_Subtitle_Strike = 1; //     Удаление зачеркивания во всех подзаголовках
const Obrabotka_Subtitle_Code = 1; //     Удаление кода во всех подзаголовках
const Obrabotka_Subtitle_Style = 1; //     Удаление формата стиль во всех подзаголовках
//  Автоматическое повышение версии файла и запись в историю изменений ("0" — отключить, "1" — включить)
const Version_on_off = 0;
//  Добавлять, если не сделано ни одного исправления ("0" — отключить, "1" — включить)
const Vsegda_on_off = 0;
//   Имя используемое в добавленной записи (an empty name gives a line without a name; the
//   original's "Зорро" is left out by the requester's decision of 2026-10-31):
const youName = '';
//  Демонстрационный режим "Показать все строки" ("0" — отключить, "1" — включить)
const VseStroki_on_off = 0;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// The non-breaking space as the original's history line held it.
const nbspEntity = '&nbsp;';

//  Рег. выражения для поиска жирности, курсива, нижнего и верхнего индекса, зачеркивания
const reSt = new RegExp('^(.*)<STRONG>.*?</STRONG>', 'g');
const reSt_ = '$1';
const reEm = new RegExp('^(.*)<EM>.*?</EM>', 'g');
const reEm_ = '$1';
const reSub = new RegExp('^(.*)<SUB>.*?</SUB>', 'g');
const reSub_ = '$1';
const reSup = new RegExp('^(.*)<SUP>.*?</SUP>', 'g');
const reSup_ = '$1';
const reStrike = new RegExp('^(.*)<STRIKE>.*?</STRIKE>', 'g');
const reStrike_ = '$1';
const reEntity = new RegExp('^([^А-яA-Za-zЁёΑ-ω]|<[^>]+>)*$', 'g'); //  Допустимый текст, который может быть без выделения
//  Удаление жирности, курсива, нижнего и верхнего индекса, зачеркивания
const reSt_Del = new RegExp('</{0,1}STRONG>', 'g');
const reEm_Del = new RegExp('</{0,1}EM>', 'g');
const reSub_Del = new RegExp('</{0,1}SUB>', 'g');
const reSup_Del = new RegExp('</{0,1}SUP>', 'g');
const reStrike_Del = new RegExp('</{0,1}STRIKE>', 'g');
const reStyleTag = /<SPAN [^>]*class=(?!code>|image )/;

/** A line of a title or a subtitle, with its current legacy HTML. */
function line(node, inDescription) {
  return { node, inDescription, extras: [], html: null };
}

function htmlOf(item) {
  if (item.html === null) item.html = serializeInline(item.node.content ?? [], item.extras);
  return item.html;
}

/** The kinds of formatting, in the original's order, for titles (Title) and subtitles. */
const KINDS = [
  { key: 'St', tag: '<STRONG>', re: reSt, re_: reSt_, del: reSt_Del, title: Obrabotka_Title_St, subtitle: Obrabotka_Subtitle_St, ru: 'Жирность', en: 'Bold', dotsRu: '   .  .  .  .  .  .\t', what: { ru: 'жирность', en: 'the bold' } },
  { key: 'Em', tag: '<EM>', re: reEm, re_: reEm_, del: reEm_Del, title: Obrabotka_Title_Em, subtitle: Obrabotka_Subtitle_Em, ru: 'Курсив', en: 'Italics', dotsRu: '  .  .  .  .  .  .  .  .\t', what: { ru: 'курсив', en: 'the italics' } },
  { key: 'Sub', tag: '<SUB>', re: reSub, re_: reSub_, del: reSub_Del, title: Obrabotka_Title_Sub, subtitle: Obrabotka_Subtitle_Sub, ru: 'Нижний индекс', en: 'Subscript', dotsRu: ' .  .  .  .\t', what: { ru: 'нижний индекс', en: 'the subscript' } },
  { key: 'Sup', tag: '<SUP>', re: reSup, re_: reSup_, del: reSup_Del, title: Obrabotka_Title_Sup, subtitle: Obrabotka_Subtitle_Sup, ru: 'Верхний индекс', en: 'Superscript', dotsRu: '   .  .  .\t', what: { ru: 'верхний индекс', en: 'the superscript' } },
  { key: 'Strike', tag: '<STRIKE>', re: reStrike, re_: reStrike_, del: reStrike_Del, title: Obrabotka_Title_Strike, subtitle: Obrabotka_Subtitle_Strike, ru: 'Зачеркивание', en: 'Strikethrough', dotsRu: '   .  .  .  .\t', what: { ru: 'зачеркивание', en: 'the strikethrough' } },
  { key: 'Code', mark: 'code', title: Obrabotka_Title_Code, subtitle: Obrabotka_Subtitle_Code, ru: 'Код', en: 'Code', dotsRu: '   .  .  .  .  .  .  .  .  .\t', what: { ru: 'код', en: 'the code' } },
  { key: 'Style', mark: 'style', title: Obrabotka_Title_Style, subtitle: Obrabotka_Subtitle_Style, ru: 'Стиль', en: 'Style', dotsRu: '   .  .  .  .  .  .  .  .\t', what: { ru: 'стиль', en: 'the style' } },
];

/** "If no letter is left once the fragments of this formatting are taken out" (the HTML kinds). */
function allLettersIn(html, kind) {
  let s_ = html;
  while (s_.search(kind.re) !== -1) s_ = s_.replace(kind.re, kind.re_);
  return s_.search(reEntity) !== -1;
}

/** The same for code and style: the innerText of a copy without those elements has no letter. */
function allLettersInMark(html, extras, mark) {
  const content = parseInline(html, extras);
  const text = content
    .filter((c) => c.type === 'text' && !(c.marks ?? []).some((m) => m.type === mark))
    .map((c) => c.text)
    .join('');
  return text.search(reEntity) !== -1;
}

function hasKind(html, kind) {
  return kind.mark === 'code' ? html.search('<SPAN class=code>') !== -1 : kind.mark === 'style' ? html.search(reStyleTag) !== -1 : html.search(kind.tag) !== -1;
}

function qualifies(item, kind) {
  const html = htmlOf(item);
  if (!hasKind(html, kind)) return false;
  return kind.mark ? allLettersInMark(html, item.extras, kind.mark) : allLettersIn(html, kind);
}

/** Removes a kind of formatting from a line (the tags, or every code / style element). */
function removeKind(item, kind) {
  const html = htmlOf(item);
  if (!kind.mark) {
    item.html = html.replace(kind.del, '');
    return;
  }
  const content = parseInline(html, item.extras).map((c) => {
    if (!c.marks) return c;
    const marks = c.marks.filter((m) => m.type !== kind.mark);
    const copy = { ...c };
    if (marks.length) copy.marks = marks;
    else delete copy.marks;
    return copy;
  });
  item.html = serializeInline(content, item.extras);
}

/** The lines of the text: every title line (Vopros_1 / Vopros_3) and every subtitle (Vopros_2). */
function collectLines(doc) {
  const titles = [];
  const notesTitles = [];
  const subtitles = [];
  const visit = (node, notes, inDescription) => {
    for (const child of node?.content ?? []) {
      if (child.type === 'text') continue;
      if (node.type === 'title' && (child.type === 'p' || child.type === 'empty-line')) (notes ? notesTitles : titles).push(line(child, inDescription));
      else if (child.type === 'subtitle') subtitles.push(line(child, inDescription));
      else visit(child, notes, inDescription);
    }
  };
  visit(doc.description?.titleInfo?.annotation, false, true);
  visit(doc.description?.documentInfo?.history, false, true);
  for (const body of doc.bodies ?? []) visit(body, body.attrs?.name === 'notes' || body.attrs?.name === 'comments', false);
  return { titles, notesTitles, subtitles };
}

/** The original's time string (мс => мин., с). */
function time(T, ru) {
  const Tmin = Math.floor(T / 60000);
  const TsecD = (T % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  if (Tmin === 0) return `${`${+`${TsecD}`.replace(/(.{1,5}).*/g, '$1')}`.replace('.', ',')} ${ru ? 'сек' : 's'}`;
  return `${Tmin} ${ru ? 'мин' : 'min'}${Tsec !== 0 ? ` ${Tsec} ${ru ? 'с' : 's'}` : ''}`;
}

/** The original's "show" mode: the lines one by one, Да / Нет to move, Отмена to leave. */
async function specto(ctx, msgTtl, items) {
  const count = items.length;
  let k = 0;
  for (;;) {
    let msgWnd;
    if (count === 1) msgWnd = t(ctx, ' • Отмена —  \tВыход из режима просмотра', ' • Cancel —  \tleave the view');
    else if (count === 2) {
      msgWnd = k === 0
        ? t(ctx, ' • Да/Нет —\tПоследняя строка\n • Отмена —\tВыход из режима просмотра', ' • Yes/No —\tthe last line\n • Cancel —\tleave the view')
        : t(ctx, ' • Да/Нет —\tПервая строка\n • Отмена —\tВыход из режима просмотра', ' • Yes/No —\tthe first line\n • Cancel —\tleave the view');
    } else if (k === 0) msgWnd = t(ctx, ' • Да —\tСледующая строка\n • Нет —\tПерейти на последнюю строку', ' • Yes —\tthe next line\n • No —\tgo to the last line');
    else if (k === count - 1) msgWnd = t(ctx, ' • Да —\tВернуться к первой строке\n • Нет —\tПредыдущая строка', ' • Yes —\tback to the first line\n • No —\tthe previous line');
    else msgWnd = t(ctx, ' • Да —\tСледующая строка\n • Нет —\tПредыдущая строка', ' • Yes —\tthe next line\n • No —\tthe previous line');
    if (!items[k].inDescription) {
      try {
        await mfbe.selection.selectNode(items[k].node.attrs.nodeId);
      } catch {
        // a line the Body view cannot select
      }
    }
    const otvet = await mfbe.ui.message(msgWnd, {
      caption: `• ${k + 1} / ${count} ${msgTtl}`,
      buttons: [
        { id: 'yes', label: t(ctx, 'Да', 'Yes'), default: true },
        { id: 'no', label: t(ctx, 'Нет', 'No') },
        { id: 'cancel', label: t(ctx, 'Отмена', 'Cancel'), cancel: true },
      ],
    });
    if (otvet === 'yes') k = k < count - 1 ? k + 1 : 0;
    else if (otvet === 'no') k = k > 0 ? k - 1 : count - 1;
    else break;
  }
}

async function askYesNo(ctx, text) {
  return (await MsgBox(text, ctx.script.name, 4)) === 6;
}

/** The original's HistoryChange: a line in the history and a higher version of the file. */
function historyChange(description, Script_Name_) {
  const info = description.documentInfo;
  const result = { HiCh: 0, VersionUp: false, versionFile: info.version ?? '', newVersion: info.version ?? '' };
  if (!info.history) info.history = { type: 'annotation', attrs: {}, content: [{ type: 'empty-line', attrs: {} }] };
  const history = info.history;
  const lines = history.content;
  const extras = [];
  const innerHTML = (p) => (p.type === 'empty-line' ? '' : serializeInline(p.content ?? [], extras));
  const setInnerHTML = (index, html) => {
    lines[index] = { type: 'p', attrs: { ...(lines[index]?.attrs ?? {}) }, content: parseInline(html, extras) };
    delete lines[index].attrs.nodeId;
  };
  //  Создание массива с прошедшими датами
  const mDate = [];
  let D = Date.now();
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
  let s = '';
  let j = lines.length - 1;
  let k = 0;
  search: for (; j >= 0; j -= 1) {
    if (!['p', 'subtitle', 'empty-line'].includes(lines[j].type)) continue;
    s = innerHTML(lines[j]);
    for (k = 0; k < 10; k += 1) {
      if (s.search(mDate[k]) !== -1) {
        povtorD = true;
        break search;
      }
    }
  }
  const inCode = (text) => text.replace(/&/g, '&amp;').replace(/ /g, nbspEntity).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/­/g, '&shy;');
  let textYouName = inCode(`${youName}`);
  if (youName !== '') textYouName += ', ';
  const Script_Name = inCode(Script_Name_);
  const reHist00s = new RegExp(`[^А-яЁёA-Za-z0-9]${Script_Name}[^А-яЁёA-Za-z0-9]`, '');
  const reHist01 = new RegExp(`(.[^…\\?!\\.,;:—])(\\s|${nbspEntity})(— ${textYouName}${mDate[k]})`, '');
  const reHist02 = new RegExp(`(.[^…\\?!\\.,;:—])[,;:]{0,1}(\\s|${nbspEntity})(— ${textYouName}${mDate[k]})`, '');
  const reHist03 = new RegExp(`(.)(\\s|${nbspEntity})(— ${textYouName}${mDate[k]})`, '');
  const reHist04 = new RegExp(`(.)(\\s|${nbspEntity})(— ${textYouName}${mDate[k]})`, '');
  if (povtorD) {
    if (s.search(reHist04) !== -1) {
      const before = s;
      if (s.search(reHist00s) === -1) {
        if (s.search(/([Сс]крипт):/) !== -1) s = s.replace(/([Сс]крипт):/g, '$1ы:');
        if (s.search(reHist01) !== -1) s = s.replace(reHist01, '$1; $3');
        if (s.search(/[Сс]крипты?:/) === -1) s = s.replace(reHist02, '$1. $3').replace(reHist03, '$1 Скрипт: $3');
        s = s.replace(reHist04, `$1 ${Script_Name} $3`);
      }
      if (k !== 0) s = s.replace(mDate[k], mDate[0]);
      if (before !== s) {
        setInnerHTML(j, s);
        result.HiCh = 3;
      }
    } else povtorD = false;
  }
  if (povtorD) return result;
  //  Повышение версии
  let versionText = '';
  let versionFile = result.versionFile;
  const ValidationVersion = versionFile.length <= 10 && versionFile.search(/^\d{0,10}(\.\d{1,8})?$/g) !== -1;
  if (ValidationVersion) {
    if (versionFile === '') versionFile = '1.0';
    let newVersion;
    if (versionFile.search(/^\d+$/g) !== -1) newVersion = `${versionFile}.1`;
    else newVersion = `${versionFile.replace(/\.\d+$/g, '')}.${+versionFile.replace(/^\d+\./g, '') + 1}`;
    if (newVersion.length <= 10) info.version = newVersion;
    result.newVersion = newVersion;
    result.VersionUp = true;
    versionText = `v.${newVersion} — `;
  }
  result.versionFile = versionFile;
  //   Добавление строк в историю изменений
  const reHist11 = new RegExp(`^(\\s|${nbspEntity}){0,}$`, '');
  const reHist12 = new RegExp(`(^|\\n)[^0-9]{0,12}${versionFile.replace(/\./, '\\.')}([^0-9]|$)`, '');
  const innerText = lines.map((p) => (p.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('')).join('\r\n');
  const lastIsEmpty = () => lines.length > 0 && innerHTML(lines[lines.length - 1]).search(reHist11) !== -1;
  if (ValidationVersion && innerText.search(reHist12) === -1) {
    if (!lastIsEmpty()) lines.push({ type: 'empty-line', attrs: {} });
    setInnerHTML(lines.length - 1, `v.${versionFile} — ?`);
    result.HiCh += 1;
  }
  if (!lastIsEmpty()) lines.push({ type: 'empty-line', attrs: {} });
  setInnerHTML(lines.length - 1, `${versionText} Скрипт: ${Script_Name} — ${textYouName}${mDate[0]}`);
  result.HiCh += 1;
  return result;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const Ts = Date.now();
  let T_pause = 0;
  const doc = await mfbe.doc.get();
  const { titles, notesTitles, subtitles } = collectLines(doc);
  const d = VseStroki_on_off === 1 ? 'показать нули' : 0;

  //  ПОДСЧЕТ И СОХРАНЕНИЕ ПАРАГРАФОВ (Vopros_1, Vopros_2, Vopros_3)
  const found = { title: {}, subtitle: {} };
  for (const kind of KINDS) {
    found.title[kind.key] = kind.title !== 0 ? titles.filter((item) => qualifies(item, kind)) : [];
    found.subtitle[kind.key] = kind.subtitle !== 0 ? subtitles.filter((item) => qualifies(item, kind)) : [];
  }
  const m_21 = notesTitles.filter((item) => {
    const s = htmlOf(item);
    return s.search(/<(STRONG|EM|SUB|SUP|STRIKE|SPAN class=code)>/) !== -1 || s.search(reStyleTag) !== -1;
  });

  //  Начальная статистика (only when some kind is in the "show" mode and has lines)
  const showing = KINDS.some((k) => (k.title === 2 && found.title[k.key].length) || (k.subtitle === 2 && found.subtitle[k.key].length));
  if (showing) {
    const mSt = [t(ctx, '  Статистика выделенных строк', '  Formatted lines'), '------------------------------------------------------'];
    const block = (head, part, setting) => {
      const lines = ['', head];
      for (const kind of KINDS) {
        const n = found[part][kind.key].length;
        if (n !== d) lines.push(`      ${ru ? kind.ru : kind.en}${ru ? kind.dotsRu : '\t'}${n}${kind[setting] === 2 ? '*' : ''}`);
      }
      if (lines.length > 2) mSt.push(...lines);
    };
    block(t(ctx, '• В заголовках', '• In titles'), 'title', 'title');
    block(t(ctx, '• В подзаголовках', '• In subtitles'), 'subtitle', 'subtitle');
    if (m_21.length !== d) mSt.push('', t(ctx, '• В заголовках  примечаний', '• In note titles'), `${t(ctx, '      Внутренние теги .  .  .\t', '      Inner tags\t')}${m_21.length}`);
    mSt.push('', t(ctx, '* контролируемая обработка', '* processing under control'), '\t\t\t\t\t', '', t(ctx, '\t◊  Продолжить? ', '\t◊  Continue? '));
    const paused = Date.now();
    const otvet = await askYesNo(ctx, mSt.join('\n'));
    T_pause += Date.now() - paused;
    if (!otvet) return;
  }

  //  ПРОСМОТР И ИЗМЕНЕНИЕ ПАРАГРАФОВ
  const removed = { title: {}, subtitle: {} };
  for (const part of ['title', 'subtitle']) {
    for (const kind of KINDS) {
      const items = found[part][kind.key];
      removed[part][kind.key] = 0;
      if (items.length === 0) continue;
      const setting = kind[part];
      let otvet = false;
      if (setting === 2) {
        const where = part === 'title' ? t(ctx, 'в заголовках', 'in titles') : t(ctx, 'в подзаголовках', 'in subtitles');
        const paused = Date.now();
        await specto(ctx, `• ${ru ? kind.ru : kind.en} ${where} • ${t(ctx, 'Просмотр', 'View')} •`, items);
        otvet = await askYesNo(ctx, t(ctx, `◊  Удалить ${kind.what.ru} во всех ${part === 'title' ? 'заголовках' : 'подзаголовках'}?                   `, `◊  Remove ${kind.what.en} in all ${part === 'title' ? 'titles' : 'subtitles'}?                   `));
        T_pause += Date.now() - paused;
      }
      if (otvet || setting === 1) {
        for (const item of items) removeKind(item, kind);
        removed[part][kind.key] = items.length;
      }
    }
  }

  //  Заголовки примечаний и комментариев
  let count_121 = 0;
  for (const item of m_21) {
    const s__ = htmlOf(item);
    // Fix: the original tested `s`, a variable left over from the previous line, here.
    if (s__.search('<SPAN class=code>') !== -1 && allLettersInMark(s__, item.extras, 'code')) removeKind(item, KINDS[5]);
    if (htmlOf(item).search(reStyleTag) !== -1 && allLettersInMark(htmlOf(item), item.extras, 'style')) removeKind(item, KINDS[6]);
    let s = htmlOf(item);
    for (const kind of KINDS.slice(0, 5)) {
      if (s.search(kind.tag) !== -1 && allLettersIn(s, kind)) s = s.replace(kind.del, '');
    }
    item.html = s;
    if (s__ !== s) count_121 += 1;
  }

  //  Writing the changed lines back
  const count_all = KINDS.reduce((n, k) => n + removed.title[k.key] + removed.subtitle[k.key], 0) + count_121;
  let descriptionChanged = false;
  const all = [...titles, ...subtitles, ...notesTitles];
  for (let i = 0; i < all.length; i += 1) {
    const item = all[i];
    if (item.html === null) continue;
    const content = parseInline(item.html, item.extras);
    if (serializeInline(content, []) === serializeInline(item.node.content ?? [], [])) continue;
    if (item.inDescription) {
      item.node.content = content;
      descriptionChanged = true;
    } else {
      await mfbe.doc.replaceNode(item.node.attrs.nodeId, { type: item.node.type, attrs: { ...item.node.attrs }, content });
    }
    if (ctx.cancelled) return;
  }

  //  ПОВЫШЕНИЕ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В ИСТОРИЮ ИЗМЕНЕНИЙ
  let history = { HiCh: 0, VersionUp: false };
  if (Version_on_off === 1 && (count_all || Vsegda_on_off === 1)) {
    history = historyChange(doc.description, `${ScriptName} ${NumerusVersion}`);
    descriptionChanged = true;
  }
  if (descriptionChanged) await mfbe.doc.setDescription(doc.description);

  //  ОКНО РЕЗУЛЬТАТОВ
  const Tf = Date.now();
  const now = new Date();
  const two = (n) => (n < 10 ? `0${n}` : `${n}`);
  const currentTime = `${now.getHours()}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const currentDate = `${now.getDate()}.${two(now.getMonth() + 1)}.${`${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1')}`;
  const mSt = [];
  mSt.push(t(ctx, ' «Удалить форматирование', ' "Remove formatting'));
  mSt.push(t(ctx, `           в заголовках и подзаголовках» v.${NumerusVersion}`, `           in titles and subtitles" v.${NumerusVersion}`));
  mSt.push('---------------------------------------------------------');
  if (d) mSt.push(t(ctx, ' Демонстрационный режим', ' Demonstration mode'));
  mSt.push('\t\t\t\t\t     ');
  mSt.push(`${t(ctx, 'Вычисления  .  .  .  .  .  .  .  .  .  .  .  .\t', 'Computing\t')}${time(Tf - Ts - T_pause, ru)}`);
  if (T_pause !== d) mSt.push(`${t(ctx, 'Диалоговые паузы .  .  .  .  .  .  .  .  .\t', 'Dialog pauses\t')}${time(T_pause, ru)}`);
  if (titles.length !== d) {
    if (notesTitles.length === 0 || d) mSt.push(`${t(ctx, 'Строк заголовков  .  .  .  .  .  .  .  .  .\t', 'Title lines\t')}${titles.length}`);
    if (notesTitles.length !== d) mSt.push(`${t(ctx, 'Строк обычных заголовков  .  .  .  .\t', 'Lines of ordinary titles\t')}${titles.length}`);
  }
  if (notesTitles.length !== d) mSt.push(`${t(ctx, 'Строк заголовков примечаний\t', 'Lines of note titles\t')}${notesTitles.length}`);
  if (subtitles.length !== d) mSt.push(`${t(ctx, 'Строк подзаголовков  .  .  .  .  .  .  .\t', 'Subtitle lines\t')}${subtitles.length}`);
  if (count_all === 0 || d) mSt.push('', t(ctx, '>> Исправлений нет', '>> Nothing to correct'));
  const section = (head, counts) => {
    const lines = ['', head];
    for (const [label, n] of counts) if (n !== d) lines.push(`      ${label}${n}`);
    if (lines.length > 2) mSt.push(...lines);
  };
  section(t(ctx, '• Удаления в заголовках', '• Removed in titles'), KINDS.map((k) => [`${ru ? k.ru : k.en}${ru ? k.dotsRu : '\t'}`, removed.title[k.key]]));
  section(t(ctx, '• Удаления в подзаголовках', '• Removed in subtitles'), KINDS.map((k) => [`${ru ? k.ru : k.en}${ru ? k.dotsRu : '\t'}`, removed.subtitle[k.key]]));
  section(t(ctx, '• Удаления в заголовках примечаний', '• Removed in note titles'), [[t(ctx, 'Внутренние теги .  .  .\t', 'Inner tags\t'), count_121]]);
  if (history.VersionUp || history.HiCh || d) mSt.push('');
  if (history.VersionUp || d) mSt.push(`${t(ctx, '• Версия файла:  ', '• Version of the file:  ')}${history.versionFile}  ›››  ${history.newVersion}`);
  if (history.HiCh === 1 || d) mSt.push(t(ctx, '• Добавлена новая строка в историю', '• A new line added to the history'));
  if (history.HiCh === 2 || d) mSt.push(t(ctx, '• Добавлены две строки в историю', '• Two lines added to the history'));
  if (history.HiCh === 3 || d) mSt.push(t(ctx, '• Изменены данные в строке истории', '• A line of the history updated'));
  mSt.push('');
  mSt.push(`• ${currentDate} • ${currentTime} •`);
  await MsgBox(`${mSt.join('\n')}\n`);
}

//                 ///  ИСТОРИЯ ИЗМЕНЕНИЙ (the original's change history, kept as written)
// v.1.0 — Создание скрипта — Александр Ка (21.03.2024)
// v.2.0 — Глобальная редакция — Александр Ка (30.01.2025)
// Изменено имя скрипта (было «Удаление жирности/курсива в заголовках и подзаголовках»)
// Добавлено удаление формата верхнего и нижнего индекса
// Исправлены все ошибки связанные с неправильным отображением текста в окнах для win7
// И т.д., и т.п.
// v.2.1 — Добавлена функция повышения версии файла и запись в историю изменений — Александр Ка (25.04.2025)
// v.2.2 — Изменение функции "повышения версии файла и запись в историю изменений" — Александр Ка (19.05.2025)
// v.2.3 — Александр Ка (19.07.2025)
// Добавлена начальная статистика
// Изменен способ поиска строк с выделением (теперь скрипт обрабатывает только строки, в которых выделены все буквы)
// Улучшена функция перехода к найденной строке
// Изменено выделение найденной строки
// v.2.4 — Александр Ка (22.07.2025)
// Добавлено удаление форматов зачеркивания, кода, стиля
// Изменено оформление окон статистики
// Добавлены пословицы
