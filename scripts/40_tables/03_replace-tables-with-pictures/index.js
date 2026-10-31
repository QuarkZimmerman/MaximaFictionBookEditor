// Converted from FictionBook Editor 2.7.9: Scripts/40_Таблицы/03_Помочь заменить таблицы на их изображения.js
// Helps replace the book's tables with pictures of them, in two passes chosen in the first
// question. "OK": above every table it puts an empty picture (href "#undefined") and a struck-out
// label "zzz_табл N из M_zzz" (N counting the tables in the order of the book: annotation,
// history, bodies); the pictures are then made and set by hand. "Cancel": it deletes every table
// with its content, and every paragraph that is only such a label (whatever its formatting) outside
// the annotations, the history and the notes and comments bodies, with the containers left empty
// by that. The second question offers to stop and read the help instead.
// Differences from 2.7.9: the work is done on the document model; where FB2 allows no picture (in
// a citation or an annotation) the label comes alone, and right after a section's annotation the
// picture comes after the label; the status line counts the tables left without a picture; where
// deleting leaves a section with no content after its title (or none at all), or with a picture
// first after its title or annotation, an empty line stays there (FB2 needs content there and no
// picture first; 2.7.9 left the section so) and the first body, if emptied, keeps one section. Fixed: the tables are counted whatever their attributes (2.7.9
// counted only tables without a style or an id, and then numbered the labels wrongly).
// The original's notice, kept as written (FR-029):
// Скрипт "Помочь заменить таблицы на их изображения" v1.11
// Автор stokber (август 2025).
// В скрипте использованы фрагменты кода из скриптов за авторством Sclex-а.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date', 'empty-line']);
/** Containers delNum removes when they are left empty (re1 of the original). */
const RE1 = new Set(['title', 'section', 'poem', 'text-author', 'cite', 'epigraph', 'stanza', 'body']);
const LABEL = /^zzz_табл \d+ из \d+_zzz$/;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The text of a block with its tags removed but the pictures (re2 of the original kept <img>). */
function labelText(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : c.type === 'inline-image' ? '<img>' : '')).join('');
}

const clone = (value) => JSON.parse(JSON.stringify(value));

export default async function run(ctx) {
  const name = 'Помочь заменить таблицы на их изображения';
  const version = '1.11';
  let count_01 = 0; // счётчик удалённых меток таблиц

  const vopros1 = t(
    ctx,
    "Чтобы расставить метки и пустые изображения над таблицами, нажмите 'OK'.\n\nЧтобы удалить метки и таблицы, нажмите 'Отмена'.\n\nP.S. В следующем окне можно отказаться от обеих вариантов и прочесть «справку».",
    "To put labels and empty pictures above the tables, press 'OK'.\n\nTo delete the labels and the tables, press 'Cancel'.\n\nP.S. In the next window you can refuse both and read the help.",
  );
  const result = (await MsgBox(vopros1, ctx.script.name, 1 + 32)) === 1;
  const vubor = result
    ? t(ctx, 'вставку пустых изображений и соответствующих им меток.', 'to insert empty pictures and the labels that go with them.')
    : t(ctx, 'удаление ВСЕХ-ВСЕХ таблиц и соответствующих им меток.', 'to delete ALL the tables and the labels that go with them.');
  const vopros2 = t(
    ctx,
    'Вы выбрали ' + vubor + " \nЕсли хотите продолжить, нажмите 'OK'.\n\nЕсли хотите завершить работу и прочесть «справку», нажмите 'Отмена'.",
    'You chose ' + vubor + " \nTo go on, press 'OK'.\n\nTo stop and read the help, press 'Cancel'.",
  );
  const help = t(
    ctx,
    "Cправка\n\nСкрипт призван помочь массово заменить таблицы на их изображения. \nНа первом этапе скрипт поможет расставить пустые изображения и соответствующие им номерные метки вида 'zzz_табл 1 из 10_zzz' НАД таблицами. Затем, после самостоятельной расстановки изображений таблиц (эта процедура, как и изготовление самих изображений, не входит в функционал сценария) скрипт поможет избавиться от ВСЕХ-ВСЕХ таблиц и соответствующих им меток, если таковые (метки) имеются. Следует иметь ввиду, что хотя метки и сформатированы в документе зачёркнутым текстом (сделано это для большего различения с оригинальным текстом документа fb2), удаляться метки вида 'zzz_табл 1 из 10_zzz' будут независимо от их внешнего или внутреннего форматирования, будь то зачеркнутый, курсивный, полужирный, надстрочный или подстрочный текст.",
    "Help\n\nThe script helps replace many tables with their pictures at once. \nIn the first pass it puts empty pictures and numbered labels like 'zzz_табл 1 из 10_zzz' ABOVE the tables. Then, once you have set the pictures of the tables yourself (making the pictures and setting them is not part of the script), it helps get rid of ALL the tables and their labels, if there are any (labels). Note that although the labels are struck out in the document (to tell them from the book's own text), labels like 'zzz_табл 1 из 10_zzz' are deleted whatever their formatting, struck out, italic, bold, superscript or subscript.",
  );
  if ((await MsgBox(vopros2, ctx.script.name, 1 + 32)) !== 1) {
    await MsgBox(help, ctx.script.name, 64);
    return;
  }
  // строка для меню замены
  await mfbe.edit.label(result ? t(ctx, 'вставку пустых изображений', 'inserting empty pictures') : t(ctx, 'удаление всех таблиц', 'deleting all tables'));

  const doc = await mfbe.doc.get();
  const description = doc.description;

  // The tables in the order of the page: the annotation, the history, then the bodies.
  const tables = [];
  const collect = (node, where) => {
    if (!node || node.type === 'text' || TEXT_BLOCKS.has(node.type)) return;
    if (node.type === 'table') {
      tables.push({ node, where });
      return;
    }
    for (const child of node.content ?? []) collect(child, where);
  };
  collect(description.titleInfo.annotation, 'annotation');
  collect(description.documentInfo.history, 'history');
  for (const body of doc.bodies) collect(body, 'body');
  const countTable = tables.length;
  let removedTablesCnt = 0;
  let noPicture = 0;

  if (result) {
    // вставка пустых изображений и меток: from the last table, as the original walked
    let descriptionChanged = false;
    for (let i = tables.length - 1; i >= 0; i--) {
      const { node, where } = tables[i];
      const j = Math.abs(removedTablesCnt - countTable); // чтобы счет был не с конца
      const label = { type: 'p', attrs: {}, content: [{ type: 'text', text: 'zzz_табл ' + j + ' из ' + countTable + '_zzz', marks: [{ type: 'strikethrough' }] }] };
      const picture = { type: 'image', attrs: { href: '#undefined' } };
      if (where === 'body') {
        const labelRef = await mfbe.doc.insertNode('before', node.attrs.nodeId, label);
        let placed = false;
        for (const side of ['before', 'after']) {
          try {
            await mfbe.doc.insertNode(side, labelRef, picture);
            placed = true;
            break;
          } catch (error) {
            if (error?.code !== 'notAllowed' && error?.code !== 'invalidNode') throw error;
          }
        }
        if (!placed) noPicture += 1;
      } else {
        // The annotation and the history hold no pictures (FB2): the label alone.
        const owner = where === 'annotation' ? description.titleInfo.annotation : description.documentInfo.history;
        const place = (list) => {
          const at = list.indexOf(node);
          if (at >= 0) {
            list.splice(at, 0, label);
            return true;
          }
          return list.some((child) => Array.isArray(child.content) && !TEXT_BLOCKS.has(child.type) && place(child.content));
        };
        place(owner.content);
        descriptionChanged = true;
        noPicture += 1;
      }
      removedTablesCnt++;
      if (removedTablesCnt % 25 === 0) await mfbe.ui.progress(removedTablesCnt, countTable);
      if (ctx.cancelled) return;
    }
    if (descriptionChanged) await mfbe.doc.setDescription(description);
  } else {
    // удаление таблиц
    const withoutTables = (node) => {
      if (!Array.isArray(node.content) || TEXT_BLOCKS.has(node.type)) return node;
      node.content = node.content.filter((child) => {
        if (child.type === 'table') {
          removedTablesCnt++;
          return false;
        }
        withoutTables(child);
        return true;
      });
      return node;
    };
    const bodies = doc.bodies.map((body) => withoutTables(clone(body)));
    let descriptionChanged = false;
    for (const [owner, key] of [[description.titleInfo, 'annotation'], [description.documentInfo, 'history']]) {
      if (!owner[key]) continue;
      const before = removedTablesCnt;
      withoutTables(owner[key]);
      if (removedTablesCnt !== before) {
        descriptionChanged = true;
        if (!owner[key].content.length) delete owner[key];
      }
    }

    // delNum: удаление меток таблиц outside the annotations, the history and the notes bodies,
    // and of the containers that this leaves empty.
    const delNum = (node) => {
      let removedAll = node.content.length > 0;
      node.content = node.content.filter((child) => {
        if (TEXT_BLOCKS.has(child.type)) {
          if (LABEL.test(labelText(child))) {
            count_01++;
            return false;
          }
          removedAll = false;
          return true;
        }
        const skipped = child.type === 'annotation' || child.type === 'table' || !Array.isArray(child.content) || child.content.length === 0;
        if (skipped) {
          removedAll = false;
          return true;
        }
        if (delNum(child) && RE1.has(child.type)) return false;
        removedAll = false;
        return true;
      });
      return removedAll && node.content.length === 0;
    };
    const keep = bodies.map((body) => {
      const bodyName = body.attrs?.name;
      if (bodyName === 'notes' || bodyName === 'comments') return true;
      return !delNum(body);
    });

    // FB2 needs content after a section's title, epigraphs, picture and annotation (and in a
    // section at all), and that content may not start with a picture: an empty line stays there.
    const fill = (node) => {
      if (!Array.isArray(node.content) || TEXT_BLOCKS.has(node.type)) return;
      if (node.type === 'section') {
        const c = node.content;
        let i = 0;
        if (c[i]?.type === 'title') i++;
        while (c[i]?.type === 'epigraph') i++;
        if (c[i]?.type === 'image') i++;
        if (c[i]?.type === 'annotation') i++;
        if (i >= c.length) c.push({ type: 'empty-line', attrs: {} });
        else if (c[i].type === 'image') c.splice(i, 0, { type: 'empty-line', attrs: {} });
      }
      node.content.forEach(fill);
    };
    bodies.forEach((body, i) => {
      if (!keep[i] && i === 0) {
        body.content = [{ type: 'section', attrs: {}, content: [{ type: 'empty-line', attrs: {} }] }];
        keep[i] = true;
      }
      if (keep[i]) {
        if (!body.content.some((c) => c.type === 'section')) body.content.push({ type: 'section', attrs: {}, content: [{ type: 'empty-line', attrs: {} }] });
        fill(body);
      }
    });

    for (let i = bodies.length - 1; i >= 0; i--) {
      const ref = doc.bodies[i].attrs.nodeId;
      if (!keep[i]) await mfbe.doc.removeNode(ref);
      else if (JSON.stringify(bodies[i]) !== JSON.stringify(doc.bodies[i])) await mfbe.doc.replaceNode(ref, bodies[i]);
    }
    if (descriptionChanged) await mfbe.doc.setDescription(description);
  }

  if (removedTablesCnt === 0) {
    await mfbe.ui.message(t(ctx, "Таблиц в документе не нашлось.\n\nСкрипт '" + name + "' v." + version + '.', "No tables were found in the document.\n\nScript 'Help replace tables with their pictures' v." + version + '.'), { caption: ctx.script.name });
    return;
  }
  if (result) {
    let text = t(ctx, 'Вставлено пустых изображений с метками таблиц: ' + removedTablesCnt + '.', 'Empty pictures with table labels inserted: ' + removedTablesCnt + '.');
    if (noPicture) text += t(ctx, ' Без изображения (FB2 не допускает его там): ' + noPicture + '.', ' Without a picture (FB2 allows none there): ' + noPicture + '.');
    await mfbe.ui.status(text, { sticky: true });
  } else {
    await mfbe.ui.status(t(ctx, 'Удалено таблиц с их содержимым: ' + removedTablesCnt + ', меток таблиц: ' + count_01 + '.', 'Tables deleted with their content: ' + removedTablesCnt + ', table labels: ' + count_01 + '.'), { sticky: true });
  }
}
