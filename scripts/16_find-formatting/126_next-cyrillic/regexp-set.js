// Engine of the scripts of FictionBook Editor 2.7.9's group 16_Поиск форматирования that are
// built on Sclex's "Поиск по набору регэкспов" (search by a set of regular expressions, TaKir's
// build, versions 5.x). Each package carries its own copy (the sandbox loads modules from the
// script's own folder only) and registers its own expressions.
//
// The search goes paragraph by paragraph from the end of the selection to the end of the book
// (no wrap-around). In the first paragraph that holds a match of any expression the earliest
// match is selected and its description shown in the status bar; a description that starts with
// "Пропустить" marks an exception: the search goes on after that match. The text an expression
// sees is the paragraph's text (FictionBook Editor removed the tags and decoded the entities of
// the paragraph's HTML), every paragraph counted, an empty line as an empty paragraph.
//   addRegExp(source, keys, description, tagCondition) - `keys` "" or "i"; `tagCondition` like
//       "+title" or "+poem -stanza": the paragraph must (not) be inside those elements, subtitle
//       and text-author naming the paragraph's own kind.
// Two generations of the engine exist in 2.7.9 and are kept apart:
//   'current' (5.0-5.3 of most scripts): the search starts at the caret's offset, a match right
//       at it counts, the caret's paragraph is skipped when the caret is at its end; Run()
//       returns "Found" or "NotFound" (or nothing, as 169's does - `returns: false`);
//   'old' (132, "версия 5.3 (СТАРАЯ)"): a collapsed caret starts one character on and a match
//       right at it is skipped; Run() returns nothing. A caret at the start of the text right
//       after an empty line counts as standing on that empty line (see below).
// The expressions are compiled without the u flag, as JScript had none. Their leading
// look-behinds, which the original emulated, are left to the engine's own look-behind.

import { loadBook, locate, setCaret, setRange, t, textOf } from './nav-lib.js';

const TAG_NAMES =
  /^(section|body|epigraph|annotation|cite|poem|stanza|title|subtitle|text-author)$/i;
const CONTAINER_TAGS = new Set([
  'section',
  'body',
  'epigraph',
  'annotation',
  'cite',
  'poem',
  'stanza',
  'title',
]);

/** A set of expressions; `errors` lists the entries that did not compile. */
export function createRegExpSet() {
  const entries = [];
  const errors = [];
  return {
    entries,
    errors,
    /** `description` is `{ ru, en }`; the Russian one decides the "Пропустить" exceptions. */
    addRegExp(source, keys, description, tagCondition) {
      try {
        const parts = (tagCondition || '')
          .trim()
          .split(/[ \t]+/)
          .filter(Boolean);
        if (!parts.every((part) => /^[-+]/.test(part) && TAG_NAMES.test(part.slice(1)))) {
          throw new Error('bad tag condition');
        }
        entries.push({
          re: new RegExp(source, `g${keys || ''}`),
          description,
          conditions: parts.map((part) => ({
            wanted: part[0] === '+',
            name: part.slice(1).toLowerCase(),
          })),
        });
      } catch {
        errors.push(
          `  addRegExp("${source}","${keys}","${description?.ru ?? ''}","${tagCondition}"`,
        );
      }
    },
  };
}

/** The elements a paragraph is inside, as the original's getTags saw them. */
function tagsOf(p) {
  const inside = new Set();
  if (p.cls === 'subtitle' || p.cls === 'text-author') inside.add(p.cls);
  for (let node = p.parent; node && node.type !== 'root'; node = node.parent) {
    if (CONTAINER_TAGS.has(node.cls)) inside.add(node.cls);
  }
  return inside;
}

function matchesConditions(entry, inside) {
  return entry.conditions.every((c) => inside.has(c.name) === c.wanted);
}

/** The earliest match of each entry at or after `from` in one paragraph, sorted by position. */
function matchesIn(set, p, text, from) {
  const inside = tagsOf(p);
  const founds = [];
  for (const entry of set.entries) {
    if (!matchesConditions(entry, inside)) continue;
    entry.re.lastIndex = from;
    if (from > text.length) continue;
    const m = entry.re.exec(text);
    if (m) founds.push({ pos: m.index, len: m[0].length, entry });
  }
  // A stable sort: of two matches at one place the expression registered first wins.
  return founds.sort((a, b) => a.pos - b.pos);
}

/**
 * Runs the search. `options.engine` is 'current' or 'old'; `options.returns` false for a script
 * whose Run() returns nothing.
 */
export async function runRegExpSearch(ctx, set, options) {
  const old = options.engine === 'old';
  const returns = !old && options.returns !== false;
  if (set.errors.length) {
    await mfbe.ui.message(
      t(
        ctx,
        'Ошибки при компиляции регэкспов, заданных в таких строках:\n\n',
        'These regular expression entries failed to compile:\n\n',
      ) +
        set.errors.join('\n') +
        t(
          ctx,
          '\n\nПожалуйста, поправьте ошибки, прежде чем использовать скрипт.',
          '\n\nPlease fix them before using the script.',
        ),
      { icon: 'error' },
    );
    return undefined;
  }
  const book = await loadBook();
  const where = await locate(book, true);
  if (!where) return undefined;
  if (where.picture) {
    // The original printed the words "sel.type" here instead of the kind of selection.
    await mfbe.ui.message(
      t(
        ctx,
        'Не обрабатываемый тип выделения: выделена картинка.',
        'Unsupported kind of selection: a picture is selected.',
      ),
      { icon: 'error' },
    );
    return undefined;
  }
  const from = where.end;
  const skipAtCaret = old && where.collapsed;
  let index = Math.floor(from.index);
  let offset = from.item && from.item.kind === 'p' ? from.offset : 0;
  if (index < 0 || index !== from.index) {
    // Not in a paragraph: the search starts with the next one.
    index = Math.floor(from.index) + 1;
    offset = 0;
  }
  let first = index === from.index;
  if (old && where.collapsed && first && offset === 0 && textOf(from.item).length > 0) {
    // The Body view holds no caret on an empty line: an empty line found is left with the caret
    // at the start of the text after it (setCaret). A caret there stands for the original's caret
    // in that empty line, so the search goes on with this text itself.
    const before = book.ps[index - 1];
    if (before && before.type === 'empty-line') index -= 1;
  }
  let found = null;
  for (let steps = 0; index < book.ps.length; steps += 1) {
    if (ctx.cancelled) return undefined;
    if (steps % 500 === 499) await mfbe.ui.progress(index, book.ps.length);
    const p = book.ps[index];
    const text = textOf(p);
    if (old) {
      const start = first ? offset + (skipAtCaret ? 1 : 0) : 0;
      const hit = matchesIn(set, p, text, start).find(
        (f) => !(first && skipAtCaret && f.pos === offset),
      );
      if (hit) {
        found = { p, ...hit };
        break;
      }
    } else if (offset < text.length || text.length === 0) {
      const [hit] = matchesIn(set, p, text, offset);
      if (hit) {
        await mfbe.ui.status(t(ctx, hit.entry.description.ru, hit.entry.description.en), {
          sticky: true,
        });
        if (hit.entry.description.ru.startsWith('Пропустить')) {
          // An exception: the search goes on right after it (one on after an empty match).
          offset = hit.pos + Math.max(hit.len, hit.pos + hit.len === offset ? 1 : 0);
          continue;
        }
        found = { p, ...hit };
        break;
      }
    }
    index += 1;
    offset = 0;
    first = false;
  }
  if (!found) {
    if (!old) await mfbe.ui.status(t(ctx, 'Поиск завершен!', 'Search finished!'), { sticky: true });
    await mfbe.ui.message(
      t(
        ctx,
        'От позиции курсора до конца документа ничего не найдено.',
        'Nothing was found between the caret and the end of the document.',
      ),
    );
    return returns ? 'NotFound' : undefined;
  }
  if (old)
    await mfbe.ui.status(t(ctx, found.entry.description.ru, found.entry.description.en), {
      sticky: true,
    });
  if (found.len === 0) await setCaret(found.p, found.pos);
  else await setRange(found.p, found.pos, found.p, found.pos + found.len);
  return returns ? 'Found' : undefined;
}
