// Converted from 19_Обработка форматирования/Обзор и превращение элементов....js (FictionBook
// Editor 2.7), Tier 3. The original opened the three-frame dialog "Обзор элементов" (element
// browser): a list of all elements of one kind - title lines, subtitles or runs of emphasis /
// strong / sup / sub / strikethrough - in which the user selected entries and reformatted them
// (titles ↔ subtitles ↔ plain text, one inline style to another or to plain text) or changed
// their case through a context menu; the dialog stayed open for further operations. Here the
// same work is done with two forms: the kind of element, then a multi-select list with the
// action to apply; the list is rebuilt after every action until the user closes it.
//
// Structural rules kept from the original:
//  - a subtitle turned into a title starts a new section (poem, stanza): what precedes it moves
//    to the previous sibling of the same kind or into a new one; when nothing follows, the
//    section is left with an empty line (the original created an empty paragraph);
//  - title lines turned into subtitles / text: a wholly selected title is replaced in place
//    (epigraphs right after it are dissolved); selected lines at the start go to the end of the
//    previous sibling of the same kind (or a new one); every unselected run of lines becomes
//    the title of a new section inserted in front, followed by the selected lines after it;
//    a title that loses all its lines is removed and the rest of its section is merged into the
//    section created before it. In a poem, text lines are wrapped in a stanza; in a stanza they
//    become verses;
//  - subtitles nested in cites are not turned into titles (reported, as the original did);
//  - edits the FB2 schema refuses are skipped and reported instead of producing invalid XML.
// Notice of the original script (FictionBook Editor 2.7, GPL-3.0), kept as written:
//скрипт "Обзор элементов"
//автор Sclex
//сайт скриптов: http://scripts.fictionbook.org

const INLINE_KINDS = ['emphasis', 'strong', 'sup', 'sub', 'strikethrough'];
const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
const CONTAINER_TYPES = new Set(['section', 'poem', 'stanza']);
const LETTER_RE = /[\p{L}\p{N}]/u;

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const nodeId = (node) => node.attrs?.nodeId;

function stripIds(node) {
  if (node.type === 'text') return node;
  const attrs = { ...(node.attrs ?? {}) };
  delete attrs.nodeId;
  return { ...node, attrs, ...(node.content ? { content: node.content.map(stripIds) } : {}) };
}

function inlineText(node) {
  if (node.type === 'text') return node.text;
  return (node.content ?? []).map(inlineText).join('');
}

/** The list label the original built: only spaces → " ", longer than 50 chars → 50 + "...". */
function preview(text) {
  if (/^[ \u00A0]*$/.test(text)) return ' ';
  return text.length > 50 ? `${text.slice(0, 50)}...` : text;
}

/* ---------------------------------------------------------------------------------------- */
/* Scanning                                                                                   */
/* ---------------------------------------------------------------------------------------- */

/** Elements of `kind` in document order; `path` is the chain of ancestor nodes. */
async function scan(kind) {
  const found = [];
  const visit = (node, path, inSection) => {
    if (node.type === 'text') return;
    const parent = path[path.length - 1];
    if (kind === 'titles') {
      if (node.type === 'title' && inSection && parent && CONTAINER_TYPES.has(parent.type)) {
        (node.content ?? []).forEach((line, index) => {
          found.push({
            kind, key: `${nodeId(node)}:${index}`, text: preview(inlineText(line)),
            titleId: nodeId(node), index, containerId: nodeId(parent), containerType: parent.type,
          });
        });
        return;
      }
    } else if (kind === 'subtitles') {
      if (node.type === 'subtitle' && inSection) {
        const container = [...path].reverse().find((n) => CONTAINER_TYPES.has(n.type));
        found.push({
          kind, key: nodeId(node), text: preview(inlineText(node)), nodeId: nodeId(node),
          parentType: parent?.type, containerId: container ? nodeId(container) : null,
        });
      }
    } else if (TEXT_BLOCKS.has(node.type) && inSection) {
      const content = node.content ?? [];
      let i = 0;
      while (i < content.length) {
        const has = (item) => item.type === 'text' && (item.marks ?? []).some((m) => m.type === kind);
        if (!has(content[i])) {
          i += 1;
          continue;
        }
        let j = i;
        while (j < content.length && has(content[j])) j += 1;
        found.push({
          kind, key: `${nodeId(node)}:${i}:${j}`, blockId: nodeId(node), start: i, end: j,
          text: preview(content.slice(i, j).map((c) => c.text).join('')),
        });
        i = j;
      }
      return;
    }
    const next = [...path, node];
    for (const child of node.content ?? []) visit(child, next, inSection || node.type === 'section');
  };
  for (const body of await mfbe.doc.getElementsByTagName('body')) visit(await mfbe.doc.getNode(body), [], false);
  return found;
}

/* ---------------------------------------------------------------------------------------- */
/* Case change (the original's context menu)                                                 */
/* ---------------------------------------------------------------------------------------- */

function changeCaseOfItems(items, mode) {
  let capitalised = false;
  return items.map((item) => {
    if (item.type !== 'text') return item;
    let text = mode === 'allBig' ? item.text.toUpperCase() : item.text.toLowerCase();
    if (mode === 'onlyFirstBig' && !capitalised) {
      const m = LETTER_RE.exec(text);
      if (m) {
        text = text.slice(0, m.index) + m[0].toUpperCase() + text.slice(m.index + m[0].length);
        capitalised = true;
      }
    }
    return text === item.text ? item : { ...item, text };
  });
}

async function applyCase(elements, mode, report) {
  for (const el of elements) {
    try {
      if (el.kind === 'titles') {
        const title = await mfbe.doc.getNode(el.titleId);
        const line = title.content[el.index];
        if (!line?.content) continue;
        await mfbe.doc.replaceNode(nodeId(line), { ...line, content: changeCaseOfItems(line.content, mode) });
      } else if (el.kind === 'subtitles') {
        const node = await mfbe.doc.getNode(el.nodeId);
        await mfbe.doc.replaceNode(el.nodeId, { ...node, content: changeCaseOfItems(node.content ?? [], mode) });
      } else {
        const block = await mfbe.doc.getNode(el.blockId);
        const content = block.content.slice();
        content.splice(el.start, el.end - el.start, ...changeCaseOfItems(content.slice(el.start, el.end), mode));
        await mfbe.doc.replaceNode(el.blockId, { ...block, content });
      }
    } catch (error) {
      report.push(error.message);
    }
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Inline runs → other mark / text                                                            */
/* ---------------------------------------------------------------------------------------- */

async function reformatInline(elements, from, to, report) {
  const byBlock = new Map();
  for (const el of elements) {
    if (!byBlock.has(el.blockId)) byBlock.set(el.blockId, []);
    byBlock.get(el.blockId).push(el);
  }
  for (const [blockId, runs] of byBlock) {
    try {
      const block = await mfbe.doc.getNode(blockId);
      const content = block.content.map((item, index) => {
        if (item.type !== 'text' || !runs.some((r) => index >= r.start && index < r.end)) return item;
        const marks = (item.marks ?? []).filter((m) => m.type !== from && m.type !== to);
        if (to !== 'text') marks.push({ type: to });
        return marks.length ? { ...item, marks } : { type: 'text', text: item.text };
      });
      await mfbe.doc.replaceNode(blockId, { ...block, content });
    } catch (error) {
      report.push(error.message);
    }
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Subtitles → text / titles                                                                  */
/* ---------------------------------------------------------------------------------------- */

async function subtitlesToText(elements, report) {
  for (const el of elements) {
    try {
      const node = await mfbe.doc.getNode(el.nodeId);
      const attrs = { ...(node.attrs ?? {}) };
      if (el.parentType === 'poem') {
        // A subtitle between stanzas becomes a one-verse stanza (an empty-class <P> in a poem).
        await mfbe.doc.replaceNode(el.nodeId, {
          type: 'stanza', attrs: {}, content: [{ type: 'v', attrs: {}, content: node.content ?? [] }],
        });
      } else {
        await mfbe.doc.replaceNode(el.nodeId, { ...node, type: el.parentType === 'stanza' ? 'v' : 'p', attrs });
      }
    } catch (error) {
      report.push(error.message);
    }
  }
}

const titleOf = (lines) => ({ type: 'title', attrs: {}, content: lines });
const asLine = (node) => ({ type: 'p', attrs: { ...(node.attrs ?? {}) }, content: node.content ?? [] });

/** Content that keeps a freshly created container valid when it has nothing but a title. */
function filler(type) {
  if (type === 'poem') return [{ type: 'stanza', attrs: {}, content: [{ type: 'v', attrs: {}, content: [] }] }];
  if (type === 'stanza') return [{ type: 'v', attrs: {}, content: [] }];
  return [{ type: 'empty-line', attrs: {} }];
}

async function siblingsOf(ref) {
  const parent = await mfbe.doc.parentOf(ref);
  const siblings = parent ? await mfbe.doc.childrenOf(parent) : [];
  return { parent, siblings, index: siblings.findIndex((s) => s.nodeId === (ref.nodeId ?? ref)) };
}

async function subtitlesToTitles(ctx, elements, report) {
  let inCite = false;
  for (const el of elements) {
    if (el.parentType === 'cite') {
      inCite = true;
      continue;
    }
    try {
      const container = await mfbe.doc.getNode(el.containerId);
      const content = container.content ?? [];
      const at = content.findIndex((n) => nodeId(n) === el.nodeId);
      if (at < 0) continue; // already moved by an earlier conversion
      const subtitle = content[at];
      let before = content.slice(0, at);
      let after = content.slice(at + 1);
      const previousIsTitle = before.length > 0 && before[before.length - 1].type === 'title';
      if (before.length > 0 && !previousIsTitle) {
        // Everything in front of the subtitle leaves for the previous sibling of the same kind,
        // or for a new one when there is none (or when the container starts with a title,
        // an epigraph, a nested section…, which must not be appended to a neighbour).
        const { siblings, index } = await siblingsOf(el.containerId);
        const prev = index > 0 ? siblings[index - 1] : null;
        const firstIsBlockLike = TEXT_BLOCKS.has(before[0].type) || before[0].type === 'empty-line';
        let reuse = prev && prev.type === container.type && firstIsBlockLike;
        if (reuse) {
          const prevNode = await mfbe.doc.getNode(prev);
          const last = prevNode.content?.[prevNode.content.length - 1];
          if (last && last.type === 'section') reuse = false;
          else await mfbe.doc.replaceNode(prev, { ...prevNode, content: [...(prevNode.content ?? []), ...before.map(stripIds)] });
        }
        if (!reuse) {
          await mfbe.doc.insertNode('before', el.containerId, { type: container.type, attrs: {}, content: before.map(stripIds) });
        }
        before = [];
      }
      const line = asLine(subtitle);
      let title;
      if (previousIsTitle) {
        title = { ...before[before.length - 1], content: [...(before[before.length - 1].content ?? []), line] };
        before = before.slice(0, -1);
      } else title = titleOf([line]);
      if (after.length === 0) {
        // The title would be the last child: the original moved it into the next sibling of
        // the same kind (or a new one holding an empty paragraph) and left this one empty.
        const { siblings, index } = await siblingsOf(el.containerId);
        const next = index >= 0 && index + 1 < siblings.length ? siblings[index + 1] : null;
        if (next && next.type === container.type) {
          const nextNode = await mfbe.doc.getNode(next);
          const nextContent = nextNode.content ?? [];
          const merged = nextContent[0]?.type === 'title'
            ? [{ ...nextContent[0], content: [...title.content, ...(nextContent[0].content ?? [])] }, ...nextContent.slice(1)]
            : [title, ...nextContent];
          await mfbe.doc.replaceNode(next, { ...nextNode, content: merged.map((n, i) => (i === 0 ? stripIds(n) : n)) });
          await mfbe.doc.removeNode(el.containerId); // nothing is left in it
          continue;
        }
        after = filler(container.type);
      }
      await mfbe.doc.replaceNode(el.containerId, { ...container, content: [...before, title, ...after] });
    } catch (error) {
      report.push(error.message);
    }
  }
  if (inCite) {
    await mfbe.ui.message(
      t(ctx, 'Среди выделенных подзаголовков были подзаголовки, вложенные в цитаты. Они не были превращены в заголовки в процессе обработки.',
        'Some of the selected subtitles are nested in cites; they were not turned into titles.'),
      { icon: 'warning' },
    );
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Title lines → subtitles / text                                                             */
/* ---------------------------------------------------------------------------------------- */

/** Converted title lines for a container of `type`: subtitles stay flat, text wraps per kind. */
function convertLines(lines, target, type) {
  const converted = lines.map((line) => {
    if (line.type !== 'p') return stripIds(line); // empty lines stay empty lines
    const kind = target === 'subtitle' ? 'subtitle' : type === 'stanza' ? 'v' : type === 'poem' ? 'v' : 'p';
    return stripIds({ ...line, type: kind });
  });
  if (type === 'poem' && target === 'p') {
    const verses = converted.filter((n) => n.type === 'v');
    return verses.length ? [{ type: 'stanza', attrs: {}, content: verses }] : [];
  }
  return converted;
}

/** Last nested section of a section (the original appended there). */
async function deepestLast(ref) {
  let current = ref;
  for (;;) {
    const children = await mfbe.doc.childrenOf(current);
    const last = children[children.length - 1];
    if (!last || last.type !== 'section' || current.type !== 'section') return current;
    current = last;
  }
}

async function titlesToLines(elements, target, report) {
  const byTitle = new Map();
  for (const el of elements) {
    if (!byTitle.has(el.titleId)) byTitle.set(el.titleId, el);
  }
  const selected = new Set(elements.map((e) => e.key));
  for (const [titleId, first] of byTitle) {
    try {
      const title = await mfbe.doc.getNode(titleId);
      const containerRef = { nodeId: first.containerId, type: first.containerType };
      const container = await mfbe.doc.getNode(containerRef);
      const type = container.type;
      const lines = title.content ?? [];
      // Runs of unselected / selected lines in order.
      const runs = [];
      lines.forEach((line, index) => {
        const sel = selected.has(`${titleId}:${index}`);
        if (runs.length && runs[runs.length - 1].selected === sel) runs[runs.length - 1].lines.push(line);
        else runs.push({ selected: sel, lines: [line] });
      });
      // Content of the container after its title; epigraphs right behind the title are
      // dissolved when text is going to precede them (content may not precede an epigraph).
      const afterTitle = () => {
        const rest = [];
        let leading = true;
        for (const node of (container.content ?? []).slice(1)) {
          if (leading && node.type === 'epigraph' && type === 'section') {
            for (const child of node.content ?? []) rest.push(child.type === 'text-author' ? asLine(child) : child);
          } else {
            leading = false;
            rest.push(node);
          }
        }
        return rest;
      };
      if (runs.length === 1 && runs[0].selected) {
        // The whole title: the converted lines take its place.
        await mfbe.doc.replaceNode(containerRef, { ...container, content: [...convertLines(lines, target, type), ...afterTitle()] });
        continue;
      }
      let i = 0;
      if (runs[0].selected) {
        // Leading selected lines: to the end of the previous sibling of the same kind.
        const { siblings, index } = await siblingsOf(containerRef);
        const prev = index > 0 && siblings[index - 1].type === type ? siblings[index - 1] : null;
        const converted = convertLines(runs[0].lines, target, type);
        if (prev) {
          const target_ = await deepestLast(prev);
          const prevNode = await mfbe.doc.getNode(target_);
          await mfbe.doc.replaceNode(target_, { ...prevNode, content: [...(prevNode.content ?? []), ...converted] });
        } else {
          await mfbe.doc.insertNode('before', containerRef, { type, attrs: {}, content: converted });
        }
        i = 1;
      }
      while (i + 1 < runs.length) {
        // An unselected run becomes the title of a new container in front, holding the
        // selected lines that follow it.
        const heading = titleOf(runs[i].lines.map(stripIds));
        const converted = convertLines(runs[i + 1].lines, target, type);
        await mfbe.doc.insertNode('before', containerRef, { type, attrs: {}, content: [heading, ...converted] });
        i += 2;
      }
      if (i < runs.length) {
        // A trailing unselected run stays as the (shortened) title.
        await mfbe.doc.replaceNode(titleId, { ...title, content: runs[i].lines });
        continue;
      }
      // Nothing is left of the title: the rest of the container merges into the one before it.
      const { siblings, index } = await siblingsOf(containerRef);
      const prev = index > 0 ? siblings[index - 1] : null;
      const remaining = afterTitle();
      const blocks = remaining.filter((n) => n.type !== 'section');
      const sections = remaining.filter((n) => n.type === 'section');
      if (prev && prev.type === type) {
        const target_ = await deepestLast(prev);
        const prevNode = await mfbe.doc.getNode(target_);
        await mfbe.doc.replaceNode(target_, { ...prevNode, content: [...(prevNode.content ?? []), ...blocks.map(stripIds)] });
        for (const section of sections) await mfbe.doc.insertNode('before', containerRef, stripIds(section));
        await mfbe.doc.removeNode(containerRef);
      } else {
        await mfbe.doc.removeNode(titleId);
      }
    } catch (error) {
      report.push(error.message);
    }
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Dialogs                                                                                   */
/* ---------------------------------------------------------------------------------------- */

const KIND_LABELS = {
  titles: ['titles', 'заголовки'],
  subtitles: ['subtitles', 'подзаголовки'],
  emphasis: ['emphasis', 'emphasis'],
  strong: ['strong', 'strong'],
  sup: ['sup', 'sup'],
  sub: ['sub', 'sub'],
  strikethrough: ['strikethrough', 'strikethrough'],
};

function actionsFor(ctx, kind) {
  const label = (en, ru) => t(ctx, ru, en);
  const out = [];
  if (kind === 'titles') {
    out.push({ value: 'subtitles', label: label('Reformat as subtitles', 'Переформатировать как подзаголовки') });
    out.push({ value: 'text', label: label('Reformat as text', 'Переформатировать как текст') });
  } else if (kind === 'subtitles') {
    out.push({ value: 'titles', label: label('Reformat as titles', 'Переформатировать как заголовки') });
    out.push({ value: 'text', label: label('Reformat as text', 'Переформатировать как текст') });
  } else {
    out.push({ value: 'text', label: label('Reformat as text', 'Переформатировать как текст') });
    for (const other of INLINE_KINDS) {
      if (other !== kind) out.push({ value: other, label: label(`Reformat as ${other}`, `Переформатировать как ${other}`) });
    }
  }
  out.push({ value: 'case:onlyFirstBig', label: label('Case: first letter upper, the rest lower', 'Регистр: первая буква большая, потом маленькие') });
  out.push({ value: 'case:allBig', label: label('Case: all upper', 'Регистр: все буквы большие') });
  out.push({ value: 'case:allSmall', label: label('Case: all lower', 'Регистр: все буквы маленькие') });
  out.push({ value: 'kind', label: label('Show another kind of element…', 'Показать другой тип элементов…') });
  return out;
}

export default async function run(ctx) {
  let kind = null;
  let action = null;
  for (;;) {
    if (!kind) {
      const choice = await mfbe.ui.form({
        title: t(ctx, 'Обзор элементов v1.8 (скрипт Sclex’а)', 'Element browser v1.8 (script by Sclex)'),
        width: 420,
        fields: [
          {
            kind: 'select', id: 'kind', label: t(ctx, 'Отобразить', 'Show'), value: 'titles',
            options: Object.entries(KIND_LABELS).map(([value, [en, ru]]) => ({ value, label: t(ctx, ru, en) })),
          },
        ],
        okLabel: t(ctx, 'Выполнить', 'Run'),
      });
      if (!choice) return;
      kind = String(choice.kind);
      action = null;
    }
    const elements = await scan(kind);
    const actions = actionsFor(ctx, kind);
    const values = await mfbe.ui.form({
      title: t(ctx, `Обзор элементов v1.8 (скрипт Sclex’а): ${KIND_LABELS[kind][1]}`, `Element browser v1.8 (script by Sclex): ${KIND_LABELS[kind][0]}`),
      width: 560,
      fields: [
        { kind: 'static', id: 'count', text: t(ctx, `Всего: ${elements.length}`, `In all: ${elements.length}`) },
        {
          kind: 'list', id: 'items', label: t(ctx, 'Элементы (выберите один или несколько)', 'Elements (select one or more)'),
          multiple: true, value: [],
          options: elements.map((el, i) => ({ value: el.key, label: `${i + 1}. ${el.text}` })),
        },
        { kind: 'select', id: 'action', label: t(ctx, 'Действие', 'Action'), options: actions, value: action ?? actions[0].value },
      ],
      okLabel: t(ctx, 'Выполнить', 'Run'),
      cancelLabel: t(ctx, 'Закрыть', 'Close'),
    });
    if (!values) return;
    action = String(values.action);
    if (action === 'kind') {
      kind = null;
      continue;
    }
    const chosen = new Set(Array.isArray(values.items) ? values.items : values.items ? [values.items] : []);
    const picked = elements.filter((el) => chosen.has(el.key));
    if (!picked.length) {
      await mfbe.ui.message(t(ctx, 'Не выбран ни один элемент.', 'No element is selected.'), { icon: 'warning' });
      continue;
    }
    const report = [];
    if (action.startsWith('case:')) await applyCase(picked, action.slice(5), report);
    else if (kind === 'titles') await titlesToLines(picked, action === 'subtitles' ? 'subtitle' : 'p', report);
    else if (kind === 'subtitles' && action === 'text') await subtitlesToText(picked, report);
    else if (kind === 'subtitles' && action === 'titles') await subtitlesToTitles(ctx, picked, report);
    else await reformatInline(picked, kind, action, report);
    if (report.length) {
      await mfbe.ui.message(
        t(ctx, 'Часть элементов не удалось преобразовать (структура FB2 не позволяет):\n', 'Some elements could not be converted (the FB2 structure does not allow it):\n') +
          [...new Set(report)].join('\n'),
        { icon: 'warning' },
      );
    }
    await mfbe.ui.status(t(ctx, `Обработано элементов: ${picked.length}`, `Elements processed: ${picked.length}`), { sticky: true });
  }
}
