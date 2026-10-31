// Converted from FictionBook Editor 2.7.9: Scripts/06_Чистка/60_Удалить разделы, внутри которых только заголовок и, возможно, пустые строки.js
// Removes the sections that hold nothing but a title and possibly empty lines - empty-line elements
// and paragraphs or subtitles of only spaces and non-breaking spaces (formatting aside; a paragraph
// with a picture is not empty) - in every body, the notes body included. A section whose subsections
// are all such sections, with nothing else than its title and empty lines, is removed with them.
// Reports the number of removed sections in the status bar.
// Fix (FR-023): the original's test of a section stopped at its first subsection. After removing an
// empty subsection it took it for content (its "neither a paragraph nor a title" check), so the
// later subsections were never looked at and a section emptied this way stayed; the subsections
// after any other content (an epigraph, a subsection with text) were not looked at either. Every
// subsection is examined here, so every section holding only a title and empty lines is removed.
// Differences: a body keeps its last section, and a section that keeps an epigraph, a picture or an
// annotation but loses all its subsections gets an empty line in their place, as an FB2 section
// needs content (2.7.9 left an empty body or such a section, invalid FB2). The run is one undo step.
// The original's notice, kept as written (FR-029):
// Скрипт "Удалить разделы, внутри которых только заголовок и, возможно, пустые строки"
// Версия 1.0
// Автор скрипта – Sclex

import { t, units } from './lib/book.js';
import { serializeInline } from './lib/legacy-html.js';

// The editor's non-breaking space is U+00A0 itself (the original's GetNBSP() display character).
const nbspChar = String.fromCharCode(160);
const emptyLineRE = new RegExp('^( | |&nbsp;|' + nbspChar + ')*?$', 'i');
const tagsRE = new RegExp(nbspChar + '|<(?!img)[^>]*?>', 'gi');
// The children of a section that the original's page showed as <P>.
const P_TYPES = new Set(['p', 'subtitle', 'empty-line', 'text-author']);

/** isEmptyLine(): a <P> whose HTML, tags but <IMG> removed, is only spaces and non-breaking spaces. */
function isEmptyLine(node) {
  if (!P_TYPES.has(node.type)) return false;
  return emptyLineRE.test(serializeInline(node.content ?? []).replace(tagsRE, ''));
}

/** A section with a title and nothing else than empty lines and sections of the same kind. */
function needsRemoving(section) {
  let wasTitle = false;
  for (const child of section.content ?? []) {
    if (child.type === 'title') wasTitle = true;
    else if (child.type === 'section') {
      if (!needsRemoving(child)) return false;
    } else if (!isEmptyLine(child)) return false;
  }
  return wasTitle;
}

/** The sections of a removed section, itself included. */
function sectionCount(section) {
  let n = 1;
  for (const child of section.content ?? []) if (child.type === 'section') n += sectionCount(child);
  return n;
}

const ref = (node) => ({ nodeId: node.attrs.nodeId, type: node.type });

export default async function run(ctx) {
  const snapshot = await mfbe.doc.get();
  let removesCnt = 0;

  // Removes the sections of `parent` that need removing and looks into the others. `keepOne`: the
  // parent is a body, which keeps one section.
  const sweep = async (parent, keepOne) => {
    const sections = (parent.content ?? []).filter((child) => child.type === 'section');
    const doomed = sections.filter(needsRemoving);
    const kept = sections.filter((s) => !doomed.includes(s));
    for (const section of kept) {
      await sweep(section, false);
      if (ctx.cancelled) return;
    }
    if (!doomed.length) return;
    const blocks = (parent.content ?? []).some((child) => child.type !== 'section' && child.type !== 'title' && child.type !== 'epigraph' && child.type !== 'image' && child.type !== 'annotation');
    let last = null;
    if (!kept.length && !blocks) last = doomed.pop();
    for (const section of doomed) {
      await mfbe.doc.removeNode(ref(section));
      removesCnt += sectionCount(section);
    }
    if (last && !keepOne) {
      // The section would be left without content: an empty line takes the place of the last one.
      await mfbe.doc.replaceNode(ref(last), { type: 'empty-line', attrs: {} });
      removesCnt += sectionCount(last);
    }
  };

  const bodies = snapshot.bodies ?? [];
  for (let i = 0; i < bodies.length; i += 1) {
    await sweep(bodies[i], true);
    await mfbe.ui.progress(i + 1, bodies.length, ctx.script.name);
    if (ctx.cancelled) return;
  }
  await mfbe.ui.status(
    t(
      ctx,
      `${units(removesCnt, { nom: 'Был удален', gen: 'Были удалены', plu: 'Было удалено' })} ${removesCnt} ${units(removesCnt, { nom: 'раздел', gen: 'раздела', plu: 'разделов' })}.`,
      removesCnt === 1 ? '1 section was removed.' : `${removesCnt} sections were removed.`,
    ),
    { sticky: true },
  );
}
