// Engine of the two "Привести заголовки ... к виду ... I" scripts (40 "частей ... 'Часть I'" and
// 50 "разделов-'книг' ... 'Книга I'" of FictionBook Editor 2.7.9, group 13). Each package carries
// its own copy (a script may only import files of its own package); the copies are identical. The
// originals' HandleP functions are identical apart from the keyword; each package passes its own
// original's regular expressions, as written, and the keyword.
//
// What the originals did: every paragraph of a section title (not the body's title, not the
// titles of poems and stanzas; the notes and comments bodies and the book's annotation and
// history are left alone) that reads "<Слово> 3", "<Слово> третья", "<Слово> 3. Название",
// "<Слово> третья: Название" or "Третья <слово>" is rewritten as "<Слово> III" or "<Слово> III.
// Название"; the run counts the paragraphs changed. They rewrote the paragraph's HTML, counting
// the characters outside the tags (removeSymbolsBeyondTags); the port runs that on the legacy
// inline-HTML notation of lib/legacy-html.js, so the inline formatting survives.

import { parseInline, serializeInline } from './lib/legacy-html.js';
import { ordinalNumber, toRoman } from './numerals.js';

const usualNbspChar = String.fromCharCode(160);

/** Table a3: "1".."1000" (no leading zeros) -> the Roman numeral. */
function a3(key) {
  return /^[1-9]\d{0,3}$/.test(key) ? toRoman(Number(key)) : undefined;
}

/** Table a4: the ordinal phrase -> the Roman numeral. */
function a4(key) {
  const n = ordinalNumber(key);
  return n === undefined ? undefined : toRoman(n);
}

/**
 * The originals' removeSymbolsBeyondTags: the characters outside the tags, counted from 1, at
 * positions beginIndex .. beginIndex + howManySymbolsToRemove - 1 are removed and substrToInsert
 * is written where the first of them was; the tags stay. The callers pass a 0-based search
 * result as beginIndex, which removes one character less (the following space stays).
 */
export function removeSymbolsBeyondTags(str, beginIndex, howManySymbolsToRemove, substrToInsert) {
  let i = 0;
  let removedSymbolsCnt = 0;
  let insideTag = false;
  const len = str.length;
  let symbolBeyondTagsCnt = 0;
  let str2 = '';
  let ch;
  while (i < len) {
    ch = str.charAt(i);
    if (ch === '<') {
      insideTag = true;
      str2 += ch;
    }
    if (!insideTag && ch !== '<' && ch !== '>') {
      symbolBeyondTagsCnt += 1;
      if (symbolBeyondTagsCnt < beginIndex || symbolBeyondTagsCnt + 1 > beginIndex + howManySymbolsToRemove) str2 += ch;
      else {
        if (removedSymbolsCnt === 0) str2 += substrToInsert;
        removedSymbolsCnt += 1;
      }
    }
    if (insideTag && ch !== '<' && ch !== '>') str2 += ch;
    if (ch === '>') {
      insideTag = false;
      str2 += ch;
    }
    i += 1;
  }
  return str2;
}

/**
 * The originals' HandleP for one paragraph of a section title: `s` is its text (innerText),
 * `innerHTML` its legacy HTML, `re` the original's expressions, `word` "Часть" or "Книга".
 * Returns the new HTML when the original assigned one (and counted the paragraph), else null.
 * The branches, their order and their tests are the original's, including the `if` without
 * braces in front of the first one (it guards only the next assignment; the outcome is the same).
 */
export function handleP(s, innerHTML, re, word) {
  let searchRslt;
  let matches;
  let replaceStr;
  let nReplace;
  let s2;
  const html = () => innerHTML.replace(/&nbsp;/g, usualNbspChar);
  const out = (newHtml) => newHtml.replace(/\xA0/g, usualNbspChar);
  const key = (m) => m.toLowerCase().replace(/ё/gi, 'е').replace(re.re100, '').replace(re.re101, ' ').replace(re.re102, '');

  searchRslt = s.search(re.re4);
  // Поиск заголовков вида "<Слово> 30"
  if (searchRslt !== -1) searchRslt = s.search(re.re5);
  if (searchRslt !== -1) {
    matches = s.match(re.re5);
    replaceStr = a3(matches[0].toUpperCase());
    if (replaceStr) return out(removeSymbolsBeyondTags(html(), 1, s.length, `${word} ${replaceStr}`));
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re.re6);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "<Слово> тридцатая"
    searchRslt = s.replace(/ё/gi, 'е').search(re.re7);
    if (searchRslt !== -1) {
      matches = s.replace(/ё/gi, 'е').match(re.re7);
      if (matches) {
        replaceStr = a4(key(matches[0]));
        if (replaceStr) return out(removeSymbolsBeyondTags(html(), 1, s.length, `${word} ${replaceStr}`));
      }
    }
  }
  searchRslt = s.search(re.re11);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "<Слово> 30. <...>" и "<Слово> 30: <...>"
    matches = s.match(re.re12);
    if (matches) {
      nReplace = matches[0].length;
      s2 = matches[0].replace(/[^:.]+/g, '');
      matches = matches[0].match(re.re13);
      replaceStr = a3(matches[0].toUpperCase());
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), searchRslt, nReplace, `${word} ${replaceStr}${s2}`));
    }
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re.re14);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "<Слово> тридцатая. <...>" и "<Слово> тридцатая: <...>"
    matches = s.replace(/ё/gi, 'е').match(re.re15);
    if (matches) {
      nReplace = matches[0].length;
      s2 = matches[0].replace(/[^:.]+/g, '');
      matches = matches[0].match(re.re16);
      replaceStr = a4(key(matches[0]));
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), searchRslt, nReplace, `${word} ${replaceStr}${s2}`));
    }
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re.re20);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Тридцатая <слово>"
    matches = s.replace(/ё/gi, 'е').match(re.re22);
    if (matches) {
      replaceStr = a4(key(matches[0].match(re.re22)[0]));
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), 1, s.length, `${word} ${replaceStr}`));
    }
  }
  return null;
}

/** The paragraphs HandleP worked on: those of section titles, in document order. */
function titleParagraphs(doc) {
  const out = [];
  const visit = (node) => {
    for (const child of node.content ?? []) {
      if (child.type !== 'section') continue;
      for (const part of child.content ?? []) {
        if (part.type !== 'title') continue;
        for (const p of part.content ?? []) if (p.type === 'p') out.push(p);
      }
      visit(child);
    }
  };
  for (const body of doc.bodies ?? []) {
    const name = body.attrs?.name;
    if (name === 'notes' || name === 'comments') continue;
    visit(body);
  }
  return out;
}

/** The originals' time string. */
export function timeString(started, ru) {
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

/** Runs HandleP over the book and returns the number of paragraphs changed. */
export async function normaliseTitles(ctx, re, word) {
  const paragraphs = titleParagraphs(await mfbe.doc.get());
  let count = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i];
    const text = (p.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
    const extras = [];
    const newHtml = handleP(text, serializeInline(p.content, extras), re, word);
    if (newHtml !== null) {
      count += 1;
      const content = parseInline(newHtml, extras);
      if (serializeInline(content, []) !== serializeInline(p.content, [])) {
        await mfbe.doc.replaceNode(p.attrs.nodeId, { type: 'p', attrs: { ...p.attrs }, content });
      }
    }
    if (i % 50 === 49) {
      await mfbe.ui.progress(i + 1, paragraphs.length);
      if (ctx.cancelled) return null;
    }
  }
  return count;
}
