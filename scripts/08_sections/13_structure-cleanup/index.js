// Converted from FictionBook Editor 2.7.9: Scripts/08_Структура разделов/13_Почистить структуру.js
// «Чистка структуры» v.1.12 by Александр Ка: cleans the structure of the whole book - the book
// annotation, the history and every body - in numbered operations (see the result window and
// docs/scripting/notes-279-drafts/08.md): empty lines and lines of white space, subtitles made of
// symbols, pictures alone in a paragraph made block pictures, empty or doubled containers,
// redundant sections, the title of a lone section, pictures before subsections, the formatting
// of note and comment links; asks before merging several main bodies into one; shows the count of
// every operation. The original's code runs here on the emulation of its page (lib/fbe-dom.js),
// which is then written back as FictionBook Editor saved it (lib/fbe-dom.js, commitPage).
// Differences: the repairs of the page's HTML (100, 103, 150, 201/202, 211) find nothing in the
// editor's model, which cannot hold what they repaired; a section that would be left with its
// title and a picture only gets an <empty-line/> after the picture (FB2 requires a text block);
// the places of the questions are not shown (the book is written when the script ends); the
// automatic version raise and history entry (Version_on_off, off in the original) is not
// offered; the result message shows no proverb: left out pending the requester's decision.
// Fixes: a picture that is a link (a note marker, a hyperlink) is not taken out of its paragraph,
// as the settings say (the original's expression also removed the link); a picture inside a
// note or comment link is kept (a typo, mSUP for mSPAN, made the original remove it).
// The original's notice, kept as written (FR-029):
//======================================
//             «Чистка структуры»
// Скрипт тестировался в FBE v.2.7.6 (win XP, IE8 и win 7, IE9 и IE11)
// * История изменений в конце скрипта
//======================================
//--------------------------------------------------------------------
                 ///  НАСТРОЙКИ
//--------------------------------------------------------------------
//     Переоформление иллюстраций (Выведение картинки из пустого параграфа)
//     * Обрабатываются картинка выделенная курсивом, жирностью, зачеркиванием, верхним/нижним индексом. Кроме того, рядом с картинкой могут быть пробелы.
//     ** Все остальные случаи не обрабатываются. Например, когда в строке есть вторая картинка, текст, или если картинка служит сноской или ссылкой.
//     *** Кроме того, не обрабатывается параграф в заголовке, аннотации, истории, эпиграфе, в стихах, в цитате -- там возможна графика только внутри текста
//--------------------------------------------------------------------
//     Перемещать иллюстрации из "кармана" в отдельную секцию
//     <section> ... [иллюстрация] [внутренние секции] </section>   ›››   <section> ... [иллюстрация в отдельной секции] [внутренние секции] </section>
//     *  Под многоточием (...) может скрываться заголовок и/или эпиграфы
//     **  После перемещения, рядом с иллюстрацией создается ещё и новая пустая строка

import { FbePage, commitPage } from './lib/fbe-dom.js';
import { jscriptRegExp as jre } from './lib/jscript-regexp.js';
import { decodeEntities } from './lib/legacy-html.js';

/* ------------------------------------------------------------------------ */
/* Settings of the original, with its values                                */
/* ------------------------------------------------------------------------ */

const Obrabotka_Img_v_Texte_on_off = 1; // 0 ; 1 ; 2 // ("0" — никогда не переоформлять, "1" — всегда переоформлять, "2" — всегда спрашивать)
const Obrabotka_karm_Img = 1; // 0 ; 1 ; 2 // ("0" — никогда не перемещать, "1" — всегда перемещать, "2" — всегда спрашивать)
const Obrabotka_Entity_ttl = 1; // 0 ; 1 ; 2 // ("0" — никогда не удалять, "1" — всегда удалять, "2" — всегда спрашивать)
const Add_Entity_Img_Podpis = 0; // 0 ; 1 // ("0" — не изменять, "1" — всегда добавлять)
const Add_Entity_Img_Title = 0; // 0 ; 1
const Add_Entity_Img_Img = 0; // 0 ; 1

const ScriptName = '«Чистка структуры»';
const NumerusVersion = '1.12';

/** Russian in the Russian interface, English otherwise (FR-026 of feature 007). */
function tr(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** Declension of «исправлений»-like words: 0 for 1, 1 for 2-4, 2 otherwise (the original's pad()). */
function pad(n) {
  const m1 = n % 10;
  const m2 = n % 100;
  if (m2 < 11 || m2 > 19) {
    if (m1 === 1) return 0;
    if (m1 === 2 || m1 === 3 || m1 === 4) return 1;
  }
  return 2;
}

/** The original's time(): milliseconds as «1,234 сек» or «2 мин 5 с». */
function timeText(ctx, T) {
  const Tmin = Math.floor(T / 60000);
  const TsecD = (T % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  if (Tmin === 0) {
    const s = String(+String(TsecD).replace(/(.{1,5}).*/g, '$1'));
    return ctx.uiLanguage === 'ru' ? `${s.replace('.', ',')} сек` : `${s} s`;
  }
  let text = tr(ctx, `${Tmin} мин`, `${Tmin} min`);
  if (Tsec !== 0) text += tr(ctx, ` ${Tsec} с`, ` ${Tsec} s`);
  return text;
}

export default async function run(ctx) {
  const Ts = Date.now();
  let T_pause = 0;
  const pause = async (call) => {
    const started = Date.now();
    try {
      return await call();
    } finally {
      T_pause += Date.now() - started;
    }
  };
  const AskYesNo = (text) => pause(async () => (await MsgBox(text, ScriptName, 4 + 32)) === 6);

  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  const fbwBody = page.fbwBody;
  const document = { createElement: (name) => page.createElement(name) };

  //   Неразрывный пробел из настроек FBE (the editor's: U+00A0)
  const nbspEntity = '&nbsp;';
  const nbspChar = ' ';

  /* ------------------------------------------------ _1_ (100, 103): Восстановление параграфов */
  // Text and inline tags outside a <P>, or a <P> without its end tag: the editor's model holds
  // inline content only inside text blocks, so the page never has them.
  const count_100 = 0;
  const count_103 = 0;

  /* ------------------------------------------------ 150: разрыв секции перед заголовком */
  let count_150 = 0;
  {
    const mDiv = fbwBody.getElementsByTagName('DIV');
    for (let j = mDiv.length - 1; j >= 0; j--) {
      const div = mDiv[j];
      if (div.className == 'title' && div.parentNode && div.parentNode.className == 'section' && div.previousSibling != null) {
        const section_1 = div.parentNode;
        const section_2 = section_1.cloneNode(false);
        section_1.insertAdjacentElement('afterEnd', section_2);
        section_2.removeAttribute('id');
        while (section_1.lastChild.className != 'title') section_2.insertAdjacentElement('afterBegin', section_1.lastChild);
        section_2.insertAdjacentElement('afterBegin', section_1.lastChild);
        count_150++;
      }
    }
  }

  /* ------------------------------------------------ _2_: регулярные выражения */
  const re211 = jre('&nbsp;', 'g');
  const re211_ = nbspChar;
  let count_211 = 0;
  const re212 = jre('^(\\s|' + nbspChar + '|<[^>]{1,}>){1,}$', 'g');
  const re212ex = jre('<SPAN [^>]{0,}?class=image', 'g');
  let count_212 = 0;
  let count_213 = 0;
  let count_214 = 0;
  const re221 = jre('^(annotation|poem|cite|history|section)$', 'g');
  const re222 = jre('</{0,1}STRONG>|</{0,1}EM>|</{0,1}SUP>|</{0,1}SUB>|</{0,1}STRIKE>', 'g');
  const re223 = jre('^(\\s|' + nbspChar + '|<[^>]{1,}>){0,}((\\s|' + nbspChar + '){0,}⁂|((\\s|' + nbspChar + '){0,}•){1,9}|((\\s|' + nbspChar + '){0,}\\*){1,9}|((\\s|' + nbspChar + '){0,}\\+){1,9}|((\\s|' + nbspChar + '){0,}[-–—]){3,9}|((\\s|' + nbspChar + '){0,}~){3,9}|((\\s|' + nbspChar + '){0,}[хx]){3,9})(\\s|' + nbspChar + '|<[^>]{1,}>){0,}$', 'g');
  const re224 = jre('</{0,1}STRONG>|</{0,1}EM>', 'g');
  const re225 = jre('^(\\s|' + nbspChar + '|<[^>]{1,}>){0,}⁂(\\s|' + nbspChar + '|<[^>]{1,}>){0,}$', 'g');
  const re225_ = '<SUB>*</SUB><SUP>*</SUP><SUB>*</SUB>';
  const re226s = jre('^(<[^>]{1,}>){0,}(((\\s|' + nbspChar + '){0,}•){2,5}|((\\s|' + nbspChar + '){0,}\\*){2,5}|((\\s|' + nbspChar + '){0,}\\+){2,5})(\\s|' + nbspChar + '|<[^>]{1,}>){0,}$', 'g');
  const re226 = jre('([•\\*\\+])(\\s|' + nbspChar + '){0,}(?=[•\\*\\+])', 'g');
  const re226_ = '$1 ';
  let count_227 = 0;
  let count_228 = 0;
  const re231s = jre('<SPAN [^>]{0,}?class=image', 'g');
  const re231 = jre('^(&nbsp;|\\s|' + nbspChar + '|<[^>]{1,}>){0,}(<SPAN [^>]{0,}?class=image[^>]{0,}>)(<[^>]{1,}>){0,}(<IMG [^>]{1,}>)(&nbsp;|\\s|' + nbspChar + '|<[^>]{1,}>){0,}$', 'g');
  const re231_ = '$2$4</SPAN>';
  let count_231 = 0;
  let q_231 = false;
  let count_232 = 0;
  const re241 = jre('^(title|epigraph|annotation)$', 'g');
  let count_241 = 0;
  let count_251 = 0;
  const re252 = jre('^(title|epigraph|stanza|poem|cite)$', 'g');
  let count_252 = 0;
  let count_253 = 0;
  let count_262 = 0;
  let count_263 = 0;
  const re271 = jre('^(title|epigraph|image|annotation)$', 'g');
  let count_271 = 0;
  const re272 = jre('^(title|annotation|stanza|poem|epigraph|cite|subtitle|section)$', 'g');
  let count_272 = 0;
  let count_281 = 0;
  const re001 = jre('^<SPAN [^>]{0,}?class=image[^>]{0,}><IMG [^>]{1,}></SPAN>$', 'g');
  const m_001 = [];
  let count_001 = 0;
  const m_002 = [];
  let count_002 = 0;
  const m_003 = [];
  const reNBSPon = jre(nbspChar, 'g');
  const reNBSPon_ = '&nbsp;';
  // 201/202 (a tag inside the same tag): the editor keeps formatting as marks and merges nested
  // formatting of one kind when it reads a book, so the page never shows <EM>…<EM>…</EM>…</EM>.
  const count_201 = 0;
  const count_202 = 0;

  /** The picture of the paragraph is a link (a note marker or a hyperlink): the settings leave it. */
  const imageIsLinked = (ptr) => /<A\b[^>]*>(?:(?!<\/A>)[\s\S])*class=image/.test(ptr.innerHTML);

  function HandleP(ptr) {
    let s = ptr.innerHTML;

    // Коррекция неразрывных пробелов
    if (s.search(re211) != -1) {
      if (nbspEntity != '&nbsp;') count_211 += s.match(re211).length;
      s = s.replace(re211, re211_);
    }

    // Чистка пустых строк от пробелов и внутренних тегов
    if (s.search(re212) != -1 && s.search(re212ex) == -1) {
      s = '';
      count_212++;
    }

    // Снятие форматирования "подзаголовок" с пустой строки
    if (s == '' && ptr.className == 'subtitle') {
      ptr.insertAdjacentElement('afterEnd', document.createElement('P'));
      ptr = ptr.nextSibling;
      ptr.previousSibling.removeNode(true);
      count_213++;
    }

    // Снятие форматирования "автор текста" с пустой строки (если предыдущая строка без этого формата)
    if (s == '' && ptr.className == 'text-author' && (ptr.previousSibling == null || (ptr.previousSibling != null && ptr.previousSibling.className != 'text-author'))) {
      ptr.removeAttribute('className');
      count_214++;
    }

    // Добавление формата "подзаголовок" для строк из символов
    if (ptr.parentNode.className.search(re221) != -1) {
      let sct = s.search(re222) != -1 ? s.replace(re222, '') : s;
      if (sct.search(re223) != -1) {
        sct = s;
        if (sct.search(re224) != -1) sct = sct.replace(re224, '');
        if (sct.search(re225) != -1) sct = sct.replace(re225, re225_);
        if (sct.search(re226s) != -1) sct = sct.replace(re226, re226_);
        if (sct.search('х') != -1) sct = sct.replace(/х/g, 'x');
        if (ptr.className != 'subtitle') {
          ptr.className = 'subtitle';
          count_227++;
          if (ptr.previousSibling != null && ptr.previousSibling.innerHTML == '' &&
              (ptr.previousSibling.previousSibling == null || ptr.previousSibling.previousSibling.className != 'image')) {
            ptr.previousSibling.removeNode(true);
            count_272++;
          }
        }
        if (s != sct) {
          s = sct;
          count_228++;
        }
      }
    }

    // Внутренняя чистка графики в пустом параграфе (fix: a picture that is a link is left as it is)
    if (s.search(re231s) != -1 && s.match(re231s).length == 1 && s.search(re231) != -1 && !imageIsLinked(ptr)) {
      const s_ = s.replace(re231, re231_);
      q_231 = true;
      if (s != s_) {
        s = s_;
        count_231++;
      }
    } else q_231 = false;

    // возвращение кода н/р пробела
    if (nbspEntity == '&nbsp;' && s.search(reNBSPon) != -1) s = s.replace(reNBSPon, reNBSPon_);

    // сохранение абзаца в оригинале только в том случае, если он действительно изменен
    if (ptr.innerHTML != s) ptr.innerHTML = s;

    // Снятие внешнего форматирования с графики в пустом параграфе
    if (q_231) {
      while (ptr.parentNode != null && ptr.parentNode.children.length == 1 &&
          (ptr.parentNode.className == 'cite' || ptr.parentNode.className == 'poem' ||
            (ptr.parentNode.className == 'stanza' && ptr.parentNode.parentNode != null && ptr.parentNode.parentNode.children.length == 1 && ptr.parentNode.parentNode.className == 'poem'))) {
        ptr.parentNode.removeNode(false);
        count_232++;
      }
    }

    // Добавление пустой строки между "карманным" блоком и концом секции
    if (ptr.innerHTML != '') {
      let ptrUp = ptr;
      while (ptrUp.nextSibling == null && ptrUp.parentNode != null && ptrUp.parentNode.className != 'section') ptrUp = ptrUp.parentNode;
      if (ptrUp.nextSibling == null && ptrUp.parentNode != null && ptrUp.parentNode.className == 'section') {
        if (ptrUp.className.search(re241) != -1) {
          ptrUp.insertAdjacentElement('afterEnd', document.createElement('P'));
          count_241++;
        }
      }
    }

    // ОПЕРАЦИИ с очищенными пустыми строками
    if (ptr.innerHTML == '' && ptr.className != 'th' && ptr.className != 'td') {
      // Удаление первой пустой строки в ряде из двух пустых строк
      if (ptr.previousSibling != null && ptr.previousSibling.innerHTML == '') {
        ptr.previousSibling.removeNode(true);
        count_251++;
      }

      // Удаление внешних тегов для единственной пустой строки
      while (ptr.parentNode != null && ptr.parentNode.children.length == 1 &&
          (ptr.parentNode.className.search(re252) != -1 ||
            (ptr.parentNode.className == 'annotation' && ptr.parentNode.parentNode != null && ptr.parentNode.parentNode.getAttribute('id') != 'fbw_body'))) {
        ptr.parentNode.removeNode(false);
        count_252++;
      }

      //  Удаление ошибочных пустых строк в "body" и "fbw_body" (вне секции)
      if (ptr.parentNode != null && (ptr.parentNode.className == 'body' || ptr.parentNode.getAttribute('id') == 'fbw_body')) {
        ptr.removeNode(true);
        count_253++;
        return;
      }

      if (ptr.parentNode != null && ptr.parentNode.children.length == 1) {
        //  Удаление пустых "body"
        let ptrUp = ptr;
        while (ptrUp.parentNode != null && ptrUp.parentNode.children.length == 1 && ptrUp.className != 'body') ptrUp = ptrUp.parentNode;
        if (ptrUp.className == 'body' &&
            ((ptrUp.previousSibling != null && ptrUp.previousSibling.className == 'body') ||
              (ptrUp.nextSibling != null && ptrUp.nextSibling.className == 'body'))) {
          ptrUp.removeNode(true);
          count_262++;
          return;
        }

        //  Удаление пустых секций
        ptrUp = ptr;
        while (ptrUp.parentNode != null && ptrUp.parentNode.children.length == 1 && ptrUp.parentNode.className == 'section') ptrUp = ptrUp.parentNode;
        if (ptrUp.className == 'section' &&
            ((ptrUp.previousSibling != null && ptrUp.previousSibling.className == 'section') ||
              (ptrUp.nextSibling != null && ptrUp.nextSibling.className == 'section' && ptrUp.previousSibling == null) ||
              (ptrUp.parentNode != null && ptrUp.parentNode.getAttribute('id') == 'fbw_body'))) {
          ptrUp.removeNode(true);
          count_263++;
          return;
        }
      }

      //  Удаление пустых строк на окраине разделов
      if ((ptr.previousSibling == null && ptr.nextSibling != null) ||
          (ptr.nextSibling == null && ptr.previousSibling != null && ptr.previousSibling.className.search(re271) == -1)) {
        ptr.removeNode(true);
        count_271++;
        return;
      }

      //  Удаление пустых строк рядом с разделами и подзаголовками
      if (ptr.previousSibling != null && ptr.nextSibling != null && ptr.parentNode != null &&
          ((ptr.previousSibling.className.search(re272) != -1 && ptr.nextSibling.className != 'image') ||
            (ptr.nextSibling.className.search(re272) != -1 && ptr.previousSibling.className != 'image'))) {
        ptr.removeNode(true);
        count_272++;
        return;
      }

      //  Замена пустых строк в стихах на разрыв строф
      if (ptr.parentNode != null && ptr.parentNode.className == 'stanza' &&
          ptr.previousSibling != null && ptr.previousSibling.nodeName == 'P' &&
          ptr.nextSibling != null && ptr.nextSibling.nodeName == 'P') {
        const stanza_1 = ptr.parentNode;
        const stanza_2 = stanza_1.cloneNode(false);
        stanza_1.insertAdjacentElement('beforeBegin', stanza_2);
        stanza_1.removeAttribute('id');
        while (stanza_1.firstChild.innerHTML != '') stanza_2.insertAdjacentElement('beforeEnd', stanza_1.firstChild);
        stanza_1.firstChild.removeNode(true);
        count_281++;
        return;
      }
    }

    //  Поиск графики в тексте
    if (Obrabotka_Img_v_Texte_on_off != 0 && ptr.innerHTML.search(re001) != -1 && (ptr.parentNode.className == 'section' || ptr.parentNode.className == 'body')) {
      m_001[count_001] = ptr;
      count_001++;
    }

    //  Поиск пустых строк между строк заголовка
    if (Obrabotka_Entity_ttl != 0 && ptr.parentNode.className == 'title' && ptr.previousSibling != null && ptr.previousSibling.innerHTML == '') {
      m_002[count_002] = ptr;
      count_002++;
    }

    //  Поиск ссылок
    if (ptr.innerHTML.search(/<\/A>/) != -1) m_003.push(ptr);
  }

  /* ------------------------------------------------ _2_: применение функции "HandleP" */
  {
    let ptr = fbwBody;
    let SaveNext = ptr;
    let ProcessingEnding = false;
    let handled = 0;
    while (!ProcessingEnding) {
      if (SaveNext.firstChild != null && SaveNext.nodeName != 'P') SaveNext = SaveNext.firstChild;
      else {
        while (SaveNext.nextSibling == null) {
          SaveNext = SaveNext.parentNode;
          if (SaveNext == fbwBody || SaveNext == null) {
            ProcessingEnding = true;
            break;
          }
        }
        if (!ProcessingEnding) SaveNext = SaveNext.nextSibling;
      }
      if (ptr.nodeName == 'P' && ptr.parentNode) {
        HandleP(ptr);
        handled += 1;
        if (handled % 500 === 0) {
          await mfbe.ui.progress(handled, undefined, ScriptName);
          if (ctx.cancelled) return;
        }
      }
      ptr = SaveNext;
    }
  }

  /* ------------------------------------------------ _3_ (301): Выведение картинки из текста */
  let otvet_001 = false;
  if (count_001 != 0 && Obrabotka_Img_v_Texte_on_off == 2) {
    const ok = pad(count_001);
    const which = [' изображение, которое', ' изображения, которые', ' изображений, которые'][ok];
    const what = ['картинки', 'картинок', 'картинок'][ok];
    otvet_001 = await AskYesNo(tr(ctx,
      `◊  КАРТИНКИ в ТЕКСТЕ  ◊\n\nНайдено ${count_001}${which} можно вывести\nиз пустого параграфа\n\nПРЕОБРАЗОВАТЬ\nоформление ${what}?`,
      `◊  PICTURES IN THE TEXT  ◊\n\nFound ${count_001} picture(s) that can be taken\nout of an empty paragraph\n\nTURN them into block pictures?`));
  }
  const re301 = jre('<P( [^>]{1,}){0,1}><SPAN( [^>]{0,}?class=image[^>]{0,}><IMG [^>]{1,}>)</SPAN></P>', 'g');
  let count_301 = 0;
  if (otvet_001 || Obrabotka_Img_v_Texte_on_off == 1) {
    for (let n = 0; n < count_001; n++) {
      const p = m_001[n];
      // outerHTML.replace(re301, "<DIV$2</DIV>"): the paragraph becomes a block picture.
      if (p.parentNode && p.outerHTML.search(re301) != -1) {
        const href = /href="([^"]*)"/.exec(p.innerHTML)?.[1] ?? '';
        const img = page.createElement('DIV');
        img.className = 'image';
        img.attrs.href = href;
        const alt = /alt="([^"]*)"/.exec(p.alts[0] ?? '')?.[1];
        if (alt) img.attrs.alt = decodeEntities(alt);
        p.insertAdjacentElement('beforeBegin', img);
        p.removeNode(true);
      }
      count_301++;
    }
  }

  /* ------------------------------------------------ 311: Удаление пустой строки посреди заголовка */
  let count_311 = 0;
  if (Obrabotka_Entity_ttl == 2) {
    for (let n = 0; n < count_002; n++) {
      const line = m_002[n].previousSibling;
      if (!line) continue;
      const answer = await pause(() => MsgBox(
        tr(ctx, ` УДАЛИТЬ пустую строку посреди заголовка «${m_002[n].innerText}»?`, ` REMOVE the empty line inside the title «${m_002[n].innerText}»?`),
        tr(ctx, `• 311. Пустая строка внутри заголовка  •  ${n + 1} из ${count_002} • `, `• 311. Empty line inside a title  •  ${n + 1} of ${count_002} • `),
        3 + 32));
      if (answer == 6) {
        line.removeNode(true);
        count_311++;
      }
      if (answer == 2) break;
    }
  }
  if (Obrabotka_Entity_ttl == 1) {
    for (let n = 0; n < count_002; n++) {
      const line = m_002[n].previousSibling;
      if (!line) continue;
      line.removeNode(true);
      count_311++;
    }
  }

  /* ------------------------------------------------ 320-322: примечания и комментарии */
  const re320 = jre('^\\{\\d{1,4}\\}$', '');
  const re321 = jre('</?(STRONG|EM|SUP|SUB|STRIKE)>', 'g');
  const re322 = jre('</?(STRONG|EM|SUB|STRIKE)>', 'g');
  let count_320 = 0;
  let count_321 = 0;
  let count_322 = 0;
  /** The text of a piece of inline HTML (tags removed, entities decoded). */
  const textOf = (html) => decodeEntities(html.replace(/<[^>]*>/g, ''));
  /** The <SUP> elements of inline HTML, in document order: [open start, open end, close start, close end]. */
  const supElements = (html) => {
    const out = [];
    const stack = [];
    const re = /<(\/?)SUP\b[^>]*>/g;
    let m;
    while ((m = re.exec(html))) {
      if (!m[1]) {
        const el = { openStart: m.index, openEnd: m.index + m[0].length };
        out.push(el);
        stack.push(el);
      } else if (stack.length) {
        const el = stack.pop();
        el.closeStart = m.index;
        el.closeEnd = m.index + m[0].length;
      }
    }
    return out.filter((el) => el.closeStart !== undefined);
  };
  /** removeNode(false) of an element of inline HTML: its tags go, its content stays. */
  const unwrap = (html, el) => html.slice(0, el.openStart) + html.slice(el.openEnd, el.closeStart) + html.slice(el.closeEnd);
  /** Every <SPAN> of inline HTML removed, its content kept - but an inline picture (fix). */
  const unwrapSpans = (html) => {
    const stack = [];
    return html.replace(/<(\/?)SPAN\b([^>]*)>/g, (all, closing, attrs) => {
      if (!closing) {
        const keep = /class=image/.test(attrs);
        stack.push(keep);
        return keep ? all : '';
      }
      return stack.pop() ? all : '';
    });
  };
  for (let k = m_003.length - 1; k >= 0; k--) {
    const p = m_003[k];
    if (!p.parentNode) continue;
    const links = [...p.html.matchAll(/<A\b([^>]*)>([\s\S]*?)<\/A>/g)];
    let html = p.html;
    for (let j = links.length - 1; j >= 0; j--) {
      const [all, attrs] = links[j];
      let inner = links[j][2];
      const className = /\bclass=("[^"]*"|[^\s>]+)/.exec(attrs)?.[1]?.replace(/"/g, '') ?? '';
      if (!(className == 'note' || textOf(inner).search(re320) != -1)) continue;
      let change_n = false;
      let change_c = false;
      if (className == 'note') {
        if (inner.search(re321) != -1) {
          inner = inner.replace(re321, '');
          change_n = true;
        }
      } else {
        if (inner.search(re322) != -1) {
          inner = inner.replace(re322, '');
          change_c = true;
        }
        const mSUP = supElements(inner);
        if (mSUP.length != 0) {
          for (let jj = mSUP.length - 1; jj >= 1; jj--) {
            inner = unwrap(inner, supElements(inner)[jj]);
            change_c = true;
          }
          const first = supElements(inner)[0];
          if (textOf(inner.slice(first.openEnd, first.closeStart)) != textOf(inner)) {
            inner = `<SUP>${unwrap(inner, first)}</SUP>`;
            change_c = true;
            count_322++;
          }
        } else {
          inner = `<SUP>${inner}</SUP>`;
          count_322++;
        }
      }
      if (inner.search('</SPAN>') != -1) {
        const unwrapped = unwrapSpans(inner);
        if (unwrapped != inner) {
          inner = unwrapped;
          if (className == 'note') change_n = true;
          else change_c = true;
        }
      }
      // A link inside inline formatting was moved out of it; the page's notation writes a link
      // outside the formatting of its text, so the link is never inside one here.
      if (change_n) count_320++;
      if (change_c) count_321++;
      const start = links[j].index;
      html = html.slice(0, start) + `<A${attrs}>${inner}</A>` + html.slice(start + all.length);
    }
    if (html != p.html) p.innerHTML = html;
  }

  /* ------------------------------------------------ _4_ (401, 402): Разделы "DIV" */
  let count_401 = 0;
  let count_402 = 0;
  const mImg = [];
  const mSection = [];
  const mBody = [];
  {
    const mDiv = fbwBody.getElementsByTagName('DIV');
    for (let j = mDiv.length - 1; j >= 0; j--) {
      const div = mDiv[j];
      if (!fbwBody.contains(div)) continue;
      // Удаление пустых узлов "DIV"
      if (div.innerHTML == '') {
        div.removeNode(true);
        count_401++;
        continue;
      }
      // Чистка двойных разделов "DIV"
      if (div.children.length == 1 && div.className == div.firstChild.className) {
        div.removeNode(false);
        count_402++;
        continue;
      }
      if (div.className == 'image') mImg.push(div);
      if (div.className == 'section') mSection.push(div);
      if (div.className == 'body' && div.getAttribute('fbname') != 'notes' && div.getAttribute('fbname') != 'comments' && div.parentNode == fbwBody) mBody.push(div);
    }
  }
  const count_Img = mImg.length;
  const count_Section = mSection.length;
  const count_Body = mBody.length;

  /* ------------------------------------------------ 011: Разделы "body" */
  let otvet_011 = false;
  if (count_Body > 1) {
    const razdel = [' раздел', ' раздела', ' разделов'][pad(count_Body)];
    otvet_011 = await AskYesNo(tr(ctx,
      `◊  СЛИШКОМ МНОГО "body"  ◊\n\nНайдены ${count_Body}${razdel} "body"\n\nОБЪЕДИНИТЬ в один раздел?`,
      `◊  TOO MANY "body"  ◊\n\nFound ${count_Body} "body" sections\n\nMERGE them into one?`));
  }

  /* ------------------------------------------------ _5_ (501-503): Объединение "body" */
  let count_501 = 0;
  let count_502 = 0;
  let count_503 = 0;
  if (otvet_011) {
    const newBody = mBody[count_Body - 1].cloneNode(false);
    newBody.removeAttribute('fbname');
    newBody.attrs.fbname = '';
    mBody[count_Body - 1].insertAdjacentElement('beforeBegin', newBody);
    for (let j = mBody.length - 1; j >= 0; j--) {
      const Body = mBody[j];
      const newSection = page.createElement('DIV');
      newSection.className = 'section';
      newBody.insertAdjacentElement('beforeEnd', newSection);
      // Удаление лишнего обрамления секцией
      if (Body.children.length == 1 && Body.firstChild.className == 'section') Body.firstChild.removeNode(false);
      // Перестановка заглавной картинки "body"
      let div2 = Body.firstChild;
      if (div2 != null && div2.className == 'image') {
        while (div2.nextSibling != null) {
          if (div2.nextSibling.className == 'title' || div2.nextSibling.className == 'epigraph') div2 = div2.nextSibling;
          else break;
        }
        if (div2.className != 'image') {
          div2.insertAdjacentElement('afterEnd', Body.firstChild);
          count_502++;
        }
      }
      // Создание заголовка из имени "body" (если возможно)
      let newTitle = null;
      const fbname = Body.getAttribute('fbname');
      if (fbname != null && fbname != '' && Body.firstChild != null && Body.firstChild.className != 'title') {
        newTitle = page.createElement('DIV');
        newTitle.className = 'title';
        newTitle.insertAdjacentElement('afterBegin', page.createElement('P'));
        newTitle.firstChild.innerHTML = fbname;
        Body.insertAdjacentElement('afterBegin', newTitle);
        count_503++;
      }
      // Перемещение "body" в новую секцию и удаление оболочки этого "body"
      newSection.insertAdjacentElement('beforeEnd', Body);
      Body.removeNode(false);
      count_501++;
      if (newTitle) {
        const answer = await pause(() => mfbe.ui.prompt(
          tr(ctx, ' СОХРАНИТЬ ЗАГОЛОВОК, полученный из имени <body>?\n    (текст заголовка можно отредактировать)',
            ' KEEP THE TITLE made from the name of the <body>?\n    (the text of the title can be edited)'),
          { caption: tr(ctx, '• 503. Заголовок <body> •', '• 503. Title of the <body> •'), defaultValue: newTitle.firstChild.innerHTML, yesNoCancel: true }));
        if (answer) newTitle.firstChild.innerHTML = answer;
        else {
          newTitle.removeNode(true);
          count_503--;
        }
      }
    }
  }

  /* ------------------------------------------------ _6_ (511-521): Разделы "section" */
  let count_511 = 0;
  let count_512 = 0;
  let count_514 = 0;
  let count_521 = 0;
  for (let j = count_Section - 1; j >= 0; j--) {
    if (j >= mSection.length) continue;
    const Section = mSection[j];

    // Чистка секций в <body>
    bbb: {
      if (Section.parentNode != null && Section.parentNode.className == 'body') {
        let classStroka = '';
        let div2 = Section.parentNode.firstChild;
        while (div2 != null) {
          if (div2.nodeName != 'DIV') break bbb;
          else if (div2.className == 'image') classStroka += 'i';
          else if (div2.className == 'title') classStroka += 't';
          else if (div2.className == 'epigraph') classStroka += 'e';
          else if (div2.className == 'section') {
            if (classStroka.search('s') != -1) break bbb;
            classStroka += 's';
          } else break bbb;
          div2 = div2.nextSibling;
        }
        div2 = Section.firstChild;
        while (div2 != null) {
          if (div2.nodeName != 'DIV') break bbb;
          if (div2.className == 'title') classStroka += 't';
          else if (div2.className == 'epigraph') classStroka += 'e';
          else if (div2.className != 'section') break bbb;
          else break;
          div2 = div2.nextSibling;
        }
        if (classStroka.search(/t.*t|e.*t/) != -1) break bbb;
        Section.removeNode(false);
        mSection.splice(j, 1);
        count_511++;
        continue;
      }
    }

    // Чистка внутренних секций
    ccc: {
      if (Section.parentNode != null && Section.parentNode.className == 'section') {
        let classStroka = '';
        let div2 = Section.parentNode.firstChild;
        while (div2 != null) {
          if (div2.nodeName != 'DIV') break ccc;
          else if (div2.className == 'title') classStroka += 't';
          else if (div2.className == 'epigraph') classStroka += 'e';
          else if (div2.className == 'image') classStroka += 'i';
          else if (div2.className == 'annotation') classStroka += 'a';
          else if (div2.className == 'section') {
            if (classStroka.search('s') != -1) break ccc;
            classStroka += 's';
          } else break ccc;
          div2 = div2.nextSibling;
        }
        div2 = Section.firstChild;
        while (div2 != null && div2.nodeName == 'DIV') {
          if (div2.className == 'title') break ccc;
          else if (div2.className == 'epigraph') classStroka += 'e';
          else if (div2.className == 'image') classStroka += 'i';
          else if (div2.className == 'annotation') classStroka += 'a';
          else if (div2.className == 'section') {
            if (classStroka.search(/s$/g) != -1) break;
            classStroka += 's';
          } else break;
          div2 = div2.nextSibling;
        }
        if (classStroka.search(/.t|i.*e|i.*i.*[as]|a.*e/) != -1) break ccc;
        Section.removeNode(false);
        mSection.splice(j, 1);
        count_512++;
        continue;
      }
    }

    //  Объединение двух секций вида: 1) Заголовок + пустая строка и 2) Секция с текстом
    if (Section.children.length == 2 && Section.firstChild.className == 'title' && Section.lastChild.nodeName == 'P' && Section.lastChild.innerHTML == '' &&
        Section.nextSibling && Section.nextSibling.className == 'section' && Section.nextSibling.firstChild.className != 'title') {
      if (Section.parentNode.children.length == 2 && Section.parentNode.className == 'section') {
        Section.parentNode.removeNode(false);
        mSection.splice(j + 1, 1);
        count_402++;
      }
      Section.nextSibling.insertAdjacentElement('afterBegin', Section.firstChild);
      Section.removeNode(true);
      mSection.splice(j, 1);
      count_514++;
      continue;
    }
  }

  for (let j = mSection.length - 1; j >= 0; j--) {
    const Section = mSection[j];
    // Перемещение заголовка основной секции в <body>
    ddd: {
      if (Section.parentNode != null && Section.parentNode.className == 'body') {
        let classStroka = '';
        let div2 = Section.parentNode.firstChild;
        while (div2 != null) {
          if (div2.nodeName != 'DIV') break ddd;
          else if (div2.className == 'image') classStroka += 'i';
          else if (div2.className == 'section') {
            if (classStroka.search('s') != -1) break ddd;
            classStroka += 's';
          } else break ddd;
          div2 = div2.nextSibling;
        }
        div2 = Section.firstChild;
        while (div2 != null) {
          if (div2.className == 'title') classStroka += 't';
          else if (div2.className == 'section') break ddd;
          else if (div2.nodeName == 'P') break;
          div2 = div2.nextSibling;
        }
        if (classStroka.search(/^[^t]+$|[^s]t/) != -1) break ddd;
        Section.insertAdjacentElement('beforeBegin', Section.firstChild);
        count_521++;
      }
    }
  }

  /* ------------------------------------------------ 021: Разделы "image" */
  let count_021 = 0;
  for (let j = count_Img - 1; j >= 0; j--) {
    const img = mImg[j];
    if (img.parentNode && img.parentNode.className == 'section') {
      if ((img.nextSibling != null && img.nextSibling.innerHTML == '' && img.nextSibling.nextSibling != null && img.nextSibling.nextSibling.className == 'section') ||
          (img.nextSibling != null && img.nextSibling.className == 'section')) {
        count_021++;
      }
    }
  }
  let otvet_021 = false;
  if (count_021 != 0 && Obrabotka_karm_Img == 2) {
    otvet_021 = await AskYesNo(tr(ctx,
      `◊  ИЛЛЮСТРАЦИЯ В КАРМАНЕ  ◊\n\nНайдено иллюстраций в карманах секций: ${count_021}\n\n< Начало внешней секции >\n    < . . . . . >\n    < Иллюстрация >\n    < Внутренние секции >\n< Конец внешней секции >\n\nОБРАМИТЬ иллюстрации новыми внутренними секциями?`,
      `◊  PICTURE IN A POCKET  ◊\n\nPictures found in the pockets of sections: ${count_021}\n\n< Start of the outer section >\n    < . . . . . >\n    < Picture >\n    < Inner sections >\n< End of the outer section >\n\nFRAME the pictures with new inner sections?`));
  }

  /* ------------------------------------------------ _7_ (6xx): Разделы "image" */
  let count_601 = 0;
  let count_611 = 0;
  let count_621 = 0;
  let count_622 = 0;
  let count_631 = 0;
  let count_632 = 0;
  let Re_Add_Entity = '&';
  if (Add_Entity_Img_Podpis != 1) Re_Add_Entity += '|cite|subtitle||normal';
  if (Add_Entity_Img_Title != 1) Re_Add_Entity += '|title';
  if (Add_Entity_Img_Img != 1) Re_Add_Entity += '|image';
  const re611ex = jre('^(' + Re_Add_Entity + ')$', 'g');
  for (let j = 0; j < count_Img; j++) {
    const img = mImg[j];
    if (!img.parentNode) continue;
    if (img.parentNode.className == 'section') {
      // Удаление пустых строк рядом с картинкой в "кармане" секций
      if (img.nextSibling != null && img.nextSibling.innerHTML == '' && img.nextSibling.nextSibling != null &&
          (img.nextSibling.nextSibling.className == 'section' || img.nextSibling.nextSibling.className == 'annotation')) {
        img.nextSibling.removeNode(true);
        count_601++;
      }
      if (img.previousSibling != null && img.previousSibling.innerHTML == '' && img.nextSibling != null &&
          (img.nextSibling.className == 'section' || img.nextSibling.className == 'annotation')) {
        img.previousSibling.removeNode(true);
        count_601++;
      }

      if (img.nextSibling == null || (img.nextSibling != null && img.nextSibling.className != 'section' && img.nextSibling.className != 'annotation')) {
        //  Вставка пустой строки перед картинкой (внутри секции)
        if (img.previousSibling != null && img.previousSibling.innerHTML != '' && img.previousSibling.className.search(re611ex) == -1) {
          img.insertAdjacentElement('beforeBegin', document.createElement('P'));
          count_611++;
        }
        //  Вставка пустой строки после картинки (внутри секции)
        if (img.nextSibling != null && img.nextSibling.innerHTML != '' && img.nextSibling.className.search(re611ex) == -1) {
          img.insertAdjacentElement('afterEnd', document.createElement('P'));
          count_611++;
        }
        //  Удаление пустой строки между границей секции и картинкой
        if (img.previousSibling != null && img.previousSibling.previousSibling == null && img.previousSibling.innerHTML == '') {
          img.previousSibling.removeNode(true);
          count_622++;
        }
        //  Вставка пустой строки между картинкой и границей секции (если кроме картинки, в секции больше ничего нет)
        if (img.previousSibling == null && img.nextSibling == null) {
          img.insertAdjacentElement('afterEnd', document.createElement('P'));
          count_621++;
        }
        //  Удаление пустой строки между картинкой и границей секции (если перед картинкой что-то есть)
        if (img.previousSibling != null && img.nextSibling != null && img.nextSibling.nextSibling == null && img.nextSibling.innerHTML == '') {
          img.nextSibling.removeNode(true);
          count_622++;
        }
      }

      //  Перемещение картинки из "кармана" в отдельную секцию
      if ((Obrabotka_karm_Img == 1 || otvet_021) && img.nextSibling != null && img.nextSibling.className == 'section') {
        const newSection = page.createElement('DIV');
        newSection.className = 'section';
        img.insertAdjacentElement('afterEnd', newSection);
        newSection.insertAdjacentElement('afterBegin', document.createElement('P'));
        newSection.insertAdjacentElement('afterBegin', img);
        count_631++;
        if (newSection.nextSibling != null) {
          const imgUp = newSection.nextSibling;
          if (imgUp.className == 'section' && imgUp.children.length == 1 && imgUp.firstChild.nodeName == 'P' && imgUp.firstChild.innerHTML == '') {
            imgUp.removeNode(true);
            count_263++;
          }
        }
        eee: {
          if (newSection.parentNode.className == 'section' && newSection.parentNode.parentNode != null && newSection.parentNode.parentNode.className == 'body') {
            let classStroka = '';
            let div2 = newSection.parentNode.parentNode.firstChild;
            while (div2 != null) {
              if (div2.nodeName != 'DIV') break eee;
              else if (div2.className == 'image') classStroka += 'i';
              else if (div2.className == 'title') classStroka += 't';
              else if (div2.className == 'epigraph') classStroka += 'e';
              else if (div2.className == 'section') {
                if (classStroka.search('s') != -1) break eee;
                classStroka += 's';
              } else break eee;
              div2 = div2.nextSibling;
            }
            div2 = newSection.parentNode.firstChild;
            while (div2 != null) {
              if (div2.nodeName != 'DIV') break eee;
              if (div2.className == 'title') classStroka += 't';
              else if (div2.className == 'epigraph') classStroka += 'e';
              else if (div2.className != 'section') break eee;
              else break;
              div2 = div2.nextSibling;
            }
            if (classStroka.search(/t.*t|e.*t/) != -1) break eee;
            newSection.parentNode.removeNode(false);
            count_511++;
          }
        }
      }
    }

    //  Перемещение картинки из <body> в отдельную секцию
    if (img.parentNode && img.parentNode.className == 'body' && img.previousSibling != null && img.nextSibling != null && img.nextSibling.className == 'section') {
      const newSection = page.createElement('DIV');
      newSection.className = 'section';
      img.insertAdjacentElement('afterEnd', newSection);
      newSection.insertAdjacentElement('afterBegin', document.createElement('P'));
      newSection.insertAdjacentElement('afterBegin', img);
      count_632++;
      if (newSection.nextSibling != null) {
        const imgUp = newSection.nextSibling;
        if (imgUp.className == 'section' && imgUp.children.length == 1 && imgUp.firstChild.nodeName == 'P' && imgUp.firstChild.innerHTML == '') {
          imgUp.removeNode(true);
          count_263++;
        }
      }
    }
  }

  /* ------------------------------------------------ the schema */
  // A section left with its title, epigraphs and picture only (a picture taken out of the only
  // paragraph of a titled section, which 621 does not reach): an empty line after the picture.
  for (const section of fbwBody.getElementsByTagName('DIV')) {
    if (section.className != 'section') continue;
    const kids = section.children;
    if (!kids.length) continue;
    const head = new Set(['title', 'epigraph', 'image', 'annotation']);
    if (kids.every((kid) => kid.nodeName == 'DIV' && head.has(kid.className)) && kids[kids.length - 1].className == 'image') {
      section.insertAdjacentElement('beforeEnd', document.createElement('P'));
    }
  }

  /* ------------------------------------------------ Подсчет общего количества исправлений */
  let itogi = count_100 + count_103 + count_150 + count_201 + count_213 + count_214 + count_227 + count_232 + count_241 + count_251 + count_252 + count_253 + count_262 + count_263 + count_271 + count_272 + count_281 + count_301 + count_311 + count_401 + count_402 + count_501 + count_502 + count_503 + count_511 + count_512 + count_514 + count_521 + count_601 + count_611 + count_621 + count_622 + count_631 + count_632;
  itogi += count_211 + count_212 + count_228 + count_231 + count_320 + count_321 + count_322;

  await commitPage(page);

  /* ------------------------------------------------ ОКНО РЕЗУЛЬТАТОВ */
  const Tf = Date.now();
  const now = new Date(Tf);
  const two = (n) => (n < 10 ? `0${n}` : `${n}`);
  const currentTime = `${now.getHours()}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const currentDate = `${now.getDate()}.${two(now.getMonth() + 1)}.${String(now.getFullYear()).replace(/^.*?(\d{1,2})$/g, '$1')}`;
  const mSt = [];
  mSt.push(` ${ScriptName} v.${NumerusVersion}`);
  mSt.push('-----------------------------------------------------------------------');
  mSt.push('');
  mSt.push(tr(ctx, '• СТАТИСТИКА:', '• STATISTICS:'));
  mSt.push(tr(ctx, 'Время выполнения .  .  .  .  .  .  .  .  .\t', 'Time taken .  .  .  .  .  .  .  .  .  .  .\t') + timeText(ctx, Tf - Ts));
  if (T_pause != 0) mSt.push(tr(ctx, 'Вычисления   .  .  .  .  .  .  .  .  .  .  .  .\t', 'Computing .  .  .  .  .  .  .  .  .  .  .  .\t') + timeText(ctx, Tf - Ts - T_pause));
  if (itogi != 0) mSt.push(tr(ctx, 'Всего исправлений .  .  .  .  .  .  .  .  .\t', 'Corrections in all .  .  .  .  .  .  .  .\t') + itogi);
  if (itogi == 0) {
    mSt.push('');
    mSt.push(tr(ctx, '   >> Исправлений нет', '   >> No corrections'));
  }
  const section = (titleRu, titleEn, rows) => {
    const shown = rows.filter(([count]) => count != 0);
    if (!shown.length) return;
    mSt.push('');
    mSt.push(tr(ctx, titleRu, titleEn));
    for (const [count, ru, en] of shown) mSt.push(`${tr(ctx, ru, en)}\t${count}`);
  };
  section('• РАЗНЫЕ ИСПРАВЛЕНИЯ:', '• VARIOUS CORRECTIONS:', [
    [count_100, '100. Восстановление параграфов .  .  .  .  .  .  .  .  .  .  .', '100. Paragraphs restored'],
    [count_103, '103. Коррекция внутренних тегов вне параграфа  ', '103. Inline tags outside a paragraph corrected'],
    [count_150, '150. Добавление разрыва секции перед заголовком', '150. Section break added before a title'],
    [count_201, '201. Удаление повторных внутренних тегов в строке', '201. Repeated inline tags removed in a line'],
    [count_202, '202. Добавление формата "Цитата" .  .  .  .  .  .  .  .  .  .', '202. "Cite" format added'],
    [count_211, '211. Замена "&nbsp;" на неразрывный пробел .  .  .  .', '211. "&nbsp;" replaced by a non-breaking space'],
    [count_227, '227. Формат "подзаголовок" для строк из символов', '227. "Subtitle" format for lines of symbols'],
    [count_228, '228. Коррекция подзаголовков из символов  .  .  .  .  .', '228. Subtitles of symbols corrected'],
    [count_231, '231. Удаление мусора из строк с графикой  .  .  .  .  .  .', '231. Clutter removed from lines with a picture'],
    [count_232, '232. Удаление формата со строки с графикой  .  .  .  .', '232. Format removed from a line with a picture'],
    [count_301, '301. Переоформление графики  .  .  .  .  .  .  .  .  .  .  .  .', '301. Pictures turned into block pictures'],
    [count_320, '320. Удаление формата в примечаниях  .  .  .  .  .  .  .  .', '320. Format removed in note links'],
    [count_321, '321. Удаление формата в комментариях   .  .  .  .  .  .  .', '321. Format removed in comment links'],
    [count_322, '322. Верхний индекс для комментариев .  .  .  .  .  .  .  .', '322. Superscript for comment links'],
    [count_402, '402. Исправление двойных разделов  .  .  .  .  .  .  .  .  .', '402. Doubled containers corrected'],
    [count_501, '501. Преобразование раздела "body" в секцию   .  .  .', '501. "body" turned into a section'],
    [count_502, '502. Перестановка заглавной картинки .  .  .  .  .  .  .  .', '502. Title picture moved'],
    [count_503, '503. Преобразование имени "body" в заголовок .  .  .', '503. "body" name turned into a title'],
    [count_511, '511. Удаление лишней секции в "body"  .  .  .  .  .  .  .  .', '511. Redundant section in "body" removed'],
    [count_512, '512. Удаление лишних внутренних секций   .  .  .  .  .  .', '512. Redundant inner sections removed'],
    [count_514, '514. Объединение двух секций: заголовок+текст  .  .', '514. Two sections merged: title+text'],
    [count_521, '521. Заголовок из основной секции  в "body" .  .  .  .  .', '521. Title of the main section moved into "body"'],
    [count_631, '631. Иллюстрация из "кармана"  в новую секцию .  .', '631. Picture moved from a "pocket" into a new section'],
    [count_632, '632. Иллюстрация из "body"  в новую секцию .  .  .  .  .', '632. Picture moved from "body" into a new section'],
  ]);
  section('• ОПЕРАЦИИ С ПУСТЫМИ СТРОКАМИ:', '• OPERATIONS WITH EMPTY LINES:', [
    [count_212, '212. Удаление мусора из пустых строк  .  .  .  .  .  .  .  .', '212. Clutter removed from empty lines'],
    [count_213, '213. Удаление формата "подзаголовок"   .  .  .  .  .  .  .', '213. "Subtitle" format removed'],
    [count_214, '214. Удаление формата "автор текста"  .  .  .  .  .  .  .  .', '214. "Text author" format removed'],
    [count_241, '241. Вставка между "карманом" и концом секции  ', '241. Inserted between a "pocket" and the end of a section'],
    [count_251, '251. Удаление второй пустой строки подряд .  .  .  .  .', '251. Second empty line in a row removed'],
    [count_252, '252. Удаление внешнего форматирования  .  .  .  .  .  .', '252. Outer formatting removed'],
    [count_253, '253. Удаление в "body" и "fbw_body"  .  .  .  .  .  .  .  .  .', '253. Removed in "body" and "fbw_body"'],
    [count_262, '262. Удаление пустого "body" .  .  .  .  .  .  .  .  .  .  .  .  .', '262. Empty "body" removed'],
    [count_263, '263. Удаление пустых секций .  .  .  .  .  .  .  .  .  .  .  .  .', '263. Empty sections removed'],
    [count_271, '271. Удаление на окраине разделов   .  .  .  .  .  .  .  .  .', '271. Removed at the edge of containers'],
    [count_272, '272. Удаление за краем разделов и подзаголовков', '272. Removed next to containers and subtitles'],
    [count_281, '281. Замена пустых строк в стихах на разрыв строф', '281. Empty lines in poems made stanza breaks'],
    [count_311, '311. Удаление  посреди заголовка  .  .  .  .  .  .  .  .  .  .', '311. Removed inside a title'],
    [count_401, '401. Удаление абсолютно пустых разделов   .  .  .  .  .', '401. Completely empty containers removed'],
    [count_601, '601. Удаление возле картинки в "кармане" секций', '601. Removed next to a picture in a "pocket"'],
    [count_611, '611. Вставка рядом с картинкой посреди секции  .  .', '611. Inserted next to a picture inside a section'],
    [count_621, '621. Вставка между картинкой и границей секции', '621. Inserted between a picture and the edge of a section'],
    [count_622, '622. Удаление между картинкой и границей секции', '622. Removed between a picture and the edge of a section'],
  ]);
  mSt.push('');
  mSt.push(`• ${currentDate} • ${currentTime} •`);
  await MsgBox(mSt.join('\n'), ScriptName, 64);
}

//                 ///  ИСТОРИЯ ИЗМЕНЕНИЙ (of the original, kept as written)
//    v.1.0 — Создание скрипта — Александр Ка (27.03.2024)
//    v.1.1 — Исправлена ошибка с добавлением пустых строк — Александр Ка (10.06.2024)
//    v.1.2 — Коррекция метода удаления пустого заголовка — Александр Ка (13.07.2024)
//    v.1.3 — Александр Ка (17.10.2024)
// Добавлен универсальный дизайн окна результатов
// 100. Восстановление параграфов (вместо неработающей операции №101)
// удален №102. Перезапись параграфов (эта дополнительная операция уже не требуется)
// 103. Коррекция внутренних тегов вне параграфов (добавлен перенос тега в параграфы)
// 150. Добавление разрыва секции перед заголовком
// 201. Удаление повторных внутренних тегов в параграфе (добавлен полуавтомат для сложных случаев)
// 202. Добавление формата "Цитата" (дополнение к №201)
// Устранение замедления при выборе в FBE прозрачного символа для н/р пробела
//    v.1.4 — Александр Ка (18.10.2024)
// Исправлена старая ошибка в среде win7, которая приводила к удалению иллюстраций в тексте
//    v.1.5 — Александр Ка (30.11.2024)
// Исправлена ошибка, которая приводила к игнорированию прозрачных н/р пробелов
// 632. Перемещение картинки из "body" в отдельную секцию (новая операция)
// Коррекция диалогов
// Добавление настроек для операции добавления пустых строк между иллюстрациями и текстом в секции
//    v.1.6 — Александр Ка (12.12.2024)
// Добавление настроек для вставки пустых строк между иллюстрациями.
// Коррекция операции 213. Удаление формата "подзаголовок" (для пустой строки)
// Удаление курсора из текста при изменении структуры
//    v.1.7 — Александр Ка (30.03.2025)
// Добавление оп. №514. Объединение двух секций: заголовок+текст
// Удаление универсального дизайна
// Общая правка скрипта
//    v.1.8 - 1.9 — Мелочи — Александр Ка (02.04.2025)
//    v.1.10 — Добавление функции "повышения версии файла и запись в историю изменений" — Александр Ка (27.04.2025)
//    v.1.11 — Изменение функции "повышения версии файла и запись в историю изменений" — Александр Ка (19.05.2025)
//    v.1.12 — Александр Ка (25.07.2025)
// Улучшение операции №150 (Добавление разрыва секции перед заголовком)
// Добавление операций № 320, 321, 322 (обработка примечаний и комментариев)
// Улучшена функция перехода к найденному тексту или строке
