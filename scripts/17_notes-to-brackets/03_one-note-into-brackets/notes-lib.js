// Shared engine of the three "Перенос примечаний в скобки" scripts (17_Перенос примечаний в
// скобки, FictionBook Editor 2.7, Tier 2). Each package folder carries its own copy (the sandbox
// loads modules from the script's folder only).
//
// The originals replaced a footnote reference (a link into a `notes` / `comments` body) with the
// text of the note itself in square ([…]) or curly ({…}) brackets: the note's paragraphs joined
// with " // ", keeping emphasis / strong / sup / sub / strikethrough / code and ordinary links,
// dropping everything else (note links, styles, images). The bracketed text is inserted without
// the formatting that surrounded the reference (the HTML version closed and reopened the
// enclosing tags around it). Scripts 01/02 do this for every reference and then delete the
// notes/comments bodies; script 03 does it for the note under the caret only, deletes that note
// section and renumbers the remaining notes and comments (the "unification" of group 02/03).

const TEXT_BLOCKS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);
/** Everything the original rendered as <P>, i.e. what contributes a " // " separator. */
const NOTE_LINES = new Set([...TEXT_BLOCKS, 'empty-line']);
const KEPT_MARKS = new Set(['strong', 'emphasis', 'sup', 'sub', 'strikethrough', 'code']);
const NOTE_BODIES = new Set(['notes', 'comments']);

export function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

const nodeId = (node) => node.attrs?.nodeId;
const linkOf = (item) => (item.marks ?? []).find((m) => m.type === 'link') ?? null;

/** `#id` → `id`; anything else (external links) → null, like the original getLocalHref. */
export function localHref(href) {
  if (typeof href !== 'string') return null;
  const hash = href.indexOf('main.html#') >= 0 ? href.indexOf('main.html#') + 9 : href.indexOf('#');
  if (hash < 0) return null;
  return href.slice(hash + 1);
}

/** All bodies as `{ ref, json }` in document order. */
export async function loadBodies() {
  const out = [];
  for (const ref of await mfbe.doc.getElementsByTagName('body')) {
    out.push({ ref, json: await mfbe.doc.getNode(ref) });
  }
  return out;
}

/** Depth-first visit with the ancestor chain (`parents[0]` is the body). */
function walk(node, fn, parents = []) {
  if (node.type === 'text') return;
  fn(node, parents);
  const next = [...parents, node];
  for (const child of node.content ?? []) walk(child, fn, next);
}

/** Text blocks of a body in document order. */
export function textBlocksOf(bodyJson) {
  const out = [];
  walk(bodyJson, (node) => {
    if (TEXT_BLOCKS.has(node.type)) out.push(node);
  });
  return out;
}

/**
 * id → { sectionId, bodyName } for every element id that lives inside a section: a reference
 * may point at the section or at anything inside it, the whole section is the note.
 */
export function indexTargets(bodies) {
  const targets = new Map();
  for (const { json } of bodies) {
    walk(json, (node, parents) => {
      const id = node.attrs?.id;
      if (!id) return;
      const chain = [...parents, node];
      const section = [...chain].reverse().find((n) => n.type === 'section');
      if (!section) return;
      targets.set(id, { sectionId: nodeId(section), bodyName: json.attrs?.name ?? '' });
    });
  }
  return targets;
}

/** Maximal runs of inline items sharing one link: `{ start, end, href, type }` (item indexes). */
export function linkRuns(content) {
  const runs = [];
  let i = 0;
  while (i < content.length) {
    const link = linkOf(content[i]);
    if (!link) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < content.length) {
      const other = linkOf(content[j]);
      if (!other || other.attrs?.href !== link.attrs?.href || other.attrs?.type !== link.attrs?.type) break;
      j += 1;
    }
    runs.push({ start: i, end: j, href: link.attrs?.href ?? '', type: link.attrs?.type ?? null });
    i = j;
  }
  return runs;
}

/** Inline items with the text of a note section (its own title excluded), lines joined by " // ". */
export function noteInline(section) {
  const items = [];
  let firstLine = true;
  const visit = (node) => {
    if (NOTE_LINES.has(node.type)) {
      if (!firstLine) items.push({ type: 'text', text: ' // ' });
      firstLine = false;
    }
    for (const child of node.content ?? []) {
      if (child.type === 'text') {
        if (!child.text) continue;
        const marks = (child.marks ?? []).filter(
          (m) => KEPT_MARKS.has(m.type) || (m.type === 'link' && m.attrs?.type !== 'note'),
        );
        items.push(marks.length ? { type: 'text', text: child.text, marks } : { type: 'text', text: child.text });
      } else if (child.type !== 'title' || node !== section) {
        visit(child); // the section's own title is skipped, nested titles are not
      }
    }
  };
  visit(section);
  return items;
}

/**
 * Replaces the link run [start, end) of `block` with the bracketed note text. `brackets` is
 * "[]" or "{}"; `space` adds the leading space of script 02/03.
 */
export async function replaceRunWithNote(blockRef, content, run, noteItems, brackets, space) {
  const inserted = [
    { type: 'text', text: `${space ? ' ' : ''}${brackets[0]}` },
    ...noteItems,
    { type: 'text', text: brackets[1] },
  ];
  const node = await mfbe.doc.getNode(blockRef);
  await mfbe.doc.replaceNode(blockRef, {
    ...node,
    content: [...content.slice(0, run.start), ...inserted, ...content.slice(run.end)],
  });
}

/**
 * Moves every eligible reference of `blockRef` (last to first, so earlier item indexes stay
 * valid and inserted text is never revisited) into brackets. `eligible(run)` decides which
 * runs count; returns the ids of the note sections that were inlined.
 */
export async function moveReferencesOfBlock(blockRef, targets, eligible, space, moved) {
  let limit = Infinity;
  for (;;) {
    const node = await mfbe.doc.getNode(blockRef);
    const content = node.content ?? [];
    const run = linkRuns(content)
      .filter((r) => r.start < limit && eligible(r))
      .map((r) => ({ ...r, target: targets.get(localHref(r.href) ?? '') }))
      .filter((r) => r.target && NOTE_BODIES.has(r.target.bodyName))
      .pop();
    if (!run) return;
    const section = await mfbe.doc.getNode(run.target.sectionId);
    const brackets = run.target.bodyName === 'notes' ? '[]' : '{}';
    await replaceRunWithNote(blockRef, content, run, noteInline(section), brackets, space);
    moved.push(run.target.sectionId);
    limit = run.start;
  }
}

/* ---------------------------------------------------------------------------------------- */
/* Renumbering ("unification") of notes / comments, as scripts 02/04 and 03/04 of FBE did it  */
/* ---------------------------------------------------------------------------------------- */

const KINDS = {
  notes: { idTpl: 'n_%N', linkTpl: '[%N]', sup: false, bodyTitle: 'Примечания' },
  comments: { idTpl: 'c_%N', linkTpl: '{%N}', sup: true, bodyTitle: 'Комментарии' },
};

const fill = (tpl, n) => tpl.replace('%N', String(n));
const titleJson = (text) => ({
  type: 'title',
  attrs: {},
  content: [{ type: 'p', attrs: {}, content: [{ type: 'text', text }] }],
});

/** Renumbers the sections of the `notes` or `comments` body and the references to them. */
export async function unify(ctx, kind) {
  const spec = KINDS[kind];
  const bodies = await loadBodies();
  const body = bodies.find((b) => b.json.attrs?.name === kind);
  if (!body) return true; // the original created and immediately removed an empty body
  const children = body.json.content ?? [];
  const sections = children.filter((n) => n.type === 'section');
  if (sections.some((s) => (s.content ?? []).some((n) => n.type === 'section'))) {
    await mfbe.ui.message(
      t(ctx,
        `В body ${kind} есть секции второго уровня вложения. Такие файлы не обрабатываются данным скриптом. Работа скрипта завершена.`,
        `The "${kind}" body contains nested sections. Such files are not processed by this script; the script has finished.`),
      { icon: 'warning' },
    );
    return false;
  }
  // The body gets a title when it has none.
  const firstStructural = children.find((n) => n.type === 'section' || n.type === 'epigraph' || n.type === 'title');
  if (!firstStructural) await mfbe.doc.insertNode('append', body.ref, titleJson(spec.bodyTitle));
  else if (firstStructural.type !== 'title') {
    await mfbe.doc.insertNode('before', nodeId(firstStructural), titleJson(spec.bodyTitle));
  }
  // Old id → number, then new ids and titles.
  const numberById = new Map();
  sections.forEach((section, index) => {
    if (section.attrs?.id) numberById.set(section.attrs.id, index + 1);
  });
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const n = index + 1;
    const newId = fill(spec.idTpl, n);
    const content = section.content ?? [];
    const hasTitle = content[0]?.type === 'title';
    const wantedTitle = titleJson(fill('%N', n));
    const sameTitle =
      hasTitle &&
      content[0].content?.length === 1 &&
      content[0].content[0].type === 'p' &&
      (content[0].content[0].content ?? []).map((c) => c.text ?? '').join('') === String(n) &&
      (content[0].content[0].content ?? []).every((c) => c.type === 'text' && !(c.marks ?? []).length);
    if (section.attrs?.id === newId && sameTitle) continue;
    await mfbe.doc.replaceNode(nodeId(section), {
      ...section,
      attrs: { ...(section.attrs ?? {}), id: newId },
      content: sameTitle ? content : [wantedTitle, ...(hasTitle ? content.slice(1) : content)],
    });
  }
  // Every link of the book that points at one of the old ids (re-read: titles were replaced).
  for (const { json } of await loadBodies()) {
    for (const block of textBlocksOf(json)) {
      const content = block.content ?? [];
      const runs = linkRuns(content)
        .map((r) => ({ ...r, n: numberById.get(localHref(r.href) ?? '') }))
        .filter((r) => r.n !== undefined);
      if (!runs.length) continue;
      let next = content;
      for (const run of [...runs].reverse()) {
        const first = content[run.start];
        const others = (first.marks ?? []).filter((m) => m.type !== 'link' && !(spec.sup && m.type === 'sup'));
        const marks = [
          ...others,
          { type: 'link', attrs: { href: `#${fill(spec.idTpl, run.n)}`, ...(run.type ? { type: run.type } : {}) } },
          ...(spec.sup ? [{ type: 'sup' }] : []),
        ];
        next = [
          ...next.slice(0, run.start),
          { type: 'text', text: fill(spec.linkTpl, run.n), marks },
          ...next.slice(run.end),
        ];
      }
      await mfbe.doc.replaceNode(nodeId(block), { ...block, content: next });
    }
  }
  return true;
}
