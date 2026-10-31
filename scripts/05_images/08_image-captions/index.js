// Converted from FictionBook Editor 2.7.9: Scripts/05_Иллюстрации/08_Разметить подписи к иллюстрациям....js
// (Sclex, version 1.4; 2.7beta1's 08_Разметка подписей к иллюстрациям....js, 1.2, before feature
// 007), with its dialog HTML/Разметка подписей к иллюстрациям.html. Tier 3: the modeless dialog
// becomes a form (the markup to apply, the length limit, where to start) followed by the same
// walk: the paragraph right after every block picture is a caption candidate. A short candidate
// that does not end with a sentence mark is marked up at once; for the others the paragraph is
// selected and the user is asked, with the dialog's buttons ("Искать дальше", "Разметить как
// подпись", "Закрыть диалог", "Во всех дальнейших случаях разметить как подписи").
//
// As in the original, an inline picture is content: a paragraph holding one is no empty line, and
// the test for a final sentence mark looks at the text before a picture that ends the paragraph.
// Differences (docs/scripting/conversion-notes-279-a.md, group 05): the dialog is modal - its
// settings hold for the whole run and the caret cannot be moved between the questions -, its keys
// K, L, A have no counterpart (Enter marks the caption, Esc closes), the button "Мигать абзацем"
// is dropped (the selection shows the paragraph), the help popup [?] is a note of the form, the
// settings are not remembered between runs; a final sentence mark followed by spaces still
// counts (the original took such a paragraph for a caption without asking).
// The original's notice, kept as written (FR-029):
//автор Sclex
//сайт скриптов: http://scripts.fictionbook.org

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'v', 'text-author', 'td', 'th']);

/** The paragraph's text with every inline picture as one character (the original's IMG -> "."). */
function plain(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '.')).join('');
}

/** An empty line: nothing but spaces and non-breaking spaces (a picture is content). */
function isLineEmpty(node) {
  return (node.content ?? []).every((c) => c.type === 'text' && /^[  ]*$/.test(c.text));
}

/**
 * Short enough and not ending with . … ? ! -> marked up without asking. Pictures at the end are
 * passed over as the original passed over the tags; spaces after the last mark are too.
 */
function mayAutoprocess(node, limit) {
  const text = (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/\s+$/, '');
  return text !== '' && !/[.…?!]$/.test(text) && plain(node).length <= limit;
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
    title: t(ctx, 'Разметка подписей к иллюстрациям v1.4', 'Mark up the illustration captions v1.4'),
    fields: [
      { kind: 'static', id: 'format', text: t(ctx, 'Как форматировать подпись:', 'How to format the caption:') },
      { kind: 'checkbox', id: 'strong', label: t(ctx, 'жирный (b)', 'bold (b)'), value: false },
      { kind: 'checkbox', id: 'emphasis', label: t(ctx, 'курсив (i)', 'italic (i)'), value: false },
      { kind: 'checkbox', id: 'sup', label: t(ctx, 'верхний индекс (x²)', 'superscript (x²)'), value: false },
      { kind: 'checkbox', id: 'sub', label: t(ctx, 'нижний индекс (x₂)', 'subscript (x₂)'), value: false },
      { kind: 'checkbox', id: 'subtitle', label: 'subtitle', value: true },
      {
        kind: 'number', id: 'limit', value: 200, min: 1, max: 100000,
        label: t(ctx, 'Не размечать автоматически абзац как подпись, если число символов в нем больше', 'Do not mark up a paragraph as a caption automatically if it has more characters than'),
      },
      {
        kind: 'static', id: 'help',
        text: t(ctx,
          'Абзацы после картинок, длина которых (абзацев) меньше или равна заданного пользователем значения и которые не оканчиваются точкой, многоточием, восклицательным или вопросительным знаком, будут размечены как подписи автоматически, без запроса подтверждения. (Но не сразу, а по мере того, как позиция обработки будет миновать эти абзацы.)',
          'The paragraphs after pictures whose length is at most the value given and which do not end with a full stop, an ellipsis, an exclamation or a question mark are marked up as captions automatically, without asking. (Not at once, but as the processing passes them.)'),
      },
      {
        kind: 'radio', id: 'start', value: selection && selection.nodes.length ? 'cursor' : 'begin',
        label: t(ctx, 'Откуда начать', 'Where to start'),
        options: [
          { value: 'cursor', label: t(ctx, 'Стартовать от курсора', 'Start from the caret') },
          { value: 'begin', label: t(ctx, 'Стартовать от начала документа', 'Start from the beginning of the document') },
        ],
      },
    ],
    okLabel: t(ctx, 'Старт', 'Start'),
    cancelLabel: t(ctx, 'Закрыть диалог', 'Close the dialog'),
  });
  if (!form) return;
  const limit = Number(form.limit) || 100;

  // Pictures and the block after each one, in document order.
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
      const picture = t(ctx, '[рисунок]', '[picture]');
      const text = (next.content ?? []).map((c) => (c.type === 'text' ? c.text : picture)).join('');
      const answer = await mfbe.ui.message(
        t(ctx, `Это подпись к иллюстрации?\n\n«${text.length > 300 ? `${text.slice(0, 300)}…` : text}»`,
          `Is this the caption of the illustration?\n\n"${text.length > 300 ? `${text.slice(0, 300)}…` : text}"`),
        {
          icon: 'question',
          buttons: [
            { id: 'skip', label: t(ctx, 'Искать дальше', 'Search on') },
            { id: 'yes', label: t(ctx, 'Разметить как подпись', 'Mark up as a caption'), default: true },
            { id: 'close', label: t(ctx, 'Закрыть диалог', 'Close the dialog'), cancel: true },
            { id: 'all', label: t(ctx, 'Во всех дальнейших случаях разметить как подписи', 'Mark up as captions in all further cases') },
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
        `All captions processed.\n\nPictures met: ${pictures}\nCaptions processed: ${captions}`),
    );
  } else {
    await mfbe.ui.message(t(ctx, 'Достигнут конец документа.', 'The end of the document was reached.'));
  }
}
