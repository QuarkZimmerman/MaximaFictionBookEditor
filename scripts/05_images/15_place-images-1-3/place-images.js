// The engine of the two identical FictionBook Editor 2.7.9 scripts "15_Расставить иллюстрации по
// заданным местам 1.3.js" and "15_Расставить иллюстрации по заданным местам.js" (group
// 05_Иллюстрации), one copy in each package: the sandbox only loads modules from the script's own
// folder.
//
// The original took the pictures of fbw_body (the book annotation, the history, every body)
// whose binary is missing - the empty pictures set aside as places, "#undefined" or
// "#nobin_undefined" - and the binaries no picture or cover uses, left out those that look like
// a cover or a copy ("cover.jpg", "x.jpg_1"), and when both lists were as long as each other gave
// the i-th place of the first body the i-th unused binary, in the order of the binary objects.
// Then it turned the paragraphs of the first body that hold nothing but white space into empty
// lines. Otherwise it showed the counts, and on request the lists in detail.

const name = "'Расставить иллюстрации по заданным местам'";
const nameEn = "'Place the illustrations at the given places'";
const version = '1.3';

// The original's settings "обрабатывать ли history" and "обрабатывать ли annotation" (both
// true) had no effect: its paragraph clean-up walked the first body only, which holds neither.

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** The original's confirm(): OK or Cancel. */
async function confirm(text) {
  const answer = await mfbe.ui.message(text, {
    icon: 'question',
    buttons: [
      { id: 'ok', label: '', default: true },
      { id: 'cancel', label: '', cancel: true },
    ],
  });
  return answer === 'ok';
}

/** The original's time(): seconds, five characters of the number, a comma for the point. */
function time(ctx, Ts) {
  const TsecD = (Date.now() - Ts) / 1000;
  const seconds = String(TsecD).replace(/(.{1,5}).*/g, '$1').replace(/\.$/g, '');
  return t(ctx, `${seconds.replace('.', ',')} с`, `${seconds} s`);
}

/** The pictures in fbw_body order: `{ node, inDescription, inFirstBody }`. */
function picturesOf(doc) {
  const pictures = [];
  const visit = (node, where) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (node.type === 'image' || node.type === 'inline-image') {
      pictures.push({ node, ...where });
      return;
    }
    for (const child of node.content ?? []) visit(child, where);
  };
  visit(doc.description?.titleInfo?.annotation, { inDescription: true, inFirstBody: false });
  visit(doc.description?.documentInfo?.history, { inDescription: true, inFirstBody: false });
  (doc.bodies ?? []).forEach((body, index) => visit(body, { inDescription: false, inFirstBody: index === 0 }));
  return pictures;
}

/** Gives a picture of a body the address `#id`, keeping its other attributes and marks. */
async function setAddress(picture, id) {
  const { node } = picture;
  node.attrs = { ...(node.attrs ?? {}), href: `#${id}` };
  const attrs = { ...node.attrs };
  delete attrs.nodeId;
  const replacement = { type: node.type, attrs };
  if (node.marks?.length) replacement.marks = node.marks;
  await mfbe.doc.replaceNode(node.attrs.nodeId, replacement);
}

/**
 * The original's correction(): every paragraph of the first body holding nothing but white space
 * (with or without formatting) and no picture is emptied - which FictionBook Editor saved as an
 * empty line; a verse as a verse of one space, a table cell as an empty cell.
 */
async function correction(body) {
  const blocks = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object' || node.type === 'text') return;
    if (TEXT_BLOCKS.has(node.type)) {
      blocks.push(node);
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(body);
  for (const block of blocks) {
    const content = block.content ?? [];
    if (content.length === 0 || content.some((child) => child.type !== 'text')) continue;
    if (!/^[\s ]+$/.test(content.map((child) => child.text ?? '').join(''))) continue;
    const attrs = { ...(block.attrs ?? {}) };
    delete attrs.nodeId;
    let replacement;
    if (block.type === 'td' || block.type === 'th') replacement = { type: block.type, attrs, content: [] };
    else if (block.type === 'v') {
      if (content.length === 1 && content[0].text === ' ' && !content[0].marks?.length) continue;
      replacement = { type: 'v', attrs, content: [{ type: 'text', text: ' ' }] };
    } else replacement = { type: 'empty-line' };
    try {
      await mfbe.doc.replaceNode(block.attrs.nodeId, replacement);
    } catch (error) {
      if (error?.code !== 'notAllowed' && error?.code !== 'invalidNode') throw error;
      // No empty line is allowed there (a poem's text author): the paragraph is emptied.
      await mfbe.doc.replaceNode(block.attrs.nodeId, { type: block.type, attrs, content: [] });
    }
  }
}

export async function placeImages(ctx) {
  const doc = await mfbe.doc.get();
  const body = (doc.bodies ?? [])[0]; // только первое body
  if (!body) {
    await mfbe.ui.message(
      t(
        ctx,
        'В документе не найдено ни одного раздела body. Скрипт завершает свою работу.',
        'The document has no body. The script ends its work.',
      ),
    );
    return true;
  }

  const result0 = await confirm(
    t(
      ctx,
      'Прикрепите ваши иллюстрации к документу с расставленными заранее пустыми изображениями. Количество этих иллюстраций должно быть равно количеству пустых изображений. Расставляться в документе они будут согласно алфавитному порядку их имён.\n\nОК — Продолжить; Отмена — Выйти.',
      'Attach your illustrations to the document, in which empty pictures were placed beforehand. There must be as many illustrations as empty pictures. They will be placed in the document in the alphabetical order of their names.\n\nOK — continue; Cancel — quit.',
    ),
  );
  if (result0 === false) return false;

  const Ts = Date.now(); // время начала работы скрипта.

  // Проверка наличия и количества изображений (the code of "Проверить иллюстрации").
  // The covers: those of the title-info and of the src-title-info, by their address.
  const covers = new Set();
  for (const info of [doc.description?.titleInfo, doc.description?.srcTitleInfo]) {
    for (const image of info?.coverpage ?? []) covers.add(String(image.href ?? ''));
  }
  const pictures = picturesOf(doc);
  const ids = (doc.binaries ?? []).map((binary) => binary.id);

  // Find unused images
  let unusedList = ''; // список прикреплённых.
  for (const id of ids) {
    const found = pictures.some((picture) => picture.node.attrs?.href === `#${id}`);
    if (!found && !covers.has(`#${id}`)) unusedList += `${id}\n`;
  }

  // Find broken images (no binary): the address after its first character (the original's
  // IMG src after "fbw-internal:#").
  let broken = '';
  for (const picture of pictures) {
    const img = String(picture.node.attrs?.href ?? '').slice(1);
    if (!ids.includes(img)) broken += `${img}\n`;
  }
  const brokenList = broken; // список пустых.
  if (broken === '') broken = t(ctx, ' • не найдено\n', ' • none\n');

  let prolog; // текст для первой строки финального сообщения.
  if (!unusedList && !brokenList) {
    prolog = t(ctx, 'Пустые и прикреплённые неиспользуемые изображения отсутствуют.\n\n', 'There are neither empty pictures nor attached unused pictures.\n\n');
  } else if (!unusedList) {
    prolog = t(ctx, 'Прикреплённые неиспользуемые изображения отсутствуют.\n\n', 'There are no attached unused pictures.\n\n');
  } else if (!brokenList) {
    prolog = t(ctx, 'Пустые изображения отсутствуют.\n\n', 'There are no empty pictures.\n\n');
  } else prolog = '';

  // Вероятные обложки и копии (cover.jpg, cover_src.png, x.jpg_1) are left out.
  const found = unusedList.match(/cover(_src)?\.(jpg|png)(_\d+)?|.+?[.](jpg|png)_\d+/g) || []; // Находим все совпадения
  const colCoverPlusCopies = found.length;
  const coverPlusCopies = found.join('\n');
  unusedList = unusedList.replace(/^cover(_src)?[.](jpg|png)(_\d+)?\n/gim, ''); // исключаем вероятные обложки.
  unusedList = unusedList.replace(/^.+?[.](jpg|png)_\d+\n/gim, ''); // исключаем вероятные копии.

  const arrUnused = unusedList.split('\n'); // массив неиспользованных изображений.
  const arrBroken = brokenList.split('\n'); // массив пустых изображений.
  const colUnused = arrUnused.length - 1; // всего неиспользованных.
  const colBroken = arrBroken.length - 1; // всего пустых
  const colUndefined = (broken.match(/^undefined$/gm) || []).length; // всего пустых с именем "undefined".
  const colNobinUndefined = (broken.match(/nobin_undefined/g) || []).length; // всего пустых с именем "nobin_undefined".
  const pieces = (count) => t(ctx, `${count} шт.`, `${count}`);
  if (colUndefined === 0) broken = `nobin_undefined (${pieces(colNobinUndefined)})`;
  else if (colNobinUndefined === 0) broken = `undefined (${pieces(colUndefined)})`;
  else broken = `undefined (${pieces(colUndefined)})\nnobin_undefined (${pieces(colNobinUndefined)})`;

  let propusk = t(
    ctx,
    `\nПропущенные скриптом, как вероятные обложки и(или) копии изображений (всего ${colCoverPlusCopies} шт.):\n${coverPlusCopies}\n\n--------------------\n`,
    `\nSkipped by the script as probable covers and/or copies of pictures (${colCoverPlusCopies} in all):\n${coverPlusCopies}\n\n--------------------\n`,
  );
  let pustue = t(
    ctx,
    `\nПустые изображения (всего ${colBroken} шт.)\nВ том числе:\n${broken}\n\n--------------------\n`,
    `\nEmpty pictures (${colBroken} in all)\nAmong them:\n${broken}\n\n--------------------\n`,
  );
  // если прикреплённых неиспользуемых изображений более 30, то выводить их список одной строкой через запятую:
  if (colUnused > 30) unusedList = unusedList.replace(/\n/gm, ',\t');
  let prikrep = t(
    ctx,
    `\nПрикрепленные неиспользуемые изображения (всего ${colUnused} шт.): \n${unusedList}\n`,
    `\nAttached unused pictures (${colUnused} in all): \n${unusedList}\n`,
  );
  // не показывать соответствующие строки при отсутствии вложений этого типа:
  if (coverPlusCopies === '') propusk = '';
  if (colBroken === 0) pustue = '';
  if (colUnused === 0) prikrep = '';

  let tempus = time(ctx, Ts);
  const scriptLine = t(ctx, `Скрипт ${name} v.${version}`, `Script ${nameEn} v.${version}`);
  const reportTitle = t(ctx, 'Расставить иллюстрации по заданным местам', 'Place the illustrations at the given places');

  if (colUnused !== colBroken) {
    // если количества пустых и прикрепленных неиспользованных не совпадает:
    const msg1 = t(
      ctx,
      `${prolog}Увы, у вас разное кол-во заданных мест (или пустых изображений) и прикрепленных неиспользуемых иллюстраций!\n\n- заданных мест (undefined) - ${colBroken}.\n- прикрепленных неиспользуемых иллюстраций  - ${colUnused}.\n\nРасстановка не будет произведена.\nСкрипт завершает свою работу.\nВремя: ${tempus}.\n${scriptLine}\n\nПоказать дополнительные сведения о неиспользованных изображениях?\nОК — Да; Отмена — Нет. Выйти.`,
      `${prolog}Alas, the number of the given places (or empty pictures) differs from the number of the attached unused illustrations!\n\n- given places (undefined) - ${colBroken}.\n- attached unused illustrations  - ${colUnused}.\n\nNothing will be placed.\nThe script ends its work.\nTime: ${tempus}.\n${scriptLine}\n\nShow more about the unused pictures?\nOK — yes; Cancel — no, quit.`,
    );
    if (await confirm(msg1)) {
      // вывести подробную инфу:
      await mfbe.ui.report({ title: reportTitle, text: propusk + pustue + prikrep });
    }
    return undefined;
  }

  // zamena(): the i-th place of the first body - the first picture there whose address is that
  // of the i-th empty picture, letter case aside - gets the i-th unused binary. The message
  // counts the pictures placed (the original reported the smaller of the two counts).
  const inFirstBody = pictures.filter((picture) => picture.inFirstBody);
  let placed = 0;
  for (let i = 0; i < arrUnused.length - 1; i += 1) {
    const wanted = `#${arrBroken[i]}`.toLowerCase();
    const target = inFirstBody.find((picture) => String(picture.node.attrs?.href ?? '').toLowerCase() === wanted);
    if (!target) continue;
    await setAddress(target, arrUnused[i]);
    placed += 1;
    if (ctx.cancelled) return undefined;
  }
  await correction(body);
  tempus = time(ctx, Ts);
  const msg3 = t(
    ctx,
    `${prolog}Расставлено изображений: \t${placed}\nВремя: ${tempus}\n${scriptLine}.`,
    `${prolog}Pictures placed: \t${placed}\nTime: ${tempus}\n${scriptLine}.`,
  );
  if (propusk === '') {
    // вывести в случае удачной расстановки:
    await mfbe.ui.message(msg3);
  } else if (
    // если остались обложки и(или) копии:
    await confirm(
      t(
        ctx,
        `${msg3}\n\nПоказать сведения о проигнорированных скриптом изображениях?\nОК — Да; Отмена — Нет. Выйти.`,
        `${msg3}\n\nShow the pictures the script ignored?\nOK — yes; Cancel — no, quit.`,
      ),
    )
  ) {
    await mfbe.ui.report({ title: reportTitle, text: propusk });
  }
  return undefined;
}
