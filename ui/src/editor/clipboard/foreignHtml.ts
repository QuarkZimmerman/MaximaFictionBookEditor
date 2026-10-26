/**
 * Tables pasted from other programs (feature 006; FR-059; C11, C45, C46; R5.9; U28, U29;
 * data-model §8.5, §8.9; research R5 item 4, R5.2 to R5.4, vR5 corr 3, vR5 missing 13): HTML
 * from a web page, a word processor or a spreadsheet as the paste router takes it - its parts in
 * document order, the paragraphs around tables parsed exactly as today's paste parses them, and
 * each table converted into an FB2 table with its rows, header cells, spans, alignment and
 * supported inline formatting. The regular result (step 10 of data-model §8.5) is the router's,
 * which knows the destination (`regularisePastedTable`, data-model §8.6).
 *
 * - **Inert** (constitution VI; U28): the HTML is parsed with `DOMParser` into a document that
 *   runs no script, fetches nothing and is never attached to the page; pictures are dropped
 *   whatever their URL.
 * - **CSS** is read from text by `pastedCss.ts`, so jsdom and Chromium agree (R5 probe P8).
 * - **Never taken**: `id`, `class`, `lang`, `data-id`, `data-style`, the editor's own markers
 *   `data-node-id` and `data-type` - a cell's content is copied with a link's `href` and the
 *   formatting its styles set, nothing else -, so no `span.fb-*` rule of the schema can match
 *   (vR5 missing 13); no node ids (the router stamps them, data-model §8.7).
 *
 * The module imports only `ui/src/editor/` and `ui/src/model/`; its imports from
 * `plugins/clipboard.ts` are used at call time only, as `route.ts`'s are.
 */

import {
  DOMParser as PMDOMParser,
  Fragment,
  type Mark,
  type Node as PMNode,
  type NodeType,
} from 'prosemirror-model';

import { flattenToParagraphs } from '../plugins/clipboard';
import { fb2Schema } from '../schema';
import { withSpans } from '../table/edit';
import { MAX_COLSPAN, MAX_ROWSPAN } from '../table/grid';

import {
  effectiveDeclarations,
  isHidden,
  mapAlign,
  mapVAlign,
  readPastedCss,
  type CssRule,
} from './pastedCss';

/** A part of a foreign paste, in document order: paragraphs, or a table with its caption. */
export type ForeignPart =
  { kind: 'blocks'; nodes: PMNode[] } | { kind: 'table'; caption: PMNode | null; table: PMNode };

export interface ForeignPaste {
  parts: ForeignPart[];
}

/** The elements removed inside a table (data-model §8.5 step 4), besides `o:p` and VML. */
const REMOVED: ReadonlySet<string> = new Set([
  'img',
  'picture',
  'svg',
  'video',
  'audio',
  'canvas',
  'iframe',
  'object',
  'embed',
  'input',
  'button',
  'select',
  'textarea',
  'option',
  'optgroup',
  'datalist',
  'script',
  'style',
  'template',
  'noscript',
  'colgroup',
  'col',
]);

/** Block-level elements: inside a cell a space goes before and after each (step 7). */
const BLOCKS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'li',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hgroup',
  'blockquote',
  'pre',
  'table',
  'caption',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'section',
  'article',
  'header',
  'footer',
  'nav',
  'aside',
  'main',
  'address',
  'figure',
  'figcaption',
  'hr',
  'center',
  'form',
  'fieldset',
  'legend',
  'details',
  'summary',
  'menu',
  'dir',
  'output',
]);

/**
 * The elements whose tag a mark rule of the schema reads (`strong`, `emphasis`, `strikethrough`,
 * `sub`, `sup`, `code`, `link`); inside a cell every other element is copied as a `span`, or not
 * at all when it carries no formatting.
 */
const MARK_TAGS: ReadonlySet<string> = new Set([
  'a',
  'b',
  'strong',
  'i',
  'em',
  's',
  'strike',
  'del',
  'sub',
  'sup',
  'code',
  'tt',
]);

/** The schema's rule for bold, which the inline styles of a cell are rewritten for. */
const BOLD = /^(bold(er)?|[5-9]\d{2,})$/i;

const N = fb2Schema.nodes;

/** One conversion: the inert document, its rules and the declarations read so far. */
interface Context {
  doc: Document;
  rules: CssRule[];
  declarations: Map<Element, Map<string, string>>;
}

function nameOf(element: Element): string {
  return element.localName.toLowerCase();
}

/** The effective declarations of `element`, read once per element. */
function declared(ctx: Context, element: Element): Map<string, string> {
  let found = ctx.declarations.get(element);
  if (!found) {
    found = effectiveDeclarations(element, ctx.rules);
    ctx.declarations.set(element, found);
  }
  return found;
}

/** Text that holds more than white space and no-break spaces. */
function hasText(text: string | null | undefined): boolean {
  return /[^\s\u00a0]/.test(text ?? '');
}

/* ------------------------------------------------------------------------ */
/* The paragraphs around tables (step 3): today's parse                     */
/* ------------------------------------------------------------------------ */

/**
 * The paragraphs of `container` as today's paste gives them (`sliceFromExternalHtml`:
 * `parseSlice` without preserved white space, `flattenToParagraphs`); with `dropEmpty` the empty
 * paragraphs between tables give no block at all, while no-break-space paragraphs stay (C45).
 */
function paragraphsOf(container: Element, dropEmpty: boolean): PMNode[] {
  const parsed = PMDOMParser.fromSchema(fb2Schema).parseSlice(container, {
    preserveWhitespace: false,
  });
  const paragraphs = flattenToParagraphs(parsed.content);
  return dropEmpty
    ? paragraphs.filter((node) => node.type !== N.p || node.content.size > 0)
    : paragraphs;
}

/* ------------------------------------------------------------------------ */
/* Cell content (step 7)                                                    */
/* ------------------------------------------------------------------------ */

/** The inline `style` the schema's mark rules read, from an element's declarations. */
function markStyle(declarations: Map<string, string>): string | null {
  const out: string[] = [];
  const weight = declarations.get('font-weight');
  if (weight !== undefined) out.push(`font-weight: ${BOLD.test(weight.trim()) ? '700' : 'normal'}`);
  const style = declarations.get('font-style');
  if (style !== undefined && /^(italic|oblique)\b/i.test(style.trim())) {
    out.push('font-style: italic');
  }
  const decoration =
    declarations.get('text-decoration') ?? declarations.get('text-decoration-line');
  if (decoration !== undefined && /line-through/i.test(decoration)) {
    out.push('text-decoration: line-through');
  }
  const vertical = declarations.get('vertical-align')?.trim().toLowerCase();
  if (vertical === 'sub' || vertical === 'super') out.push(`vertical-align: ${vertical}`);
  return out.length > 0 ? out.join('; ') : null;
}

/**
 * Bold (or italic) set on `element` or inherited: the nearest element, from `element` up to the
 * document, whose declarations name the font weight (style) decides; a `b` or `strong` (`i` or
 * `em`) without such a declaration counts as set (C46). The default bold of a `th` is not set.
 */
function inherited(ctx: Context, element: Element, kind: 'bold' | 'italic'): boolean {
  for (let at: Element | null = element; at; at = at.parentElement) {
    const declarations = declared(ctx, at);
    const name = nameOf(at);
    if (kind === 'bold') {
      const weight = declarations.get('font-weight');
      if (weight !== undefined) return BOLD.test(weight.trim());
      if (name === 'b' || name === 'strong') return true;
    } else {
      const style = declarations.get('font-style');
      if (style !== undefined) return /^(italic|oblique)\b/i.test(style.trim());
      if (name === 'i' || name === 'em') return true;
    }
  }
  return false;
}

/** `content` with `mark` on every inline node. */
function markAll(content: Fragment, mark: Mark): Fragment {
  const nodes: PMNode[] = [];
  content.forEach((node) => nodes.push(node.mark(mark.addToSet(node.marks))));
  return Fragment.from(nodes);
}

/**
 * The content of `source` copied into `target` as the mark rules read it, top-down - every node
 * appended while it is still empty, so a deep structure costs no more than a flat one: text as
 * it is; every `<br>` a space; a space before and after every block-level element, a nested
 * table's rows and cells included; an element of `MARK_TAGS` with its tag (a link with its
 * `href` alone), any other element as a `span` when it carries formatting and not at all
 * otherwise; each copy's `style` the subset of its source's effective declarations that the
 * mark rules read (`markStyle`). No other attribute is taken (data-model §8.5 step 8).
 */
function copyRun(ctx: Context, source: Element, target: Element): void {
  const stack: { node: Node | null; into: Element }[] = [];
  const pushChildren = (from: Node, into: Element) => {
    for (let child = from.lastChild; child; child = child.previousSibling) {
      stack.push({ node: child, into });
    }
  };
  const space = () => ctx.doc.createTextNode(' ');
  pushChildren(source, target);
  while (stack.length > 0) {
    const { node, into } = stack.pop()!;
    if (!node) {
      into.appendChild(space());
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      into.appendChild(ctx.doc.createTextNode(node.nodeValue ?? ''));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    const name = nameOf(element);
    if (name === 'br') {
      into.appendChild(space());
      continue;
    }
    const block = BLOCKS.has(name);
    const style = markStyle(declared(ctx, element));
    const tag = MARK_TAGS.has(name) ? name : 'span';
    let inner = into;
    if (block) into.appendChild(space());
    if (tag !== 'span' || style) {
      const copy = ctx.doc.createElement(tag);
      const href = tag === 'a' ? element.getAttribute('href') : null;
      if (href !== null) copy.setAttribute('href', href);
      if (style) copy.setAttribute('style', style);
      into.appendChild(copy);
      inner = copy;
    }
    // The space after a block, once its content is in.
    if (block) stack.push({ node: null, into });
    pushChildren(element, inner);
  }
}

/**
 * The content of a cell or a caption as one inline run (data-model §8.5 step 7): copied as the
 * mark rules read it (`copyRun`), parsed with `top` as the top node and white space collapsed;
 * a run of only white space and no-break spaces is empty; bold or italic set on the element or
 * inherited marks the whole run (C46).
 */
function inlineRun(ctx: Context, element: Element, top: NodeType): Fragment {
  const container = ctx.doc.createElement('div');
  copyRun(ctx, element, container);
  let content = PMDOMParser.fromSchema(fb2Schema).parse(container, {
    topNode: top.create(),
    preserveWhitespace: false,
  }).content;
  let blank = true;
  content.forEach((node) => {
    if (!node.isText || hasText(node.text)) blank = false;
  });
  if (blank) return Fragment.empty;
  if (inherited(ctx, element, 'bold')) content = markAll(content, fb2Schema.marks.strong!.create());
  if (inherited(ctx, element, 'italic')) {
    content = markAll(content, fb2Schema.marks.emphasis!.create());
  }
  return content;
}

/* ------------------------------------------------------------------------ */
/* Alignment (step 6)                                                       */
/* ------------------------------------------------------------------------ */

/** An element's own alignment: its CSS `text-align`, else its `align` attribute. */
function ownAlign(ctx: Context, element: Element): string | null {
  return (
    mapAlign(declared(ctx, element).get('text-align')) ?? mapAlign(element.getAttribute('align'))
  );
}

/** An element's own vertical alignment: its CSS `vertical-align`, else its `valign` attribute. */
function ownVAlign(ctx: Context, element: Element): string | null {
  return (
    mapVAlign(declared(ctx, element).get('vertical-align')) ??
    mapVAlign(element.getAttribute('valign'))
  );
}

/**
 * The uniform alignment of the blocks the text of `cell` stands in: for each text that holds
 * more than white space, the nearest element below the cell that sets an alignment; null when a
 * text has none or two texts differ.
 */
function blockAlign(ctx: Context, cell: Element): string | null {
  let found: string | null | undefined;
  const walker = ctx.doc.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!hasText(text.nodeValue)) continue;
    let value: string | null = null;
    for (let at = text.parentElement; at && at !== cell; at = at.parentElement) {
      if (declared(ctx, at).has('text-align') || at.hasAttribute('align')) {
        value = ownAlign(ctx, at);
        break;
      }
    }
    if (value === null) return null;
    if (found === undefined) found = value;
    else if (found !== value) return null;
  }
  return found ?? null;
}

/**
 * A cell's `align`: its own; else the uniform alignment of the blocks its text stands in; else
 * its row group's; else the table's CSS `text-align` (the table's `align` attribute places the
 * table, it aligns no text).
 */
function cellAlign(ctx: Context, cell: Element, group: Element | null, table: Element) {
  return (
    ownAlign(ctx, cell) ??
    blockAlign(ctx, cell) ??
    (group ? ownAlign(ctx, group) : null) ??
    mapAlign(declared(ctx, table).get('text-align'))
  );
}

/* ------------------------------------------------------------------------ */
/* Tables (steps 4 to 9)                                                    */
/* ------------------------------------------------------------------------ */

/** A span as FB2 takes it: a whole number of 1 or more, capped at `limit`; else 1 (C11). */
function spanOf(value: string | null, limit: number): number {
  if (value === null || !/^\s*\d+\s*$/.test(value)) return 1;
  const span = Number(value.trim());
  return span >= 1 ? Math.min(span, limit) : 1;
}

/** Removes the hidden, marker, VML and unsupported elements inside `table` (step 4). */
function clean(ctx: Context, table: Element): void {
  const doomed = new Set(
    Array.from(table.querySelectorAll('*')).filter((element) => {
      const name = nameOf(element);
      if (REMOVED.has(name) || name === 'o:p' || name.startsWith('v:')) return true;
      const declarations = declared(ctx, element);
      return isHidden(declarations) || /^\s*ignore\s*$/i.test(declarations.get('mso-list') ?? '');
    }),
  );
  // Each removed subtree once: an element inside a removed one goes with it.
  for (const element of doomed) {
    let inside = false;
    for (let at = element.parentElement; at && at !== table; at = at.parentElement) {
      if (doomed.has(at)) {
        inside = true;
        break;
      }
    }
    if (!inside) element.remove();
  }
  // The structure changed: the rules may match otherwise now.
  ctx.declarations.clear();
}

/** The rows of `table` in FB2 order: `thead`, then `tbody` and direct rows, then `tfoot`. */
function rowsOf(table: Element): { row: Element; group: Element | null }[] {
  const head: { row: Element; group: Element | null }[] = [];
  const body: { row: Element; group: Element | null }[] = [];
  const foot: { row: Element; group: Element | null }[] = [];
  for (const child of Array.from(table.children)) {
    const name = nameOf(child);
    if (name === 'tr') {
      body.push({ row: child, group: null });
      continue;
    }
    if (name !== 'thead' && name !== 'tbody' && name !== 'tfoot') continue;
    const list = name === 'thead' ? head : name === 'tfoot' ? foot : body;
    for (const row of Array.from(child.children)) {
      if (nameOf(row) === 'tr') list.push({ row, group: child });
    }
  }
  return [...head, ...body, ...foot];
}

/**
 * One outer table converted (steps 4 to 9): the table node - null when no cell is left - and its
 * caption paragraph, null without a caption or with an empty one.
 */
function convertTable(
  ctx: Context,
  table: Element,
): { table: PMNode | null; caption: PMNode | null } {
  clean(ctx, table);
  const captionElement = Array.from(table.children).find((child) => nameOf(child) === 'caption');
  const captionRun = captionElement ? inlineRun(ctx, captionElement, N.p!) : Fragment.empty;
  const caption = captionRun.size > 0 ? N.p!.create(null, captionRun) : null;
  const rows: PMNode[] = [];
  let cells = 0;
  for (const { row, group } of rowsOf(table)) {
    const header = !!group && nameOf(group) === 'thead';
    const rowCells: PMNode[] = [];
    for (const cell of Array.from(row.children)) {
      const name = nameOf(cell);
      if (name !== 'td' && name !== 'th') continue;
      const type = name === 'th' || header ? N.th! : N.td!;
      const attrs = withSpans(
        {
          align: cellAlign(ctx, cell, group, table),
          valign:
            ownVAlign(ctx, cell) ?? ownVAlign(ctx, row) ?? (group ? ownVAlign(ctx, group) : null),
        },
        spanOf(cell.getAttribute('colspan'), MAX_COLSPAN),
        spanOf(cell.getAttribute('rowspan'), MAX_ROWSPAN),
      );
      rowCells.push(type.create(attrs, inlineRun(ctx, cell, type)));
    }
    cells += rowCells.length;
    rows.push(N.tr!.create({ align: ownAlign(ctx, row) }, rowCells));
  }
  return { table: cells > 0 ? N.table!.create(null, rows) : null, caption };
}

/**
 * Pasted HTML from another program in parts, in document order (data-model §8.5): the HTML
 * before, between and after the outer tables (those without a table ancestor) cut with DOM
 * ranges and parsed as today's paste parses it - empty paragraphs give no block, no-break-space
 * paragraphs stay (C45); HTML without a table gives exactly `sliceFromExternalHtml`'s
 * paragraphs -, and each table converted, its caption marked as such (vR5 corr 3).
 */
export function parseForeignHtml(html: string): ForeignPaste {
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  const ctx: Context = { doc, rules: readPastedCss(doc), declarations: new Map() };
  const body = doc.body;
  const tables = Array.from(body.querySelectorAll('table')).filter(
    (table) => !table.parentElement?.closest('table'),
  );
  if (tables.length === 0) {
    const nodes = paragraphsOf(body, false);
    return { parts: nodes.length > 0 ? [{ kind: 'blocks', nodes }] : [] };
  }
  // The pieces around the tables, cut before a table is changed.
  const pieces = tables.map((table, index) => {
    const range = doc.createRange();
    if (index === 0) range.setStart(body, 0);
    else range.setStartAfter(tables[index - 1]!);
    range.setEndBefore(table);
    return range.cloneContents();
  });
  const last = doc.createRange();
  last.setStartAfter(tables[tables.length - 1]!);
  last.setEnd(body, body.childNodes.length);
  pieces.push(last.cloneContents());

  const parts: ForeignPart[] = [];
  const addBlocks = (nodes: PMNode[]) => {
    if (nodes.length === 0) return;
    const previous = parts[parts.length - 1];
    if (previous?.kind === 'blocks') previous.nodes.push(...nodes);
    else parts.push({ kind: 'blocks', nodes });
  };
  const addPiece = (piece: DocumentFragment) => {
    const container = doc.createElement('div');
    container.appendChild(piece);
    addBlocks(paragraphsOf(container, true));
  };
  tables.forEach((element, index) => {
    addPiece(pieces[index]!);
    const { table, caption } = convertTable(ctx, element);
    if (table) parts.push({ kind: 'table', caption, table });
    else if (caption) addBlocks([caption]);
  });
  addPiece(pieces[tables.length]!);
  return { parts };
}

/** The text of `element` outside scripts, styles, templates and `noscript`. */
function visibleText(element: Element): string {
  let text = '';
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('script, style, template, noscript')) continue;
    text += node.nodeValue ?? '';
  }
  return text;
}

/**
 * True when `html` holds a table with text (R5.9; data-model §8.9): a cheap `<td` / `<th` test
 * first, then a `td` or `th` with more than white space in an inert parse. A table that holds
 * only a picture, or only empty cells, has none.
 */
export function htmlHasTextTable(html: string): boolean {
  if (!/<t[dh][\s>]/i.test(html)) return false;
  const doc = new window.DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('td, th')).some((cell) => hasText(visibleText(cell)));
}
