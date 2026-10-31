// Converted from FictionBook Editor 2.7.9: Scripts/09_Стихи/10_Создать (под)заголовки из первых строк стихов, ориентируясь по абзацам-звездочкам....js
// In a collection of poems separated by lines of asterisks, gives each poem a section title - or a
// subtitle - made from its first line, «Первая строка…», marks up the epigraphs written with the
// marks «%» (end of the epigraph) and «@» (its author), and reports the counts. After its help
// and its questions (plain asterisk lines, asterisk subtitles, titles or subtitles, the least
// number of lines of a poem), the original rewrote the first body's innerHTML with regular
// expressions; the same expressions run here, as written, on the body's HTML as IE wrote it, on the
// emulation of the editor's page (lib/fbe-dom.js), and the paragraphs and containers the
// expressions leave as they were keep what that page did not show (restoreOrigins).
// Fixes: a non-breaking space between the asterisks counts as a space (the pattern used
// nbspEntity before it was set, so it held the word "undefined" instead of &nbsp;); asterisk lines
// in a section annotation lose their protection marks at the end (the original removed the marks
// ☺…☻ in cites, poems, stanzas and epigraphs only, and left them in the text of annotations).
// The original's notice, kept as written (FR-029):
// «Создать (под)заголовки из первых строк стихов, ориентируясь по абзацам-звездочкам...» для редактора Fiction Book Editor (FBE).
// Версия 1.0.
// Автор stokber.
//
	// проверка на наличие тегов с "id" и "style":

import { FbePage, commitPage, restoreOrigins, snapshotOrigins } from './lib/fbe-dom.js';
import { jscriptRegExp as jre } from './lib/jscript-regexp.js';

function tr(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

export default async function run(ctx) {
  const name = 'Создать (под)заголовки из первых строк стихов, ориентируясь по абзацам-звездочкам...';
  const version = '1.0';
  const help = tr(ctx,
    'Справка\n\nСкрипт предназначен для создания заголовков стихотворений, в которых эту роль выполняют строки состоящие обычно из звёздочек. Сценарий находит первую строку стихотворения и создаёт из неё заголовок. В книгах часто такие строки-звездочки используются не только как разделители отдельных стихов друг от друга. Часто ими могут отделяться и разделы не только стихов. Как правило, в сборниках стихов такое случается редко. Скрипт постарается из таких групп звёздочек не создавать заголовки. Определяет это он по длине строк — они не должны быть слишком длинными. Если в вашем документе после строки со звёздочками находятся короткие прозаические строки, то чтобы скрипт из них не создавал заголовки, можно увеличить количество строк, которые скрипт будет считать стихом. В самом крайнем случае придётся такие строки-звездочки оградить от действия скрипта, добавив в них любой символ отличный от звёздочки и пробела. Например:\n***#.\nИногда после строки со звёздочками идут не сразу стихи, а эпиграф к ним. В таком случае, перед тем как запустить этот скрипт, такие стихи, а вернее заголовки к ним придётся разметить вручную, иначе в заголовках окажется содержание первой строки эпиграфа. Есть также вариант пометить специальной меткой конец эпиграфа. По умолчанию это знак процента \'%\', проставленный в конце эпиграфа, в последней его строке. Также можно проставить и специальный знак автора эпиграфа в виде символа \'@\' в начале строк с именами авторов. В таком случае скрипт сам разметит эпиграфы их авторов.\nНо делать это  (расставлять такие метки) нужно очень аккуратно, чтобы не нарушить валидность документа. Помните, что эпиграф следует сразу за заголовком раздела, а имена авторов должны быть строго в последних строках эпиграфа. Например:\n\n***\nТоску и грусть, страданья, самый ад,\nВсё в красоту она преобразила.\n@Гамлет%\n\nЯ шел во тьме к заботам и веселью,\nВверху сверкал незримый мир духов.\nЗа думой вслед лилися трель за трелью\nНапевы звонкие пернатых соловьев…\n\n- - - - -\n\nЕсли вы выбрали форматирование Подзаголовками, то эпиграфы размечаться не будут.\n\n=============================\n\n«' + name + '» v.' + version + '.',
    'Help\n\nThe script creates the titles of poems where lines usually made of asterisks play that role. It finds the first line of a poem and makes a title of it. In books such asterisk lines often separate not only poems from each other but other parts of the text as well; in collections of poems that is rare. The script tries not to make titles from such groups of asterisks, judging by the length of the lines: they must not be too long. If short prose lines follow an asterisk line in your document, you can raise the number of lines the script takes for a poem, so that it makes no titles of them. As a last resort, protect such asterisk lines from the script by adding to them any character other than an asterisk or a space, for example:\n***#.\nSometimes an asterisk line is followed not by the poem itself but by its epigraph. Then, before running this script, mark up such poems - their titles, rather - by hand, or the titles will hold the first line of the epigraph. You can also mark the end of the epigraph with a special mark, by default the percent sign \'%\' at the end of its last line, and the lines with the names of its authors with \'@\' at their start. Then the script marks up the epigraphs and their authors itself.\nBut put such marks very carefully, so as not to break the validity of the document. Remember that an epigraph comes right after the title of its section, and the names of the authors must be in the last lines of the epigraph. For example:\n\n***\nТоску и грусть, страданья, самый ад,\nВсё в красоту она преобразила.\n@Гамлет%\n\nЯ шел во тьме к заботам и веселью,\nВверху сверкал незримый мир духов.\nЗа думой вслед лилися трель за трелью\nНапевы звонкие пернатых соловьев…\n\n- - - - -\n\nWith subtitles chosen, epigraphs are not marked up.\n\n=============================\n\n«' + name + '» v.' + version + '.');
  const alert = (text) => MsgBox(text, name);
  const confirm = async (text) => (await MsgBox(text, name, 1 + 32)) == 1;
  const prompt = (text, value) => InputBox(text, name, String(value));

  const snapshot = await mfbe.doc.get();
  const page = new FbePage(snapshot);
  const fbwBody = page.fbwBody;
  let body = fbwBody.firstChild;
  while (body && body.className != 'body') body = body.nextSibling;
  if (body == null) {
    await alert(tr(ctx, 'В документе не найдено ни одного раздела body. Скрипт завершает свою работу.', 'The document has no body. The script stops.'));
    return true;
  }
  await alert(help);

  const sIB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>';
  const fIB = '</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';
  const aIB = '<EM>|<STRONG>|<EM><STRONG>|<STRONG><EM>|</EM>|</STRONG>|</EM></STRONG>|</STRONG></EM>';
  let astNormCountStart;
  let astSubTitleCountStart;
  let astCountStart;
  let epigCountStart;
  let authorCountStart;

  // проверка на наличие тегов с "id" и "style":
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

  // nbspEntity as the original's try block sets it with the editor's non-breaking space (fix: the
  // original built `ast` before that block, with nbspEntity still undefined).
  const nbspChar = ' ';
  const nbspEntity = '&nbsp;';
  const ast = '(?:(?:\\s|' + nbspEntity + '|' + aIB + ')*?[*](?:\\s|' + nbspEntity + '|' + aIB + ')*?)+';
  const astNewRegexp = jre('<P( class=subtitle)?>' + ast + '</P>', 'g');
  astCountStart = (body.innerHTML.match(astNewRegexp) || []).length;
  astNormCountStart = jre('<P>' + ast + '</P>', 'g');
  astSubTitleCountStart = jre('<P class=subtitle>' + ast + '</P>', 'g');

  if (astCountStart == 0) {
    await alert(tr(ctx, 'В документе не найдено подходящих строк-звёздочек для создания заголовков стихов. Скрипт завершает свою работу.',
      'The document has no suitable asterisk lines to make titles of poems from. The script stops.'));
    return true;
  }

  // выбор
  const questNormal = await confirm(tr(ctx, 'Создавать ли заголовки из обычных строк-звёздочек?', 'Make titles from plain asterisk lines?'));
  const questSubtitle = await confirm(tr(ctx, 'Создавать ли заголовки из подзаголовков-звёздочек?', 'Make titles from asterisk subtitles?'));
  if (questNormal == false && questSubtitle == false) {
    await alert(tr(ctx, 'Вы не выбрали источник заголовков.\nСкрипт завершает свою работу.\n\n«' + name + '» v.' + version + '.',
      'You chose no source of titles.\nThe script stops.\n\n«' + name + '» v.' + version + '.'));
    return true;
  }
  if (questNormal == true && questSubtitle == false) {
    if (astNormCountStart.test(body.innerHTML) == false) {
      await alert(tr(ctx, 'В документе не найдено подходящих строк-звёздочек обычным текстом для создания заголовков стихов. Скрипт завершает свою работу.\n\n«' + name + '» v.' + version + '.',
        'The document has no suitable plain asterisk lines to make titles of poems from. The script stops.\n\n«' + name + '» v.' + version + '.'));
      return true;
    }
  }
  if (questNormal == false && questSubtitle == true) {
    if (astSubTitleCountStart.test(body.innerHTML) == false) {
      await alert(tr(ctx, 'В документе не найдено подходящих подзаголовков-звёздочек обычным текстом для создания заголовков стихов. Скрипт завершает свою работу.\n\n«' + name + '» v.' + version + '.',
        'The document has no suitable asterisk subtitles to make titles of poems from. The script stops.\n\n«' + name + '» v.' + version + '.'));
      return true;
    }
  }

  const questTag = await confirm(tr(ctx,
    'Выберите тип оформления: Заголовки или Подзаголовки. Кликните «Да», чтобы названия стихов по первой строке размечались как Заголовки разделов, или «Отмена», чтобы размечались как Подзаголовки.',
    'Choose the formatting: titles or subtitles. Click «OK» to mark up the names of the poems made from their first lines as section titles, or «Cancel» to mark them up as subtitles.'));

  let colStr;
  while (colStr < 1 || /\D/.test(colStr) == true) {
    colStr = await prompt(tr(ctx,
      'Введите минимальное количество строк (целое число от 1 и больше, без пробелов по краям), которое скрипт будет считать стихом.',
      'Enter the least number of lines (a whole number from 1 up, without spaces around it) that the script takes for a poem.'), 4);
    if (colStr == null) return true;
  }
  colStr--;

  let str; // строка заголовка до.
  let str2; // строка заголовка после.
  const colSymbStrMin = 1;
  const colSymbStrMaxHtml = 400;
  const colSymbStrMaxText = 80;
  const labelEpi = '%';
  const labelAuthor = '@';

  const Ts = Date.now();
  let TimeStr = 0;

  const counterBefore = () => {
    const fromHTML = fbwBody.innerHTML;
    astCountStart = (fromHTML.match(astNewRegexp) || []).length;
    epigCountStart = (fromHTML.match(/<DIV class=epigraph>/g) || []).length;
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
    const astCountEnd = (fromHTML.match(astNewRegexp) || []).length;
    const epigCountEnd = (fromHTML.match(/<DIV class=epigraph>/g) || []).length;
    const authorCountEnd = (fromHTML.match(/<P class=text-author>/g) || []).length;
    const astCount = astCountStart - astCountEnd;
    const epigCount = epigCountEnd - epigCountStart;
    const authorCount = authorCountEnd - authorCountStart;
    secToMsec();
    await alert(tr(ctx,
      'Размечено:\nЗаголовков/подзаголовков: ' + astCount + '\nЭпиграфов: ' + epigCount + '\nАвторов эпиграфов: ' + authorCount + '\n\nВремя выполнения скрипта: ' + TimeStr + '\n\n«' + name + '» v.' + version,
      'Marked up:\nTitles/subtitles: ' + astCount + '\nEpigraphs: ' + epigCount + '\nEpigraph authors: ' + authorCount + '\n\nTime taken: ' + TimeStr + '\n\n«' + name + '» v.' + version));
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
  // создание содержания заголовка:
  const titlAst = (s) => {
    s = s.replace(jre('<sup>.+?</sup>|\\[\\d+\\]|\\{\\d+\\}|\\*', 'igm'), '');
    s = s.replace(jre('\\r\\n', 'igm'), ' ');
    s = s.replace(jre('</?[^>]+>', 'igm'), '');
    s = s.replace(/&nbsp;/g, ' ');
    s = s.replace(jre('^[\\s □▫◦]+|[\\s □▫◦]+$', 'gm'), '');
    s = s.replace(jre('\\r\\n', 'igm'), ' ');
    s = s.replace('^(.|[\\r\\n])+?' + labelEpi, 'img', '');
    s = s.replace(jre('^«([^«»]+)»[.,;:…\\s □▫◦«;—–-]*$', 'igm'), '$1');
    s = s.replace(jre('^„([^„“]+)“[.,;:…\\s □▫◦«;—–-]*$', 'igm'), '$1');
    s = s.replace(jre('[.,;:…\\s □▫◦«;—–-]+$', 'g'), '');
    s = s.replace(jre('^[\\s □▫◦—–-]+', 'g'), '');
    s = s.replace(/([*\wа-яё“»)])$/gi, '$1…»');
    s = s.replace(/([!?])$/gi, '$1..»');
    s = s.replace(/(\?!|!\?)\.\.»$/gi, '$1.»');
    s = s.replace(/!!!\.\.»$/gi, '!!!»');
    s = s.replace(/\?\?\?\.\.»$/gi, '???»');
    s = s.replace(/^/gi, '«');
    s = s.replace(/^««/gi, '«„');
    s = s.replace(/»»/gi, '»“');
    s = s.replace(jre('^«.+»$', 'g'), (match) => match.replace(/(.)«/g, '$1„'));
    s = s.replace(jre('^«.+»$', 'g'), (match) => match.replace(/»(.)/g, '“$1'));
    s = s.replace(/\.\.\./gi, '…');
    str2 = s;
    return str2;
  };

  let astS;
  if (questNormal == true && questSubtitle == false) astS = '<P>' + ast + '</P>\\r\\n';
  if (questNormal == false && questSubtitle == true) astS = '<P(?: class=subtitle)>' + ast + '</P>\\r\\n';
  if (questNormal == true && questSubtitle == true) astS = '<P(?: class=subtitle)?>' + ast + '</P>\\r\\n';

  const zamena = () => {
    // простановка меток звёздочек в DIV-ах:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=(cite|poem|stanza|epigraph|annotation|text-author)>(.|[\\r\\n])+?</DIV>\\r\\n', 'igm'), (match) =>
      match.replace(jre('<P>(' + ast + ')</P>', 'igm'), '<P>☺$1☻</P>'));

    // удалить пустые строки примыкающие к строкам-звёздочкам:
    body.innerHTML = body.innerHTML.replace(jre('((?:<P>(?:\\s|&nbsp;|□|' + aIB + ')+</P>\\r\\n)+)(<P(?: class=subtitle)?>(' + ast + ')</P>\\r\\n)', 'igm'), '$2');
    body.innerHTML = body.innerHTML.replace(jre('(<P(?: class=subtitle)?>(' + ast + ')</P>\\r\\n)((?:<P>(?:\\s|&nbsp;|□|' + aIB + ')+</P>\\r\\n)+)', 'igm'), '$1');

    const epi = '(?:(?:<P>.{1,' + colSymbStrMaxHtml + '}</P>\\r\\n){0,3}(?:<P>.{1,' + colSymbStrMaxHtml + '}' + labelEpi + '(?:' + fIB + ')?</P>\\r\\n))?';
    const epiReal = '(?:(?:<P>.{1,' + colSymbStrMaxHtml + '}</P>\\r\\n){0,3}(?:<P>.{1,' + colSymbStrMaxHtml + '}' + labelEpi + '(?:' + fIB + ')?</P>\\r\\n))';
    const empty_Line = '(?:<P>(?:\\s|&nbsp;|□|' + aIB + ')*</P>\\r\\n)?';
    // добавление пустой строки между заголовком и строкой со звёздочками для будущей валидности:
    body.innerHTML = body.innerHTML.replace(jre('(<DIV class=title>(?:\\r\\n<P>.+</P>){1,5}</DIV>\\r\\n)(<P>' + ast + '</P>\\r\\n(?:<P>(?:' + empty_Line + ')</P>\\r\\n){0,1}(' + epi + empty_Line + ')((<P>(.{' + colSymbStrMin + ',' + colSymbStrMaxHtml + '})</P>\\r\\n)(?:(?:<P>.{' + colSymbStrMin + ',' + colSymbStrMaxHtml + '}</P>\\r\\n' + empty_Line + '){' + colStr + '})))', 'mgi'), (match) => {
      if (findLongestStringLength(match) < colSymbStrMaxText) {
        return match.replace(jre('(<DIV class=title>(?:\\r\\n<P>.+</P>){1,5}</DIV>\\r\\n)', 'igm'), '$1<P>' + nbspChar + '</P>');
      }
      return match;
    });

    // создание заголовка:
    body.innerHTML = body.innerHTML.replace(jre(astS + '(?:<P>(?:' + empty_Line + ')</P>\\r\\n){0,1}(' + epi + empty_Line + ')((<P>(?!' + ast + ')(.{' + colSymbStrMin + ',' + colSymbStrMaxHtml + '})</P>\\r\\n)(?:(?:<P>(?!' + ast + ').{' + colSymbStrMin + ',' + colSymbStrMaxHtml + '}</P>\\r\\n' + empty_Line + '){' + colStr + '}))', 'mgi'), (match, p1, p2, p3) => {
      str = p3;
      if (findLongestStringLength(p2) < colSymbStrMaxText) {
        titlAst(str);
        // для заголовка:
        if (questTag == true) return match.replace(jre('(.|[\\r\\n])+', 'mgi'), '</DIV><DIV class=section><DIV class=title><P>' + str2 + '</P></DIV>' + p1 + p2);
        // для подзаголовка:
        return match.replace(jre('(.|[\\r\\n])+', 'mgi'), '<P class=subtitle>' + str2 + '</P>' + p1 + p2);
      }
      return match;
    });

    // удаление пустых строк в эпиграфе и после:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=title>\\r\\n<P>.+</P></DIV>\\r\\n' + epiReal + '(<P>&nbsp;</P>\\r\\n){0,1}.', 'igm'), (match) =>
      match.replace(jre('<P>&nbsp;</P>\\r\\n', 'igm'), ''));
    // создание эпиграфов при наличии меток:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=title>\\r\\n<P>.+</P></DIV>\\r\\n' + epiReal, 'igm'), (match) =>
      match.replace(jre(epiReal, 'igm'), '<DIV class=epigraph>$&</DIV>'));
    // создание автора эпиграфов при наличии меток:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=epigraph>(.|[\\r\\n])+?</DIV>\\r\\n', 'igm'), (match) =>
      match.replace(jre('<P>((?:' + sIB + ')?' + labelAuthor + '.+?)</P>', 'igm'), '<P class=text-author>$1</P>'));
    // удаление меток:
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=epigraph>(.|[\\r\\n])+?</DIV>\\r\\n', 'igm'), (match) =>
      match.replace(jre(labelEpi + '|' + labelAuthor, 'igm'), ''));
    // удаление меток звёздочек в DIV-ах (fix: also in annotations, where they were set):
    body.innerHTML = body.innerHTML.replace(jre('<DIV class=(cite|poem|stanza|epigraph|annotation)>(.|[\\r\\n])+?</DIV>\\r\\n', 'igm'), (match) =>
      match.replace(jre('<P>☺(' + ast + ')☻</P>', 'igm'), '<P>$1</P>'));
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
