// Converted from FictionBook Editor 2.7.9: Scripts/21_Поиск и замена/70_Проставить ударения над буквами, выделенными жирностью, курсивом либо регистром.js
// Puts stress marks (U+0301) over vowels, in one of two modes asked for at the start:
// - OK: a single vowel in italics, bold or bold italics inside a word ("пап<i>а</i>") becomes the
//   vowel with a stress mark, without that formatting; a vowel formatted by itself between
//   words (the conjunction "и" in bold) is left as it is;
// - Cancel, then OK: an upper-case vowel after a lower-case letter, or after a single upper-case
//   letter at the start of a word ("молОко", "НАчало"), becomes the lower-case vowel with a stress
//   mark.
// The book's annotation and the document's history are processed too, as the original's settings
// had it. Reports the number of letters with a stress mark it added. Every paragraph is edited in
// the original's HTML notation (lib/legacy-html.js) so that its expressions apply as written.
// The expressions' \s is JScript's [ \f\n\r\t\v] (not the other Unicode spaces of JavaScript).
// The original's notice, kept as written (FR-029):
//======================================
//            Скрипт «Проставить ударения над буквами, выделенными жирностью, курсивом или регистром» v.1.1 (08.07.2024)
//            Создан на базе скрипта «Генеральная уборка» (автор скрипта - jurgennt)
//                                             Engine by ©Sclex
//                                                    01.05.2007 – 07.05.2008
//                                             (доработка до заявленного функционала - stokber, апрель 2024)
// Скрипт ищет одиночные гласные буквы размеченные курсивом или жирным шрифтом и заменяет их на у́да́рны́е́ гла́сны́е́. Во втором режиме ищет ПРОПИСНЫЕ гласные в середине слова и тоже меняет на у́да́рны́е́ гла́сны́е́.
//~~~~~~~~~~~~~~~~~~
import { collectTextBlocks, parseInline, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';

const VersionNumber = '1.1';

//обрабатывать ли history
const ObrabotkaHistory = true;
//обрабатывать ли annotation
const ObrabotkaAnnotation = true;

const sIB = '<EM><STRONG>|<STRONG><EM>|<EM>|<STRONG>';
const fIB = '</EM></STRONG>|</STRONG></EM>|</EM>|</STRONG>';
const aIB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>|</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';
// The editor keeps U+00A0 itself and writes it as &nbsp; in the HTML notation.
const nbspEntity = '&nbsp;';
// "\\\s" of the original: JScript's \s.
const S = '[ \\f\\n\\r\\t\\v]';
const znPrepin = '[-—–.*,;:?!…«»“”„()  \'"]';

const ACUTE = '́';
const letters = new Map(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я', 'А', 'Е', 'Ё', 'И', 'О', 'У', 'Ы', 'Э', 'Ю', 'Я'].map((v) => [v, v + ACUTE]));

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function tagCase(s) {
  for (const [key, accent] of letters) {
    const re101 = new RegExp(`<EM><STRONG>${key}</STRONG></EM>`, 'g');
    const re102 = new RegExp(`<STRONG><EM>${key}</EM></STRONG>`, 'g');
    const re103 = new RegExp(`<(STRONG|EM)>(${znPrepin}*)${key}(${znPrepin}*)</\\1>`, 'g');
    const re103a = new RegExp(`([а-яё])(${sIB})${key}(${znPrepin}+)`, 'g');
    const re104 = new RegExp(`(${sIB})${key}(${S}|${nbspEntity})(${fIB})`, 'g');
    const re105 = new RegExp(`(${sIB})(${S}|${nbspEntity})${key}(${fIB})`, 'g');
    if (s.search(re101) !== -1) s = s.replace(re101, accent);
    if (s.search(re102) !== -1) s = s.replace(re102, accent);
    if (s.search(re103) !== -1) s = s.replace(re103, `$2${accent}$3`);
    if (s.search(re103a) !== -1) s = s.replace(re103a, `$1${accent}$3$2`);
    if (s.search(re104) !== -1) s = s.replace(re104, `${accent}$2$1$3`);
    if (s.search(re105) !== -1) s = s.replace(re105, `$1$2${accent}`);
  }
  return s;
}

// The original's re110 ... re119a, in its order (Е and А test [^а-яё] before the capital, the
// other vowels [^а-яёА-ЯЁ]).
const UP_CASE = [];
for (const [vowel, small, wide] of [
  ['А', 'а', false], ['Е', 'е', false], ['Ё', 'ё', true], ['И', 'и', true], ['О', 'о', true],
  ['У', 'у', true], ['Ы', 'ы', true], ['Э', 'э', true], ['Ю', 'ю', true], ['Я', 'я', true],
]) {
  UP_CASE.push([new RegExp(`([а-яё])${vowel}`, 'g'), `$1${small}${ACUTE}`]);
  UP_CASE.push([new RegExp(`((^|[^а-яё${wide ? 'А-ЯЁ' : ''}])[А-ЯЁ])${vowel}`, 'g'), `$1${small}${ACUTE}`]);
}

function upCase(s) {
  for (const [re, repl] of UP_CASE) if (s.search(re) !== -1) s = s.replace(re, repl);
  return s;
}

const key1 = '[аеёиоуыэюяАЕЁИОУЫЭЮЯ]';
// двойное форматирование вокруг конструкций типа "слов<EM>о о</EM>лово":
const re1 = new RegExp(`(<EM><STRONG>)(.+?)(${S}|${nbspEntity})(${key1})(</STRONG></EM>)`, 'g');
const re2 = new RegExp(`(<STRONG><EM>)(.+?)(${S}|${nbspEntity})(${key1})(</EM></STRONG>)`, 'g');
const re3 = new RegExp(`(<EM><STRONG>)(${key1})(${S}|${nbspEntity})(.*?)(</STRONG></EM>)`, 'g');
const re4 = new RegExp(`(<STRONG><EM>)(${key1})(${S}|${nbspEntity})(.*?)(</EM></STRONG>)`, 'g');
const re5 = new RegExp(`(<EM>)(${key1})(${S}|${nbspEntity})(.+?)(</EM>)`, 'g');
const re6 = new RegExp(`(<STRONG>)(${key1})(${S}|${nbspEntity})(.+?)(</STRONG>)`, 'g');
const re7 = new RegExp(`(<EM>)(.+?)(${S}|${nbspEntity})(${key1})(</EM>)`, 'g');
const re8 = new RegExp(`(<STRONG>)(.+?)(${S}|${nbspEntity})(${key1})(</STRONG>)`, 'g');
const split_ = '$1$2$5$3$1$4$5';
// убираем форматирование пробелов вокруг одиночной буквы:
const re9 = new RegExp(`(${sIB})(${S}|${nbspEntity})?(${key1})(${S}|${nbspEntity})(${aIB})`, 'g');
const re10 = new RegExp(`(${aIB})(${key1})?(${S}|${nbspEntity})(${key1})(${aIB})`, 'g');
// помечаем отдельно стоящие курсивно-жирные гласные буквы:
const re100s = new RegExp(`(^|[^а-яА-ЯёЁ>])(${sIB})(${S}|${nbspEntity})?(${key1})(${S}|${nbspEntity})?(${fIB})(?![<а-яА-ЯёЁ])`, 'g');
// удаляем метки:
const re100e = /<\/?b>/g;
const STRESSED = /(а́|е́|ё́|и́|о́|у́|ы́|э́|ю́|я́|А́|Е́|И́|О́|У́|Ы́|Э́|Ю́|Я́|ё́|Ё́)/g;

function handle(s, fontTag, fontUp) {
  if (fontTag) {
    for (const re of [re1, re2, re3, re4, re5, re6, re7, re8]) if (s.search(re) !== -1) s = s.replace(re, split_);
    if (s.search(re9) !== -1) s = s.replace(re9, '$2$1$3$5$4');
    if (s.search(re10) !== -1) s = s.replace(re10, split_);
    if (s.search(re100s) !== -1) s = s.replace(re100s, '$1$2$3<b>$4</b>$5$6'); // помечаем.
    s = tagCase(s);
    if (s.search(re100e) !== -1) s = s.replace(re100e, ''); // удаляем метки.
  }
  if (fontUp) s = upCase(s);
  return s;
}

/** Text blocks of the description's annotation and history (FictionBook Editor showed them in the body view). */
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
  if (ObrabotkaAnnotation) visit(description?.titleInfo?.annotation);
  if (ObrabotkaHistory) visit(description?.documentInfo?.history);
  return out;
}

const innerTextOf = (node) => (node.content ?? []).map((item) => (item.type === 'text' ? item.text ?? '' : '')).join('');

/** The original's time string ("0,123 сек", "1 мин 5 с"...). */
function timeString(ctx, ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor(ms / 60000 - hours * 60);
  const sec = Math.ceil(ms / 1000 - minutes * 60 - hours * 3600);
  const sec1 = Math.ceil(10 * (ms / 1000 - minutes * 60)) / 10;
  const sec2 = Math.ceil(100 * (ms / 1000 - minutes * 60)) / 100;
  const sec3 = Math.ceil(1000 * (ms / 1000 - minutes * 60)) / 1000;
  const [s, m, h] = ctx.uiLanguage === 'ru' ? ['сек', 'мин', 'ч'] : ['s', 'min', 'h'];
  const short = ctx.uiLanguage === 'ru' ? 'с' : 's';
  if (sec3 < 1 && minutes < 1) return `${sec3} ${s}`;
  if (sec2 < 10 && minutes < 1) return `${sec2} ${s}`;
  if (sec1 < 30 && minutes < 1) return `${sec1} ${s}`;
  if (minutes < 1) return `${sec} ${s}`;
  if (hours < 1) return `${minutes} ${m} ${sec} ${short}`;
  return `${hours} ${h} ${minutes} ${m} ${sec} ${short}`;
}

export default async function run(ctx) {
  const started = Date.now();
  const fontTag =
    (await MsgBox(
      t(
        ctx,
        'Вы хотите заменить отдельные гласные курсивные или жирные буквы на буквы с ударением?\nЕсли требуется  заменить ПРОПИСНЫЕ гласные буквы среди строчных на буквы с ударением, то нажмите Отмена.',
        'Do you want to replace single vowels in italics or bold with stressed vowels?\nTo replace UPPER-CASE vowels among lower-case letters with stressed vowels instead, press Cancel.',
      ),
      ctx.script.name,
      1,
    )) === 1;
  let fontUp = false;
  if (!fontTag) {
    fontUp =
      (await MsgBox(
        t(ctx, 'Вы хотите заменить ПРОПИСНЫЕ гласные буквы среди строчных на буквы с ударением?', 'Do you want to replace UPPER-CASE vowels among lower-case letters with stressed vowels?'),
        ctx.script.name,
        1,
      )) === 1;
    if (!fontUp) {
      await MsgBox(t(ctx, 'Вы ничего не выбрали!', 'You have chosen nothing!'), ctx.script.name);
      return;
    }
  }

  const snapshot = await mfbe.doc.get();
  const description = snapshot.description;
  const descBlocks = descriptionBlocks(description);
  const blocks = collectTextBlocks(snapshot);
  const text = () => [...descBlocks.map(innerTextOf), ...blocks.map((b) => innerTextOf(b.node))].join('\n');
  const countStart = (text().match(STRESSED) || []).length; // было букв с ударением.

  let descriptionChanged = false;
  for (const node of descBlocks) {
    const extras = [];
    const before = serializeInline(node.content, extras);
    const after = handle(before, fontTag, fontUp);
    if (after !== before) {
      node.content = parseInline(after, extras);
      descriptionChanged = true;
    }
  }
  if (descriptionChanged) await mfbe.doc.setDescription(description);
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    const extras = [];
    const before = serializeInline(block.node.content, extras);
    const after = handle(before, fontTag, fontUp);
    if (after !== before) {
      const node = { type: block.node.type, attrs: { ...block.node.attrs }, content: parseInline(after, extras) };
      await mfbe.doc.replaceNode(block.ref, node);
      block.node = node;
    }
    if (i % 100 === 0) await mfbe.ui.progress(i, blocks.length, ctx.script.name);
    if (ctx.cancelled) return;
  }

  const countEnd = (text().match(STRESSED) || []).length;
  const countReplace = countEnd - countStart; // заменено букв.
  const time = timeString(ctx, Date.now() - started);
  await MsgBox(
    t(
      ctx,
      `                  –= Jurgen Script =– \n «Проставить ударения над буквами, выделенными жирностью, курсивом или регистром» v.${VersionNumber} stokber Edition       \n\nЗаменено букв: ${countReplace}.\n\n Время: ${time}.`,
      `                  –= Jurgen Script =– \n "Put stress marks over letters marked by bold, italics or case" v.${VersionNumber} stokber Edition       \n\nLetters replaced: ${countReplace}.\n\n Time: ${time}.`,
    ),
    ctx.script.name,
  );
}
