// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/35_Разночтения Ё-Е.js
// Words that read differently with Е and with Ё (все/всё, небо/нёбо, мел/мёл ... 179 pairs of the
// original's list, words.js): the script finds them in the whole book - the book's annotation and
// the document's history included, as FictionBook Editor showed them above the bodies - shows
// their statistics, then offers each one in turn, selected in the text, for the other reading
// (Yes replaces, No keeps, Cancel skips the rest of that word's group). Then it lists the other
// words written with Ё and offers to write them with Е (all at once, or group by group). At the
// end it raises the version of the file and writes a line into the history (the original's
// setting Version_on_off = 1; the line names no user), and shows its results, page by page.
// The settings below are the original's, with its values, the user name excepted.
// Differences from the original (docs/scripting/notes-279-drafts/18.md):
// - the input box of each question, where a minus typed before Yes undid the last answer and any
//   other text stopped the work, is a message with buttons: Yes, No, Cancel, Step back (one
//   answer per press) and Stop (with the original's "stop?" question); the help window ("Окно
//   Управление") describes these buttons; the word is selected instead of being framed and
//   coloured, and the script does not scroll it to a set height of the window (Raspolozhenie);
// - the result message shows no proverb: left out pending the requester's decision;
// - the original's "B mode" check has no counterpart: scripts work on the book itself;
// - the history line carries no user name, by the requester's decision (2026-10-31): the
//   original's youName was «Зорро», a placeholder for the user's own name, and an empty name -
//   what the setting holds here - is the original's own way to a line without one,
//   "v.1.1 —  Скрипт: «Разночтения Ё/Е» 2.2 — 31.10.2026".
// The original's notice, kept as written (FR-029):
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//             «Разночтения Ё/Е»
//  Скрипт предназначен для расстановки букв "ё"/"е" в словах, где возможно разночтение
// Скрипт тестировался в FBE v.2.7.8 (win XP, IE8 и win 7, IE11)
//  * История изменений в конце скрипта
//~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
import { serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';
import { historyChange } from './history.js';
import { W } from './words.js';

const ScriptName = '«Разночтения Ё/Е»';
const NumerusVersion = '2.2';

//--------------------------------------------------------------------
//  НАСТРОЙКИ (settings)
//--------------------------------------------------------------------
//   •  Режим работы ("0" — править всё, "1" — только Ёфикация, "2" — только деЁфикация)
const Rezhim = 0;
//   •  Показывать окно "Управление" ("0" — отключить, "1" — показывать)
const Upravlenie = 1;
//   •  Максимум строк в окне результатов (примерно 30-52)
//  * Скрипт постарается не превышать это значение, и при необходимости добавит необходимое
//    количество страниц.
const Vysota_teksta = 50;
//   •  Автоматическое повышение версии файла и запись в историю изменений ("0" — отключить,
//      "1" — включить)
const Version_on_off = 1;
//  Добавлять, если не сделано ни одного исправления ("0" — отключить, "1" — включить)
const Vsegda_on_off = 0;
//   Имя используемое в добавленной записи (an empty name gives a line without a name; the
//   original's "Зорро" is left out by the requester's decision of 2026-10-31):
const youName = '';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// JScript's \s: the ASCII white space only.
const S = '[\\t\\n\\v\\f\\r ]';
const nbspEntity = '&nbsp;';

/* ------------------------------------------------------------------------------------------ */
/* The text as FictionBook Editor showed it                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * Every paragraph in the order of FictionBook Editor's page: the book's annotation, the history,
 * then the bodies. A record holds the node (of the snapshot, changed in place) and where it is.
 */
function collectParagraphs(snapshot) {
  const out = [];
  const visit = (node, place) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      out.push({ node, place });
      return;
    }
    for (const child of node.content ?? []) visit(child, place);
  };
  visit(snapshot.description?.titleInfo?.annotation, 'description');
  visit(snapshot.description?.documentInfo?.history, 'description');
  for (const body of snapshot.bodies ?? []) visit(body, 'body');
  return out;
}

/** The paragraph's innerText: its text without the pictures. */
function innerText(par) {
  return (par.node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
}

/** The text offset (pictures and other inline objects count as one) of an index of the HTML. */
function textOffsetAt(html, index) {
  let offset = 0;
  let i = 0;
  while (i < index) {
    const ch = html[i];
    if (ch === '<') {
      const end = html.indexOf('>', i);
      if (/^<(IMG|X)\b/i.test(html.slice(i, i + 5))) offset += 1;
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    if (ch === '&') {
      const m = /^&(#x[0-9a-f]+|#\d+|[a-z]+);/i.exec(html.slice(i, i + 12));
      if (m) {
        offset += 1;
        i += m[0].length;
        continue;
      }
    }
    offset += 1;
    i += 1;
  }
  return offset;
}

/** The matches of a global expression in the paragraph's HTML, as places of its text. */
function findWords(par, re) {
  const html = serializeInline(par.node.content ?? [], []);
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(html))) {
    const from = textOffsetAt(html, m.index + m[1].length);
    out.push({ par, from, to: from + m[2].length });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

/** The current text of a place. */
function wordAt(place) {
  let text = '';
  for (const item of place.par.node.content ?? []) text += item.type === 'text' ? item.text : '￼';
  return text.slice(place.from, place.to);
}

/** Writes a word of the same length over a place, keeping the formatting, in the book. */
async function setWord(state, place, word) {
  const { par } = place;
  let offset = 0;
  const content = [];
  for (const item of par.node.content ?? []) {
    const length = item.type === 'text' ? item.text.length : 1;
    if (item.type === 'text' && place.from < offset + length && place.to > offset) {
      const a = Math.max(place.from, offset);
      const b = Math.min(place.to, offset + length);
      const piece = word.slice(a - place.from, b - place.from);
      content.push({ ...item, text: item.text.slice(0, a - offset) + piece + item.text.slice(b - offset) });
    } else content.push(item);
    offset += length;
  }
  par.node.content = content;
  if (par.place === 'body') {
    await mfbe.doc.replaceNode(
      { nodeId: par.node.attrs.nodeId, type: par.node.type },
      { type: par.node.type, attrs: { ...par.node.attrs }, content },
    );
  } else {
    // The annotation and the history are parts of the description, written as a whole.
    await mfbe.doc.setDescription(state.snapshot.description);
  }
}

/** Selects a place in the Body view (the original framed and coloured the word). */
async function selectPlace(place) {
  const nodeId = place.par.node.attrs?.nodeId;
  if (!nodeId) return;
  await mfbe.selection.set({ nodeId, offset: place.from }, { nodeId, offset: place.to });
  await mfbe.selection.scrollIntoView();
}

/* ------------------------------------------------------------------------------------------ */
/* The original's helpers                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** ФУНКЦИЯ СКЛОНЕНИЯ ПО ПАДЕЖАМ В ЗАВИСИМОСТИ ОТ ЧИСЛА */
function pad(Numer) {
  let ok = 2;
  const m1 = Numer % 10;
  const m2 = Numer % 100;
  if (m2 < 11 || m2 > 19) {
    if (m1 === 1) ok = 0;
    else if (m1 === 2 || m1 === 3 || m1 === 4) ok = 1;
  }
  return ok;
}

/** ФУНКЦИЯ КОНВЕРТАЦИИ ВРЕМЕНИ (мс => мин., с) */
function time(ctx, T) {
  const Tmin = Math.floor(T / 60000);
  const TsecD = (T % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  if (Tmin === 0) {
    const seconds = `${+`${TsecD}`.replace(/(.{1,5}).*/g, '$1')}`;
    return t(ctx, `${seconds.replace('.', ',')} сек`, `${seconds} s`);
  }
  let tempus = `${Tmin}${t(ctx, ' мин', ' min')}`;
  if (Tsec !== 0) tempus += ` ${Tsec}${t(ctx, ' с', ' s')}`;
  return tempus;
}

/** The original's percentage: four significant characters, a comma in Russian. */
function percent(ctx, value) {
  const text = `${+`${value * 100}`.replace(/(^[0.]*....).+/, '$1').replace(/(^0\.0*\d\d).+/, '$1')}`;
  return `${ctx.uiLanguage === 'ru' ? text.replace(/(\.)/, ',') : text}%`;
}

const SLOV = { ru: ['слово', 'слова', 'слов'], en: ['word', 'words', 'words'] };
const GRUPPAH = { ru: ['группе', 'группах', 'группах'], en: ['group', 'groups', 'groups'] };

function words(ctx, n) {
  return (ctx.uiLanguage === 'ru' ? SLOV.ru : SLOV.en)[ctx.uiLanguage === 'ru' ? pad(n) : n === 1 ? 0 : 2];
}

function groups(ctx, n) {
  return (ctx.uiLanguage === 'ru' ? GRUPPAH.ru : GRUPPAH.en)[ctx.uiLanguage === 'ru' ? pad(n) : n === 1 ? 0 : 2];
}

/** Dialogs, with the original's account of the time they were open (T_pause). */
async function dialog(state, open) {
  const started = Date.now();
  try {
    return await open();
  } finally {
    state.T_pause += Date.now() - started;
  }
}

async function msgBox(state, ctx, text) {
  await dialog(state, () => mfbe.ui.message(text, { caption: ctx.script.name, icon: 'info' }));
}

async function askYesNo(state, ctx, text) {
  return dialog(state, async () => (await MsgBox(text, ctx.script.name, 4 + 32)) === 6);
}

/** The question about one word: the original's input box as a message with its choices. */
async function askButtons(state, ctx, caption, text, buttons) {
  return dialog(state, () => mfbe.ui.message(text, { caption, buttons, icon: 'question' }));
}

/** ФУНКЦИЯ СОЗДАНИЕ И ОТОБРАЖЕНИЯ СТРАНИЦ: the lines in pages of at most Vysota_teksta lines. */
async function pageF(state, ctx, lines) {
  const mSt = [...lines];
  let ind = mSt.length;
  const height = Math.max(Vysota_teksta, 30);
  let Kolo = height - 2;
  let page;
  if (height >= ind) {
    page = 1;
    Kolo = ind;
  } else {
    page = Math.ceil(ind / Kolo);
    Kolo = Math.ceil(ind / page);
  }
  while (ind <= Kolo * page) {
    mSt[ind] = '';
    ind += 1;
  }
  const mPage = [];
  for (let n = 0; n < page; n += 1) {
    mPage[n] = '';
    for (let k = 0; k < Kolo; k += 1) mPage[n] += `${mSt[k + n * Kolo]}\n`;
    if (page !== 1) {
      mPage[n] += '                                                                                         \n';
      if (n !== page - 1) {
        mPage[n] += t(ctx, `◊  Стр. ${n + 1}  ◊  Показать  следующую  страницу?`, `◊  Page ${n + 1}  ◊  Show the next page?`);
      } else {
        mPage[n] += t(ctx, `◊  Стр. ${n + 1} (последняя)  ◊  Закрыть окно?`, `◊  Page ${n + 1} (the last)  ◊  Close the window?`);
      }
    }
  }
  let otvet1 = true;
  let n = 0;
  while (otvet1) {
    if (page === 1) {
      await msgBox(state, ctx, mPage[0]);
      break;
    }
    otvet1 = await askYesNo(state, ctx, mPage[n]);
    n += 1;
    if (n === page) {
      n = 0;
      otvet1 = !otvet1;
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The run                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export default async function run(ctx) {
  const Ts = Date.now();
  const state = { T_pause: 0, snapshot: await mfbe.doc.get() };

  /// РАСШИРЕНИЕ СПИСКА ЗАМЕН: the sorted list of both readings of every pair (M), checked first.
  const M = [];
  let mSort = [' ', '№'];
  for (let k = 0; k < W.length; k += 1) {
    if (`${W[k][0]}  ${W[k][2]}`.search(/^(.*)[ЕЁеё](.*)  \1[ЕЁеё]\2$/) === -1) {
      const stop = await askYesNo(
        state,
        ctx,
        t(
          ctx,
          `Обнаружено недопустимое различие в паре #${k + 1}:       \n•  ${W[k][0]}  ›››  ${W[k][2]}       \n(слова должны отличаться в букве «е»/«ё»)       \n\n◊  Остановить скрипт?       `,
          `A pair differs in a way that is not allowed, pair #${k + 1}:       \n•  ${W[k][0]}  ›››  ${W[k][2]}       \n(the words must differ in the letter «е»/«ё» only)       \n\n◊  Stop the script?       `,
        ),
      );
      if (stop) return;
      continue;
    }
    if (W[k][0] === W[k][2]) {
      const stop = await askYesNo(
        state,
        ctx,
        t(
          ctx,
          `Обнаружены одинаковые слова в паре #${k + 1}:       \n•  ${W[k][0]}  ›››  ${W[k][2]}       \n\n◊  Остановить скрипт?       `,
          `A pair holds the same word twice, pair #${k + 1}:       \n•  ${W[k][0]}  ›››  ${W[k][2]}       \n\n◊  Stop the script?       `,
        ),
      );
      if (stop) return;
      continue;
    }
    for (let j = 0; j < 3; j += 2) {
      const sort = W[k][j].toUpperCase().replace(/Ё(.*)/, 'Е$1 ');
      let k1 = 0;
      let k2 = mSort.length - 1;
      while (k2 - k1 !== 1) {
        const kMidi = Math.floor((k2 + k1) / 2);
        if (sort >= mSort[kMidi]) k1 = kMidi;
        else k2 = kMidi;
      }
      mSort.splice(k2, 0, sort);
      const n = k2 - 1;
      const entry = [];
      if (j === 0) entry.push(W[k][0], W[k][1], W[k][2], W[k][3]);
      else entry.push(W[k][2], W[k][3], W[k][0], W[k][1]);
      entry[4] = entry[0].replace(/^(.).+/, '$1').toUpperCase() + entry[0].replace(/^.(.+)/, '$1');
      entry[5] = entry[2].replace(/^(.).+/, '$1').toUpperCase() + entry[2].replace(/^.(.+)/, '$1');
      entry[6] = entry[0].toUpperCase();
      entry[7] = entry[2].toUpperCase();
      entry[8] = 0; // Счетчик замен
      entry[10] = j === 0; // Замена  е ››› ё
      entry[11] = 0; // Счетчик найденных слов
      entry[12] = []; // Найденные слова
      M.splice(n, 0, entry);
    }
  }
  const LengthM = M.length;

  //  Создание рег-выражения для поиска всех слов с разночтением.
  let allM = '(^|[^А-яA-Za-zЁё0-9])(';
  for (let k = 1; k < LengthM; k += 2) {
    const f1 = `${M[k][0]}  ${M[k][2]}`.replace(/^(.*)(.)(.*)  \1(.)\3$/g, '$1[$2$4]$3');
    if (f1.replace(/^(.).+/, '$1') !== '[') {
      allM += `[${f1.replace(/^(.).+/, '$1').toUpperCase()}${f1.replace(/^(.).+/, '$1')}]${f1.replace(/^.(.+)/, '$1')}|${f1.toUpperCase()}|`;
    }
    if (f1.replace(/^(.).+/, '$1') === '[') {
      allM += `[${f1.replace(/^.(..).+/, '$1').toUpperCase()}${f1.replace(/^.(..).+/, '$1')}]${f1.replace(/^....(.+)/, '$1')}|${f1.toUpperCase()}|`;
    }
  }
  allM = allM.replace(/\|$/, ')(?=[^А-яA-Za-zЁё0-9]|$)');
  const reAllM = new RegExp(allM, 'g');

  //  Массив списка для поиска
  const MM = [' ', '№'];
  mSort = [' ', '№'];
  for (let k = 0; k < LengthM; k += 1) {
    const sort = M[k][6];
    let k1 = 0;
    let k2 = mSort.length - 1;
    while (k2 - k1 !== 1) {
      const kMidi = Math.floor((k2 + k1) / 2);
      if (sort >= mSort[kMidi]) k1 = kMidi;
      else k2 = kMidi;
    }
    mSort.splice(k2, 0, sort);
    MM.splice(k2, 0, [M[k][6], k]);
  }

  /// ПОИСК СЛОВ С РАЗНОЧТЕНИЕМ
  const paragraphs = collectParagraphs(state.snapshot);
  const reW_body = new RegExp(`(^|${S}|${nbspEntity}).{0,}?[А-яA-Za-zЁё].{0,}?(?=${S}|${nbspEntity}|$)`, 'g');
  let count_W_body = 0;
  for (let j = 0; j < paragraphs.length; j += 1) {
    if (ctx.cancelled) return;
    if (j % 200 === 0) await mfbe.ui.progress(j, paragraphs.length, ctx.script.name);
    const par = paragraphs[j];
    const words0 = innerText(par).match(reW_body);
    if (words0) count_W_body += words0.length;
    found: for (const place of findWords(par, reAllM)) {
      const elem2 = wordAt(place).toUpperCase();
      let k1 = 0;
      let k2 = MM.length - 1;
      while (k2 - k1 !== 1) {
        const kMidi = Math.floor((k2 + k1) / 2);
        if (elem2 === MM[kMidi][0]) {
          M[MM[kMidi][1]][11] += 1;
          M[MM[kMidi][1]][12].push(place);
          continue found;
        }
        if (elem2 > MM[kMidi][0]) k1 = kMidi;
        else k2 = kMidi;
      }
    }
  }

  /// СТАТИСТИКА СЛОВ С РАЗНОЧТЕНИЕМ
  const razdelitel = '· · · · · · · · · · · · · · · · · · · · · · · ·';
  let count_w01 = 0;
  let count_jo01 = 0;
  let count_gr = 0;
  let mSt = [];
  mSt.push(t(ctx, '  Статистика слов с разночтением', '  Statistics of the words read differently with Е and Ё'));
  mSt.push('-----------------------------------------------------------');
  for (let k = 0; k < LengthM; k += 1) {
    if (M[k][11] !== 0) {
      count_gr += 1;
      count_w01 += M[k][11];
      if (k * 0.5 !== Math.floor(k * 0.5)) count_jo01 += M[k][11];
    }
  }
  mSt.push(
    t(
      ctx,
      `Найдено   .  .  .  .\t${count_w01} ${words(ctx, count_w01)} в ${count_gr} ${groups(ctx, count_gr)}`,
      `Found   .  .  .  .\t${count_w01} ${words(ctx, count_w01)} in ${count_gr} ${groups(ctx, count_gr)}`,
    ),
  );
  mSt.push(`${t(ctx, 'Ёфикация .  .  .  .\t', 'With Ё   .  .  .  .\t')}${percent(ctx, count_jo01 / count_w01)}`);
  mSt.push('                                                                                         ');
  for (let k = 0; k < LengthM; k += 2) if (M[k][11] !== 0) mSt.push(`${M[k][11]}  —\t${M[k][0]}`);
  if (mSt[mSt.length - 1].search(/^ *$/) === -1) mSt.push(razdelitel);
  for (let k = 1; k < LengthM; k += 2) if (M[k][11] !== 0) mSt.push(`${M[k][11]}  —\t${M[k][0]}`);
  if (mSt[mSt.length - 1] === razdelitel) mSt.pop();
  if (mSt[mSt.length - 1].search(/^ *$/) !== -1) mSt.pop();
  if (count_w01 !== 0) await pageF(state, ctx, mSt);

  ///   Окно "Управление"
  if (Upravlenie !== 0 && count_w01 !== 0) {
    await msgBox(
      state,
      ctx,
      t(
        ctx,
        ' • УПРАВЛЕНИЕ \n\n\n «Да» – разрешить замену \n «Нет» – отказаться от замены \n «Отмена» – отказаться от группы замен \n\n «Шаг назад» – \n    отменить последнее действие \n    (несколько нажатий – отмена нескольких действий) \n\n «Прервать» – \n    прерывание обработки слов с разночтением. \n',
        ' • CONTROLS \n\n\n «Yes» – allow the replacement \n «No» – refuse the replacement \n «Cancel» – refuse the whole group of replacements \n\n «Step back» – \n    undo the last answer \n    (several presses undo several answers) \n\n «Stop» – \n    stop working on the words read differently. \n',
      ),
    );
  }

  /// ПОЛУАВТОМАТИЧЕСКИЕ ЗАМЕНЫ СЛОВ С РАЗНОЧТЕНИЕМ
  const variantButtons = [
    { id: 'yes', label: t(ctx, 'Да', 'Yes'), default: true },
    { id: 'no', label: t(ctx, 'Нет', 'No') },
    { id: 'cancel', label: t(ctx, 'Отмена', 'Cancel'), cancel: true },
    { id: 'back', label: t(ctx, 'Шаг назад', 'Step back') },
    { id: 'stop', label: t(ctx, 'Прервать', 'Stop') },
  ];
  const mUndo = [];
  let LU = 0;
  let exit = false;
  let k = 0;
  for (k = 0; k < LengthM; k += 1) {
    if (M[k][10] && Rezhim === 2) continue;
    if (!M[k][10] && Rezhim === 1) continue;
    if (exit) break;
    let Lj = M[k][12].length;
    let count_msg = 1;
    let otmena = false;
    let j = 0;
    for (j = 0; j < Lj; j += 1) {
      if (otmena || exit) break;
      if (ctx.cancelled) return;
      const place = M[k][12][j];
      const elem1 = wordAt(place);
      let elem2;
      if (elem1 === M[k][0]) elem2 = M[k][2];
      else if (elem1 === M[k][4]) elem2 = M[k][5];
      else if (elem1 === M[k][6]) elem2 = M[k][7];
      else continue;
      mUndo[LU] = { k, j, Lj, s: elem1, count: M[k][8], msg: count_msg };
      LU += 1;
      const msgTitle = `•  ${M[k][0]}  ›››  ${M[k][2]}  —  ${count_msg} / ${M[k][11]}`;
      let msg = `${t(ctx, ' ◊  Найден текст:\t', ' ◊  Found:\t')}${elem1}`;
      if (M[k][1]) msg += ` (${M[k][1]})`;
      msg += `${t(ctx, '\n ◊  Заменить на:\t', '\n ◊  Replace with:\t')}${elem2}`;
      if (M[k][3]) msg += ` (${M[k][3]})`;
      await selectPlace(place);
      const answer = await askButtons(state, ctx, msgTitle, msg, variantButtons);
      if (answer === 'stop') {
        exit = await askYesNo(
          state,
          ctx,
          t(ctx, '◊  Прервать обработку слов с разночтением?       ', '◊  Stop working on the words read differently?       '),
        );
        j -= 1;
        if (exit) break;
        else continue;
      }
      if (answer === 'back') {
        // The original's minus: this question and the answer before it are taken back.
        for (let jjj = 2; jjj > 0 && LU > 0; jjj -= 1) {
          LU -= 1;
          k = mUndo[LU].k;
          j = mUndo[LU].j;
          Lj = mUndo[LU].Lj;
          if (wordAt(M[k][12][j]) !== mUndo[LU].s) await setWord(state, M[k][12][j], mUndo[LU].s);
          M[k][8] = mUndo[LU].count;
          count_msg = mUndo[LU].msg;
        }
        j -= 1;
        continue;
      }
      if (answer === 'cancel') {
        otmena = true;
        break;
      }
      if (answer === 'yes') {
        await setWord(state, place, elem2);
        M[k][8] += 1;
      }
      count_msg += 1;
    }
  }
  let count_all_1 = 0;
  for (let i = 0; i < LengthM; i += 1) count_all_1 += M[i][8];

  /// ПОИСК ЁФИЦИРОВАННЫХ СЛОВ БЕЗ РАЗНОЧТЕНИЯ
  let count_all_2 = 0;
  const reJo = /(^|[^А-яA-Za-zЁё0-9])([А-яЁё]*[Ёё][А-яЁё]*)(?=[^А-яA-Za-zЁё0-9]|$)/g;
  let allMJo = '^(';
  for (let i = 1; i < LengthM; i += 2) allMJo += `${M[i][0]}|`;
  allMJo = allMJo.replace(/\|$/, ')$');
  const reAllMJo = new RegExp(allMJo, 'i');
  const mJo_word = [' ', '№'];
  const mJo_count = [' ', '№'];
  const mJo_elem = [' ', '№'];
  mSort = [' ', '№'];
  for (const par of paragraphs) {
    if (!/[Ёё]/.test(serializeInline(par.node.content ?? [], []))) continue;
    const places = findWords(par, reJo);
    found: for (let jj = places.length - 1; jj >= 0; jj -= 1) {
      let elem1 = wordAt(places[jj]);
      if (elem1.length === 1 || elem1.search(reAllMJo) !== -1) continue;
      elem1 = elem1.replace(/^(.).+/, '$1').toUpperCase() + elem1.replace(/^.(.+)/, '$1');
      const elem2 = elem1.replace(/Ё/g, 'Е№').replace(/ё/g, 'е№');
      let k1 = 0;
      let k2 = mSort.length - 1;
      while (k2 - k1 !== 1) {
        const kMidi = Math.floor((k2 + k1) / 2);
        if (elem2 === mSort[kMidi]) {
          mJo_count[kMidi] += 1;
          mJo_elem[kMidi].push(places[jj]);
          continue found;
        }
        if (elem2 > mSort[kMidi]) k1 = kMidi;
        else k2 = kMidi;
      }
      mSort.splice(k2, 0, elem2);
      mJo_word.splice(k2, 0, elem1);
      mJo_count.splice(k2, 0, 1);
      mJo_elem.splice(k2, 0, [places[jj]]);
    }
  }
  for (const list of [mJo_word, mJo_count, mJo_elem]) {
    list.pop();
    list.shift();
  }

  /// СТАТИСТИКА ЁФИЦИРОВАННЫХ СЛОВ БЕЗ РАЗНОЧТЕНИЯ
  let count_jo02 = 0;
  const mLength = mJo_word.length;
  mSt = [];
  mSt.push(t(ctx, '  Статистика\n  ёфицированных слов без разночтения', '  Statistics of the words\n  written with Ё that read only one way'));
  mSt.push('-----------------------------------------------------------');
  for (let i = 0; i < mLength; i += 1) count_jo02 += mJo_count[i];
  mSt.push(
    t(
      ctx,
      `Найдено   .  .  .  .\t${count_jo02} ${words(ctx, count_jo02)} в ${mLength} ${groups(ctx, mLength)}`,
      `Found   .  .  .  .\t${count_jo02} ${words(ctx, count_jo02)} in ${mLength} ${groups(ctx, mLength)}`,
    ),
  );
  mSt.push(`${t(ctx, 'Ёфикация .  .  .  .\t', 'With Ё   .  .  .  .\t')}${percent(ctx, count_jo02 / (count_W_body - count_w01))}`);
  mSt.push('                                                                                         ');
  for (let i = 0; i < mLength; i += 1) mSt.push(`${mJo_count[i]}  —\t${mJo_word[i]}`);
  if (mLength !== 0) await pageF(state, ctx, mSt);

  /// ПОЛУАВТОМАТИЧЕСКАЯ деЁФИКАЦИЯ СЛОВ БЕЗ РАЗНОЧТЕНИЯ
  const deYo = (text) => text.replace(/Ё/g, 'Е').replace(/ё/g, 'е');
  let otvet1 = false;
  let otvet2 = false;
  if (Rezhim !== 1 && mLength !== 0) {
    otvet1 = await askYesNo(state, ctx, t(ctx, '◊  ДеЁфицировать эти слова?       ', '◊  Write these words with Е?       '));
    if (otvet1) {
      otvet2 = await askYesNo(
        state,
        ctx,
        t(
          ctx,
          '◊  Выборочно? \n\n• ДА  —\tВыборочно \n• НЕТ  —\tДеЁфицировать всё       ',
          '◊  Group by group? \n\n• YES  —\tGroup by group \n• NO  —\tAll of them at once       ',
        ),
      );
    }
    if (otvet1 && !otvet2) {
      for (let i = 0; i < mLength; i += 1) {
        for (let j = mJo_elem[i].length - 1; j >= 0; j -= 1) await setWord(state, mJo_elem[i][j], deYo(wordAt(mJo_elem[i][j])));
      }
      count_all_2 = count_jo02;
    }
    if (otvet1 && otvet2) {
      if (Upravlenie !== 0 && mLength !== 0) {
        await msgBox(
          state,
          ctx,
          t(
            ctx,
            ' • УПРАВЛЕНИЕ \n\n\n «Да» – разрешить изменение \n «Нет» – отказаться от изменения \n «Отмена» – прерывание деЁфикации \n\n «Шаг назад» – \n    отменить последнее действие \n    (несколько нажатий – отмена нескольких действий) \n',
            ' • CONTROLS \n\n\n «Yes» – allow the change \n «No» – refuse the change \n «Cancel» – stop writing the words with Е \n\n «Step back» – \n    undo the last answer \n    (several presses undo several answers) \n',
          ),
        );
      }
      const groupButtons = [
        { id: 'yes', label: t(ctx, 'Да', 'Yes'), default: true },
        { id: 'no', label: t(ctx, 'Нет', 'No') },
        { id: 'cancel', label: t(ctx, 'Отмена', 'Cancel'), cancel: true },
        { id: 'back', label: t(ctx, 'Шаг назад', 'Step back') },
      ];
      const mUndo_s = [];
      const mUndo_count = [];
      for (k = 0; k < mLength; k += 1) {
        if (ctx.cancelled) return;
        mUndo_s[k] = mJo_elem[k].map((place) => wordAt(place));
        mUndo_count[k] = count_all_2;
        const msgTitle = t(ctx, `•  ${k + 1}-я группа слов (из ${mJo_word.length})`, `•  Group ${k + 1} of ${mJo_word.length}`);
        const msg = `${mJo_word[k]} (${mJo_count[k]} ${words(ctx, mJo_count[k])})${t(ctx, '\n\t\t\t\t\tДеЁфицировать?', '\n\t\t\t\t\tWrite with Е?')}`;
        await selectPlace(mJo_elem[k][0]);
        const answer = await askButtons(state, ctx, msgTitle, msg, groupButtons);
        if (answer === 'cancel') {
          exit = await askYesNo(state, ctx, t(ctx, '◊  Прервать выполнение скрипта?       ', '◊  Stop the script?       '));
          k -= 1;
          if (exit) break;
          else continue;
        }
        if (answer === 'back') {
          for (let jjj = 1; jjj > 0 && k >= 1; jjj -= 1) {
            k -= 1;
            for (let j = mJo_elem[k].length - 1; j >= 0; j -= 1) {
              if (wordAt(mJo_elem[k][j]) !== mUndo_s[k][j]) await setWord(state, mJo_elem[k][j], mUndo_s[k][j]);
              count_all_2 = mUndo_count[k];
            }
          }
          k -= 1;
          continue;
        }
        if (answer === 'yes') {
          for (let j = mJo_elem[k].length - 1; j >= 0; j -= 1) await setWord(state, mJo_elem[k][j], deYo(wordAt(mJo_elem[k][j])));
          count_all_2 += mJo_elem[k].length;
        }
      }
    }
  }

  ///  ПОВЫШЕНИЕ ВЕРСИИ ФАЙЛА И ЗАПИСЬ В ИСТОРИЮ ИЗМЕНЕНИЙ
  let history = { HiCh: 0, VersionUp: false, versionFile: state.snapshot.description.documentInfo.version ?? '', newVersion: '' };
  if (Version_on_off === 1 && (count_all_1 + count_all_2 !== 0 || Vsegda_on_off === 1)) {
    // The description as the book has it now (the replacements in it are already written).
    const description = (await mfbe.doc.get()).description;
    history = historyChange(description, `${ScriptName} ${NumerusVersion}`, youName);
    await mfbe.doc.setDescription(description);
  }

  /// ОКНО РЕЗУЛЬТАТОВ  :  Текущее время и дата
  const now = new Date();
  const currentMinutes = `${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
  const currentSeconds = `${now.getSeconds() < 10 ? '0' : ''}${now.getSeconds()}`;
  const currentMonth = `${1 + now.getMonth() < 10 ? '0' : ''}${1 + now.getMonth()}`;
  const currentYear = `${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const currentTime = `${now.getHours()}:${currentMinutes}:${currentSeconds}`;
  const currentDate = `${now.getDate()}.${currentMonth}.${currentYear}`;

  /// ОКНО РЕЗУЛЬТАТОВ  :  Сборка массива с результатами обработки
  const Tf = Date.now();
  let count_joAll = count_jo01 + count_jo02 - count_all_2;
  for (let i = 0; i < LengthM; i += 2) count_joAll += M[i][8];
  for (let i = 1; i < LengthM; i += 2) count_joAll -= M[i][8];
  mSt = [];
  mSt.push(` ${ScriptName} v.${NumerusVersion}`);
  mSt.push('-----------------------------------------------------------');
  if (Rezhim === 1) mSt.push(t(ctx, '  режим «Только Ёфикация»', '  mode «Ё only»'));
  if (Rezhim === 2) mSt.push(t(ctx, '  режим «Только деЁфикация»', '  mode «Е only»'));
  mSt.push('                                                                                         ');
  mSt.push(`${t(ctx, 'Вычисления  .  .  .  .  .  .  .\t', 'Computing  .  .  .  .  .  .  .\t')}${time(ctx, Tf - Ts - state.T_pause)}`);
  if (state.T_pause !== 0) mSt.push(`${t(ctx, 'Диалоговые паузы .  .  .  .\t', 'Dialogs  .  .  .  .  .  .  .\t')}${time(ctx, state.T_pause)}`);
  mSt.push(`${t(ctx, 'Всего слов .  .  .  .  .  .  .  .\t', 'Words  .  .  .  .  .  .  .  .\t')}${count_W_body}`);
  if (count_W_body === 0) count_W_body = 1;
  mSt.push(`${t(ctx, 'С буквой «Ё»   .  .  .  .  .  .\t', 'With the letter «Ё»  .  .  .\t')}${percent(ctx, count_joAll / count_W_body)}`);
  if (count_all_1 !== 0) mSt.push(`${t(ctx, 'Замен «разночтения»  .  .\t', 'Variant readings changed  .\t')}${count_all_1}`);
  if (count_all_2 !== 0) mSt.push(`${t(ctx, 'ДеЁфицированно слов .  .\t', 'Written with Е  .  .  .  .\t')}${count_all_2}`);
  if (count_all_1 !== 0) {
    mSt.push('');
    mSt.push(t(ctx, '• Подробно (разночтения):', '• In detail (variant readings):'));
    for (let i = 0; i < LengthM; i += 1) if (M[i][8] !== 0) mSt.push(`${M[i][8]}  —\t${M[i][0]}  ›››  ${M[i][2]}`);
  }
  if (count_all_1 + count_all_2 === 0) {
    mSt.push('');
    mSt.push(t(ctx, '   >> Исправлений нет', '   >> No corrections'));
  }
  if (history.VersionUp || history.HiCh) mSt.push('');
  if (history.VersionUp) mSt.push(`${t(ctx, '• Версия файла:  ', '• File version:  ')}${history.versionFile}  ›››  ${history.newVersion}`);
  if (history.HiCh === 1) mSt.push(t(ctx, '• Добавлена новая строка в историю', '• A new line added to the history'));
  if (history.HiCh === 2) mSt.push(t(ctx, '• Добавлены две строки в историю', '• Two lines added to the history'));
  if (history.HiCh === 3) mSt.push(t(ctx, '• Изменены данные в строке истории', '• A line of the history changed'));
  mSt.push('');
  mSt.push(`• ${currentDate} • ${currentTime} •`);
  mSt.push('');
  mSt.push('-----------------------------------------------------------');
  await pageF(state, ctx, mSt);
}
