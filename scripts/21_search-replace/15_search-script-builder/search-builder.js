// Shared helper of the "Скрипт-конструктор (поиск)" scripts of FictionBook Editor 2.7.9 (group 21:
// the template and its example). Each package carries an identical copy (the sandbox loads modules
// from the script's own folder only); the packages differ in their settings and operations.
//
// The original went through the paragraphs of the editor's body view - the book's annotation, the
// document's history, then the bodies - and gave each one, as its text without tags (innerText),
// to the operations, with flags telling where the paragraph stands; then it showed the counts in a
// statistics window, with a proverb from a list of wartime sayings - left out here pending the
// requester's decision (the list is not copied). The annotation and the history are part of the
// description here; they are read from it in the same order.

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
 * node (an empty line's `node` is an empty paragraph).
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

/* ---------------------------------------------------------------------------------------- */
/* The statistics window                                                                      */
/* ---------------------------------------------------------------------------------------- */

/**
 * Builds and shows the original's window, without its proverb. `o`: { name, version, column
 * (Vysota_kolonki), all (VseStroki_on_off), started, count_P, count, stroka }.
 */
export async function showStatistics(ctx, o) {
  const ru = ctx.uiLanguage === 'ru';
  const Ts = o.started;
  const currentFullDate = new Date();
  const currentHours = currentFullDate.getHours();
  let currentMinutes = currentFullDate.getMinutes();
  let currentSeconds = currentFullDate.getSeconds();
  if (currentMinutes < 10) currentMinutes = `0${currentMinutes}`;
  if (currentSeconds < 10) currentSeconds = `0${currentSeconds}`;
  const currentDay = currentFullDate.getDate();
  let currentMonth = 1 + currentFullDate.getMonth();
  let currentYear = currentFullDate.getFullYear();
  let Day_ = '';
  if (currentDay < 10) Day_ = '  ';
  if (currentMonth < 10) currentMonth = `0${currentMonth}`;
  currentYear = `${currentYear}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const currentTime = `${currentHours}:${currentMinutes}:${currentSeconds}`;
  const currentDate = `${currentDay}.${currentMonth}.${currentYear}`;

  const Tf = new Date().getTime();
  const T2 = Tf - Ts;
  const TsecD = T2 / 1000;
  const tempus = `${`${TsecD}`.replace(/(.{1,5}).*/g, '$1').replace(/\.$/g, '').replace('.', ',')} ${ru ? 'с' : 's'}`;

  const mSt = [];
  mSt.push(ru ? '• СТАТИСТИКА:\t\t\t\t' : '• STATISTICS:\t\t\t\t');
  mSt.push(`${ru ? '• Время выполнения  .  .  .  .  .  .  .  .  .  .  .  .  .' : '• Run time  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .'}\t${tempus}`);
  mSt.push(`${ru ? '• Всего строк   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .  .' : '• Lines in all   .  .  .  .  .  .  .  .  .  .  .  .  .  .  .'}\t${o.count_P}`);
  const cTaT1 = mSt.length - 1; //  число строк в первом разделе
  mSt.push('\t\t\t\t\t');
  mSt.push(ru ? '• ПОИСК И ПОДСЧЁТ:\t\t\t' : '• SEARCH AND COUNT:\t\t\t');
  let d = 0;
  if (o.all === 1) d = 'показать все строки';
  for (let k = 0; k <= 999; k += 1) {
    // eslint-disable-next-line eqeqeq
    if (o.stroka[k] != undefined && o.count[k] != d) mSt.push(`00${k}`.replace(/.*(...)$/g, '$1. ') + o.stroka[k] + o.count[k]);
  }
  if (cTaT1 === mSt.length - 3) mSt.length -= 2; //  Удаление двух последних строк, если нет пунктов в этом разделе

  // The original added a proverb here (Poslovitsa_on_off), drawn from a list of wartime sayings.
  // It is left out pending the requester's decision: the window is the one the original showed
  // with the proverb switched off.

  const ind = mSt.length;
  let max0 = o.column;
  if (max0 < 1) max0 = 1;
  const sto = ind / max0 <= 3 ? Math.ceil(ind / max0) : 3;
  const Kolo = Math.ceil(ind / sto);
  let stT = '';
  for (let k = 0; k < Kolo; k += 1) {
    stT += `\n${mSt[k]}\t`;
    if (sto > 1 && k + Kolo < ind) stT += `${mSt[k + Kolo]}\t`;
    if (sto > 2 && k + 2 * Kolo < ind) stT += `${mSt[k + 2 * Kolo]}\t`;
  }
  let otst = '';
  let otst2 = '';
  let otst3 = '';
  let otst4 = '';
  if (sto === 2) {
    otst = '                                                ';
    otst2 = '                              ';
    otst3 = ':::::::::';
    otst4 = ' ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍';
  }
  if (sto === 3) {
    otst = '                                                                                                ';
    otst2 = '                                                                      ';
    otst3 = ':::::::::::::';
    otst4 = ' ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍';
  }
  await MsgBox(
    `${otst}                                  –= ◊ =–                                                    ${otst}\n\n` +
      `• «${o.name}»  v.${o.version}\n` +
      ` ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍ ̍${otst4}${stT}\n\n` +
      `${otst2}${Day_}.:::::::::::${otst3} ${currentDate} ::::::::::::${otst3} ${currentTime} ${otst3}:::::::::::.`,
    ctx.script.name,
  );
}
