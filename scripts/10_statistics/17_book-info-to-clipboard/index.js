// Converted from FictionBook Editor 2.7.9: Scripts/10_Статистика/17_Информацию о книге - в буфер обмена.js
// Gathers the main facts about the book into a text and, when the user agrees, puts it on the
// clipboard: the authors, the title with the date it was written, the series, the language
// (unless Russian), the annotation (cut after about 1,000 characters at the end of a sentence),
// the genres (decoded with the original's table, genres.js), the translation (from which
// language, by whom), the illustrators (custom-info "illustrator"), additional information (the
// pictures, the covers and an estimate of printed pages: 2,000 characters, 35 lines of verse or
// 0.3 megapixels of pictures a page), the print edition, the contents (the titles of the bodies
// and sections; of poems too in a book that is mostly verse) and the number of notes and comments.
// A window first shows what was found and asks whether to send the text. The settings below are
// the original's (compact contents, at most 20 names, about 1,000 characters of annotation, the
// order of the blocks). Languages are decoded with the original's tables (languages.js).
// The English interface gives the labels, genres and languages in English.
// Difference from the original: none in what is gathered; it reads the book's description and
// text from the document model instead of the Description view's fields. See
// docs/scripting/notes-279-drafts/10.md.
// The original's notice, kept as written (FR-029):
//------------------------------------------------------------------------------------------
//             «Информацию о книге – в буфер обмена»
//  Скрипт предназначен для получения основных данных о книге
//  * Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//  **  История изменений в конце скрипта
//------------------------------------------------------------------------------------------
import { GENRE_CODES, GENRE_NAMES_EN, GENRE_NAMES_RU } from './genres.js';
import { LANG_CODES, LANG_NAMES_EN, LANG_NAMES_GENITIVE, LANG_NAMES_NOMINATIVE } from './languages.js';
import { serializeInline } from './lib/legacy-html.js';

const NumerusVersion = '1.3';

// ---------------------------------------------------------------
///  НАСТРОЙКИ (settings)
// ---------------------------------------------------------------
//  Дизайн оглавления ("0" — сжатый, "1" — разряженный)
const Dizajn = 0;
//     Максимальное число имен авторов книги, которое можно добавить в текст
const MaxAuthor = 20;
//     Ориентировочная максимальная длина аннотации (в символах, от 1 до 1000000)
//  * При любом значении максимума, скрипт постарается не обрезать предложения.
const DLINA = 1000;
//  Расположение блоков текста
//  * здесь можно удалять (отправлять в комментарий) лишние блоки, или изменять их очередность.
const mW = [
  'Автор',
  'Название',
  'Серия',
  'Язык книги',
  'Аннотация',
  'Жанр',
  'Перевод',
  'Художник',
  'Дополнительная информация',
  'Печатное издание',
  'Оглавление',
  'Примечания и комментарии',
];

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// JScript's \s: the ASCII white space only.
const S = '[\\t\\n\\v\\f\\r ]';
const nbspEntity = '&nbsp;';

/// Регулярные выражения (общие)
const re01 = /<IMG/g; //  Замена внутренних иллюстраций на текст "&&&".
const re01_ = '&&&<';
const re02 = /<A[^>]{1,}>[^А-яЁёa-z]{1,}?<\/A>/g; //  Удаление текста ссылок.
const re03 = /<[^>]{1,}>/g; //  Удаление тегов.
const re04 = /&&&/g; //  Замена "&&&" на текст "<иллюстрация>".
const re05 = new RegExp(nbspEntity, 'g'); //  Замена символов н/р пробела на обычный неразрывный пробел.
const re06 = /^[  ]{1,}|[  ]{1,}$/g; //  Удаление начальных и конечных пробелов.

/// Функция склонения по падежам в зависимости от числа
function pad(Numer) {
  let ok = 2;
  const m1 = Numer % 10;
  const m2 = Numer % 100;
  if (m2 < 11 || m2 > 19) {
    if (m1 === 1) ok = 0;
    else if (m1 === 2 || m1 === 3 || m1 === 4) ok = 1;
  }
  return ok;
}

/** A counted noun: the original's three Russian forms, or English singular / plural. */
function forms(ctx, n, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru[pad(n)] : en[n === 1 ? 0 : 1];
}

const TEXT_BLOCKS = new Set(['p', 'v', 'subtitle', 'text-author', 'date', 'td', 'th']);
// The class FictionBook Editor 2.7.9 gave the element of each container (files/fb2.xsl).
const DIV_CLASS = {
  body: 'body',
  section: 'section',
  title: 'title',
  epigraph: 'epigraph',
  annotation: 'annotation',
  cite: 'cite',
  poem: 'poem',
  stanza: 'stanza',
  table: 'table',
  tr: 'tr',
  image: 'image',
};

/**
 * The book as FictionBook Editor's fbw_body: the annotation block, the history block (one empty
 * paragraph each when the book has none), then every body. Paragraph items (`p: true`) are the
 * text blocks and the empty lines; containers keep their class.
 */
function buildPage(snapshot) {
  const build = (node, parent) => {
    const isP = TEXT_BLOCKS.has(node.type) || node.type === 'empty-line';
    const item = { node, parent, p: isP, cls: isP ? '' : (DIV_CLASS[node.type] ?? 'x'), children: [] };
    if (!isP && node.type !== 'image') {
      for (const child of node.content ?? []) {
        // Unknown elements (raw XML) were SPANs on FictionBook Editor's page: no P, no DIV.
        if (child && typeof child === 'object' && child.type !== 'text' && child.type !== 'raw-xml') {
          item.children.push(build(child, item));
        }
      }
    }
    return item;
  };
  const root = { cls: 'root', children: [] };
  const block = (cls, node) => {
    const item = { node: node ?? null, parent: root, p: false, cls, children: [] };
    for (const child of node?.content ?? []) if (child.type !== 'raw-xml') item.children.push(build(child, item));
    if (item.children.length === 0) item.children.push({ node: { type: 'p', content: [] }, parent: item, p: true, cls: '', children: [] });
    root.children.push(item);
  };
  block('annotation', snapshot.description?.titleInfo?.annotation);
  block('history', snapshot.description?.documentInfo?.history);
  for (const body of snapshot.bodies ?? []) {
    const item = build(body, root);
    item.fbname = body.attrs?.name ?? '';
    root.children.push(item);
  }
  return root;
}

/** All paragraphs (getElementsByTagName("P")) or containers ("DIV") inside an item. */
function descendants(item, wantP) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.p === wantP) out.push(child);
      if (!child.p) visit(child);
    }
  };
  visit(item);
  return out;
}

/** A paragraph's innerHTML in FictionBook Editor's notation and its innerText. */
function innerHTML(item) {
  return item.node.type === 'empty-line' ? '' : serializeInline(item.node.content ?? [], []);
}

function innerText(item) {
  return (item.node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('');
}

/** The original's clean-up of a line of the annotation or of a title. */
function cleanLine(s0, withImages) {
  let s = s0;
  if (withImages && s.search('<IMG') !== -1) s = s.replace(re01, re01_);
  if (s.search('<') !== -1) s = s.replace(re02, '');
  if (s.search('<') !== -1) s = s.replace(re03, '');
  if (withImages && s.search('&&&') !== -1) s = s.replace(re04, 'ILLUSTRATION_MARK');
  if (s.search(nbspEntity) !== -1) s = s.replace(re05, ' ');
  if (s.search('&') !== -1) {
    s = s.replace(/&nbsp;/g, ' ');
    s = s.replace(/&lt;/g, '<');
    s = s.replace(/&gt;/g, '>');
    s = s.replace(/&shy;/g, '­');
    s = s.replace(/&amp;/g, '&');
  }
  if (s.search(re06) !== -1) s = s.replace(re06, '');
  return s;
}

/** The names of the people of one kind (authors, translators): count and the lines. */
function people(ctx, persons) {
  const list = persons?.length ? persons : [{}];
  let lines = '';
  let count = 0;
  for (const person of list) {
    let name = '';
    if (person.firstName) name += ` ${person.firstName}`;
    if (person.middleName) name += ` ${person.middleName}`;
    if (person.lastName) name += ` ${person.lastName}`;
    if (name !== '') {
      count += 1;
      if (count <= MaxAuthor) lines += `${name}\n`;
      else {
        lines += t(ctx, ' и другие\n', ' and others\n');
        count = list.length;
        break;
      }
    }
  }
  return { lines, count };
}

/** The sequences as the form listed them: every one, nested ones after their parent. */
function flatSequences(sequences) {
  const out = [];
  const visit = (list, depth) => {
    for (const seq of list ?? []) {
      out.push({ seq, depth });
      visit(seq.children, depth + 1);
    }
  };
  visit(sequences, 0);
  // The form shows one empty sequence when the book has none.
  if (out.length === 0) out.push({ seq: { name: '' }, depth: 0 });
  return out;
}

function sequenceText(seq) {
  const seqName = seq.name ?? '';
  let seqNumber = seq.number === undefined || seq.number === null ? '' : `${seq.number}`;
  let text = '';
  if (seqName !== '') text += seqName;
  if (seqNumber !== '') seqNumber = seqNumber.replace(/^0+/, '');
  if (seqNumber !== '') {
    if (seqName !== '') text += '  – ';
    text += seqNumber;
  }
  return text;
}

/** The text of a textarea's innerHTML (the custom-info value). */
function textareaHTML(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

export default async function run(ctx) {
  const Ts = Date.now();
  const ru = ctx.uiLanguage === 'ru';
  const snapshot = await mfbe.doc.get();
  const description = snapshot.description;
  const titleInfo = description.titleInfo ?? {};
  const binaries = await mfbe.doc.binaries();
  const page = buildPage(snapshot);
  const notGiven = t(ctx, ' <не указан>\n', ' <not given>\n');

  /// ЖАНРЫ
  const genreNames = ru ? GENRE_NAMES_RU : GENRE_NAMES_EN;
  let Zhanry = '';
  let count_Genre = 0;
  for (const genre of titleInfo.genres ?? []) {
    let bookGenre = genre.code ?? '';
    if (bookGenre === '') continue;
    count_Genre += 1;
    const k = GENRE_CODES.indexOf(bookGenre);
    if (k >= 0) bookGenre = genreNames[k];
    Zhanry += ` ${bookGenre} ·`;
  }
  if (Zhanry !== '') Zhanry = Zhanry.replace(/ ·$/, '\n');
  else Zhanry = notGiven;

  /// АВТОРЫ
  const authors = people(ctx, titleInfo.authors);
  let Avtory = authors.lines;
  const count_Author = authors.count;
  if (count_Author === 0) Avtory = notGiven;

  /// НАЗВАНИЕ
  let bookTitle = titleInfo.bookTitle ?? '';
  if (bookTitle !== '') bookTitle = ` ${bookTitle}\n`;
  else bookTitle = t(ctx, ' <не указано>\n', ' <not given>\n');

  /// ЯЗЫК КНИГИ
  const bookLang = titleInfo.lang ?? '';
  let Jazyk = '';
  if (bookLang !== '' && bookLang !== 'ru') {
    const k = LANG_CODES.indexOf(bookLang);
    if (k >= 0) Jazyk = ` ${ru ? LANG_NAMES_NOMINATIVE[k] : LANG_NAMES_EN[k]}\n`;
    if (Jazyk === '') Jazyk = ` <${bookLang}>\n`;
  }

  /// ЛИТЕРАТУРНАЯ СЕРИЯ
  let seqS_1 = '';
  let count_Seq_1 = 0;
  for (const { seq, depth } of flatSequences(titleInfo.sequences)) {
    const seq_1 = sequenceText(seq);
    if (seq_1 !== '') {
      count_Seq_1 += 1;
      seqS_1 += ` ${'     '.repeat(depth)}${seq_1}\n`;
    }
  }

  /// ДАТА СОЗДАНИЯ
  const bookDate = titleInfo.date?.text ?? '';
  if (bookDate !== '') bookTitle += ` <${bookDate}>\n`;

  /// ПЕРЕВОДЧИКИ
  const translators = people(ctx, titleInfo.translators);
  const Perevodchiki = translators.lines;
  const count_Translator = translators.count;

  /// ПЕРЕВЕДЕННОЙ ЯЗЫК
  const bookSrcLang = titleInfo.srcLang ?? '';
  let Perevod = '';
  if (bookSrcLang !== '' && bookLang !== bookSrcLang) {
    const k = LANG_CODES.indexOf(bookSrcLang);
    if (k >= 0) Perevod = t(ctx, ` • Перевод с ${LANG_NAMES_GENITIVE[k]}`, ` • Translated from ${LANG_NAMES_EN[k]}`);
    if (Perevod === '') Perevod = t(ctx, ` • Перевод с <${bookSrcLang}>`, ` • Translated from <${bookSrcLang}>`);
    if (count_Translator !== 0) Perevod += ':\n';
    else Perevod += '\n';
  }
  if (count_Translator !== 0) {
    if (Perevod === '') Perevod = t(ctx, ' • Перевод:\n', ' • Translation:\n');
    Perevod += Perevodchiki;
  }

  /// ХУДОЖНИКИ
  let Hudozhniki = '';
  let count_illustrator = 0;
  for (const info of description.customInfo ?? []) {
    if ((info.infoType ?? '').search(/^(ml)?illustrator$/i) !== -1) {
      count_illustrator += 1;
      let illustrator = textareaHTML(info.text ?? '');
      illustrator = illustrator.replace(new RegExp(`${S}+`, 'g'), ' ');
      illustrator = illustrator.replace(re06, '');
      if (illustrator && illustrator.length > 2 && illustrator.length < 256) Hudozhniki += ` ${illustrator}\n`;
    }
  }

  /// ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ :  иллюстрации
  let Dopolnitelno = '';
  const images = [];
  const visitImages = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') images.push(node.attrs?.href ?? '');
    for (const child of node.content ?? []) visitImages(child);
  };
  visitImages(titleInfo.annotation);
  visitImages(description.documentInfo?.history);
  for (const body of snapshot.bodies ?? []) visitImages(body);
  const count_Img = images.length;
  const textSrc = `${images.join('')}#`;
  if (count_Img !== 0) {
    Dopolnitelno += ` ${count_Img}${forms(ctx, count_Img, [' иллюстрация', ' иллюстрации', ' иллюстраций'], [' illustration', ' illustrations'])}\n`;
  }

  /// ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ :  обложки
  let count_Cover = 0;
  for (const cover of titleInfo.coverpage ?? []) if ((cover.href ?? '') !== '') count_Cover += 1;
  for (const cover of description.srcTitleInfo?.coverpage ?? []) if ((cover.href ?? '') !== '') count_Cover += 1;
  const oblozhek = [[' обложка', ' обложки', ' обложек'], [' cover', ' covers']];
  if (count_Cover !== 0 && Dopolnitelno !== '') {
    Dopolnitelno = Dopolnitelno.replace(/\n$/g, ', ');
    if (count_Cover === 1) Dopolnitelno += t(ctx, ' обложка\n', ' cover\n');
    else Dopolnitelno += ` ${count_Cover}${forms(ctx, count_Cover, ...oblozhek)}\n`;
  }
  if (count_Cover !== 0 && Dopolnitelno === '') {
    if (count_Cover === 1) Dopolnitelno += t(ctx, ' Обложка\n', ' Cover\n');
    else Dopolnitelno += ` ${count_Cover}${forms(ctx, count_Cover, ...oblozhek)}\n`;
  }

  /// ДОПОЛНИТЕЛЬНАЯ ИНФОРМАЦИЯ :  объём текста
  // * 1 страница = 2000 символов, или 35 строк стихотворного текста, или 0,3 мегапикселей иллюстраций
  const allP = descendants(page, true);
  const count_P = allP.length;
  let count_Sim = 0;
  let count_Poem = 0;
  for (const ptr of allP) {
    if (ptr.parent.cls === 'stanza') count_Poem += 1;
    else count_Sim += innerText(ptr).length + 2;
  }
  let count_Pix = 0;
  for (const binary of binaries) {
    if (`${binary.contentType ?? ''}`.search('image') === -1 || !binary.width || !binary.height) continue;
    const Dims = `${binary.width}x${binary.height}`;
    if (Dims.search(/^\d+x\d+$/) === -1) continue;
    const re_Id = new RegExp(`#${binary.id}(?=#)`, 'g');
    if (textSrc.search(re_Id) !== -1) {
      let Pix_1 = Dims.replace(/x\d+/, '') * Dims.replace(/\d+x/, '');
      if (Pix_1 > 300000) Pix_1 = 300000;
      count_Pix += Pix_1 * textSrc.match(re_Id).length;
    }
  }
  let count_V = count_Poem / 35 + count_Sim / 2000 + count_Pix / 300000;
  if (count_V !== 0) count_V = Math.ceil(count_V);
  if (count_V !== 0) {
    Dopolnitelno += ` ${count_V}${forms(
      ctx,
      count_V,
      [' условная бумажная страница', ' условные бумажные страницы', ' условных бумажных страниц'],
      [' estimated printed page', ' estimated printed pages'],
    )}\n`;
  }

  /// ПЕЧАТНОЕ ИЗДАНИЕ
  const publish = description.publishInfo ?? {};
  let Pechatnoe_izdanie = '';
  if ((publish.city ?? '') !== '') Pechatnoe_izdanie += ` ${publish.city}:`;
  if ((publish.publisher ?? '') !== '') Pechatnoe_izdanie += ` ${publish.publisher},`;
  if ((publish.year ?? '') !== '') Pechatnoe_izdanie += ` ${publish.year}.`;
  if (Pechatnoe_izdanie !== '') Pechatnoe_izdanie = `${Pechatnoe_izdanie.replace(/.$/g, '').replace(/([^.])$/g, '$1.')}\n`;
  let pechatnoeName = publish.bookName ?? '';
  if (pechatnoeName !== '') {
    pechatnoeName = pechatnoeName.replace(/([^.])$/g, '$1.');
    if (Pechatnoe_izdanie !== '') Pechatnoe_izdanie = ` ${pechatnoeName} —${Pechatnoe_izdanie}`;
    else Pechatnoe_izdanie = ` ${pechatnoeName}\n`;
  }
  let seqS_2 = '';
  let count_Seq_2 = 0;
  for (const { seq } of flatSequences(publish.sequences)) {
    let seq_2 = '';
    const seqName = seq.name ?? '';
    let seqNumber = seq.number === undefined || seq.number === null ? '' : `${seq.number}`;
    if (seqName !== '') seq_2 += ` ${seqName}`;
    if (seqNumber !== '') seqNumber = seqNumber.replace(/^0+/, '');
    if (seqNumber !== '') {
      if (seqName !== '') seq_2 += '  – ';
      seq_2 += seqNumber;
    }
    if (seq_2 !== '') {
      count_Seq_2 += 1;
      seqS_2 += `${seq_2}, `;
    }
  }
  if (count_Seq_2 !== 0) {
    seqS_2 = seqS_2.replace(/, $/g, '');
    if (count_Seq_2 === 1) Pechatnoe_izdanie += t(ctx, ` (серия: ${seqS_2})\n`, ` (series: ${seqS_2})\n`);
    else Pechatnoe_izdanie += t(ctx, ` (серии: ${seqS_2})\n`, ` (series: ${seqS_2})\n`);
  }
  if ((publish.isbn ?? '') !== '') Pechatnoe_izdanie += ` ISBN ${publish.isbn}\n`;

  /// АННОТАЦИЯ
  let Annotatsija = '';
  const ks = '    ';
  let Dlina = DLINA;
  if (`${Dlina}`.search(/^\d+$/) !== -1 && +Dlina > 0) Dlina += ks.length;
  else Dlina = 1000;
  const re11 = new RegExp(`^([^\\\t]{${Dlina}})([^\\\t]{0,400}?[А-яA-Za-zЁё]{2}[…\\\.\\\?!\\\n]{1,10}|[^\\\t]{0,100}${S}|)[^\\\t]{0,}$`, '');
  const re12 = new RegExp(`${S}{0,10}$`, '');
  const annotationBlock = page.children[0];
  for (const ptr of descendants(annotationBlock, true)) {
    const s = cleanLine(innerHTML(ptr), false);
    if (s !== '') Annotatsija += `${ks}${s}\n`;
    if (s === '' && Annotatsija.search(/.\n$/) !== -1) Annotatsija += '\n';
    if (Annotatsija.length > Dlina + 500) break;
  }
  if (Annotatsija !== '') Annotatsija = Annotatsija.replace(/\n+$/, '');
  if (Annotatsija.length > Dlina) {
    let Ann_ = Annotatsija.replace(re11, '$1$2');
    if (Ann_ !== Annotatsija) Ann_ = Ann_.replace(re12, ' <…>');
    Annotatsija = Ann_;
  }
  if (Annotatsija !== '') Annotatsija += '\n';

  /// ОГЛАВЛЕНИЕ
  let count_Title = 0;
  let Oglavlenie = '';
  const Stihi = count_Poem / count_P > 0.7;
  const illustrationMark = t(ctx, '<иллюстрация>', '<illustration>');
  const handleDIV = (div) => {
    let divUp = div.parent;
    if (
      div.cls === 'title' &&
      (/^(section|body)$/.test(divUp.cls) || (Stihi && /^(poem|stanza)$/.test(divUp.cls)))
    ) {
      count_Title += 1;
      let otstup = ' ';
      while (/^(section|poem|stanza)$/.test(divUp.cls)) {
        divUp = divUp.parent;
        otstup += '     ';
      }
      let textTitle = '';
      for (const line of descendants(div, true)) {
        let s = cleanLine(innerHTML(line), Dizajn === 1).replace(/ILLUSTRATION_MARK/g, illustrationMark);
        if (s === '') {
          if (Dizajn === 1) s = t(ctx, '<пустая строка>', '<empty line>');
          else continue;
        }
        if (Dizajn === 1 || otstup === ' ') textTitle += `${otstup}${s}\n`;
        else if (textTitle === '') textTitle += `${otstup}${s}`;
        else textTitle += `     • ${s}`;
      }
      if (textTitle !== '') {
        if (Dizajn === 1 || otstup !== ' ') Oglavlenie += `${textTitle}\n`;
        else Oglavlenie += textTitle;
      }
    }
  };
  let count_Notes = 0;
  let count_Comments = 0;
  for (const divBody of page.children) {
    const named = divBody.cls === 'body' ? divBody.fbname : '';
    if (divBody.cls !== 'body' || (named !== 'notes' && named !== 'comments')) {
      for (const div of descendants(divBody, false)) handleDIV(div);
    }
    if (divBody.cls === 'body' && named === 'notes') {
      count_Notes += descendants(divBody, false).filter((div) => div.cls === 'section').length;
    }
    if (divBody.cls === 'body' && named === 'comments') {
      count_Comments += descendants(divBody, false).filter((div) => div.cls === 'section').length;
    }
  }
  if (Oglavlenie !== '' && Dizajn === 1) Oglavlenie = Oglavlenie.replace(/\n$/, '');

  /// ПРИМЕЧАНИЯ И КОММЕНТАРИИ (продолжение)
  let SektsiiSnosok = '';
  if (count_Notes !== 0) {
    SektsiiSnosok += ` ${count_Notes}${forms(ctx, count_Notes, [' примечание', ' примечания', ' примечаний'], [' note', ' notes'])}\n`;
  }
  if (count_Comments !== 0) {
    if (count_Notes !== 0 && Dizajn === 1) SektsiiSnosok += '\n';
    SektsiiSnosok += ` ${count_Comments}${forms(ctx, count_Comments, [' комментарий', ' комментария', ' комментариев'], [' comment', ' comments'])}\n`;
  }

  /// ОКНО РЕЗУЛЬТАТОВ  :  Текущее время и дата
  const now = new Date();
  const currentMinutes = `${now.getMinutes() < 10 ? '0' : ''}${now.getMinutes()}`;
  const currentSeconds = `${now.getSeconds() < 10 ? '0' : ''}${now.getSeconds()}`;
  const currentMonth = `${1 + now.getMonth() < 10 ? '0' : ''}${1 + now.getMonth()}`;
  const currentYear = `${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1');
  const currentTime = `${now.getHours()}:${currentMinutes}:${currentSeconds}`;
  const currentDate = `${now.getDate()}.${currentMonth}.${currentYear}`;

  /// Подсчет чистого компьютерного времени, потраченного на обработку текста
  const T2 = Date.now() - Ts;
  const Tmin = Math.floor(T2 / 60000);
  const TsecD = (T2 % 60000) / 1000;
  const Tsec = Math.floor(TsecD);
  let tempus;
  if (Tmin === 0) {
    const seconds = `${+`${TsecD}`.replace(/(.{1,5}).*/g, '$1')}`;
    tempus = t(ctx, `${seconds.replace('.', ',')} сек`, `${seconds} s`);
  } else {
    tempus = `${Tmin}${t(ctx, ' мин', ' min')}`;
    if (Tsec !== 0) tempus += ` ${Tsec}${t(ctx, ' с', ' s')}`;
  }

  /// ОКНО РЕЗУЛЬТАТОВ  :  Сборка массива с результатами обработки
  const Mark = (count) => (!count ? '   ' : '· ');
  const Counter = (count) => {
    if (!count) return t(ctx, '<нет>', '<none>');
    if (typeof count !== 'number') return t(ctx, '<есть>', '<yes>');
    return count;
  };
  const mSt = [];
  mSt.push(t(ctx, ` «Информацию о книге – в буфер обмена» v.${NumerusVersion}`, ` «Book information to the clipboard» v.${NumerusVersion}`));
  mSt.push('-----------------------------------------------------------------     ');
  mSt.push('');
  mSt.push(t(ctx, '• СТАТИСТИКА:\t\t\t\t', '• STATISTICS:\t\t\t\t'));
  mSt.push(`${Mark(tempus)}${t(ctx, 'Время выполнения     \t', 'Time     \t')}${tempus}`);
  mSt.push(`${Mark(count_Author)}${t(ctx, 'Авторы  .  .  .  .  .  .  .  .  .\t', 'Authors  .  .  .  .  .  .  .  .\t')}${Counter(count_Author)}`);
  mSt.push(`${Mark(bookTitle)}${t(ctx, 'Название  .  .  .  .  .  .  .  .\t', 'Title  .  .  .  .  .  .  .  .  .\t')}${Counter(bookTitle)}`);
  if (bookDate !== '') mSt.push(`${Mark(bookDate)}${t(ctx, 'Дата написания   .  .  .  .\t', 'Date written  .  .  .  .  .\t')}${Counter(bookDate)}`);
  if (count_Seq_1 !== 0) mSt.push(`${Mark(count_Seq_1)}${t(ctx, 'Серия .  .  .  .  .  .  .  .  .  .\t', 'Series  .  .  .  .  .  .  .  .\t')}${Counter(count_Seq_1)}`);
  mSt.push(`${Mark(bookLang)}${t(ctx, 'Язык книги  .  .  .  .  .  .  .\t', 'Language  .  .  .  .  .  .  .\t')}${Counter(bookLang)}`);
  if (Annotatsija !== '') mSt.push(`${Mark(Annotatsija)}${t(ctx, 'Аннотация   .  .  .  .  .  .  .\t', 'Annotation  .  .  .  .  .  .\t')}${Counter(Annotatsija)}`);
  mSt.push(`${Mark(count_Genre)}${t(ctx, 'Жанр  .  .  .  .  .  .  .  .  .  .\t', 'Genre  .  .  .  .  .  .  .  .  .\t')}${Counter(count_Genre)}`);
  if (bookSrcLang !== '') mSt.push(`${Mark(bookSrcLang)}${t(ctx, 'Язык оригинала   .  .  .  .\t', 'Original language  .  .  .\t')}${Counter(bookSrcLang)}`);
  if (count_Translator !== 0) mSt.push(`${Mark(count_Translator)}${t(ctx, 'Переводчики .  .  .  .  .  .\t', 'Translators  .  .  .  .  .\t')}${Counter(count_Translator)}`);
  if (count_illustrator !== 0) mSt.push(`${Mark(count_illustrator)}${t(ctx, 'Художники  .  .  .  .  .  .  .\t', 'Illustrators  .  .  .  .  .\t')}${Counter(count_illustrator)}`);
  if (count_Img !== 0) mSt.push(`${Mark(count_Img)}${t(ctx, 'Иллюстрации .  .  .  .  .  .\t', 'Illustrations  .  .  .  .  .\t')}${Counter(count_Img)}`);
  if (count_Cover !== 0) mSt.push(`${Mark(count_Cover)}${t(ctx, 'Обложка   .  .  .  .  .  .  .  .\t', 'Cover  .  .  .  .  .  .  .  .  .\t')}${Counter(count_Cover)}`);
  if (count_V !== 0) mSt.push(`${Mark(count_V)}${t(ctx, 'Страницы .  .  .  .  .  .  .  .\t', 'Pages  .  .  .  .  .  .  .  .  .\t')}${Counter(count_V)}`);
  if (Pechatnoe_izdanie !== '') mSt.push(`${Mark(Pechatnoe_izdanie)}${t(ctx, 'Печатное издание  .  .  .\t', 'Print edition  .  .  .  .  .\t')}${Counter(Pechatnoe_izdanie)}`);
  mSt.push(`${Mark(count_Title)}${t(ctx, 'Заголовки .  .  .  .  .  .  .  .\t', 'Titles  .  .  .  .  .  .  .  .  .\t')}${Counter(count_Title)}`);
  if (count_Notes !== 0) mSt.push(`${Mark(count_Notes)}${t(ctx, 'Примечания   .  .  .  .  .  .\t', 'Notes  .  .  .  .  .  .  .  .  .\t')}${Counter(count_Notes)}`);
  if (count_Comments !== 0) mSt.push(`${Mark(count_Comments)}${t(ctx, 'Комментарии .  .  .  .  .  .\t', 'Comments  .  .  .  .  .  .  .\t')}${Counter(count_Comments)}`);
  mSt.push('');
  mSt.push(`• ${currentDate} • ${currentTime} •`);
  mSt.push('');
  mSt.push('-----------------------------------------------------------------');
  mSt.push(t(ctx, ' ◊  Отправить подготовленный текст', ' ◊  Send the prepared text'));
  mSt.push(t(ctx, '                       в буфер обмена?', '                       to the clipboard?'));
  const st2 = mSt.map((line) => `${line}\n`).join('');
  //  Вывод окна результатов (и вопроса о сохранении в буфер)
  if ((await MsgBox(st2, ctx.script.name, 4 + 32)) !== 6) return;

  /// ФИНАЛЬНАЯ СБОРКА ОСНОВНОГО ТЕКСТА
  let Txt2 = '';
  for (const block of mW) {
    switch (block) {
      case 'Автор':
        if (count_Author <= 1) Txt2 += `${t(ctx, ' • Автор:\n', ' • Author:\n')}${Avtory}\n`;
        else Txt2 += `${t(ctx, ' • Авторы:\n', ' • Authors:\n')}${Avtory}\n`;
        break;
      case 'Название':
        Txt2 += `${t(ctx, ' • Название:\n', ' • Title:\n')}${bookTitle}\n`;
        break;
      case 'Серия':
        if (count_Seq_1 === 1) Txt2 += `${t(ctx, ' • Серия:\n', ' • Series:\n')}${seqS_1}\n`;
        if (count_Seq_1 > 1) Txt2 += `${t(ctx, ' • Серии:\n', ' • Series:\n')}${seqS_1}\n`;
        break;
      case 'Язык книги':
        if (Jazyk !== '') Txt2 += `${t(ctx, ' • Язык книги:\n', ' • Language of the book:\n')}${Jazyk}\n`;
        break;
      case 'Аннотация':
        if (Annotatsija !== '') {
          Txt2 += `${t(ctx, ' • Аннотация:\n', ' • Annotation:\n')} ~~~~~~~~~~~~~~~~~~~~\n${Annotatsija} ~~~~~~~~~~~~~~~~~~~~\n\n`;
        }
        break;
      case 'Жанр':
        Txt2 += `${t(ctx, ' • Жанр:\n', ' • Genre:\n')}${Zhanry}\n`;
        break;
      case 'Перевод':
        if (Perevod !== '') Txt2 += `${Perevod}\n`;
        break;
      case 'Художник':
        if (count_illustrator === 1) Txt2 += `${t(ctx, ' • Художник:\n', ' • Illustrator:\n')}${Hudozhniki}\n`;
        if (count_illustrator > 1) Txt2 += `${t(ctx, ' • Художники:\n', ' • Illustrators:\n')}${Hudozhniki}\n`;
        break;
      case 'Дополнительная информация':
        if (Dopolnitelno !== '') Txt2 += `${t(ctx, ' • Дополнительная информация:\n', ' • Additional information:\n')}${Dopolnitelno}\n`;
        break;
      case 'Печатное издание':
        if (Pechatnoe_izdanie !== '') Txt2 += `${t(ctx, ' • Печатное издание:\n', ' • Print edition:\n')}${Pechatnoe_izdanie}\n`;
        break;
      case 'Оглавление':
        if (Oglavlenie !== '') Txt2 += `${t(ctx, ' • Оглавление:\n', ' • Contents:\n')} ~~~~~~~~~~~~~~~~~~~~\n${Oglavlenie}\n`;
        break;
      case 'Примечания и комментарии':
        if (SektsiiSnosok !== '') Txt2 += `${SektsiiSnosok}\n`;
        break;
      default:
        break;
    }
  }
  await mfbe.clipboard.writeText(Txt2);
}

///  ИСТОРИЯ ИЗМЕНЕНИЙ (of the original, kept as written)
// v.1.0 — Создание скрипта — Александр Ка (06.03.2025)
// v.1.1 — Добавление аннотации — Александр Ка (09.03.2025)
// v.1.2 — Изменение структуры скрипта, оформления — Александр Ка (11.03.2025)
// v.1.3 — Настройки: Расположение блоков текста — Александр Ка (02.05.2025)
