// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/30_Привести заголовки глав к виду 'Глава 1'.js
// Brings chapter titles to the form "Глава 1". Every paragraph of a section title (not the body's
// title, not the titles of poems and stanzas; the notes and comments bodies are left alone) that
// reads "XII", "12", "Глава XII", "Глава двенадцатая", "XII. Название", "Глава XII. Название",
// "Глава двенадцатая. Название", "12. Название", "Двенадцатая глава", "Двенадцатая глава.
// Название", "глава 12" or "Глава 12. Название" becomes "Глава 12" or "Глава 12. Название"; a
// message gives the number of titles changed. The original rewrote the paragraph's HTML, counting
// the characters outside the tags; the port runs its expressions and that counting unchanged on
// the legacy inline-HTML notation of lib/legacy-html.js, so the inline formatting survives and
// the original's behaviour is kept, odd cases included (docs/scripting/notes-279-drafts/13.md).
// Difference from the original (a fix): where the replaced part reaches the end of the title, the
// space the replacement ends with is not added ("Четырнадцатая глава" becomes "Глава 14", where
// 2.7.9 wrote "Глава 14 ").
// The original's notice, kept as written (FR-029):
// Скрипт "Приведение заголовков к виду "Глава 1"
// Автор Sclex
//обрабатывать ли history
//обрабатывать ли annotation
import { parseInline, serializeInline } from './lib/legacy-html.js';
import { ordinalNumber, romanNumber } from './numerals.js';

const VERSION_NUMBER = '2.1';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// FictionBook Editor showed the non-breaking space as a configurable character (GetNBSP); the
// document model holds the real U+00A0.
const nbspChar = ' ';
const usualNbspChar = String.fromCharCode(160);

// The original's regular expressions, as written.
const re0=new RegExp("^[ "+nbspChar+"]*[IVXLCDM]+[ "+nbspChar+"]*$","i");
const re1=new RegExp("[IVXLCDM]+","i");
  
const re2=new RegExp("^[ "+nbspChar+"]*\\d+[.]?[ "+nbspChar+"]*$");
const re3=new RegExp("\\d+");
  
const re4=new RegExp("^[ "+nbspChar+"]*Глава[ "+nbspChar+"]+[IVXLCDM]+[ "+nbspChar+"]*$","i");
const re5=new RegExp("[IVXLCDM]+","i");
  
const re6=new RegExp("^( |"+nbspChar+")*Глава"+
                      "(( |"+nbspChar+")+(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая"+
                                          "|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|"+
                                          "семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|"+
                                          "сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|"+
                                          "восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|"+
                                          "триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|"+
                                          "восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+"+
                      "[.:]?( |"+nbspChar+")*$","i");
const re7=new RegExp("(( |"+nbspChar+")+(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+","i");
  
const re8=new RegExp("^[ "+nbspChar+"]*[IVXLCDM]+\\.[ "+nbspChar+"].*$","i");
const re9=new RegExp("^[ "+nbspChar+"]*[IVXLCDM]+\\.[ "+nbspChar+"]+","i");
const re10=new RegExp("[IVXLCDM]+","i");
  
const re11=new RegExp("[ "+nbspChar+"]*Глава[ "+nbspChar+"]+[IVXLCDM]+\\.?[ "+nbspChar+"].*$","i");
const re12=new RegExp("[ "+nbspChar+"]*Глава[ "+nbspChar+"]+[IVXLCDM]+\\.?[ "+nbspChar+"]+","i");
const re13=new RegExp("[IVXLCDM]+","i");
  
const re14=new RegExp("^( |"+nbspChar+")*Глава"+
                      "(( |"+nbspChar+")+(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая"+
                                          "|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|"+
                                          "семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|"+
                                          "сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|"+
                                          "восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|"+
                                          "триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|"+
                                          "восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+[.:,]?.*$"+
                      "[ "+nbspChar+"]*$","i");
const re15=new RegExp("^( |"+nbspChar+")*Глава"+
                       "([ "+nbspChar+"]+(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+[.:,]?[ "+nbspChar+"]*","i");
const re16=new RegExp("([ "+nbspChar+"]+(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+","i");
 
const re17=new RegExp("^( |"+nbspChar+")*\\d+\\.[ "+nbspChar+"].*$");
const re18=new RegExp("^( |"+nbspChar+")*\\d+\\.[ "+nbspChar+"]+");
const re19=new RegExp("\\d+");
  
const re20=new RegExp("^([ "+nbspChar+"]*(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая"+
                                          "|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|"+
                                          "семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|"+
                                          "сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|"+
                                          "восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|"+
                                          "триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|"+
                                          "восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+[ "+nbspChar+"]+глава$"+
                      "[ "+nbspChar+"]*$","i");
const re21=new RegExp("([ "+nbspChar+"]*(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+[ "+nbspChar+"]+глава","i");
const re22=new RegExp("([ "+nbspChar+"]*(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+","i");
const re24=new RegExp("^[ "+nbspChar+"]*Глава[ "+nbspChar+"]+\\d+[ "+nbspChar+"]*$","i");
const re25=new RegExp("\\d+","i");  
  
const re31=new RegExp("[ "+nbspChar+"]*Глава[ "+nbspChar+"]+\\d+[.:]?[ "+nbspChar+"].*$","i");
const re32=new RegExp("[ "+nbspChar+"]*Глава[ "+nbspChar+"]+\\d+[.:]?[ "+nbspChar+"]+","i");
const re33=new RegExp("\\d+","i");
  
const re44=new RegExp("( |"+nbspChar+")*((первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая"+
                      "|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|"+
                      "семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|"+
                      "сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|"+
                      "восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|"+
                      "триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|"+
                      "восьмисотая|восемьсот|девятисотая|девятьсот|тысячная)( |"+nbspChar+")+)+"+
                      "глава[.:,]?.*( |"+nbspChar+")*$","i");
const re45=new RegExp("( |"+nbspChar+")*((первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная)( |"+nbspChar+")+)+"+
                      "глава"+
                      "[.:,]?[ "+nbspChar+"]*","i");
const re46=new RegExp("([ "+nbspChar+"]*(первая|вторая|третья|четвертая|пятая|шестая|седьмая|восьмая|девятая|десятая|одиннадцатая|двенадцатая|тринадцатая|четырнадцатая|пятнадцатая|шестнадцатая|семнадцатая|восемнадцатая|девятнадцатая|двадцатая|двадцать|тридцатая|тридцать|сороковая|сорок|пятидесятая|пятьдесят|шестидесятая|шестьдесят|семидесятая|семьдесят|восьмидесятая|восемьдесят|девяностая|девяносто|сотая|сто|двухсотая|двести|трехсотая|триста|четырехсотая|четыреста|пятисотая|пятьсот|шестисотая|шестьсот|семисотая|семьсот|восьмисотая|восемьсот|девятисотая|девятьсот|тысячная))+","i");
  
const re100=new RegExp("^( |"+nbspChar+")+");
const re101=new RegExp("( |"+nbspChar+"){2,}","g");
const re102=new RegExp("( |"+nbspChar+")+$");

// The original's tables a1 (Roman -> Arabic) and a2 (ordinal words -> Arabic), see numerals.js.
const a1 = (key) => {
  const n = romanNumber(key);
  return n === undefined ? undefined : String(n);
};
const a2 = (key) => {
  const n = ordinalNumber(key);
  return n === undefined ? undefined : String(n);
};

/**
 * The original's removeSymbolsBeyondTags: the characters outside the tags, counted from 1, at
 * positions beginIndex .. beginIndex + howManySymbolsToRemove - 1 are removed and substrToInsert
 * is written where the first of them was (the tags stay). A begin index of 0 (the callers pass
 * a 0-based search result) therefore removes one character less, which the original's
 * replacement strings take into account. `dropEndSpace` (fix F1): when the removal reaches the
 * last character, the space the replacement ends with is not written.
 */
function removeSymbolsBeyondTags(str, beginIndex, howManySymbolsToRemove, substrToInsert, dropEndSpace) {
  let insert = substrToInsert;
  if (dropEndSpace) {
    let total = 0;
    let inside = false;
    for (let j = 0; j < str.length; j += 1) {
      const c = str.charAt(j);
      if (c === '<') inside = true;
      if (!inside && c !== '<' && c !== '>') total += 1;
      if (c === '>') inside = false;
    }
    if (beginIndex + howManySymbolsToRemove - 1 >= total) insert = insert.replace(/ +$/, '');
  }
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
        if (removedSymbolsCnt === 0) str2 += insert;
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
 * The original's HandleP for one paragraph of a section title: `s` is its text (innerText),
 * `innerHTML` its legacy HTML. Returns { html, counted } when the original assigned a new
 * innerHTML, or null. The branches, their order and their tests are the original's, including
 * the two `if` statements without braces (they guard only the next assignment, which leaves the
 * outcome unchanged) and the counting of the "Глава 30" branches, which compares text with HTML.
 */
function handleP(s, innerHTML) {
  let searchRslt;
  let matches;
  let replaceStr;
  let nReplace;
  let s2;
  const html = () => innerHTML.replace(/&nbsp;/g, usualNbspChar);
  const out = (newHtml, counted) => ({ html: newHtml.replace(/\xA0/g, usualNbspChar), counted });
  const key = (m) => m.toLowerCase().replace(/ё/gi, 'е').replace(re100, '').replace(re101, ' ').replace(re102, '');

  searchRslt = s.search(re0);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "XXX"
    searchRslt = s.search(re1);
    matches = s.match(re1);
    replaceStr = a1(matches[0].toUpperCase());
    if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), 1, s.length, `Глава ${replaceStr}`), true);
  }
  searchRslt = s.search(re2);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "30" и "30."
    searchRslt = s.search(re3);
    matches = s.match(re3);
    if (matches) return out(removeSymbolsBeyondTags(html(), 1, s.length, `Глава ${matches[0]}`), true);
  }
  searchRslt = s.search(re4);
  // Поиск заголовков вида "Глава XXX"
  if (searchRslt !== -1) searchRslt = s.search(re5);
  if (searchRslt !== -1) {
    matches = s.match(re5);
    replaceStr = a1(matches[0].toUpperCase());
    if (replaceStr) return out(removeSymbolsBeyondTags(html(), 1, s.length, `Глава ${replaceStr}`), true);
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re6);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Глава тридцатая"
    searchRslt = s.replace(/ё/gi, 'е').search(re7);
    if (searchRslt !== -1) {
      matches = s.replace(/ё/gi, 'е').match(re7);
      if (matches) {
        replaceStr = a2(key(matches[0]));
        if (replaceStr) return out(removeSymbolsBeyondTags(html(), 1, s.length, `Глава ${replaceStr}`), true);
      }
    }
  }
  searchRslt = s.search(re8);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "XXX. <...>"
    matches = s.match(re9);
    if (matches) {
      nReplace = matches[0].length;
      matches = matches[0].match(re10);
      replaceStr = a1(matches[0].toUpperCase());
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), 1, nReplace, `Глава ${replaceStr}. `, true), true);
    }
  }
  searchRslt = s.search(re11);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Глава XXX. <...>"
    matches = s.match(re12);
    if (matches) {
      nReplace = matches[0].length;
      matches = matches[0].match(re13);
      replaceStr = a1(matches[0].toUpperCase());
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), searchRslt, nReplace, `Глава ${replaceStr}.`), true);
    }
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re14);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Глава тридцатая. <...>"
    matches = s.replace(/ё/gi, 'е').match(re15);
    if (matches) {
      nReplace = matches[0].length + 1;
      s2 = matches[0].replace(/[^:.,]+/g, '');
      matches = matches[0].match(re16);
      replaceStr = a2(key(matches[0]));
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), searchRslt, nReplace, `Глава ${replaceStr}${s2} `, true), true);
    }
  }
  searchRslt = s.search(re17);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "30. <...>"
    matches = s.match(re18);
    if (matches) {
      nReplace = matches[0].length;
      matches = matches[0].match(re19);
      return out(removeSymbolsBeyondTags(html(), 1, nReplace, `Глава ${matches[0]}. `, true), true);
    }
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re20);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Тридцатая глава"
    matches = s.replace(/ё/gi, 'е').match(re21);
    if (matches) {
      nReplace = matches[0].length + 1;
      s2 = matches[0].replace(/[^:.,]+/g, '');
      matches = matches[0].match(re22);
      replaceStr = a2(key(matches[0]));
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), searchRslt, nReplace, `Глава ${replaceStr}${s2} `, true), true);
    }
  }
  searchRslt = s.replace(/ё/gi, 'е').search(re44);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Тридцатая глава. <...>" или "Тридцатая глава: <...>"
    matches = s.replace(/ё/gi, 'е').match(re45);
    if (matches) {
      nReplace = matches[0].length + 1;
      s2 = matches[0].replace(/[^:.]+/g, '');
      matches = matches[0].match(re46);
      replaceStr = a2(key(matches[0]));
      if (replaceStr !== undefined) return out(removeSymbolsBeyondTags(html(), searchRslt, nReplace, `Глава ${replaceStr}${s2} `, true), true);
    }
  }
  searchRslt = s.search(re24);
  // Поиск заголовков вида "Глава 30"
  if (searchRslt !== -1) searchRslt = s.search(re25);
  if (searchRslt !== -1) {
    matches = s.match(re25);
    if (matches) {
      const s3 = s.replace(/&nbsp;/g, usualNbspChar).replace(new RegExp(`${nbspChar}+`, 'g'), ' ').replace(/^ +/, '').replace(/ +$/, '');
      const newHTML = removeSymbolsBeyondTags(html(), 1, s.length, `Глава ${matches[0]}`).replace(/\xA0/g, usualNbspChar);
      return { html: newHTML, counted: s3 !== newHTML };
    }
  }
  searchRslt = s.search(re31);
  if (searchRslt !== -1) {
    // Поиск заголовков вида "Глава 30. <...>" и "Глава 30: <...>"
    matches = s.match(re32);
    if (matches) {
      nReplace = matches[0].length;
      s2 = matches[0].replace(/[^:.]+/g, '');
      matches = matches[0].match(re33);
      if (matches) {
        const s3 = s.replace(/&nbsp;/g, usualNbspChar).replace(new RegExp(`${nbspChar}+`, 'g'), ' ').replace(/^ +/, '').replace(/ +$/, '');
        const newHTML = removeSymbolsBeyondTags(html(), searchRslt, nReplace, `Глава ${matches[0]}${s2}`).replace(/\xA0/g, usualNbspChar);
        return { html: newHTML, counted: s3 !== newHTML.replace(new RegExp(`${nbspChar}+`, 'g'), ' ') };
      }
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

/** innerText of the paragraph: its text without the pictures. */
function innerText(p) {
  return (p.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
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
  const paragraphs = titleParagraphs(await mfbe.doc.get());
  let count = 0;
  for (let i = 0; i < paragraphs.length; i += 1) {
    const p = paragraphs[i];
    const extras = [];
    const before = serializeInline(p.content, extras);
    const result = handleP(innerText(p), before);
    if (result) {
      if (result.counted) count += 1;
      const content = parseInline(result.html, extras);
      if (serializeInline(content, []) !== serializeInline(p.content, [])) {
        await mfbe.doc.replaceNode(p.attrs.nodeId, { type: 'p', attrs: { ...p.attrs }, content });
      }
    }
    if (i % 50 === 49) {
      await mfbe.ui.progress(i + 1, paragraphs.length);
      if (ctx.cancelled) return;
    }
  }
  const ru = ctx.uiLanguage === 'ru';
  await mfbe.ui.message(
    t(
      ctx,
      `  –= Скрипт Sclex-а =– \n «Приведение заголовков к виду "Глава 1"» v${VERSION_NUMBER}  \t \n\n Произведено замен заголовков глав: ${count}\n\n Время: ${timeString(started, ru)}.\n`,
      `  –= A script by Sclex =– \n "Bring chapter titles to the form 'Глава 1'" v${VERSION_NUMBER}  \t \n\n Chapter titles replaced: ${count}\n\n Time: ${timeString(started, ru)}.\n`,
    ),
  );
}
