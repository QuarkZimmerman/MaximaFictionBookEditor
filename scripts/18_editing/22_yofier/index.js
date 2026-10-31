// Converted from FictionBook Editor 2.7.9: Scripts/18_Мелочи редактирования/22_Ёфикатор.js
// Puts the letter Ё back into some 70 groups of common words written with Е (ещё, её, моё,
// придётся, ребёнок, причём, о нём, вперёд, шёл, зелёный, чёрный, тётя ...) in every paragraph of
// the book - the book's annotation and the document's history included, as the original's
// settings ObrabotkaHistory and ObrabotkaAnnotation say - and then shows the time it took and how
// many times an expression changed a paragraph. The original's expressions (rules.js, copied as
// written) run, in its order, on the legacy inline-HTML notation of lib/legacy-html.js, as the
// original ran them on the paragraph's HTML: the formatting stays, and what they did there they
// do here, quirks included (a word that follows another changed word with one space between them
// is not changed in the same pass, since the space was taken by the first match).
// Fix: the expression for "нашёл", "нашёлся" (re19a), which the original defined but never
// applied, runs after the one for "ушёл". Differences: "\s" of the three expressions for "о нём",
// "о чём", "во всём" keeps JScript's meaning (a tab, a line break or a plain space; the
// non-breaking space is in the expressions themselves); the annotation and the history are
// changed through doc.setDescription.
// See docs/scripting/notes-279-drafts/18.md.
// The original's notice, kept as written (FR-029):
//=== Буква «Ёё» ===
//Engine by ©Sclex (01.05.2007 – 07.05.2008)
//Jurgen Script «Генеральная уборка» Golma Edition
import { collectTextBlocks, parseInline, rewriteBlockHtml, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';
import { RULES } from './rules.js';

const VERSION_NUMBER = '0.1';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// JScript's \s: the ASCII white space only (no non-breaking or other Unicode spaces).
const JSCRIPT_SPACE = '[\\t\\n\\v\\f\\r ]';
const EXPRESSIONS = RULES.map(([re, replacement]) => [
  new RegExp(re.source.replace(/\\s/g, JSCRIPT_SPACE), re.flags),
  replacement,
]);

/** The original's HandleP: every expression in turn, counted once per paragraph it changes. */
function handleP(html, counter) {
  let s = html;
  for (const [re, replacement] of EXPRESSIONS) {
    if (s.search(re) !== -1) {
      s = s.replace(re, replacement);
      counter.count += 1;
    }
  }
  return s;
}

/** The text blocks of the book's annotation and of the history (description nodes). */
function descriptionBlocks(description) {
  const out = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      out.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(description?.titleInfo?.annotation);
  visit(description?.documentInfo?.history);
  return out;
}

/** The original's time string, with English units in the English interface. */
function timeString(ctx, started) {
  const ms = Date.now() - started;
  const Thour = Math.floor(ms / 3600000);
  const Tmin = Math.floor(ms / 60000 - Thour * 60);
  const Tsec = Math.ceil(ms / 1000 - Tmin * 60 - Thour * 3600);
  const Tsec1 = Math.ceil(10 * (ms / 1000 - Tmin * 60)) / 10;
  const Tsec2 = Math.ceil(100 * (ms / 1000 - Tmin * 60)) / 100;
  const Tsec3 = Math.ceil(1000 * (ms / 1000 - Tmin * 60)) / 1000;
  const sec = t(ctx, ' сек', ' s');
  if (Tsec3 < 1 && Tmin < 1) return Tsec3 + sec;
  if (Tsec2 < 10 && Tmin < 1) return Tsec2 + sec;
  if (Tsec1 < 30 && Tmin < 1) return Tsec1 + sec;
  if (Tmin < 1) return Tsec + sec;
  if (Thour < 1) return `${Tmin}${t(ctx, ' мин ', ' min ')}${Tsec}${t(ctx, ' с', ' s')}`;
  return `${Thour}${t(ctx, ' ч ', ' h ')}${Tmin}${t(ctx, ' мин ', ' min ')}${Tsec}${t(ctx, ' с', ' s')}`;
}

export default async function run(ctx) {
  const started = Date.now();
  const counter = { count: 0 };
  const snapshot = await mfbe.doc.get();

  // The book's annotation and the history came first in FictionBook Editor's text; node
  // operations cover the bodies only, so they are edited in the description and written back.
  const description = snapshot.description;
  let descriptionChanged = false;
  for (const node of descriptionBlocks(description)) {
    const extras = [];
    const before = serializeInline(node.content ?? [], extras);
    const after = handleP(before, counter);
    if (after !== before) {
      node.content = parseInline(after, extras);
      descriptionChanged = true;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);

  const blocks = collectTextBlocks(snapshot);
  for (let i = 0; i < blocks.length; i += 1) {
    if (ctx.cancelled) return;
    if (i % 50 === 0) await mfbe.ui.progress(i, blocks.length, ctx.script.name);
    await rewriteBlockHtml(blocks[i], (html) => handleP(html, counter));
  }

  let st1 = '';
  if (counter.count !== 0) st1 += t(ctx, '\n Статистика', '\n Statistics');
  if (counter.count !== 0) st1 += `\n• Ё:  \t${counter.count}`;
  if (st1 !== '') st1 = `\n${st1}`;
  await mfbe.ui.message(
    t(ctx, ' «Маленький Ёфикатор» v.', ' «Little Yo-fier» v.') +
      VERSION_NUMBER +
      '\n\n' +
      t(ctx, ' Время: ', ' Time: ') +
      timeString(ctx, started) +
      '.' +
      st1,
    { caption: ctx.script.name, icon: 'info' },
  );
}
