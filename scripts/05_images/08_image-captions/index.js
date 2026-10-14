// Converted from 05_Иллюстрации/08_Разметка подписей к иллюстрациям....js (FictionBook Editor 2.7),
// Tier 3: the modeless dialog "Разметка подписей к картинкам.html" becomes a form (markup to
// apply, length limit, where to start) followed by the same walk: the paragraph right after every
// block image is a caption candidate. Short candidates that do not end with a sentence mark are
// marked up at once; for the others the paragraph is selected and the user is asked
// ("Это подпись" / "Искать дальше" / "Все" / "Закрыть"), as with the dialog's buttons.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//скрипт «Разметка подписей к картинкам»
//автор Sclex
//сайт скриптов: http://scripts.fictionbook.org

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

function plain(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '.')).join('');
}

function isLineEmpty(node) {
  return /^[ \u00A0]*$/.test((node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(''));
}

/** Short enough and not ending with . … ? ! -> processed without asking. */
function mayAutoprocess(node, limit) {
  const text = plain(node);
  return !/[.…?!]\s*$/.test(text) && text.length <= limit;
}

/** Applies the chosen marks to the whole paragraph (existing copies of the mark are dropped first). */
function markup(node, options) {
  const wanted = [];
  if (options.strong) wanted.push('strong');
  if (options.emphasis) wanted.push('emphasis');
  if (options.sup) wanted.push('sup');
  if (options.sub) wanted.push('sub');
  const content = (node.content ?? []).map((child) => {
    if (child.type !== 'text') return child;
    const marks = (child.marks ?? []).filter((m) => !wanted.includes(m.type));
    return { ...child, marks: [...marks, ...wanted.map((type) => ({ type }))] };
  });
  return { ...node, type: options.subtitle ? 'subtitle' : node.type, content };
}

export default async function run(ctx) {
  const selection = await mfbe.selection.get();
  const form = await mfbe.ui.form({
    title: t(ctx, 'Разметка подписей к картинкам v1.2', 'Mark up image captions v1.2'),
    fields: [
      { kind: 'static', id: 'help', text: t(ctx, 'Как размечать подписи (абзац сразу после картинки):', 'How to mark up a caption (the paragraph right after an image):') },
      { kind: 'checkbox', id: 'strong', label: t(ctx, 'жирный (b)', 'bold (b)'), value: false },
      { kind: 'checkbox', id: 'emphasis', label: t(ctx, 'курсив (i)', 'italic (i)'), value: false },
      { kind: 'checkbox', id: 'sup', label: t(ctx, 'верхний индекс (x²)', 'superscript (x²)'), value: false },
      { kind: 'checkbox', id: 'sub', label: t(ctx, 'нижний индекс (x₂)', 'subscript (x₂)'), value: false },
      { kind: 'checkbox', id: 'subtitle', label: 'subtitle', value: true },
      {
        kind: 'number', id: 'limit', value: 200, min: 1, max: 100000,
        label: t(ctx, 'Ограничение длины (подписи не длиннее и без точки в конце размечаются без вопроса)', 'Length limit (shorter captions without a final period are processed without asking)'),
      },
      {
        kind: 'radio', id: 'start', value: selection && selection.nodes.length ? 'cursor' : 'begin',
        label: t(ctx, 'Откуда начать', 'Where to start'),
        options: [
          { value: 'cursor', label: t(ctx, 'Старт от курсора', 'From the caret') },
          { value: 'begin', label: t(ctx, 'Старт от начала', 'From the beginning') },
        ],
      },
    ],
    okLabel: t(ctx, 'Старт', 'Start'),
  });
  if (!form) return;
  const limit = Number(form.limit) || 100;

  // Images and the block after each one, in document order.
  const doc = await mfbe.doc.get();
  const candidates = [];
  const order = [];
  const visit = (node) => {
    if (node.type === 'text') return;
    order.push(node.attrs?.nodeId);
    const children = node.content ?? [];
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.type === 'image') candidates.push({ image: child, next: children[i + 1] ?? null });
      visit(child);
    }
  };
  for (const body of doc.bodies) visit(body);
  let startIndex = 0;
  if (form.start === 'cursor' && selection && selection.nodes.length) {
    const here = order.indexOf(selection.anchor.nodeId);
    startIndex = candidates.findIndex((c) => order.indexOf(c.image.attrs.nodeId) >= here);
    if (startIndex < 0) startIndex = candidates.length;
  }

  let changeAll = false;
  let pictures = 0;
  let captions = 0;
  for (let i = startIndex; i < candidates.length; i += 1) {
    const { next } = candidates[i];
    pictures += 1;
    if (!next || !TEXT_BLOCKS.has(next.type) || isLineEmpty(next)) continue;
    let apply = changeAll || mayAutoprocess(next, limit);
    if (!apply) {
      await mfbe.selection.selectNode(next.attrs.nodeId);
      const text = plain(next);
      const answer = await mfbe.ui.message(
        t(ctx, `Это подпись к картинке?\n\n«${text.length > 300 ? `${text.slice(0, 300)}…` : text}»`,
          `Is this an image caption?\n\n"${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`),
        {
          icon: 'question',
          buttons: [
            { id: 'yes', label: t(ctx, 'Это подпись', 'It is a caption'), default: true },
            { id: 'skip', label: t(ctx, 'Искать дальше', 'Search on') },
            { id: 'all', label: t(ctx, 'Все', 'All') },
            { id: 'close', label: t(ctx, 'Закрыть', 'Close'), cancel: true },
          ],
        },
      );
      if (answer === 'close') return;
      if (answer === 'all') changeAll = true;
      apply = answer === 'yes' || answer === 'all';
    }
    if (apply) {
      await mfbe.doc.replaceNode(next.attrs.nodeId, markup(next, form));
      captions += 1;
    }
    if (ctx.cancelled) return;
  }
  if (changeAll) {
    await mfbe.ui.message(
      t(ctx, `Обработка всех подписей успешно завершена.\n\nВстретилось картинок: ${pictures}\nОбработано подписей: ${captions}`,
        `All captions processed.\n\nImages seen: ${pictures}\nCaptions processed: ${captions}`),
    );
  } else {
    await mfbe.ui.message(t(ctx, 'Достигнут конец документа.', 'The end of the document was reached.'));
  }
}
