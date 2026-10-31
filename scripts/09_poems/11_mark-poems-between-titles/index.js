// Converted from FictionBook Editor 2.7.9: Scripts/09_Стихи/11_Разметка стихов между разделами с заголовками.js
// Marks up as a poem each run of at least the given number of short paragraphs (all shorter than
// 80 characters) that is the whole text between a title, a subtitle, the start of a section, an
// epigraph or - if asked - a picture, and the next section, title, subtitle or picture: empty
// lines become stanza breaks, a date line (a year 1700-2029) and the lines after it become text
// authors (their italics and bold removed, if asked), asterisk subtitles inside sections become
// plain lines (if asked) and, inside a poem, a stanza of their own; reports the counts. After its
// questions the original rewrote the first body's innerHTML with regular expressions; the same
// expressions run here, as written, on the body's HTML as IE wrote it, on the emulation of the
// editor's page (lib/fbe-dom.js), and the paragraphs and containers the expressions leave as they
// were keep what that page did not show (restoreOrigins).
// The original's notice, kept as written (FR-029):
// Скрипт «Разметка стихов между разделами с заголовками» для редактора Fiction Book Editor (FBE).
// Версия 1.22. (сентябрь 2024)
// Автор stokber.
//
	// проверка наналичие тегов с "id" и "style":
			// return true;
			// return true;

import { FbePage, commitPage, restoreOrigins, snapshotOrigins } from './lib/fbe-dom.js';
import { jscriptRegExp as jre } from './lib/jscript-regexp.js';

function tr(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const version = 1.22;
  const title = 'Разметка стихов между разделами с заголовками';
  const alert = (text) => MsgBox(text, title);
  const confirm = async (text) => (await MsgBox(text, title, 1 + 32)) == 1;
  const prompt = (text, value) => InputBox(text, title, String(value));

  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  const fbwBody = page.fbwBody;
  let body = fbwBody.firstChild;
  while (body && body.className != 'body') body = body.nextSibling;
  if (!body) return;

  // проверка наналичие тегов с "id" и "style":
  const countId = (body.innerHTML.match(/<(P|DIV) id=[^>]+?>/g) || []).length;
  if (countId != 0) {
    await alert(tr(ctx, 'В документе найдено ' + countId + " тегов с атрибутом 'id'. Скрипт не работает с такими тегами. Стихи, окружённые ими размечены не будут.",
      'The document has ' + countId + " tags with an 'id' attribute. The script does not work with such tags; the poems they surround will not be marked up."));
  }
  const countStyle = (body.innerHTML.match(/<(P|DIV) [^>]*style=[^>]+>/g) || []).length;
  if (countStyle != 0) {
    await alert(tr(ctx, 'В документе найдено ' + countStyle + " тегов с атрибутом 'style'. Скрипт не работает с такими тегами. Стихи, окружённые ими размечены не будут.",
      'The document has ' + countStyle + " tags with a 'style' attribute. The script does not work with such tags; the poems they surround will not be marked up."));
  }

  const questImages = await confirm(tr(ctx, 'Размечать ли стихами фрагменты текста примыкающие к картинкам?', 'Mark up as poems the parts of the text next to pictures?'));
  const questFont = await confirm(tr(ctx, 'Удалять ли курсив (жирность) из СТРОК С ДАТИРОВКОЙ СТИХОВ, если вся строка изначально ими сделана?',
    'Remove the italics (bold) from the DATE LINES OF POEMS when the whole line is set in them?'));
  const questAst = await confirm(tr(ctx, 'Расформатировать ли внутрисекционные подзаголовки-звёздочки, КРОМЕ находящихся:\n в начале раздела;\nсразу за заголовком раздела;\nсразу за датами стихотворений?',
    'Unformat the asterisk subtitles inside sections, EXCEPT those:\n at the start of a section;\nright after a section title;\nright after the dates of poems?'));
  const colStr = await prompt(tr(ctx, 'Введите минимальное количество строк, которое скрипт будет считать стихом.', 'Enter the least number of lines that the script takes for a poem.'), 3);
  if (colStr == null) {
    await alert(tr(ctx, 'Вы отменили запуск скрипта\n«Разметка стихов между разделами с заголовками» v.' + version + '.\n\nСтихи размечены не будут.',
      'You cancelled the run of the script\n«Разметка стихов между разделами с заголовками» v.' + version + '.\n\nNo poems will be marked up.'));
    return true;
  }

  const Ts = Date.now();
  let TimeStr = 0;
  // The editor's non-breaking space is U+00A0: the original's nbspEntity is then "&nbsp;".
  const nbspEntity = '&nbsp;';

  let poemCountStart;
  let stanzaCountStart;
  let authorCountStart;
  const colSymbStrMin = 1;
  const colSymbStrMaxHtml = 400;
  const colSymbStrMaxText = 80;
  // метка конца документа:
  const labelEnd = '<D>%ьЪЬъЬ%ъьЪЬ%</D>';
  const ast = '(?:<(?:EM|STRONG)>)*(?:(?:\\s|' + nbspEntity + ')*[*](?:\\s|' + nbspEntity + ')*)+(?:</(?:EM|STRONG)>)*';
  const empty_Line = '(?:<P>&nbsp;</P>\\r\\n)*';

  let beforePoem;
  let afterPoem;
  if (questImages == true) {
    // два регекспа без оформления с картинками и два ниже без картинок:
    beforePoem = '<DIV class=title>(?:\\r\\n<P>.+</P>){1,5}</DIV>|<P class=subtitle>.+?</P>|<DIV class=section>|<DIV class=epigraph>(?:\\r\\n<P>.+?</P>)+(?:\\r\\n<P class=text-author>.+?</P>)*</DIV>|<DIV onresiz.+?</DIV>';
    afterPoem = '\\r\\n((?:<P>[^\\r\\n©@]{' + colSymbStrMin + ',' + colSymbStrMaxHtml + '}?\\r\\n){' + colStr + ',})(?!<DIV onrezistart|<DIV class=(title|poem|stanza|cite|epigraph)>)(?=<DIV class=section>|<DIV class=title>|<DIV class=body|<P class=subtitle>|<DIV id=fbw_updater style|<DIV onresiz.+?</DIV>|$)';
  } else {
    beforePoem = '<DIV class=title>(?:\\r\\n<P>.+</P>){1,5}</DIV>|<P class=subtitle>.+?</P>|<DIV class=section>|<DIV class=epigraph>(?:\\r\\n<P>.+?</P>)+(?:\\r\\n<P class=text-author>.+?</P>)*</DIV>|<DIV class=onresiz.+?</DIV>';
    afterPoem = '\\r\\n((?:<P>[^\\r\\n©@]{' + colSymbStrMin + ',' + colSymbStrMaxHtml + '}?\\r\\n){' + colStr + ',})(?!<DIV onrezistart|<DIV class=(title|poem|stanza|cite|epigraph)>)(?=<DIV class=section>|<DIV class=title>|<DIV class=body|<P class=subtitle>|<DIV id=fbw_updater style)';
  }

  const data = '(?:<(?:EM|STRONG)>)*(?:.*\\D)?(?:1[789][0-9][0-9]|20[0-2][0-9])(?!(?:[0-9]| год[а-я]|[-](?:й|е|х|м|го)))(?:.*[^.])?(?:</(?:EM|STRONG)>)*';

  const counterBefore = () => {
    const fromHTML = fbwBody.innerHTML;
    poemCountStart = (fromHTML.match(/<DIV class=poem>/g) || []).length;
    stanzaCountStart = (fromHTML.match(/<DIV class=stanza>/g) || []).length;
    authorCountStart = (fromHTML.match(/<P class=text-author>/g) || []).length;
  };
  const secToMsec = () => {
    const Tf = Date.now();
    const Thour = Math.floor((Tf - Ts) / 3600000);
    const Tmin = Math.floor((Tf - Ts) / 60000 - Thour * 60);
    const Tsec = Math.ceil((Tf - Ts) / 1000 - Tmin * 60 - Thour * 3600);
    const Tsec1 = Math.ceil(10 * ((Tf - Ts) / 1000 - Tmin * 60)) / 10;
    const Tsec2 = Math.ceil(100 * ((Tf - Ts) / 1000 - Tmin * 60)) / 100;
    const Tsec3 = Math.ceil(1000 * ((Tf - Ts) / 1000 - Tmin * 60)) / 1000;
    const sec = tr(ctx, ' сек', ' s');
    if (Tsec3 < 1 && Tmin < 1) TimeStr = Tsec3 + sec;
    else if (Tsec2 < 10 && Tmin < 1) TimeStr = Tsec2 + sec;
    else if (Tsec1 < 30 && Tmin < 1) TimeStr = Tsec1 + sec;
    else if (Tmin < 1) TimeStr = Tsec + sec;
    else if (Tmin >= 1 && Thour < 1) TimeStr = Tmin + tr(ctx, ' мин ', ' min ') + Tsec + tr(ctx, ' с', ' s');
    else if (Thour >= 1) TimeStr = Thour + tr(ctx, ' ч ', ' h ') + Tmin + tr(ctx, ' мин ', ' min ') + Tsec + tr(ctx, ' с', ' s');
  };
  const counterAfter = async () => {
    const fromHTML = fbwBody.innerHTML;
    const poemCount = (fromHTML.match(/<DIV class=poem>/g) || []).length - poemCountStart;
    const stanzaCount = (fromHTML.match(/<DIV class=stanza>/g) || []).length - stanzaCountStart;
    const authorCount = (fromHTML.match(/<P class=text-author>/g) || []).length - authorCountStart;
    secToMsec();
    await MsgBox(tr(ctx,
      '\tРазмечено:\nСтихов: \t' + poemCount + '\nСтроф:  \t' + stanzaCount + '\nДат:    \t' + authorCount + '\n\nВремя выполнения скрипта: \t' + TimeStr + '\n\n«Разметка стихов между разделами с заголовками» v.' + version,
      '\tMarked up:\nPoems: \t' + poemCount + '\nStanzas:  \t' + stanzaCount + '\nDates:    \t' + authorCount + '\n\nTime taken: \t' + TimeStr + '\n\n«Разметка стихов между разделами с заголовками» v.' + version), title);
  };

  // функция определения количества символов самой длинной строки (Text) в фрагменте:
  const findLongestStringLength = (txt) => {
    txt = txt.replace(/<[^>]*>/g, '');
    txt = txt.replace(/^&nbsp;$/g, '');
    txt = txt.replace(/&nbsp;/g, ' ');
    const txtSplit = txt.split('\r\n');
    let longestLength = 0;
    for (let i = 0; i < txtSplit.length; i++) {
      if (txtSplit[i].length > longestLength) longestLength = txtSplit[i].length;
    }
    return longestLength;
  };

  const zamena = () => {
    // проставить метку конца документа:
    body.innerHTML = body.innerHTML.replace(jre('(.|[\\r\\n])+', 'i'), '$&<P class=subtitle>' + labelEnd + '</P>');

    if (questAst == true) {
      //разбираемся с подзаголовками-звёздочками:
      //вплотную к дате:
      body.innerHTML = body.innerHTML.replace(jre('(<P>' + data + '</P>)\\r\\n' + empty_Line + '(<P class=subtitle>)(' + ast + ')</P>', 'mgi'), '$1$2☺$3☺</P>');
      //вплотную к разделу:
      body.innerHTML = body.innerHTML.replace(jre('(<DIV class=section>)\\r\\n' + empty_Line + '(<P class=subtitle>)(' + ast + ')</P>', 'mgi'), '$1$2☺$3☺</P>');
      //вплотную к заголовку:
      body.innerHTML = body.innerHTML.replace(jre('(<DIV class=title>(?:\\r\\n<P>.+</P>){1,5}</DIV>)\\r\\n' + empty_Line + '(<P class=subtitle>)(' + ast + ')</P>', 'mgi'), '$1$2☺$3☺</P>');
      body.innerHTML = body.innerHTML.replace(jre('(<P class=subtitle>)(' + ast + ')</P>', 'gi'), '<P>☻$2☻</P>');
    }

    // проставить теги poem:
    body.innerHTML = body.innerHTML.replace(jre('(' + beforePoem + ')(' + afterPoem + ')', 'igm'), (match, p1, p2) => {
      const txt = p2;
      // убираем пустые строки из подсчета минимального кол. строк предполагаемого стиха:
      const colLine = txt.split('\r\n').length - 2;
      const colEmptyLine = (txt.match(/<P>&nbsp;<\/P>/g) || []).length;
      if (colLine < colStr + 2 && colLine - colEmptyLine < colStr) return match;
      if (findLongestStringLength(txt) < colSymbStrMaxText) {
        return match.replace(jre('(.|[\\r\\n])+', 'igm'), p1 + '<DIV class=poem><DIV class=stanza>' + p2 + '</DIV></DIV>');
      }
      return match;
    });

    // `if(questAst = true)` in the original: an assignment, so this part always runs.
    // поправить звездочки внутри стихов:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=poem>(.|[\\r\\n])+?</DIV>', 'igm'), (match) =>
      match.replace(jre('<P>☻(' + ast + ')☻</P>', 'ig'), '<P>$1</P>'));
    body.innerHTML = body.innerHTML.replace(jre('<P>☻(' + ast + ')☻</P>', 'gi'), '<P class=subtitle>$1</P>');
    body.innerHTML = body.innerHTML.replace(jre('<P class=subtitle>☺(' + ast + ')☺</P>', 'gi'), '<P class=subtitle>$1</P>');
    // обрамить пустыми строками обычные строки-звёздочки:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=poem>(.|[\\r\\n])+?</DIV>', 'igm'), (match) =>
      match.replace(jre('\\r\\n(?!<P>&nbsp;</P>)(<P>' + ast + '</P>)\\r\\n(?!<P>&nbsp;</P>)', 'igm'), '<P>&nbsp;</P>$1<P>&nbsp;</P>'));

    // удалить начальные и конечные пустые строки:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=poem>(.|[\\r\\n])+?</DIV>', 'igm'), (match) =>
      match.replace(jre('<DIV class=stanza>\\r\\n<P>&nbsp;</P>', 'igm'), '<DIV class=stanza>'));
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=poem>(.|[\\r\\n])+?</DIV>', 'igm'), (match) =>
      match.replace(jre('\\r\\n<P>&nbsp;</P></DIV>', 'igm'), '</DIV>'));
    // вставка пустой строки над датой:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=poem>(.|[\\r\\n])+?</DIV>', 'igm'), (match) =>
      match.replace(jre('(?:<P>&nbsp;</P>\\r\\n)?(<P>' + data + '</P>)', 'igm'), '<P>&nbsp;</P>$1'));
    // новые строфы вместо пустых строк:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=poem>(.|[\\r\\n])+?</DIV>', 'igm'), (match) =>
      match.replace(jre('<P>&nbsp;</P>', 'igm'), '</DIV><DIV class=stanza>'));
    // разметить даты и возможные строки ниже тегами "text-author":
    body.innerHTML = body.innerHTML.replace(jre('(<DIV class=stanza>\\r\\n<P>' + data + ')</P>\\r\\n<P>(.+?</P>)</DIV>', 'igm'), '$1</P></DIV><P class=text-author>$2');
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=stanza>\\r\\n<P>(' + data + ')</P></DIV>', 'igm'), '<P class=text-author>$1</P>');
    // удалить метку конца body:
    body.innerHTML = body.innerHTML.replace(jre('<P class=subtitle>' + labelEnd + '</P>', 'i'), '');

    if (questFont == true) {
      // удалить внешние EM/STRONG с дат стихотворений:
      body.innerHTML = body.innerHTML.replace(jre('<DIV class=stanza>(.|[\\r\\n])+?</DIV></DIV>', 'igm'), (match) =>
        match.replace(jre('<P class=text-author>(?:(?:<(?:EM|STRONG)>){1,2})([^<]+)((</(EM|STRONG)>){1,2})</P>', 'img'), '<P class=text-author>$1</P>'));
    }
  };

  const correction = () => {
    // Чистка пустых строк от пробелов и внутренних тегов
    const re212 = jre('^(\\s|' + nbspEntity + '|<[^>]{1,}>){1,}$', 'g');
    const re212ex = jre('<SPAN class=image', 'g');
    const HandleP = (p) => {
      let s = p.innerHTML;
      if (s.search(re212) != -1 && s.search(re212ex) == -1) s = '';
      p.innerHTML = s;
    };
    for (const p of body.getElementsByTagName('P')) HandleP(p);
  };

  const origins = snapshotOrigins(body);
  counterBefore();
  zamena();
  correction();
  restoreOrigins(origins, body);
  await commitPage(page);
  await counterAfter();
}
