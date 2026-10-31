// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/550_Создать заголовок книги (в body) из названия (в описании документа).js
// Creates the book's title in the main body from the description: a line with the authors' names
// (first name, patronymic - after a question - and last name, up to five authors, "и др." when
// there are more) and a line with the book title are put at the top of the main body's title
// (which is made when the body has none); empty lines at the start of the title go, and a line
// that already holds the authors or the book title is not added twice. A book with more than one
// main body is refused, as in the original. The settings below are the original's, with its
// values. A window confirms the result.
// Differences from the original: the caret is put at the start of the title (the original also
// scrolled there); a book without any body (a descriptor) is refused with a message, the original
// made a body.
// The original's notice, kept as written (FR-029):
//======================================
//             «Создать заголовок книги»
//  Добавление заголовка в основное <body> с использованием данных из <title-info>
//  Скрипт тестировался в FBE v.2.7.7 (win XP, IE8 и win 7, IE11)
//  * История изменений в конце скрипта
//======================================
// ---------------------------------------------------------------
                 ///  НАСТРОЙКИ
// ---------------------------------------------------------------
//     Добавлять новые строки в начало уже существующего заголовка
// ---------------------------------------------------------------
//     Максимальное число авторов книги, имена которых можно вписать в заголовок
//     Если число окажется больше максимума ...
// ---------------------------------------------------------------
import { parseInline, serializeInline } from './lib/legacy-html.js';

const ScriptName = '«Создать заголовок книги»';
const NumerusVersion = '1.3';

// ---------------------------------------------------------------
//                 ///  НАСТРОЙКИ (settings)
// ---------------------------------------------------------------
//     Добавлять новые строки в начало уже существующего заголовка ("0" — НЕ добавлять, "1" — добавлять)
const TitlePlusTitle = 1;
//     Максимальное число авторов книги, имена которых можно вписать в заголовок
const MaxAuthor = 5;
//     Если число окажется больше максимума ... ("0" — ничего не вписывать, "1" — вписывать максимум)
const AuthorPlus = 1;
//     Добавлять курсив к именам авторов ("0" — НЕ добавлять, "1" — добавлять)
const Emphasis = 0;
//     Добавлять КАПС к названию книги ("0" — НЕ добавлять, "1" — добавлять)
const UpperCase = 0;
//     Порядок строк в заголовке ("0" — сначала Автор книги, потом Название; "1" — сначала Название, потом Автор книги)
const Porjadok_strok = 0;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

// The non-breaking space: FictionBook Editor's display character (nbspChar) is the real U+00A0
// in the document model, and the legacy notation writes it &nbsp;.
const nbspChar = ' ';
const nbspEntity = '&nbsp;';

/** Функция склонения по падежам в зависимости от числа */
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

//  Рег. выражения для функции "HandleValue"
// Удаление начальных и конечных пробелов строки
const re121 = new RegExp(`^(\\s|${nbspChar}|&nbsp;|[            ​  ⁠　]{1,})|(\\s|${nbspChar}|&nbsp;|[            ​  ⁠　]){1,}$`, 'g');
// Коррекция спец. символов
const re122 = new RegExp('&', 'g');
const re123 = new RegExp('<', 'g');
const re124 = new RegExp('>', 'g');
const re125 = new RegExp(' ', 'g');

/** The original's HandleValue: a value of the description, trimmed and written as HTML. */
function HandleValue(vl) {
  return `${vl ?? ''}`.replace(re121, '').replace(re122, '&amp;').replace(re123, '&lt;').replace(re124, '&gt;').replace(re125, nbspChar);
}

// A line of the title that holds nothing but spaces and tags; a picture is content.
const re212 = new RegExp(`^(\\s|${nbspEntity}|&nbsp;|<[^>]{1,}>){0,}$`, '');
const re212ex = /<IMG\b/;

function innerHTML(node) {
  return node.type === 'empty-line' ? '' : serializeInline(node.content ?? [], []);
}

function isEmptyLine(node) {
  const html = innerHTML(node);
  return html.search(re212) !== -1 && html.search(re212ex) === -1;
}

function paragraph(html) {
  return { type: 'p', attrs: {}, content: parseInline(html, []) };
}

export default async function run(ctx) {
  const doc = await mfbe.doc.get();
  const bodies = doc.bodies ?? [];
  // Создание массива с узлами "body" (без "body" примечаний и комментариев)
  const mBody = bodies.filter((b) => b.attrs?.name !== 'notes' && b.attrs?.name !== 'comments');
  if (mBody.length > 1) {
    const razdelov = [t(ctx, ' раздел', ' section'), t(ctx, ' раздела', ' sections'), t(ctx, ' разделов', ' sections')];
    await MsgBox(
      t(
        ctx,
        `\n В книге ${mBody.length}${razdelov[pad(mBody.length)]} <body>       \n\n Скрипт не понимает       \n в какой из них добавлять заголовок.       \n`,
        `\n The book has ${mBody.length}${razdelov[pad(mBody.length)]} <body>       \n\n The script cannot tell       \n which of them should get the title.       \n`,
      ),
    );
    return;
  }
  if (bodies.length === 0) {
    await MsgBox(t(ctx, '\n В книге нет ни одного раздела <body>.       \n', '\n The book has no <body>.       \n'));
    return;
  }

  // Получение данных: authors (FictionBook Editor showed one empty author when there was none)
  const description = doc.description;
  const authors = description?.titleInfo?.authors?.length ? description.titleInfo.authors : [{}];
  let maximum;
  if (authors.length <= MaxAuthor) maximum = authors.length;
  else if (AuthorPlus === 1) maximum = MaxAuthor;
  else {
    const najdeny = [t(ctx, ' найден', ' found'), t(ctx, ' найдены', ' found'), t(ctx, ' найдены', ' found')];
    const avtorov_knigi = [t(ctx, ' автор книги', ' author of the book'), t(ctx, ' автора книги', ' authors of the book'), t(ctx, ' авторов книги', ' authors of the book')];
    await MsgBox(
      t(
        ctx,
        `\n В разделе <title-info> ${najdeny[pad(authors.length)]} ${authors.length}${avtorov_knigi[pad(authors.length)]}       \n\n Это превышает максимальное число авторов,       \n имена которых можно вписать в заголовок.       \n\n * В «Настройках» скрипта можно изменить       \n    способ записи и максимальное число.       `,
        `\n In <title-info> ${najdeny[pad(authors.length)]} ${authors.length}${avtorov_knigi[pad(authors.length)]}       \n\n This is more than the maximum number of authors       \n whose names may go into the title.       \n\n * The script's settings can change       \n    that number and the way of writing.       `,
      ),
    );
    maximum = 0;
  }
  let authorNameS = '';
  let authorNameS_2 = '';
  for (let j = 0; j < maximum; j += 1) {
    const firstName = HandleValue(authors[j].firstName);
    const middleName = HandleValue(authors[j].middleName);
    const lastName = HandleValue(authors[j].lastName);
    let authorName = '';
    let authorName_2 = '';
    if (firstName !== '') authorName += ` ${firstName}`;
    if (middleName !== '') authorName += ` ${middleName}`;
    if (lastName !== '') authorName += ` ${lastName}`;
    if (authorName !== '') authorNameS += `,${authorName}`;
    if (firstName !== '') authorName_2 += ` ${firstName}`;
    if (lastName !== '') authorName_2 = `${authorName_2} ${lastName}`;
    if (authorName_2 === '') authorName_2 = authorName;
    if (authorName_2 !== '') authorNameS_2 += `,${authorName_2}`;
  }
  authorNameS = authorNameS.replace(/^, /, '');
  authorNameS_2 = authorNameS_2.replace(/^, /, '');
  if (AuthorPlus === 1 && authorNameS !== '' && authors.length > MaxAuthor) {
    // book text, in the book's language as in the original
    authorNameS += ' и др.';
    authorNameS_2 += ' и др.';
  }
  let bookTitle = HandleValue(description?.titleInfo?.bookTitle);
  if (authorNameS === '' && maximum !== 0) await MsgBox(t(ctx, '\n В разделе <title-info> отсутствуют имена авторов \n', '\n <title-info> holds no names of authors \n'));
  if (bookTitle === '') await MsgBox(t(ctx, '\n В разделе <title-info> отсутствует название книги       \n', '\n <title-info> holds no book title       \n'));
  if (authorNameS === '' && bookTitle === '') return;

  // ДОБАВЛЕНИЕ СТРОК ЗАГОЛОВКА
  let Otvet = true;
  if (authorNameS !== authorNameS_2) {
    Otvet =
      (await MsgBox(
        t(
          ctx,
          ` ◊  Добавлять  отчество?       \n-------------------------------------------------------       \n• Да:\t${authorNameS}       \n\n• Нет:\t${authorNameS_2}       `,
          ` ◊  Add the patronymics?       \n-------------------------------------------------------       \n• Yes:\t${authorNameS}       \n\n• No:\t${authorNameS_2}       `,
        ),
        ctx.script.name,
        4,
      )) === 6;
  }
  if (!Otvet) authorNameS = authorNameS_2;

  // The main body (made when there is none, before the notes) and its title.
  let body = mBody[0];
  let created = false;
  if (!body) {
    body = { type: 'body', attrs: {}, content: [{ type: 'section', attrs: {}, content: [{ type: 'empty-line', attrs: {} }] }] };
    created = true;
  }
  const content = body.content ?? [];
  let titleIndex = content.findIndex((c) => c.type === 'title');
  let lines;
  if (titleIndex < 0) {
    // Если нет раздела <title> ::: создание нового раздела <title> (after the body's picture)
    titleIndex = content[0]?.type === 'image' ? 1 : 0;
    lines = [{ type: 'empty-line', attrs: {} }];
  } else lines = [...(content[titleIndex].content ?? [])];
  const hadTitle = !created && content[titleIndex]?.type === 'title';

  if (TitlePlusTitle !== 1) {
    // Проверка на существование заголовка книги
    if (lines.some((p) => !isEmptyLine(p))) {
      await MsgBox(
        t(
          ctx,
          '\n В разделе <body> уже есть заголовок       \n\n * В «Настройках» скрипта можно изменить       \n    способ добавления заголовка.       ',
          '\n The <body> has a title already       \n\n * The script\'s settings can change       \n    the way the title is added.       ',
        ),
      );
      return;
    }
    lines = [];
  }
  if (bookTitle !== '' && UpperCase === 1) bookTitle = bookTitle.toUpperCase();
  if (authorNameS !== '' && Emphasis === 1) authorNameS = `<EM>${authorNameS}</EM>`;

  let nachalo = true;
  if (TitlePlusTitle === 1) {
    const imenami_avtorov = [t(ctx, 'именем автора', 'the name of the author'), t(ctx, 'именами авторов', 'the names of the authors'), t(ctx, 'именами авторов', 'the names of the authors')];
    const kept = [];
    for (const p of lines) {
      if (isEmptyLine(p)) {
        if (!nachalo) kept.push(p);
        continue;
      }
      nachalo = false;
      kept.push(p);
      if (authorNameS !== '' && authorNameS === innerHTML(p)) {
        await MsgBox(t(ctx, `\n В заголовке уже есть строка       \n с ${imenami_avtorov[pad(maximum)]} из <title-info>       \n`, `\n The title already has a line       \n with ${imenami_avtorov[pad(maximum)]} from <title-info>       \n`));
        authorNameS = '';
      }
      if (bookTitle !== '' && bookTitle === innerHTML(p)) {
        await MsgBox(t(ctx, '\n В заголовке уже есть строка       \n с названием книги из <title-info>       ', '\n The title already has a line       \n with the book title from <title-info>       '));
        bookTitle = '';
      }
    }
    lines = kept;
    if (authorNameS === '' && bookTitle === '') {
      // The original stopped here, the empty lines at the start of the title already removed.
      if (hadTitle && lines.length !== (content[titleIndex].content ?? []).length) await writeTitle(body, titleIndex, lines, hadTitle);
      return;
    }
    if (lines.length > 0) lines.unshift({ type: 'empty-line', attrs: {} });
  }
  if (Porjadok_strok === 0 && bookTitle !== '') lines.unshift(paragraph(bookTitle));
  if (authorNameS !== '') lines.unshift(paragraph(authorNameS));
  if (Porjadok_strok !== 0 && bookTitle !== '') lines.unshift(paragraph(bookTitle));

  if (created) {
    body.content.unshift({ type: 'title', attrs: {}, content: lines });
    await mfbe.doc.insertNode('before', bodies[0].attrs.nodeId, body);
  } else await writeTitle(body, titleIndex, lines, hadTitle);

  // The caret goes to the start of the title (GoTo_0).
  try {
    const fresh = (await mfbe.doc.get()).bodies.find((b) => b.attrs?.name !== 'notes' && b.attrs?.name !== 'comments');
    const first = fresh?.content?.find((c) => c.type === 'title')?.content?.find((c) => c.type === 'p');
    if (first) await mfbe.selection.set({ nodeId: first.attrs.nodeId, offset: 0 });
  } catch {
    // the caret stays
  }

  // ОКНО РЕЗУЛЬТАТОВ
  const now = new Date();
  const two = (n) => (n < 10 ? `0${n}` : `${n}`);
  const currentTime = `${now.getHours()}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
  const currentDate = `${now.getDate()}.${two(now.getMonth() + 1)}.${`${now.getFullYear()}`.replace(/^.*?(\d{1,2})$/g, '$1')}`;
  const mSt = [
    ` ${t(ctx, ScriptName, '"Create the book title"')} v.${NumerusVersion}`,
    '-------------------------------------------------------',
    '',
    t(ctx, '• Заголовок, созданный из данных <title-info>', '• The title made from <title-info>'),
    nachalo ? t(ctx, '   успешно добавлен в текст книги', '   has been added to the text of the book') : t(ctx, '   успешно добавлен в существующий заголовок', '   has been added to the existing title'),
    '',
    `• ${currentDate} • ${currentTime} •`,
  ];
  await MsgBox(mSt.map((s) => `${s}       \n`).join(''));
}

/** Writes the body's title: replaced when it exists, inserted at its place otherwise. */
async function writeTitle(body, titleIndex, lines, hadTitle) {
  const title = { type: 'title', attrs: hadTitle ? { ...body.content[titleIndex].attrs } : {}, content: lines };
  if (hadTitle) {
    await mfbe.doc.replaceNode(body.content[titleIndex].attrs.nodeId, title);
    return;
  }
  const next = body.content[titleIndex];
  await mfbe.doc.insertNode('before', next.attrs.nodeId, title);
}

//                 ///  ИСТОРИЯ (the original's change history, kept as written)
//~~~~~~~~~~~~~~~~~~
// v.1.0 — Создание скрипта — Александр Ка (14.06.2024)
//~~~~~~~~~~~~~~~~~~
// v.1.1 — Александр Ка (19.06.2024)
// Возможность добавлять новые строки в уже существующий заголовок
// Возможность добавлять имена авторов при превышении максимума
//~~~~~~~~~~~~~~~~~~
// v.1.2 — Александр Ка (16.01.2025)
// Изменено имя скрипта (было «Создать заголовок книги из названия»)
// Исправлены все ошибки в окнах для win7
// Исправлена ошибка с возможным удалением иллюстрации в заголовке (в IE11)
// Добавлена обработка спец. символов: «&», «<», «>» и н/р пробела
// Возможность изменить порядок строк
//~~~~~~~~~~~~~~~~~~
// v.1.3 — Мелочи — Александр Ка (28.04.2025)
//~~~~~~~~~~~~~~~~~~
