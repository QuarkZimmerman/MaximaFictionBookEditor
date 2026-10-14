// Converted from 06_Чистка/14_Разрыв предложения.js (FictionBook Editor): "Поиск разорванных
// предложений". Looks at every pair of consecutive paragraphs of a section (titles, epigraphs,
// annotations, text-author lines, the first paragraph of a stanza/cite and subtitles are
// skipped): a first paragraph without final punctuation followed by a lower-case start is
// merged automatically, a hyphenated line end is merged when the user treats line-end hyphens
// as hyphenation, and the doubtful patterns (no final dot, question/exclamation/quote at the
// end, capital letter next) are offered one by one (Yes = merge / add the dot, No = skip).
// The pair is processed in the legacy notation "<P>…</P>\r\n<P>…</P>" the original worked on.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//======================================
//             Поиск разорваных предложений
//                                                Engine like AlxS™
//                                                                     17.11.2007…14.04.2008
//~~~~~~~~~~~~
// v.1.1 — второй параграф (z) просчитывается до последнего (z<ps.length)
//~~~~~~~~~~~~
// v.1.2 — предлагается поставить точку после вложенных кавычек-лапок var re4 (29.02.2008)
//~~~~~~~~~~~~
// v.1.3 — предлагается объединение после запятой (добавил левые кавычки после тире в диалогах) var re3 (04.03.2008)
//~~~~~~~~~~~~
// v.1.5 — баловство со статистикой (14.04.2008)
//~~~~~~~~~~~~
// v.1.6 — баловство со статистикой (16.12.2008)
//======================================
import { collectTextBlocks, htmlToPlainText, parseInline, serializeInline } from './lib/legacy-html.js';

const NB = '\u00A0';
const S_IB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>';
const F_IB = '</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';
const RE0 = new RegExp(`([^!…\\?_][a-z0-9а-яё](${F_IB}){0,1})(\\s|${NB}){0,}</P>\\r\\n<P>(\\s|${NB}){0,}((${S_IB}){0,1}[«\\"\\-]{0,1}(\\s|${NB}){0,}[a-zа-яё]{1,}[^\\)])`, 'gm');
const RE00 = new RegExp(`([а-я])-</P>\\r\\n<P>(\\s|${NB}){0,}([а-я])`, 'gm');
const RE1 = new RegExp(`([^!…\\?_][a-z0-9А-яё,;—–\\-\\»\\)IVX](${F_IB}){0,1})(\\s|${NB}){0,}</P>\\r\\n<P>(\\s|${NB}){0,}((${S_IB}){0,1}[«\\(\\[\\"\\-–—=]{0,1}(\\s|${NB}){0,}[a-z0-9а-яё\\?\\!…\\"]+[^\\)])`, 'gm');
const RE2 = new RegExp(`([a-zа-яё\\d\\w][\\?!…»\\"“](${F_IB}){0,1})(\\s|${NB}){0,}</P>\\r\\n<P>(\\s|${NB}){0,}((${S_IB}){0,1}[«\\"\\(\\[\\-–—\\.,<]{0,1}(\\s|${NB}){0,}(\\s|${NB}){0,1}[a-zа-яё…\\"«][a-zа-яё\\d])`, 'gm');
const RE3 = new RegExp(`([^!\\.\\?…][\\wа-яё»\\-],{0,1}(${F_IB}){0,1})</P>\\r\\n<P>((${S_IB}){0,1}[«\\"„\\(…\\[\\-–—\\.,]{0,1}(\\s|${NB}){0,1}«{0,1}[A-ZА-ЯЁ\\d])`, 'gm');
const RE4 = new RegExp(`([\\wа-яё]“{0,1}»{0,1}(${F_IB}){0,1}),{0,1}$`, 'gm');

const SKIP_PARENT = new Set(['title', 'epigraph', 'annotation']);

/** `<P>` or `<P class=...>` like the IE outerHTML the original concatenated. */
function openTag(type) {
  return type === 'p' || type === 'v' ? '<P>' : `<P class=${type}>`;
}

function excerptEnd(html) {
  const text = htmlToPlainText(html);
  return text.length > 50 ? `… ${text.slice(-50)}` : text;
}

function excerptStart(html) {
  const text = htmlToPlainText(html);
  return text.length > 50 ? `${text.slice(0, 50)} …` : text;
}

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const started = Date.now();
  const hyphenation = (await MsgBox(
    ru
      ? '–= Jürgen Script =–\n\nБудем считать дефисы в конце строк\n                   ПЕРЕНОСАМИ?\n\n     Если «Да»,\nто скрипт прогонит все переносы автоматом,\nно потом нужно будет пройтись и в ручном\nрежиме, чтобы подобрать другие разрывы.'
      : '–= Jürgen Script =–\n\nTreat hyphens at the end of a line as\n                   HYPHENATION?\n\n     With "Yes" every hyphenated break is\njoined automatically; the other breaks are\nthen offered one by one.',
    ctx.script.name,
    4 + 32,
  )) === 6;

  const snapshot = await mfbe.doc.get();
  const topSections = [];
  for (const body of snapshot.bodies ?? []) for (const child of body.content ?? []) if (child.type === 'section') topSections.push(child);
  if (topSections.length === 0) {
    await mfbe.ui.message(ru ? '\n В документе отсутствуют секции. \n\n' : '\n The document has no sections. \n\n', { icon: 'warning' });
    return;
  }
  let counta = 0;
  let countr = 0;
  let countt = 0;
  const stats = () => (ru ? `р:${countr} а:${counta} т:${countt}` : `m:${countr} a:${counta} d:${countt}`);
  const ask = async (text, b1, b2) => {
    try {
      await mfbe.selection.set({ nodeId: b2.ref.nodeId, offset: 0 });
      await mfbe.selection.scrollIntoView();
    } catch {
      // best effort
    }
    const sep = ru ? '                                       >>>     <<< ' : '                                       >>>     <<< ';
    return (await MsgBox(`${text}                                      ${stats()} \n\n${excerptEnd(b1.html)}\n${sep}\n     ${excerptStart(b2.html)}\n`, ctx.script.name, 4 + 32)) === 6;
  };

  for (const section of topSections) {
    const blocks = collectTextBlocks({ bodies: [section] }).map((b) => {
      const extras = [];
      return { ...b, extras, html: serializeInline(b.node.content, extras) };
    });
    for (let j = 0; j < blocks.length - 1; j += 1) {
      if (ctx.cancelled) return;
      const b1 = blocks[j];
      const b2 = blocks[j + 1];
      const p1 = b1.ancestors[0]?.type;
      const p2 = b2.ancestors[0]?.type;
      if (SKIP_PARENT.has(p1) || SKIP_PARENT.has(p2) || b1.node.type === 'text-author' || b2.node.type === 'text-author'
        || p1 === 'stanza' || b1.node.type === 'subtitle' || p1 === 'cite') continue;
      const junction = `</P>\r\n${openTag(b2.node.type)}`;
      const ss = `${openTag(b1.node.type)}${b1.html}</P>\r\n${openTag(b2.node.type)}${b2.html}</P>`;
      const merge = async (re, repl) => {
        const merged = ss.replace(re, repl);
        if (merged === ss || merged.includes(junction)) return false;
        const inner = merged.replace(/^<P[^>]*>/, '').replace(/<\/P>$/, '');
        b1.node.content = parseInline(inner, [...b1.extras, ...b2.extras]);
        b1.html = serializeInline(b1.node.content, (b1.extras = []));
        await mfbe.doc.replaceNode(b1.ref, { type: b1.node.type, attrs: { ...b1.node.attrs }, content: b1.node.content });
        await mfbe.doc.removeNode(b2.ref);
        blocks.splice(j + 1, 1);
        j -= 1;
        return true;
      };
      if (ss.search(RE0) !== -1) {
        if (await merge(RE0, '$1 $5')) counta += 1;
        continue;
      }
      if (hyphenation) {
        if (ss.search(RE00) !== -1) {
          if (await merge(RE00, '$1$3')) counta += 1;
          continue;
        }
      } else if (ss.search(RE00) !== -1) {
        if (await ask(ru ? ' 1. Объединить параграфы, перенос?' : ' 1. Join the paragraphs (hyphenation)?', b1, b2)) {
          if (await merge(RE00, '$1$3')) countr += 1;
        }
        continue;
      }
      if (ss.search(RE1) !== -1) {
        if (await ask(ru ? ' 1. Объединить параграфы?' : ' 1. Join the paragraphs?', b1, b2)) {
          if (await merge(RE1, '$1 $5')) countr += 1;
        }
        continue;
      }
      if (ss.search(RE2) !== -1) {
        if (await ask(ru ? ' 2. Объединить параграфы?' : ' 2. Join the paragraphs?', b1, b2)) {
          if (await merge(RE2, '$1 $5')) countr += 1;
        }
        continue;
      }
      const m3 = ss.search(RE3) !== -1;
      const m4 = b1.html.search(RE4) !== -1;
      if (!m3 && !m4) continue;
      if (m4) {
        if (await ask(ru ? ' Поставить в конце первого параграфа точку?' : ' Put a full stop at the end of the first paragraph?', b1, b2)) {
          b1.html = b1.html.replace(RE4, '$1.');
          b1.node.content = parseInline(b1.html, b1.extras);
          await mfbe.doc.replaceNode(b1.ref, { type: b1.node.type, attrs: { ...b1.node.attrs }, content: b1.node.content });
          countt += 1;
          continue;
        }
      }
      if (p2 === 'cite' || p2 === 'stanza' || b2.node.type === 'subtitle' || !m3) continue;
      if (await ask(ru ? ' 3. Объединить параграфы?' : ' 3. Join the paragraphs?', b1, b2)) {
        if (await merge(RE3, '$1 $3')) countr += 1;
      }
    }
  }

  const count = counta + countr + countt;
  let st2 = '';
  if (count) st2 += ru ? '     Статистика' : '     Statistics';
  if (counta) st2 += ru ? `\n• автослияние разрывов: ……… ${counta}` : `\n• automatic joins: ……… ${counta}`;
  if (countr) st2 += ru ? `\n• ручная коррекция: ………………… ${countr}` : `\n• manual joins: ………………… ${countr}`;
  if (countt) st2 += ru ? `\n• конечные точки абзаца: ……… ${countt}` : `\n• final full stops: ……… ${countt}`;
  const seconds = Math.ceil(((Date.now() - started) / 1000) * 10) / 10;
  await mfbe.ui.message(
    ru
      ? `           –= Jürgen Script =–\n«Поиск разорванных предложений» v.1.7\n\n    ${st2}\n       Произведено замен: ………… ${count}\n\n   Время исполнения: ${seconds} сек.\n`
      : `           –= Jürgen Script =–\n"Broken sentences" v.1.7\n\n    ${st2}\n       Changes made: ………… ${count}\n\n   Time: ${seconds} s.\n`,
    { caption: ctx.script.name, icon: 'info' },
  );
}
