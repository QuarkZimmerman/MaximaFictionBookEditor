// The work of FictionBook Editor 2.7.9's «Цитатный фразотрон» 1.4 (Александр Ка), on the
// document model: the steps and the expressions are the original's, in its order; the comments in
// Russian are its own.
//
// The original took every <P> of the page's bodies other than "notes" and "comments" in document
// order (getElementsByTagName("P"): paragraphs, the lines of titles - skipped -, subtitles and text
// authors - skipped -, verses, cells, empty lines), each with its innerText; a verse stood for its
// whole stanza (the stanza's innerText, its line breaks as " /&/  "), and the next lines of the
// stanza were jumped over (jj += the stanza's number of children - 1). Here those P are the text
// blocks and empty lines of the bodies, a stanza's children its title, subtitle and verses.

import { jscriptRegExp } from './jscript-regexp.js';

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);

/** innerText of a text block: its text, pictures none. */
function innerText(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('');
}

/** The <P> of a body in document order: `{ node, parent }`. */
function paragraphsOf(body) {
  const out = [];
  const visit = (node, parent) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type) || node.type === 'empty-line') {
      out.push({ node, parent });
      return;
    }
    for (const child of node.content ?? []) visit(child, node);
  };
  for (const child of body.content ?? []) visit(child, body);
  return out;
}

/** innerText of a stanza: the text of each of its lines (title, subtitle, verses), CR LF between. */
function stanzaText(stanza) {
  const lines = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) lines.push(innerText(node));
    else for (const child of node.content ?? []) visit(child);
  };
  visit(stanza);
  return lines.join('\r\n');
}

/** "pad": the form of a Russian noun after a number (0: 1, 21...; 1: 2-4, 22...; 2: the rest). */
function pad(Numer) {
  let ok = 2;
  const m1 = Numer % 10;
  const m2 = Numer % 100;
  if (m2 < 11 || m2 > 19) {
    if (m1 == 1) ok = 0;
    else if (m1 == 2 || m1 == 3 || m1 == 4) ok = 1;
  }
  return ok;
}

/**
 * Runs the search. `s` are the settings (W, Max_tsitat, Podcherkivat_slova, SaveTsitat), `tx` picks
 * the Russian or the English text. Resolves the text of the window of results.
 */
export async function phrasetron(ctx, s, tx) {
  const ScriptName = tx('«Цитатный фразотрон»', '«Quote phrasetron»');
  const NumerusVersion = '1.4';
  const W = s.W;
  const Max_tsitat = s.Max_tsitat;
  const Podcherkivat_slova = s.Podcherkivat_slova;
  const SaveTsitat = s.SaveTsitat;

  // GetNBSP() gave the non-breaking space, U+00A0, which the original turned into "&nbsp;": the
  // alternatives "|&nbsp;" of its expressions look for that text, not for the character.
  const nbspEntity = '&nbsp;';

  //  Сборка ключевых слов
  let n;
  let words = '';
  for (n = 0; n < W.length; n++) if (W[n]) words += '|' + W[n];
  if (words == '') words = '\\\t';
  else words = words.replace('|', ''); //  Удаление первого символа.

  // Поиск истины и мудрости
  const reTrueS = jscriptRegExp('(' + words + ')([…\\\.,:;\\\?!\\\)\\\]«„“»”\\\"\\\-\\\s]|' + nbspEntity + ')', 'g');
  const reTrue = jscriptRegExp('(^(\\\s|' + nbspEntity + '){0,}|[…\\\.\\\?!\\\)\\\]](\\\s|' + nbspEntity + '){1,})([—–\\\-](\\\s|' + nbspEntity + '){1,}){0,1}([А-ЯA-ZЁ].{0,180}([…\\\[\\\(«„“»”\\\"\\\s]|' + nbspEntity + ')){0,1}(' + words + ')(([…\\\.,:;\\\?!\\\)\\\]«„“»”\\\"\\\-\\\s]|' + nbspEntity + ').{0,110}.{0,120}?){0,1}([…\\\.\\\?!]|$)', 'g');
  let count_True = 0;
  const MTrue = [];
  let massif = [];

  /// ПОИСК И ПОДСЧЕТ  :  Параграфы <P>
  function HandleP(ptr, parent, stanza) {
    let sct = innerText(ptr.node); //  получение текста параграфа без тегов и числовых кодов
    const Ttl_ = parent.type === 'title'; //   заголовки
    const subt_ = ptr.node.type === 'subtitle'; //   подзаголовки
    const textAuthor_ = ptr.node.type === 'text-author' || ptr.node.type === 'date'; //   автор текста
    const poem_ = parent.type === 'stanza'; //   стихи
    //  Объединение всех строк одной строфы (в стихах)
    if (poem_) {
      sct = stanza;
      sct = sct.replace(/[\r\n]+/g, ' /&/  '); //  Временная замена разрывов строк (так удобней).
    }
    // поиск цитат
    if (!Ttl_ && !subt_ && !textAuthor_) {
      if (count_True < Max_tsitat && sct.search(reTrueS) != -1 && sct.search(reTrue) != -1) {
        massif = sct.match(reTrue); //  Сохранение всех фрагментов из одного абзаца
        for (n = 0; n < massif.length; n++) {
          if (massif[n].length > 15) {
            //  Пропускается только фрагмент, длиной более 15 символов
            MTrue[count_True] = massif[n];
            count_True++;
          }
        }
      }
    }
  }

  // A book over the API's snapshot limit is read body by body (its description is then unknown).
  let doc;
  try {
    doc = await mfbe.doc.get();
  } catch (error) {
    if (error?.name !== 'ScriptApiError') throw error;
    doc = { description: null, bodies: [] };
    for (const ref of await mfbe.doc.getElementsByTagName('body')) doc.bodies.push(await mfbe.doc.getNode(ref));
  }
  for (const body of doc.bodies ?? []) {
    //  тело без названия "notes" или "comments"
    if (body.attrs?.name === 'notes' || body.attrs?.name === 'comments') continue;
    const mP = paragraphsOf(body);
    const mPLength = mP.length;
    for (let jj = 0; jj < mPLength; jj++) {
      if (ctx.cancelled) return null;
      if (jj % 500 === 499) await mfbe.ui.progress(jj, mPLength);
      const ptr = mP[jj];
      let stanza = null;
      if (ptr.parent.type === 'stanza') {
        //  Если строка в стихотворной строфе, то другие строки этой строфы не допускаются к
        //  отправке в функцию "HandleP"
        stanza = stanzaText(ptr.parent);
        jj += (ptr.parent.content ?? []).length - 1;
      }
      HandleP(ptr, ptr.parent, stanza);
    }
  }

  /// ОКНО РЕЗУЛЬТАТОВ  :  Разбивка цитат на строки
  const reTrueS_ = jscriptRegExp('(Путин[а-я]{0,2}|путинск[а-я]{2,3})([…\\\.,:;\\\?!\\\)\\\]«„“»”\\\"\\\-\\\s]|' + nbspEntity + ')', 'g'); //  Для определения особого раздела
  const reS50 = jscriptRegExp('^[…\\\.\\\?!\\\)\\\]]{0,}(\\\s|' + nbspEntity + '){1,}|(\\\s|' + nbspEntity + '){1,}[…\\\.,:;\\\?!\\\(\\\)\\\[\\\]«„“»”\\\"—–\\\-]{0,}$', 'g'); // Удаление лишней пунктуации
  const reS50_ = '';
  const reS60 = jscriptRegExp('(\\\s|' + nbspEntity + '){1,}', 'g'); // Удвоение пробелов
  const reS60_ = '  ';
  const strLength = 47; //  длина строки
  let reZit = jscriptRegExp('^(((  (?!—)|.){0,' + (strLength * 2 - 1) + '}?)(  /&/)|((  (?!—)|.){0,' + strLength + '})(\\\s\\\s|$)|((  (?!—)|.){0,' + strLength + '}))(.{0,})$', 'g');
  const reZitAlt = jscriptRegExp('^(((  (?!—)|.){0,' + strLength + '}?)(  /&/)|((  (?!—)|.){0,' + strLength + '})(\\\s\\\s|$)|((  (?!—)|.){0,' + strLength + '}))(.{0,})$', 'g');
  const reZitTest = jscriptRegExp('  (?!—)|.', 'g');
  const reZit_1 = '$2$5$8';
  const reZit_2 = '$10';
  const MTrue2 = []; //  Массив с цитатами, разложенными на строки
  let mWords = []; //  Массив с ключевыми словами в одной строке
  words = words.replace(reS60, reS60_);
  const reWord_0 = jscriptRegExp(words, 'g');
  const reWord_1 = jscriptRegExp(words, '');
  let ind = 0;

  if (count_True > Max_tsitat) count_True = Max_tsitat; //  контрольное ограничение числа цитат

  for (n = 0; n < count_True; n++) {
    ind = 0;
    MTrue2[n] = [];
    if (MTrue[n].search(reTrueS_) != -1) MTrue2[n][ind] = '                                   ◊ ◊ ◊ ◊ ◊';
    else MTrue2[n][ind] = '                                      ◊ ◊ ◊'; //  Добавление обычного и особого заголовка
    ind++;
    let TrueZit = '';
    TrueZit = '    ' + MTrue[n].replace(reS50, reS50_).replace(reS60, reS60_); //  Обработка цитат.
    // eslint-disable-next-line eqeqeq -- the original's test: a remainder of spaces counts as 0
    while (TrueZit != 0) {
      //  Разбивка цитат на строки
      MTrue2[n][ind] = TrueZit.replace(reZit, reZit_1);
      if (MTrue2[n][ind] != '' && MTrue2[n][ind].match(reZitTest).length > strLength) {
        //  В случае ошибки основной формулы...
        reZit = reZitAlt; //  меняем ее на альтернативную
        MTrue2[n][ind] = TrueZit.replace(reZit, reZit_1); //  и пересчитываем ошибочную строку
      }
      //  Подчеркивание ключевых слов
      if (Podcherkivat_slova && MTrue2[n][ind].search(reWord_0) != -1) {
        mWords = MTrue2[n][ind].match(reWord_0);
        for (let k = 0; k < mWords.length; k++) {
          mWords[k] = mWords[k].replace(/(.)/g, '$1̲').replace(/^(.)/g, '̲$1'); //  Добавление подстрочных знаков подчеркивания
          MTrue2[n][ind] = MTrue2[n][ind].replace(reWord_1, mWords[k]); //  Замена обычных слов в строке на подчеркнутые
        }
      }
      //   сохранение остатка цитаты
      const rest = TrueZit.replace(reZit, reZit_2);
      ind++;
      // A text the expression cannot take apart (a line break in it) would stay as it is for ever.
      if (rest === TrueZit) break;
      TrueZit = rest;
      if (ctx.cancelled) return null;
    }
    MTrue2[n][ind] = '\t\t\t\t\t\t        ';
    ind++; //  Пустая строка после цитаты
  }

  /// ОКНО РЕЗУЛЬТАТОВ: one window, which scrolls (the original's pages are gone, see the notes)
  const Najdeno = tx(['Найдена ', 'Найдены ', 'Найдено '], ['Found ', 'Found ', 'Found ']);
  const tsitat = tx([' цитата', ' цитаты', ' цитат'], [' quote', ' quotes', ' quotes']);
  const plural = (count) => (tx('ru', 'en') === 'ru' ? pad(count) : count === 1 ? 0 : 2);
  let mSt = [];
  mSt.push(' ' + ScriptName + ' v.' + NumerusVersion);
  mSt.push('-------------------------------------------------------');
  if (count_True) mSt.push('• ' + Najdeno[plural(count_True)] + count_True + tsitat[plural(count_True)] + ':');
  mSt.push('\t\t\t\t\t\t        ');
  for (n = 0; n < count_True; n++) mSt = mSt.concat(MTrue2[n]); //  Добавление всех строк цитаты.
  let mPage = '';
  for (let k = 0; k < mSt.length; k++) mPage += mSt[k] + '\n';
  if (count_True == 0) mPage += tx('>>  Цитаты не найдены', '>>  No quotes found');
  mPage = mPage.replace(/\s+$/g, ''); //  удаление пробельных символов в конце единственной страницы
  await mfbe.ui.message(mPage);

  /// СОХРАНЕНИЕ  :  Сборка текста цитат в буфер обмена
  if (count_True && SaveTsitat) {
    const answer = await mfbe.ui.message(
      tx('◊  Сохранить текст цитат                 \n           в буфер обмена?', '◊  Save the text of the quotes\n           to the clipboard?'),
      {
        icon: 'question',
        buttons: [
          { id: 'yes', label: tx('Да', 'Yes'), default: true },
          { id: 'no', label: tx('Нет', 'No'), cancel: true },
        ],
      },
    );
    if (answer === 'yes') {
      //  "Шапка"
      let textTsitat =
        '     ' + ScriptName + ' v.' + NumerusVersion + '\n' +
        '     [' + Najdeno[plural(count_True)] + count_True + tsitat[plural(count_True)] + ']\n' +
        '     ______________________________\n\n';
      //  Цитаты
      for (n = 0; n < count_True; n++) {
        textTsitat += '     ' + MTrue[n].replace(/ \/&\/  /g, '\n     ').replace(reS50, reS50_).replace(new RegExp(nbspEntity, 'g'), ' ') + '\n\n';
      }
      //  Данные книги: the authors of <title-info> (first, middle and last name) and the title
      const info = doc.description?.titleInfo ?? {};
      let authorNameS = '';
      for (const author of info.authors?.length ? info.authors : [{}]) {
        const firstName = author.firstName ?? '';
        const middleName = author.middleName ?? '';
        const lastName = author.lastName ?? '';
        let authorName = '';
        if (firstName != '') authorName += ' ' + firstName; //  Имя
        if (middleName != '') authorName += ' ' + middleName; //  Имя + Отчество
        if (lastName != '') authorName += ' ' + lastName; //  Имя + Отчество + Фамилия
        if (authorName != '') authorNameS += ',' + authorName; //  добавление этого ФИО в строку авторов
      }
      authorNameS = authorNameS.replace(/^, /, '');
      const bookTitle = info.bookTitle ?? ''; //  Получение названия книги
      if (authorNameS != '' || bookTitle != '') {
        textTsitat += '     ______________________________\n' + tx('     (из книги:  ', '     (from the book:  ');
        if (authorNameS != '') textTsitat += authorNameS;
        if (authorNameS != '' && bookTitle != '') textTsitat += '.  ';
        if (bookTitle != '') textTsitat += '«' + bookTitle + '»';
        textTsitat += ')\n\n';
      }
      await mfbe.clipboard.writeText(textTsitat); //  сохранение в буфер обмена
    }
  }
  return mPage;
}
