// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/580_Удалить подзаголовки из звездочек рядом с заголовками.js
// Removes the "* * *" subtitles that stand next to a title: a subtitle whose text is "* * *" is
// removed when it is the first element after the title of its section (or poem, stanza), or the
// last element of its section (or other container) when the next container starts with a title.
// A message gives the number found, another the numbers removed above and below titles. The
// original searched the whole text, the notes too.
// Difference from the original: a removal the schema forbids (the subtitle of a section that would
// keep only its title) is not made and is reported (2.7.9 removed it and wrote invalid FB2).
// The original's notice, kept as written (FR-029):
// Скрипт «Удалить подзаголовки из звездочек рядом с заголовками»
// Version: 3.1
// Идея - TaKir
// Реализация - DeepSeek, TaKir
        // Получаем корневой элемент
        // Ищем все подзаголовки (элементы P с классом subtitle)

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** What FictionBook Editor showed as a <P>; everything else in a book was a <DIV>. */
const P_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'date', 'td', 'th', 'empty-line']);

function isDiv(node) {
  return node && node.type !== 'text' && !P_TYPES.has(node.type);
}

/**
 * The subtitles of the text in document order, each with its parent and grandparent. The text is
 * what the original searched: the book's annotation and the document's history, which FictionBook
 * Editor always showed at its top (empty when the book has none), then the bodies.
 */
function subtitles(root) {
  const out = [];
  const visit = (node, parent, inDescription) => {
    for (const child of node.content ?? []) {
      if (child.type === 'text') continue;
      if (child.type === 'subtitle') out.push({ node: child, parent: node, grandparent: parent, inDescription });
      else if (!P_TYPES.has(child.type)) visit(child, node, inDescription || child.description === true);
    }
  };
  visit(root, null, false);
  return out;
}

/** innerText without the surrounding white space. */
function textOf(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/^\s+|\s+$/g, '');
}

/** Случай 1: the subtitle is the last element of its container (the original's "section"). */
function isLastElementInSection(subtitle, section) {
  const children = section.content ?? [];
  return children[children.length - 1] === subtitle;
}

/** The next element after the container that is a container itself (paragraphs skipped). */
function getNextSection(section, parent) {
  const siblings = parent?.content ?? [];
  for (let i = siblings.indexOf(section) + 1; i < siblings.length; i += 1) if (isDiv(siblings[i])) return siblings[i];
  return null;
}

function hasTitleAtStart(section) {
  return (section.content ?? [])[0]?.type === 'title';
}

/** Случай 2: the first element after the container's (first) title is the subtitle. */
function isFirstElementAfterTitle(subtitle, section) {
  const children = section.content ?? [];
  const title = children.findIndex((c) => c.type === 'title');
  return title >= 0 && children[title + 1] === subtitle;
}

function checkSubtitlePosition({ node, parent, grandparent }) {
  if (isLastElementInSection(node, parent)) {
    const nextSection = getNextSection(parent, grandparent);
    if (nextSection && hasTitleAtStart(nextSection)) return 'above';
  }
  if (isFirstElementAfterTitle(node, parent)) return 'below';
  return 'none';
}

export default async function run(ctx) {
  const scriptName = t(ctx, 'Скрипт «Удалить подзаголовки из звездочек рядом с заголовками»', 'Script "Remove asterisk subtitles next to titles"');
  const scriptVersion = '3.1';
  const statusBarMsg = t(ctx, 'Удаляем подзаголовки-звездочки…', 'Removing the asterisk subtitles…');
  await mfbe.ui.status(statusBarMsg);

  const doc = await mfbe.doc.get();
  const description = doc.description;
  const annotation = description?.titleInfo?.annotation;
  const history = description?.documentInfo?.history;
  const root = {
    type: 'fbw_body',
    content: [
      { ...(annotation ?? { type: 'annotation', content: [] }), description: true },
      { ...(history ?? { type: 'annotation', content: [] }), description: true },
      ...(doc.bodies ?? []),
    ],
  };
  const subtitlesToRemove = [];
  for (const item of subtitles(root)) {
    if (textOf(item.node) !== '* * *') continue;
    const position = checkSubtitlePosition(item);
    if (position !== 'none') subtitlesToRemove.push({ ...item, position });
  }
  await mfbe.ui.message(
    t(ctx, `Найдено подзаголовков-звездочек рядом с заголовками: ${subtitlesToRemove.length}`, `Asterisk subtitles found next to titles: ${subtitlesToRemove.length}`),
    { caption: scriptName },
  );

  let deletedTotal = 0;
  let deletedAbove = 0;
  let deletedBelow = 0;
  let refused = 0;
  let descriptionChanged = false;
  // Удаляем в обратном порядке
  for (let i = subtitlesToRemove.length - 1; i >= 0; i -= 1) {
    const item = subtitlesToRemove[i];
    if (item.inDescription) {
      // The annotation and the history are edited through the description.
      item.parent.content.splice(item.parent.content.indexOf(item.node), 1);
      descriptionChanged = true;
    } else {
      try {
        await mfbe.doc.removeNode(item.node.attrs.nodeId);
      } catch {
        refused += 1;
        continue;
      }
    }
    deletedTotal += 1;
    if (item.position === 'above') deletedAbove += 1;
    if (item.position === 'below') deletedBelow += 1;
  }

  if (descriptionChanged) {
    const [annotationRoot, historyRoot] = root.content;
    if (annotation) description.titleInfo.annotation = { ...annotation, content: annotationRoot.content };
    if (history) description.documentInfo.history = { ...history, content: historyRoot.content };
    await mfbe.doc.setDescription(description);
  }

  let finalMessage = t(
    ctx,
    `${scriptName}\nVersion: ${scriptVersion}\n\nУдалено подзаголовков-звездочек - ${deletedTotal}\nВыше заголовков - ${deletedAbove}\nНиже заголовков - ${deletedBelow}`,
    `${scriptName}\nVersion: ${scriptVersion}\n\nAsterisk subtitles removed - ${deletedTotal}\nAbove titles - ${deletedAbove}\nBelow titles - ${deletedBelow}`,
  );
  if (refused) finalMessage += t(ctx, `\nНе удалено (запрещено структурой документа) - ${refused}`, `\nNot removed (the document structure forbids it) - ${refused}`);
  await mfbe.ui.message(finalMessage, { caption: t(ctx, 'FBE скрипт - Результат', 'FBE script - Result') });
  await mfbe.ui.status(t(ctx, 'ОК', 'OK'));
}
