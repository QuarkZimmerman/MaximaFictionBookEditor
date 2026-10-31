// Converted from FictionBook Editor 2.7.9: Scripts/10_Статистика/10_Статистика нецензурных слов.js
// Counts the obscene words of the whole text (the book's annotation and the history included, as
// FictionBook Editor showed them) with the original's expressions (patterns.js: imDaniX's anti-mat
// expression with stokber's additions and exceptions) and the mentions of the networks and
// organisations banned in Russia (Meta, Facebook, Instagram); a message gives both numbers, and a
// report window shows the words found in the order of the text and alphabetically with their
// counts (Latin letters, digits and asterisks in red, the network names in green). Then it offers
// to note in the book's annotation that the text holds obscene language (and the mentions); those
// notes are Russian text of the book in every interface. The settings below are the original's:
// with okno = 0 the table is shown only; okno = 1 (the original's modeless window) also puts it on
// the clipboard as text, when tablCopu = 1.
// Differences from the original: the report window is the editor's (it has Copy and Save as...);
// the original's two kinds of window (an HTML window or a modeless dialog) are one. See
// docs/scripting/notes-279-drafts/10.md.
// The original's notice, kept as written (FR-029):
// Скрипт «Статистика нецензурных слов» для редактора Fiction Book Editor (FBE).
// Версия 1.8
// автор — stokber (февраль 2025).
// В скрипте использован регексп-антимат за авторством imDaniX (https://gist.github.com/imDaniX/8449f40655fcc1b92ae8d756cbca1264#file-swears-javascript-regex) дополненный рядом изменений-добавок.
import { parseInline, serializeInline, TEXT_BLOCK_TYPES } from './lib/legacy-html.js';
import { engFoul, faceInst, meta, neMat, regexp } from './patterns.js';

const version = '1.8';

// --------------------------------------------------------------------------------------------
/// НАСТРОЙКИ (settings)
//  okno: 0 — the report window ("обычное html-окно"); 1 — the report window as the original's
//  ModelessDialog, which also put the table on the clipboard when tablCopu = 1.
const okno = 0;
//  tablCopu: 0 — пропустить копирование таблицы; 1 — копировать в буфер (работает только с окном
//  ModellesDialog, в обычном html-окне игнорируется).
const tablCopu = 1;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The text of FictionBook Editor's page (innerText of fbw_body): a line per paragraph. */
function pageText(snapshot) {
  const lines = [];
  const visit = (node) => {
    if (!node || node.type === 'text') return;
    if (TEXT_BLOCK_TYPES.includes(node.type)) {
      lines.push((node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(''));
      return;
    }
    if (node.type === 'empty-line') {
      lines.push('');
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  // The annotation and the history blocks hold one empty paragraph when the book has none.
  for (const block of [snapshot.description?.titleInfo?.annotation, snapshot.description?.documentInfo?.history]) {
    const before = lines.length;
    visit(block);
    if (lines.length === before) lines.push('');
  }
  for (const body of snapshot.bodies ?? []) visit(body);
  return lines.join('\r\n');
}

/** The innerHTML of a child of the annotation, as the original tested it for "empty". */
function outerHTML(node) {
  if (node.type === 'empty-line') return '<P></P>';
  if (TEXT_BLOCK_TYPES.includes(node.type)) return `<P>${serializeInline(node.content ?? [], [])}</P>`;
  return `<DIV class=${node.type}>${(node.content ?? []).map(outerHTML).join('')}</DIV>`;
}

function innerHTML(node) {
  if (node.type === 'empty-line') return '';
  if (TEXT_BLOCK_TYPES.includes(node.type)) return serializeInline(node.content ?? [], []);
  return (node.content ?? []).map(outerHTML).join('');
}

/** добавление в аннотацию: the original's addToAnno (подсмотрено у Александра Ка). */
function addToAnno(annotation, msg_1) {
  const reH01 = /^(<\/?[^>]+>){0,}(&nbsp;|[\t\n\v\f\r ]|&nbsp;){0,}(<\/?[^>]+>){0,}$/;
  const content = annotation.content;
  //  Удаление последних пустых строк
  while (content.length && innerHTML(content[content.length - 1]).search(reH01) !== -1) content.pop();
  content.push({ type: 'p', attrs: {}, content: parseInline('&nbsp;', []) });
  content.push({ type: 'p', attrs: {}, content: parseInline(msg_1, []) });
  //  Удаление начальных пустых строк
  while (content.length && innerHTML(content[0]).search(reH01) !== -1) content.shift();
}

export default async function run(ctx) {
  const name = t(ctx, '«Статистика нецензурных слов»', '«Obscene words statistics»');
  const notFound = t(
    ctx,
    `В документе не найдено нецензурных слов.\n\n${name} v.${version}`,
    `No obscene words were found in the document.\n\n${name} v.${version}`,
  );
  const message = (text) => mfbe.ui.message(text, { caption: ctx.script.name, icon: 'info' });
  const snapshot = await mfbe.doc.get();

  let str = pageText(snapshot); // текст документа
  str = str.replace(new RegExp('[□▫◦]', 'g'), ' ');
  // ниже подменяем критические буквы для исключения некоторых особенных буквосочетаний:
  str = str.replace(new RegExp('Дранг нах Остен', 'g'), 'Дранг наЪ Остен');
  str = str.replace(new RegExp('([^а-яё])р[-]нах(?![а-яё])', 'gi'), '$1Ъ');
  str = str.replace(new RegExp('([a-zа-яё36])[-](?=[a-zа-яё36])', 'ig'), '$1 ');

  const matches = str.match(regexp); // Получаем массив совпадений.
  if (!matches) {
    await message(notFound);
    return true;
  }

  const headSequence = t(ctx, 'Последовательно', 'In the order of the text');
  const headAlphabet = t(ctx, 'По алфавиту', 'Alphabetically');
  let posl = matches.join(''); // массив в последовательный список.
  posl = posl.replace(new RegExp('[^а-яёa-z36*#\\n]+', 'img'), '\n');
  posl = posl.replace(new RegExp(`^${neMat}\\n`, 'img'), ''); // убрать исключения.
  posl = posl.replace(new RegExp('\\n\\n+', 'igm'), '\n');
  // готовим html-таблицу последовательную:
  posl = posl.replace(new RegExp('^([a-zа-яё36*#-]+)$', 'img'), '<tr><td>$1</td></tr>');
  posl = `<table align=left border=1><th>${headSequence}</th>${posl}</table>`; // список в html.

  matches.sort();
  let alf = matches.join(''); // массив в список по алфавиту.
  alf = alf.replace(new RegExp('[^а-яёa-z36*#\\n]+', 'img'), '\n');
  alf += '\n';
  alf = alf.replace(new RegExp(`^${neMat}\\n`, 'img'), ''); // убрать исключения.
  alf = alf.replace(new RegExp('\\n\\n+', 'igm'), '\n');
  alf = alf.replace(new RegExp(`${meta}|${faceInst}`, 'igm'), '♣$&');
  // ещё раз сортируем:
  const arr = alf.split('\n');
  arr.sort();
  alf = arr.join('\n');
  alf += '\n';
  alf = alf.replace(new RegExp('♣', 'igm'), '');

  let countMat;
  let countFaceInst;
  let countMeta;
  if (!alf) {
    await message(notFound);
    return true;
  } else {
    countMat = (alf.match(/\n/gim) || []).length;
    countMat -= 1;
    countMat -= 1;
    countFaceInst = (alf.match(new RegExp(faceInst, 'gi')) || []).length;
    countMeta = (alf.match(new RegExp(meta, 'gi')) || []).length;
    const countMetaFaceInst = countMeta + countFaceInst;
    countMat -= countMetaFaceInst;
    if (!countMat && !countMetaFaceInst) {
      await message(notFound);
      return true;
    }
    await message(
      t(
        ctx,
        `Найдено нецензурных слов:\t\t${countMat}\n\nУпоминаний запрещённых \nна территории РФ сетей и организаций:\t${countMetaFaceInst}\n\n${name} v.${version}`,
        `Obscene words found:\t\t${countMat}\n\nMentions of networks and organisations \nbanned in the Russian Federation:\t${countMetaFaceInst}\n\n${name} v.${version}`,
      ),
    );
  }

  // указываем количество каждого из совпадений:
  for (let i = 100; i >= 0; i -= 1) {
    const dubl = i + 1;
    alf = alf.replace(new RegExp(`^([a-zа-яё36*#-]+)\\n(\\1\\n){${i}}`, 'img'), `$1\t${dubl}\n`);
  }
  // готовим html-таблицу по алфавиту:
  alf = alf.replace(new RegExp('^([a-zа-яё36*#-]+)\\t(\\d+)$', 'img'), '<tr><td>$1</td><td>$2</td></tr>');
  alf = `<table align=left border=1><th>${headAlphabet}</th>${alf}</table>`; // список в html.
  let tabl = `${posl}<table align=left border=0><tr><td></td></tr></table>${alf}`;
  tabl = tabl.replace(new RegExp(engFoul, 'img'), "<font color='red'>$&</font>");
  tabl = tabl.replace(new RegExp(`${meta}|${faceInst}`, 'ig'), "<font color='green'>$&</font>");
  tabl = tabl.replace(new RegExp('([а-яё])([a-z36]+)', 'ig'), "$1<font color='red'>$2</font>");
  tabl = tabl.replace(new RegExp('([a-z36]+)([а-яё])', 'ig'), "<font color='red'>$1</font>$2");
  tabl = tabl.replace(new RegExp('[*#]+', 'img'), "<font color='red'>$&</font>");

  // MyMsgWindow: the report window ("HTML/Статистика нецензурных слов.html").
  await mfbe.ui.report({ title: t(ctx, 'Статистика нецензурных слов', 'Obscene words statistics'), html: tabl });
  if (okno === 1 && tablCopu === 1) {
    // текст для буфера обмена:
    let board = tabl;
    board = board.replace(new RegExp('</td><td>', 'ig'), '\t');
    board = board.replace(new RegExp(`<th>(${headSequence})</th>`, 'igm'), '  $1\n');
    board = board.replace(new RegExp(`<th>(${headAlphabet})</th>`, 'igm'), '\n\n===================\n\n  $1');
    board = board.replace(new RegExp('</?[^>]+?>', 'ig'), '');
    await mfbe.clipboard.writeText(board); // поместить данные в буфер обмена.
  }

  // добавление записи в аннотацию: the notes are Russian text of the book in every interface.
  const description = snapshot.description;
  const confirm = async (ru, en) => (await MsgBox(t(ctx, ru, en), ctx.script.name, 1 + 32)) === 1;
  let changed = false;
  const annotate = (msg_1) => {
    description.titleInfo.annotation ??= { type: 'annotation', attrs: {}, content: [] };
    addToAnno(description.titleInfo.annotation, msg_1);
    changed = true;
  };
  if (countMat > 0) {
    if (await confirm('Оставить запись о наличии неценцурной лексики в аннотации?', 'Add a note to the annotation that the text holds obscene language?')) {
      annotate('<EM>Содержит нецензурную лексику.</EM>');
    }
  }
  if (countFaceInst > 0) {
    if (
      await confirm(
        'Оставить в аннотации запись о наличии упоминаний социальных сетей и экстремитских организаций запрещённых на территории РФ (Meta, Facebook и/или Instagram)?',
        'Add a note to the annotation that the text mentions social networks and extremist organisations banned in the Russian Federation (Meta, Facebook and/or Instagram)?',
      )
    ) {
      annotate('<EM>* В тексте упоминаются социальные сети Facebook и/или Instagram (организации, запрещённые на территории РФ).</EM>');
      annotate('<EM>** Meta Platforms Inc. признана экстремистской организацией на территории РФ.</EM>');
    }
  }
  if (countMeta > 0 && countFaceInst === 0) {
    if (
      await confirm(
        'Оставить в аннотации запись о наличии упоминаний Meta Platforms Inc. (признана экстремистской организацией на территории РФ).?',
        'Add a note to the annotation that the text mentions Meta Platforms Inc. (recognised as an extremist organisation in the Russian Federation)?',
      )
    ) {
      annotate('<EM>** Meta Platforms Inc. признана экстремистской организацией на территории РФ.</EM>');
    }
  }
  if (changed) await mfbe.doc.setDescription(description);
  // The original's Run() ended with "else return true;" after the last question.
  return countMeta > 0 && countFaceInst === 0 ? undefined : true;
}
