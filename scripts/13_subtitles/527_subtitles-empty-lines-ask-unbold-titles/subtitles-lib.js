// Shared engine of the four "Разметка подзаголовков, чистка пустых строк" scripts (converted
// from 13_Подзаголовки, пустые строки/525…528, FictionBook Editor 2.7, Tier 2). The four
// packages differ only in the flags passed to `markupSubtitles`; each folder carries its own
// copy of this file because the sandbox only loads modules from the script's folder.
//
// What the original did (two passes over the whole book):
//  1. in every section / poem / stanza / cite / epigraph: paragraphs made of one to three
//     asterisks become `<subtitle>* * *</subtitle>`; empty lines are removed when they stand
//     next to another empty line, next to a poem, a cite or a subtitle, inside stanzas, at the
//     start/end of sections, epigraphs and cites (a section keeps its single empty line when
//     nothing else would remain) and anywhere inside titles; bold/italics are optionally
//     stripped from titles;
//  2. a section that starts with a subtitle (or whose title is just "* * *") is merged into the
//     preceding sibling section, so "* * *" separators no longer split chapters.
// In FBE an `<empty-line/>` was an empty `<p>`, so "empty line" means both an `empty-line`
// element and a paragraph containing only spaces / non-breaking spaces (inline images count
// as content). Edits the schema refuses (the only verse of a stanza, a subtitle inside an
// epigraph, merging into a section that ends with sub-sections) are skipped and reported.

const CONTAINERS = new Set(['section', 'body', 'poem', 'stanza', 'cite', 'epigraph']);
/** Element types the original saw as `<P>` inside the containers it walked. */
const P_LIKE = new Set(['p', 'subtitle', 'text-author', 'v', 'date', 'empty-line']);
/** Blocks that may be appended to a section when a "* * *" section is merged into it. */
const BLOCKS = new Set(['p', 'subtitle', 'poem', 'cite', 'empty-line', 'table', 'image']);
const BLANK_RE = /^[ \u00A0]*$/;
const SUBTITLE_RE = /^[ \u00A0]*\*([ \u00A0]*\*)?([ \u00A0]*\*)?[ \u00A0]*$/;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

function inlineText(node) {
  return (node.content ?? []).map((c) => (c.type === 'text' ? c.text : '\uFFFC')).join('');
}

function isEmptyLine(node) {
  if (node.type === 'empty-line') return true;
  return P_LIKE.has(node.type) && BLANK_RE.test(inlineText(node));
}

function isSubtitleLine(node) {
  return (node.type === 'p' || node.type === 'subtitle') && SUBTITLE_RE.test(inlineText(node));
}

function nodeId(node) {
  return node.attrs?.nodeId;
}

/** Copy of `node` without the given marks, or null when nothing would change. */
function withoutMarks(node, names) {
  let changed = false;
  const strip = (n) => {
    if (n.type === 'text') {
      const marks = (n.marks ?? []).filter((m) => !names.has(m.type));
      if (marks.length === (n.marks ?? []).length) return n;
      changed = true;
      return marks.length ? { ...n, marks } : { type: 'text', text: n.text };
    }
    return n.content ? { ...n, content: n.content.map(strip) } : n;
  };
  const copy = strip(node);
  return changed ? copy : null;
}

/** Copy of a subtree without node ids (so the editor issues fresh ones on insertion). */
function stripIds(node) {
  if (node.type === 'text') return node;
  const attrs = { ...(node.attrs ?? {}) };
  delete attrs.nodeId;
  return { ...node, attrs, ...(node.content ? { content: node.content.map(stripIds) } : {}) };
}

export async function markupSubtitles(ctx, options) {
  const { destrongTitles = false, deitalicTitles = false, promptDestrongTitles = false } = options;
  let destrong = destrongTitles;
  if (promptDestrongTitles) {
    const answer = await mfbe.ui.message(
      t(ctx, 'Удалять ли жирность в заголовках?', 'Remove bold formatting in titles?'),
      {
        icon: 'question',
        buttons: [
          { id: 'yes', label: t(ctx, 'Да', 'Yes'), default: true },
          { id: 'no', label: t(ctx, 'Нет', 'No'), cancel: true },
        ],
      },
    );
    destrong = answer === 'yes';
  }
  const titleMarks = new Set();
  if (destrong) titleMarks.add('strong');
  if (deitalicTitles) titleMarks.add('emphasis');

  const c = {
    empty: 0, cite: 0, poem: 0, subtitle: 0, inPoem: 0,
    sectionBegin: 0, sectionEnd: 0, epigraphBegin: 0, epigraphEnd: 0, citeBegin: 0, citeEnd: 0,
    titleBegin: 0, titleEnd: 0, titleInside: 0, total: 0,
    skipped: 0, notConverted: 0, unmerged: 0,
  };
  const started = Date.now();

  /** Removes `children[index]` in the editor and locally; false when the schema refuses. */
  const removeAt = async (children, index, counter) => {
    try {
      await mfbe.doc.removeNode(nodeId(children[index]));
    } catch {
      c.skipped += 1;
      return false;
    }
    children.splice(index, 1);
    c.total += 1;
    c[counter] += 1;
    return true;
  };

  /** Removes the run of empty lines before `children[index]`; returns the new index. */
  const removeEmptiesBefore = async (children, index, counter) => {
    let j = index - 1;
    while (j >= 0 && isEmptyLine(children[j])) {
      if (!(await removeAt(children, j, counter))) break;
      index -= 1;
      j -= 1;
    }
    return index;
  };

  const removeEmptiesAfter = async (children, index, counter) => {
    const j = index + 1;
    while (j < children.length && isEmptyLine(children[j])) {
      if (!(await removeAt(children, j, counter))) break;
    }
  };

  /** Titles lose every empty line (counted as leading / trailing / inside) and the marks. */
  const cleanTitle = async (title) => {
    const content = title.content ?? [];
    const kept = content.filter((child) => !isEmptyLine(child));
    const firstKept = content.indexOf(kept[0]);
    const lastKept = content.lastIndexOf(kept[kept.length - 1]);
    const leading = kept.length ? firstKept : content.length;
    const trailing = kept.length ? content.length - 1 - lastKept : 0;
    const inside = content.length - kept.length - leading - trailing;
    let next = kept.length === content.length ? title : { ...title, content: kept };
    const stripped = titleMarks.size ? withoutMarks(next, titleMarks) : null;
    if (stripped) next = stripped;
    if (next === title) return;
    await mfbe.doc.replaceNode(nodeId(title), next);
    title.content = next.content;
    c.titleBegin += leading;
    c.titleEnd += trailing;
    c.titleInside += inside;
    c.total += leading + trailing + inside;
  };

  const toSubtitle = async (children, index) => {
    const node = children[index];
    const next = {
      type: 'subtitle',
      attrs: { ...(node.attrs ?? {}) },
      content: [{ type: 'text', text: '* * *' }],
    };
    try {
      await mfbe.doc.replaceNode(nodeId(node), next);
      children[index] = next;
    } catch {
      c.notConverted += 1; // e.g. inside an epigraph, where FB2 allows no subtitle
    }
  };

  /** Pass 1 over one container (the original `Recursive`). */
  const pass1 = async (container) => {
    const children = container.content ?? [];
    const kind = container.type;
    let flagOfBegin = true;
    let firstEmptyMemorized = false;
    let savedFirstEmpty = null;
    let imageFlag = false;
    let imageFlag2 = false;
    let i = 0;
    while (i < children.length) {
      const ptr = children[i];
      if (CONTAINERS.has(ptr.type)) await pass1(ptr);
      if (ptr.type === 'title') await cleanTitle(ptr);
      if (ptr.type === 'image') {
        if (flagOfBegin && !imageFlag) {
          flagOfBegin = false;
          imageFlag = true;
          imageFlag2 = true;
        } else if (imageFlag) imageFlag = false;
      }
      const pLike = P_LIKE.has(ptr.type);
      if (pLike && kind === 'section') {
        if (!isEmptyLine(ptr)) {
          flagOfBegin = false;
          imageFlag = false;
        } else if (!firstEmptyMemorized && (flagOfBegin || imageFlag)) {
          firstEmptyMemorized = true;
          savedFirstEmpty = ptr;
          flagOfBegin = false;
        }
      }
      if (
        !firstEmptyMemorized && flagOfBegin && pLike &&
        (kind === 'epigraph' || kind === 'poem' || kind === 'cite')
      ) {
        if (isEmptyLine(ptr)) {
          firstEmptyMemorized = true;
          savedFirstEmpty = ptr;
        } else flagOfBegin = false;
      }
      if (ptr.type === 'table' || ptr.type === 'cite' || ptr.type === 'poem') flagOfBegin = false;
      if (ptr.type === 'poem' || ptr.type === 'cite' || (pLike && isEmptyLine(ptr))) {
        // Empty lines around poems, cites and other empty lines; none at all inside stanzas.
        const counter =
          ptr.type === 'cite' ? 'cite' : ptr.type === 'poem' ? 'poem' : kind === 'stanza' ? 'inPoem' : 'empty';
        i = await removeEmptiesBefore(children, i, counter);
        await removeEmptiesAfter(children, i, counter);
        if (kind === 'stanza' && pLike && (await removeAt(children, i, 'inPoem'))) continue;
      }
      if (pLike && (ptr.content ?? []).length > 0) {
        if (isSubtitleLine(ptr)) await toSubtitle(children, i);
        if (children[i].type === 'subtitle') {
          i = await removeEmptiesBefore(children, i, 'subtitle');
          await removeEmptiesAfter(children, i, 'subtitle');
        }
      }
      i += 1;
    }

    const removeAtEnd = async (counter) => {
      let j = children.length - 1;
      while (j >= 0 && isEmptyLine(children[j])) {
        if (!(await removeAt(children, j, counter))) break;
        j -= 1;
      }
    };
    const removeAtBegin = async (counter) => {
      const j = children.indexOf(savedFirstEmpty);
      if (j < 0) return; // already removed by one of the neighbourhood rules
      while (j < children.length && isEmptyLine(children[j])) {
        if (!(await removeAt(children, j, counter))) break;
      }
    };
    const siblingsOfSaved = () => {
      const at = children.indexOf(savedFirstEmpty);
      return {
        prev: at > 0 ? children[at - 1] : null,
        next: at >= 0 ? (children[at + 1] ?? null) : null,
      };
    };
    if (kind === 'section') {
      const { prev, next } = siblingsOfSaved();
      const last = children[children.length - 1];
      // Trailing empty lines go, unless the memorised first one is all the section has left.
      if (!firstEmptyMemorized || (last !== savedFirstEmpty && (!prev || prev.type !== 'image')) || next) {
        await removeAtEnd('sectionEnd');
      }
      const after = siblingsOfSaved().next;
      if (firstEmptyMemorized && after) {
        const afterNext = children[children.indexOf(after) + 1] ?? null;
        // An empty line that keeps an image from being the first block stays (FB2 2.0 rule).
        const ok = imageFlag2
          ? after.type !== 'image'
          : !(after.type === 'image' && afterNext && afterNext.type === 'image') &&
            !(after.type === 'image' && !afterNext);
        if (ok) await removeAtBegin('sectionBegin');
      }
    } else if (kind === 'epigraph' || kind === 'cite') {
      await removeAtEnd(kind === 'epigraph' ? 'epigraphEnd' : 'citeEnd');
      await removeAtBegin(kind === 'epigraph' ? 'epigraphBegin' : 'citeBegin');
    }
  };

  /** Pass 2 over one container (the original `Recursive2`): merge "* * *" sections. */
  const pass2 = async (container) => {
    const children = container.content ?? [];
    let i = 0;
    while (i < children.length) {
      const ptr = children[i];
      let merged = false;
      if (i > 0 && children[i - 1].type === 'section' && ptr.type === 'section' && ptr.content?.length) {
        const first = ptr.content[0];
        let payload = null;
        if (first.type === 'title' && first.content?.length && isSubtitleLine(first.content[0])) {
          // The "* * *" title is unwrapped: its first paragraph becomes the subtitle, further
          // title paragraphs plain paragraphs (that is what the original's HTML produced).
          payload = [
            { type: 'subtitle', attrs: {}, content: [{ type: 'text', text: '* * *' }] },
            ...first.content.slice(1).map((n) => (n.type === 'empty-line' ? n : { ...n, type: 'p' })),
            ...ptr.content.slice(1),
          ];
        } else if (first.type === 'subtitle') {
          payload = ptr.content.slice();
        }
        if (payload) {
          const prev = children[i - 1];
          const prevLast = prev.content?.[prev.content.length - 1];
          const appendable =
            payload.every((n) => BLOCKS.has(n.type)) && prevLast && prevLast.type !== 'section';
          if (!appendable) c.unmerged += 1;
          else {
            for (const node of payload) {
              await mfbe.doc.insertNode('append', nodeId(prev), stripIds(node));
              prev.content.push(node);
            }
            await mfbe.doc.removeNode(nodeId(ptr));
            children.splice(i, 1);
            merged = true;
          }
        }
      }
      if (merged) continue;
      if (ptr.type === 'section' || ptr.type === 'body') await pass2(ptr);
      i += 1;
    }
  };

  const trees = [];
  for (const body of await mfbe.doc.getElementsByTagName('body')) {
    trees.push(await mfbe.doc.getNode(body));
  }
  for (const tree of trees) await pass1(tree);
  for (const tree of trees) await pass2(tree);

  const seconds = Math.ceil(((Date.now() - started) / 1000) * 10) / 10;
  const lines = ctx.uiLanguage === 'ru'
    ? [
        'Работа скрипта «Разметка подзаголовков, чистка пустых строк» завершена.',
        '',
        'Удалено пустых строк:',
        `– из-за соседства с пустой строкой: ${c.empty}`,
        `– из-за соседства с цитатой: ${c.cite}`,
        `– из-за соседства со стихом: ${c.poem}`,
        `– из-за соседства с подзаголовком: ${c.subtitle}`,
        `– внутри стихов: ${c.inPoem}`,
        `– в начале секции: ${c.sectionBegin}`,
        `– в конце секции: ${c.sectionEnd}`,
        `– в начале эпиграфа: ${c.epigraphBegin}`,
        `– в конце эпиграфа: ${c.epigraphEnd}`,
        `– в начале цитаты: ${c.citeBegin}`,
        `– в конце цитаты: ${c.citeEnd}`,
        `– в начале заголовка: ${c.titleBegin}`,
        `– в конце заголовка: ${c.titleEnd}`,
        `– посреди заголовка: ${c.titleInside}`,
        '-------------------------------------------------------------------------',
        `Всего удалено пустых строк: ${c.total}`,
        ...(c.skipped ? [`Не удалено (запрещено структурой документа): ${c.skipped}`] : []),
        ...(c.notConverted ? [`Не превращено в подзаголовки (запрещено структурой): ${c.notConverted}`] : []),
        ...(c.unmerged ? [`Не объединено секций (запрещено структурой документа): ${c.unmerged}`] : []),
        '',
        `Время работы: ${seconds} с`,
      ]
    : [
        'The script "Mark up subtitles, clean up empty lines" has finished.',
        '',
        'Empty lines removed:',
        `– next to another empty line: ${c.empty}`,
        `– next to a cite: ${c.cite}`,
        `– next to a poem: ${c.poem}`,
        `– next to a subtitle: ${c.subtitle}`,
        `– inside poems: ${c.inPoem}`,
        `– at the start of a section: ${c.sectionBegin}`,
        `– at the end of a section: ${c.sectionEnd}`,
        `– at the start of an epigraph: ${c.epigraphBegin}`,
        `– at the end of an epigraph: ${c.epigraphEnd}`,
        `– at the start of a cite: ${c.citeBegin}`,
        `– at the end of a cite: ${c.citeEnd}`,
        `– at the start of a title: ${c.titleBegin}`,
        `– at the end of a title: ${c.titleEnd}`,
        `– in the middle of a title: ${c.titleInside}`,
        '-------------------------------------------------------------------------',
        `Empty lines removed in total: ${c.total}`,
        ...(c.skipped ? [`Not removed (the document structure forbids it): ${c.skipped}`] : []),
        ...(c.notConverted ? [`Not turned into subtitles (the structure forbids it): ${c.notConverted}`] : []),
        ...(c.unmerged ? [`Sections not merged (the document structure forbids it): ${c.unmerged}`] : []),
        '',
        `Running time: ${seconds} s`,
      ];
  await mfbe.ui.message(lines.join('\n'));
}
