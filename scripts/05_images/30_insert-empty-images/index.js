// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/30_Вставить пустые картинки в началах и концах секций.js
// After a dialog (start, end or both) inserts empty pictures - links to "#undefined", the places
// "Расставить иллюстрации по заданным местам" fills - into every section outside the notes body:
// after the title of a section that has one, and at the end of a section without subsections
// (of an untitled one unless it ends with a subtitle), except where such a picture stands already.
// A section left with no content but its title and empty pictures gets an empty line. A window
// gives the statistics.
// Differences from the original (docs/scripting/notes-279-drafts/05.md):
// - fix: a subtitle no longer counts as the section's title (the original's className test
//   "title" matched "subtitle" too, so an untitled section got its "start" picture after its
//   first subtitle, wherever that stood);
// - in a section with epigraphs the start picture goes after them, the place FB2 gives a
//   section's picture (the original put it between the title and the first epigraph, which left
//   the book invalid); where that place holds an ordinary picture already, none is inserted, as
//   FB2 allows one there (the original inserted it; its help text sent the user to
//   "13_Почистить структуру.js" for such cases), and none is counted;
// - the HTML dialog is a form; its notes are shown as text.
// The original's notice, kept as written (FR-029):
// Скрипт «Вставить пустые ссылки на картинки в началах и концах секций»
// Версия 3.7 
// Идея - TaKir
// Реализация - DeepSeek, TaKir, 06.11.2025
//  Скрипт применяется для массовой расстановки иллюстраций в началах и концах секций.
//  В отдельных случаях из-за структурных особенностей конкретного fb2 документа
//  может быть не проставлена пустая картинка или проставлена лишняя.
//  Поэтому иногда требуется проверка и небольшая доработка руками в вашем файле.
//  Перед запуском данного скрипта НАСТОЯТЕЛЬНО РЕКОМЕНДУЕТСЯ
//  обработать ваш  документ скриптом "13_Почистить структуру.js" из папки 08_Структура разделов.
//  Если где-то в началах и концах секций уже есть расставленные пустые картинки,
//  скрипт не будет повторно расставлять пустые картинки в эти же места.
//  Пустые картинки, уже вставленные между обычных абзацев,
//  не помешают расстановке в началах и концах секций.
//  Обычные картинки, уже вставленные в началах или концах секций,
//  также не помешают расстановке пустых картинок в началах и концах секций.

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const EMPTY_IMAGE = { type: 'image', attrs: { href: '#undefined' } };

/** The original's isEmptyImageElement: a picture whose address is "#undefined". */
function isEmptyImage(node) {
  return node?.type === 'image' && node.attrs?.href === '#undefined';
}

/** The dialog "Параметры вставки пустых ссылок на картинки" (HTML/Вставить пустые ссылки на картинки - параметры.htm). */
async function askSettings(ctx) {
  return mfbe.ui.form({
    title: t(ctx, 'Параметры вставки пустых ссылок на картинки', 'Settings for inserting empty picture links'),
    width: 720,
    fields: [
      { kind: 'static', id: 'heading', text: t(ctx, 'Вставить пустые ссылки на картинки:', 'Insert empty picture links:') },
      {
        kind: 'checkbox',
        id: 'insertStart',
        label: t(ctx, 'Вставить пустые картинки в начале всех секций', 'Insert empty pictures at the start of all sections'),
        value: true,
      },
      {
        kind: 'checkbox',
        id: 'insertEnd',
        label: t(ctx, 'Вставить пустые картинки в конце всех секций', 'Insert empty pictures at the end of all sections'),
        value: true,
      },
      {
        kind: 'static',
        id: 'notes',
        text: t(
          ctx,
          'ВНИМАНИЕ!\n' +
            '• В отдельных случаях из-за структурных особенностей конкретного fb2 документа может быть не проставлена пустая картинка или проставлена лишняя.\n' +
            '• Поэтому иногда требуется ручная проверка правильности расстановки и небольшая доработка руками в вашем файле.\n' +
            'Перед запуском данного скрипта НАСТОЯТЕЛЬНО РЕКОМЕНДУЕТСЯ обработать ваш документ скриптом «13_Почистить структуру.js» из папки 08_Структура разделов.\n' +
            'После запуска данного скрипта также рекомендуетя обработать ваш документ скриптом «13_Почистить структуру.js» для устранения возможной невалидности документа в некоторых случаях.\n' +
            'Если где-то в началах или концах секций уже есть расставленные пустые картинки, скрипт не будет повторно расставлять пустые картинки в эти же места.\n' +
            'Пустые картинки, уже вставленные между обычных абзацев, не помешают расстановке в началах и концах секций.\n' +
            'Обычные картинки, уже вставленные в началах или концах секций, также не помешают расстановке пустых картинок в началах и концах секций.',
          'ATTENTION!\n' +
            '• In some cases, because of the structure of a particular fb2 document, an empty picture may be missing or an extra one may be inserted.\n' +
            '• So a check by hand of where the pictures went, and a little work by hand in your file, are sometimes needed.\n' +
            'Before running this script it is STRONGLY RECOMMENDED to process your document with the script «13_Почистить структуру.js» of the folder 08_Структура разделов.\n' +
            'After running this script it is also recommended to process your document with «13_Почистить структуру.js», to remove a possible invalidity of the document in some cases.\n' +
            'Where empty pictures stand at the starts or ends of sections already, the script does not insert empty pictures at those places again.\n' +
            'Empty pictures already inserted between ordinary paragraphs do not hinder the insertion at the starts and ends of sections.\n' +
            'Ordinary pictures already inserted at the starts or ends of sections do not hinder the insertion of empty pictures at the starts and ends of sections either.',
        ),
      },
    ],
    okLabel: t(ctx, 'Выполнить', 'Run'),
    cancelLabel: t(ctx, 'Отмена', 'Cancel'),
  });
}

async function tryInsert(where, ref, node) {
  try {
    return await mfbe.doc.insertNode(where, ref, node);
  } catch (error) {
    if (error?.code === 'notAllowed' || error?.code === 'invalidNode') return null; // FB2 allows no picture there
    throw error;
  }
}

export default async function run(ctx) {
  const settings = await askSettings(ctx);
  if (!settings) return;
  const insertEnd = !!settings.insertEnd;
  const insertStart = !!settings.insertStart;
  if (!insertEnd && !insertStart) {
    await mfbe.ui.message(t(ctx, 'Не выбрано ни одной опции для вставки!', 'No option to insert was chosen!'));
    return;
  }
  const stats = {
    totalInserted: 0,
    startInserted: 0,
    endInserted: 0,
    emptyLinesAdded: 0,
    skippedNotes: 0,
    skippedParentSections: 0,
    skippedNamelessSections: 0,
  };
  await mfbe.ui.status(t(ctx, 'Вставляем пустые ссылки на картинки…', 'Inserting empty picture links…'));

  // The sections in document order (a section before its subsections), with their body.
  const doc = await mfbe.doc.get();
  const sections = [];
  const visit = (node, inNotes) => {
    for (const child of node.content ?? []) {
      if (child.type !== 'section') continue;
      sections.push({ node: child, inNotes });
      visit(child, inNotes);
    }
  };
  for (const body of doc.bodies ?? []) visit(body, body.attrs?.name === 'notes');

  for (let j = 0; j < sections.length; j += 1) {
    const { node: section, inNotes } = sections[j];
    if (j % 25 === 0) {
      await mfbe.ui.progress(j, sections.length);
      if (ctx.cancelled) return;
    }
    // Пропускаем section в разделе сносок (body с fbname="notes")
    if (inNotes) {
      stats.skippedNotes += 1;
      continue;
    }
    const kids = section.content ?? [];
    const sectionId = section.attrs.nodeId;
    const isParentSection = kids.some((child) => child.type === 'section');
    const firstTitle = kids.findIndex((child) => child.type === 'title');
    const hasTitle = firstTitle >= 0;

    // The section as it will be, to decide as the original did on the section it had changed.
    const planned = [...kids];
    // Вставка в начало (ТОЛЬКО для секций с заголовком): after the title and its epigraphs.
    let startAfter = null;
    if (insertStart) {
      if (hasTitle) {
        let at = firstTitle + 1;
        while (kids[at]?.type === 'epigraph') at += 1;
        if (!isEmptyImage(kids[at])) {
          startAfter = kids[at - 1];
          planned.splice(at, 0, EMPTY_IMAGE);
        }
      } else {
        stats.skippedNamelessSections += 1; // Пропускаем безымянные секции
      }
    }
    // Вставка в конец (только для листовых секций без вложенных); for an untitled section only
    // when it does not end with a subtitle.
    let atEnd = false;
    if (insertEnd && !isParentSection) {
      const last = planned[planned.length - 1];
      if (hasTitle || last?.type !== 'subtitle') {
        if (!isEmptyImage(last)) {
          atEnd = true;
          planned.push(EMPTY_IMAGE);
        }
      }
    } else if (insertEnd && isParentSection) {
      stats.skippedParentSections += 1;
    }
    // Проверяем пустые секции: nothing but titles, subtitles and empty pictures.
    let hasContent = false;
    let imageCount = 0;
    for (const child of planned) {
      if (isEmptyImage(child)) imageCount += 1;
      else if (child.type !== 'title' && child.type !== 'subtitle') hasContent = true;
    }
    // The edits, in an order the book stays valid in: the empty line first.
    let emptyLine = null;
    if (!hasContent && imageCount > 0) {
      emptyLine = await tryInsert('append', sectionId, { type: 'empty-line' });
      if (emptyLine) stats.emptyLinesAdded += 1;
    }
    if (startAfter && (await tryInsert('after', startAfter.attrs.nodeId, EMPTY_IMAGE))) stats.startInserted += 1;
    if (atEnd) {
      const inserted = emptyLine
        ? await tryInsert('before', emptyLine.nodeId, EMPTY_IMAGE)
        : await tryInsert('append', sectionId, EMPTY_IMAGE);
      if (inserted) stats.endInserted += 1;
    }
  }

  // showStatistics
  stats.totalInserted = stats.startInserted + stats.endInserted;
  let message = t(
    ctx,
    'Скрипт «Вставить пустые ссылки на картинки в началах и концах секций» v3.7\n\n',
    'Script "Insert empty picture links at the starts and ends of sections" v3.7\n\n',
  );
  message += t(ctx, 'Результаты выполнения:\n', 'Results:\n');
  message += t(ctx, 'Всего расставлено пустых картинок: ', 'Empty pictures inserted in all: ') + stats.totalInserted + '\n';
  if (insertStart) {
    message += t(ctx, '• В начале секций: ', '• At the starts of sections: ') + stats.startInserted + '\n';
    message += t(ctx, '• Пропущено безымянных секций: ', '• Untitled sections skipped: ') + stats.skippedNamelessSections + '\n';
  } else {
    message += t(ctx, '• В начале секций: ', '• At the starts of sections: ') + stats.startInserted + t(ctx, ' (не расставлялись)\n', ' (not inserted)\n');
  }
  if (insertEnd) {
    message += t(ctx, '• В конце секций: ', '• At the ends of sections: ') + stats.endInserted + '\n';
  } else {
    message += t(ctx, '• В конце секций: ', '• At the ends of sections: ') + stats.endInserted + t(ctx, ' (не расставлялись)\n', ' (not inserted)\n');
  }
  message += t(ctx, '• Добавлено пустых строк: ', '• Empty lines added: ') + stats.emptyLinesAdded + '\n';
  message += t(ctx, '• Пропущено секций в сносках: ', '• Sections in the notes skipped: ') + stats.skippedNotes + '\n';
  if (insertEnd) {
    message += t(ctx, '• Пропущено родительских секций: ', '• Parent sections skipped: ') + stats.skippedParentSections;
  } else {
    message += t(ctx, '• Пропущено родительских секций: ', '• Parent sections skipped: ') + stats.skippedParentSections + t(ctx, ' (не применялось)', ' (not applied)');
  }
  await mfbe.ui.message(message);
}
