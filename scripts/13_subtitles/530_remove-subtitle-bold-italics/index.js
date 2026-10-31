// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/530_Удаление жирности и курсива в подзаголовках.js
// Removes bold and "main" italics from subtitles: in every subtitle of the text - the book's
// annotation and the document's history included (the original's ObrabotkaHistory and
// ObrabotkaAnnotation are on), the notes too - all bold goes, and a subtitle that is italic as a
// whole (one italic run of plain text) loses the italics. The original's two expressions run, as
// written, on the legacy inline-HTML notation of lib/legacy-html.js, so formatting with a language
// (which FictionBook Editor did not keep) is left alone like the rest of the converted scripts do.
// A message gives the counts.
// Difference from the original (a fix): the statistics heading shows when only italic subtitles
// were processed too (the original tested the bold counter twice).
// The original's notice, kept as written (FR-029):
//======================================
//            "Удаление жирности и курсива в подзаголовках. v.1.02"
//                                             Автор скрипта - jurgennt
//                                             Engine by ©Sclex
//                                                    01.05.2007 – 07.05.2008
//~~~~~~~~~~~~~~~~~~
// Скрипт удаляет жирный и основной курсив из подзаголовков.
//обрабатывать ли history
//обрабатывать ли annotation
// var alter = confirm("Подзаголовки цитат и стихов тоже чистим?");
//~~~~~~~~~~ Регулярные выражения ~~~~~~~~~~~~
import { parseInline, serializeInline } from './lib/legacy-html.js';

const VersionNumber = '1.0';

//обрабатывать ли history
const ObrabotkaHistory = true;
//обрабатывать ли annotation
const ObrabotkaAnnotation = true;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// удаление жирного из подзаголовков:
const re111 = new RegExp('</?(STRONG)>', 'gi');
const re111_ = '';
// удаление основного курсива из подзаголовков:
const re112 = new RegExp('^<EM>([^>]+?)</EM>$', 'gi');
const re112_ = '$1';

/** The original's HandleP for a subtitle's innerHTML. */
function handleP(html, counters) {
  let s = html;
  if (s.search(re111) !== -1) {
    s = s.replace(re111, re111_);
    counters.count_111 += 1;
  }
  if (s.search(re112) !== -1) {
    s = s.replace(re112, re112_);
    counters.count_112 += 1;
  }
  return s;
}

function subtitlesOf(node, out = []) {
  for (const child of node?.content ?? []) {
    if (child.type === 'text') continue;
    if (child.type === 'subtitle') out.push(child);
    else subtitlesOf(child, out);
  }
  return out;
}

/** The original's time string. */
function timeString(started, ru) {
  const ms = Date.now() - started;
  const Thour = Math.floor(ms / 3600000);
  const Tmin = Math.floor(ms / 60000 - Thour * 60);
  const Tsec = Math.ceil(ms / 1000 - Tmin * 60 - Thour * 3600);
  const Tsec1 = Math.ceil(10 * (ms / 1000 - Tmin * 60)) / 10;
  const Tsec2 = Math.ceil(100 * (ms / 1000 - Tmin * 60)) / 100;
  const Tsec3 = Math.ceil(1000 * (ms / 1000 - Tmin * 60)) / 1000;
  const sec = ru ? ' сек' : ' s';
  if (Tsec3 < 1 && Tmin < 1) return Tsec3 + sec;
  if (Tsec2 < 10 && Tmin < 1) return Tsec2 + sec;
  if (Tsec1 < 30 && Tmin < 1) return Tsec1 + sec;
  if (Tmin < 1) return Tsec + sec;
  if (Thour < 1) return ru ? `${Tmin} мин ${Tsec} с` : `${Tmin} min ${Tsec} s`;
  return ru ? `${Thour} ч ${Tmin} мин ${Tsec} с` : `${Thour} h ${Tmin} min ${Tsec} s`;
}

export default async function run(ctx) {
  const started = Date.now();
  const ru = ctx.uiLanguage === 'ru';
  const counters = { count_111: 0, count_112: 0 };
  const doc = await mfbe.doc.get();

  // The book's annotation and the document's history, as the original found them at the top.
  const description = doc.description;
  let descriptionChanged = false;
  const descriptionParts = [];
  if (ObrabotkaAnnotation) descriptionParts.push(description?.titleInfo?.annotation);
  if (ObrabotkaHistory) descriptionParts.push(description?.documentInfo?.history);
  for (const part of descriptionParts) {
    for (const node of subtitlesOf(part)) {
      const extras = [];
      const before = serializeInline(node.content ?? [], extras);
      const after = handleP(before, counters);
      if (after !== before) {
        node.content = parseInline(after, extras);
        descriptionChanged = true;
      }
    }
  }

  const subtitles = [];
  for (const body of doc.bodies ?? []) subtitlesOf(body, subtitles);
  for (let i = 0; i < subtitles.length; i += 1) {
    const node = subtitles[i];
    const extras = [];
    const before = serializeInline(node.content ?? [], extras);
    const after = handleP(before, counters);
    if (after !== before) {
      await mfbe.doc.replaceNode(node.attrs.nodeId, { type: 'subtitle', attrs: { ...node.attrs }, content: parseInline(after, extras) });
    }
    if (i % 200 === 199) {
      await mfbe.ui.progress(i + 1, subtitles.length);
      if (ctx.cancelled) return;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);

  // вывод статистики, если она, конечно, есть
  let st2 = '';
  if (counters.count_111 !== 0 || counters.count_112 !== 0) st2 += t(ctx, '\n Статистика', '\n Statistics');
  if (counters.count_111 !== 0) st2 += t(ctx, `\n• обработано жирных подзаголовков:              \t${counters.count_111}`, `\n• bold subtitles processed:              \t${counters.count_111}`);
  if (counters.count_112 !== 0) st2 += t(ctx, `\n• обработано курсивных подзаголовков:        \t${counters.count_112}`, `\n• italic subtitles processed:        \t${counters.count_112}`);
  if (st2 !== '') st2 = `\n${st2}`;
  await mfbe.ui.message(
    t(
      ctx,
      `                  –= Jurgen Script =– \n "Удаление жирности и курсива в подзаголовках" v.${VersionNumber} stokber Edition 2024       \n\n Время: ${timeString(started, ru)}.${st2}`,
      `                  –= Jurgen Script =– \n "Remove bold and italics in subtitles" v.${VersionNumber} stokber Edition 2024       \n\n Time: ${timeString(started, ru)}.${st2}`,
    ),
  );
}
