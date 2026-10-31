// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/540_Удалить все пустые строки во всех body, кроме body примечаний и комментариев.js
// Removes every empty line of the book except in the notes and comments bodies: empty lines and
// paragraphs, subtitles, verses and text authors that hold nothing but spaces or non-breaking
// spaces (a picture counts as content); section annotations and tables are left alone, as in the
// original. A title, section, poem, stanza, cite or epigraph that loses its last child goes too.
// The status bar gives the number removed.
// Difference from the original: a removal the schema forbids is not made and is counted in the
// status bar - the empty line of a section that would keep only its title, the only verse of a
// poem that would keep only its title (2.7.9 removed them and wrote invalid FB2).
// The original's notice, kept as written (FR-029):
 // Скрипт "Удалить все пустые строки во всех body, кроме body примечаний и комментариев"
 // номер версии скрипта
 // флаг - обрабатывать ли history
 // флаг - обрабатывать ли annotation

// номер версии скрипта
const versionNumber = '1.1';

function t(ctx, ru, en) {
  return ctx.uiLanguage === 'ru' ? ru : en;
}

/** What FictionBook Editor showed as a <P> (outside tables). */
const P_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'date', 'empty-line']);
/** The containers removed when they are left empty (the original's re1). */
const CONTAINERS = new Set(['title', 'section', 'poem', 'text-author', 'cite', 'epigraph', 'stanza', 'body']);

/** The original's test: innerHTML without its tags (pictures kept) holds only spaces / NBSP. */
function isEmpty(node) {
  if (node.type === 'empty-line') return true;
  const content = node.content ?? [];
  if (content.some((c) => c.type !== 'text')) return false;
  return /^[  ]*$/.test(content.map((c) => c.text).join(''));
}

/** The empty paragraphs in document order, each with its chain of ancestors (nearest first). */
function emptyParagraphs(doc) {
  const out = [];
  const visit = (node, ancestors) => {
    if (P_TYPES.has(node.type)) {
      if (isEmpty(node)) out.push({ node, ancestors });
      return;
    }
    // history and annotation (processHistory / processAnnotation off) and tables are not entered
    if (node.type === 'annotation' || node.type === 'table') return;
    for (const child of node.content ?? []) if (child.type !== 'text') visit(child, [node, ...ancestors]);
  };
  for (const body of doc.bodies ?? []) {
    const name = body.attrs?.name;
    if (name === 'notes' || name === 'comments') continue;
    visit(body, []);
  }
  return out;
}

function timeString(started, ru) {
  const ms = Date.now() - started;
  const Tmin = Math.floor(ms / 60000);
  const Tsek = Math.ceil(10 * (ms / 1000 - Tmin * 60)) / 10;
  if (Tmin > 0) return ru ? `${Tmin} мин. ${Tsek} с` : `${Tmin} min ${Tsek} s`;
  return ru ? `${Tsek} с` : `${Tsek} s`;
}

export default async function run(ctx) {
  const started = Date.now();
  const ru = ctx.uiLanguage === 'ru';
  const doc = await mfbe.doc.get();
  const found = emptyParagraphs(doc);
  let count = 0;
  let refused = 0;
  for (let i = 0; i < found.length; i += 1) {
    const { node, ancestors } = found[i];
    // The paragraph, and above it every container it leaves empty, as the original removed them
    // one after the other: the highest one that may go is removed.
    const chain = [node];
    for (const ancestor of ancestors) {
      const below = chain[chain.length - 1];
      if (!CONTAINERS.has(ancestor.type) || (ancestor.content ?? []).length !== 1 || ancestor.content[0] !== below) break;
      chain.push(ancestor);
    }
    let removed = false;
    for (let k = chain.length - 1; k >= 0 && !removed; k -= 1) {
      try {
        await mfbe.doc.removeNode(chain[k].attrs.nodeId);
        const siblings = ancestors[k] ? ancestors[k].content : doc.bodies;
        siblings.splice(siblings.indexOf(chain[k]), 1);
        removed = true;
      } catch {
        // the schema forbids it (a section or poem would keep only its title, a body its last section)
      }
    }
    if (removed) count += 1;
    else refused += 1;
    if (i % 100 === 99) {
      await mfbe.ui.progress(i + 1, found.length);
      if (ctx.cancelled) return;
    }
  }
  const time = timeString(started, ru);
  let text =
    count !== 0
      ? t(ctx, `Удалено пустых строк: ${count}. Время работы скрипта: ${time}. Версия скрипта: ${versionNumber}.`, `Empty lines removed: ${count}. Running time: ${time}. Script version: ${versionNumber}.`)
      : t(ctx, `Пустых строк не найдено. Время работы скрипта: ${time}. Версия скрипта: ${versionNumber}.`, `No empty lines found. Running time: ${time}. Script version: ${versionNumber}.`);
  if (refused) text += t(ctx, ` Не удалено (запрещено структурой документа): ${refused}.`, ` Not removed (the document structure forbids it): ${refused}.`);
  await mfbe.ui.status(text, { sticky: true });
}
