// Shared helper of the "Скрипт-конструктор" script of FictionBook Editor 2.7.9 (group 21): the
// paragraphs, their flags and the statistics window of the search-and-replace builder.
//
// The original went through the paragraphs of the editor's body view - the book's annotation, the
// document's history, then the bodies - and gave each one, as its HTML (innerHTML, rendered here
// in the same notation by lib/legacy-html.js), to the operations, with flags telling where the
// paragraph stands; a paragraph whose HTML the operations changed was written back. Then it
// showed the counts in a statistics window, in pages. The annotation and the history are part of
// the description here; they are read from it in the same order and written back to it.

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

const JSCRIPT_SPACE = ' \\f\\n\\r\\t\\v';

/**
 * A pattern rewritten so that it matches as it did in FictionBook Editor's JScript: \s and \S knew
 * only [ \f\n\r\t\v] (not U+00A0 nor the other Unicode spaces of JavaScript), and a ] right after
 * [ or [^ was a member of the class.
 */
function jscriptPattern(source) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && i + 1 < source.length) {
      const next = source[i + 1];
      if (next === 's') out += inClass ? JSCRIPT_SPACE : `[${JSCRIPT_SPACE}]`;
      else if (next === 'S') out += inClass ? '\\S' : `[^${JSCRIPT_SPACE}]`;
      else out += ch + next;
      i += 1;
      continue;
    }
    if (!inClass && ch === '[') {
      inClass = true;
      out += ch;
      if (source[i + 1] === '^') {
        out += '^';
        i += 1;
      }
      if (source[i + 1] === ']') {
        out += '\\]';
        i += 1;
      }
      continue;
    }
    if (inClass && ch === ']') inClass = false;
    out += ch;
  }
  return out;
}

/** `new RegExp(source, flags)` as the operations' JScript compiled it (see jscriptPattern). */
export function JScriptRegExp(source, flags) {
  if (source instanceof globalThis.RegExp) return new globalThis.RegExp(source, flags);
  return new globalThis.RegExp(jscriptPattern(String(source)), flags);
}

/**
 * The original's flags of a paragraph: its own class (subtitle, text-author - a date was a
 * paragraph of class text-author), "text" (directly in a section) and the containers between it
 * and the nearest section (title, history, stanza, poem, epigraph, annotation, cite, table).
 */
function flagsOf(node, ancestors) {
  const flags = {
    title: false, history: false, stanza: false, poem: false, epigraph: false, annotation: false,
    cite: false, table: false,
    subtitle: node.type === 'subtitle',
    text_author: node.type === 'text-author' || node.type === 'date',
  };
  flags.text = !flags.subtitle && ancestors[0] === 'section';
  for (const type of ancestors) {
    if (type === 'section') break;
    if (type in flags && type !== 'subtitle' && type !== 'text_author' && type !== 'text') flags[type] = true;
  }
  return flags;
}

/**
 * The paragraphs in the original's order: the annotation and the history (when the settings take
 * them), then the bodies. Each: { node, source, flags, description }: `source` is the snapshot's
 * node (an empty line's `node` is an empty paragraph), so that a description paragraph is edited in
 * place.
 */
export function paragraphsOf(snapshot, { history, annotation }) {
  const out = [];
  const visit = (node, ancestors, description) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      out.push({ node, source: node, flags: flagsOf(node, ancestors), description });
      return;
    }
    if (node.type === 'empty-line') {
      // FictionBook Editor showed an empty line as an empty paragraph.
      out.push({ node: { type: 'p', content: [] }, source: node, flags: flagsOf(node, ancestors), description });
      return;
    }
    for (const child of node.content ?? []) visit(child, [node.type, ...ancestors], description);
  };
  if (annotation) visit(snapshot.description?.titleInfo?.annotation, [], true);
  if (history) visit(snapshot.description?.documentInfo?.history, [], true);
  for (const body of snapshot.bodies ?? []) visit(body, [], false);
  return out;
}

/** innerText of a paragraph: its text; a picture gives nothing. */
export function innerText(node) {
  return (node.content ?? []).map((item) => (item.type === 'text' ? item.text ?? '' : '')).join('');
}

/** The original's statistics window, in pages (AskYesNo between them). */
export async function showStatistics(ctx, o) {
  const ru = ctx.uiLanguage === 'ru';
  const currentFullDate = new Date();
  const currentHours = currentFullDate.getHours();
  let currentMinutes = currentFullDate.getMinutes();
  let currentSeconds = currentFullDate.getSeconds();
  if (currentMinutes < 10) currentMinutes = `0${currentMinutes}`;
  if (currentSeconds < 10) currentSeconds = `0${currentSeconds}`;
  const currentDay = currentFullDate.getDate();
  let currentMonth = 1 + currentFullDate.getMonth();
  let currentYear = currentFullDate.getFullYear();
  if (currentMonth < 10) currentMonth = `0${currentMonth}`;
  currentYear = `${currentYear}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const currentTime = `${currentHours}:${currentMinutes}:${currentSeconds}`;
  const currentDate = `${currentDay}.${currentMonth}.${currentYear}`;

  // Подсчет чистого компьютерного времени, потраченного на обработку текста
  const Tf = new Date().getTime();
  let tempus = 0;
  const T2 = Tf - o.started;
  const Tmin = Math.floor(T2 / 60000);
  const TsecD = (T2 % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  if (Tmin === 0) tempus = `${`${+`${TsecD}`.replace(/(.{1,5}).*/g, '$1')}`.replace('.', ',')} ${ru ? 'сек' : 's'}`;
  else {
    tempus = `${Tmin} ${ru ? 'мин' : 'min'}`;
    if (Tsec !== 0) tempus += ` ${Tsec} ${ru ? 'с' : 's'}`;
  }

  // Сборка массива с результатами обработки
  const mSt = [];
  let d = 0;
  if (o.all === 1) d = 'показать нули';
  mSt.push(` «${o.name}» v.${o.version}`);
  mSt.push('---------------------------------------------------------------');
  if (d) mSt.push(ru ? ' Демонстрационный режим' : ' Demonstration mode');
  mSt.push('\t\t\t\t\t\t       ');
  mSt.push(ru ? '• СТАТИСТИКА:\t\t\t\t' : '• STATISTICS:\t\t\t\t');
  mSt.push(`${ru ? '   Время выполнения  .  .  .  .  .  .  .  .' : '   Run time  .  .  .  .  .  .  .  .  .  .  .  .'}\t${tempus}`);
  mSt.push(`${ru ? '   Проверено строк  .  .  .  .  .  .  .  .  .' : '   Lines checked  .  .  .  .  .  .  .  .  .  .'}\t${o.count_P}`);
  mSt.push(`${ru ? '   Исправлено строк   .  .  .  .  .  .  .  .' : '   Lines corrected   .  .  .  .  .  .  .  .  .'}\t${o.count_GU}`);
  let cTaT = mSt.length; //  число строк в первом разделе
  mSt.push('');
  mSt.push(ru ? '• ПОИСК И ПОДСЧЁТ:' : '• SEARCH AND COUNT:');
  for (let k = 0; k <= 999; k += 1) {
    // eslint-disable-next-line eqeqeq
    if (o.stroka[k] != undefined && o.count[k] != d && o.re_[k] == undefined) mSt.push(`${`00${k}`.replace(/.*(...)$/g, '$1. ') + o.stroka[k]}\t${o.count[k]}`);
  }
  //  Удаление последних строк, если нет пунктов в разделе с операциями
  if (cTaT === mSt.length - 2) mSt.length -= 2;
  cTaT = mSt.length; //  число строк во втором разделе
  mSt.push('');
  mSt.push(ru ? '• ИСПРАВЛЕНИЯ:' : '• CORRECTIONS:');
  for (let k = 0; k <= 999; k += 1) {
    // eslint-disable-next-line eqeqeq
    if (o.stroka[k] != undefined && o.count[k] != d && o.re_[k] != undefined) mSt.push(`${`00${k}`.replace(/.*(...)$/g, '$1. ') + o.stroka[k]}\t${o.count[k]}`);
  }
  if (cTaT === mSt.length - 2) mSt.length -= 2;
  //  Сборка строк текущей даты и времени
  mSt.push('');
  mSt.push('---------------------------------------------------------------');
  mSt.push(`• ${currentDate} • ${currentTime} •`);

  // Определение высоты страниц и их количества
  let Vysota_teksta = o.height;
  if (Vysota_teksta < 25) Vysota_teksta = 25; // установка минимальной высоты
  let Kolo = Vysota_teksta - 3; //  высота колонки (в конце сборки страниц могут добавиться 3 строки)
  let ind = mSt.length;
  const page = Math.ceil(ind / Kolo); //  Определение количества страниц
  Kolo = Math.ceil((ind - 1) / page + 1); //  Переопределение высоты колонки
  while (ind <= Kolo * page) {
    mSt[ind] = '';
    ind += 1;
  } //  Добавление пустых строк

  // Распределение строк по страницам
  const mPage = [];
  let _k = 0; // смещение строк
  for (let n = 0; n < page; n += 1) {
    mPage[n] = '';
    if (mSt[n * Kolo + _k] === '') _k += 1; //  Пропуск пустой строки в начале страницы.
    for (let k = 0; k < Kolo; k += 1) {
      if (k === Kolo - 1 && mSt[k + n * Kolo + _k].search(/^• [^0-9]/) !== -1) {
        //   Если "последняя" строка на странице это заголовок раздела
        mPage[n] += '\n';
        _k -= 1;
      } else mPage[n] += `${mSt[k + n * Kolo + _k]}\n`; // Стандартное заполнение страницы.
    }
    if (page !== 1) {
      mPage[n] += '\t\t\t\t\t\t       \n';
      if (n !== page - 1) mPage[n] += ru ? `◊  Стр. ${n + 1}  ◊  Показать  следующую  страницу?` : `◊  Page ${n + 1}  ◊  Show  the  next  page?`;
      else mPage[n] += ru ? `◊  Стр. ${n + 1} (последняя)  ◊  Закрыть окно?` : `◊  Page ${n + 1} (the last)  ◊  Close the window?`;
    }
  }

  // Вывод страниц с результатами на экран
  let otvet = true;
  let n = 0;
  while (otvet) {
    if (page === 1) {
      await MsgBox(mPage[0], ctx.script.name);
      break;
    }
    otvet = (await MsgBox(mPage[n], ctx.script.name, 4)) === 6;
    n += 1;
    if (n === page) {
      n = 0;
      otvet = !otvet;
    }
  }
}
