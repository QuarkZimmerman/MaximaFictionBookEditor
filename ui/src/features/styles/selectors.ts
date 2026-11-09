/**
 * Feature 011 (US8; D42 and its clarifications; contracts/styles.md §1): the selectors the Styles
 * view accepts - those that can match something in an FB2 book. css-tree parses the selector list;
 * every compound selector may hold FB2 element names or `*`, classes (the named styles), ids, the
 * structural pseudo-classes, `::first-letter` / `::first-line`, joined by the four combinators.
 * Anything else - HTML names, attribute selectors, other pseudo-classes - matches nothing in an FB2
 * book and is refused with that reason. This module loads css-tree: import it lazily (PD2).
 */
import { parse, walk, type CssNode } from 'css-tree';

/** The FB2 body elements a type selector may name (contracts/styles.md §1). */
export const FB2_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  'body',
  'section',
  'title',
  'subtitle',
  'p',
  'v',
  'stanza',
  'poem',
  'epigraph',
  'cite',
  'annotation',
  'text-author',
  'date',
  'empty-line',
  'image',
  'table',
  'tr',
  'th',
  'td',
  'strong',
  'emphasis',
  'strikethrough',
  'sub',
  'sup',
  'code',
  'a',
  'style',
]);

const PSEUDO_CLASSES = new Set([
  'first-child',
  'last-child',
  'only-child',
  'nth-child',
  'nth-last-child',
  'first-of-type',
  'last-of-type',
  'not',
]);
const PSEUDO_ELEMENTS = new Set(['first-letter', 'first-line']);
const COMBINATORS = new Set([' ', '>', '+', '~']);

export type SelectorCheck =
  | { ok: true }
  | { ok: false; reason: 'syntax'; detail: string }
  | { ok: false; reason: 'matchesNothing'; detail: string };

/** Whether `text` is a selector list the Styles view accepts, and why not. */
export function checkSelector(text: string): SelectorCheck {
  if (!text.trim()) return { ok: false, reason: 'syntax', detail: '' };
  let syntax: string | null = null;
  let ast: CssNode;
  try {
    ast = parse(text, {
      context: 'selectorList',
      onParseError: (error) => {
        syntax ??= error.message;
      },
    });
  } catch (error) {
    return { ok: false, reason: 'syntax', detail: error instanceof Error ? error.message : '' };
  }
  if (syntax !== null) return { ok: false, reason: 'syntax', detail: syntax };
  let fault: string | null = null;
  walk(ast, (node) => {
    if (fault !== null) return;
    switch (node.type) {
      case 'Selector': {
        // A combinator needs a compound selector on both sides ("p >" is incomplete).
        const parts = node.children.toArray() as { type: string }[];
        if (
          parts.length === 0 ||
          parts[0]!.type === 'Combinator' ||
          parts.at(-1)!.type === 'Combinator'
        ) {
          syntax ??= 'incomplete selector';
        }
        break;
      }
      case 'TypeSelector':
        if (node.name !== '*' && !FB2_ELEMENT_NAMES.has(node.name.toLowerCase())) fault = node.name;
        break;
      case 'PseudoClassSelector':
        if (!PSEUDO_CLASSES.has(node.name.toLowerCase())) fault = `:${node.name}`;
        break;
      case 'PseudoElementSelector':
        if (!PSEUDO_ELEMENTS.has(node.name.toLowerCase())) fault = `::${node.name}`;
        break;
      case 'Combinator':
        if (!COMBINATORS.has(node.name)) fault = node.name;
        break;
      case 'AttributeSelector':
        fault = `[${node.name.name}]`;
        break;
      case 'NestingSelector':
        fault = '&';
        break;
      case 'Raw':
        fault = node.value;
        break;
      default:
        break;
    }
  });
  if (syntax !== null) return { ok: false, reason: 'syntax', detail: syntax };
  return fault === null ? { ok: true } : { ok: false, reason: 'matchesNothing', detail: fault };
}

/** The class names a selector list defines (`.letter`, `p.letter` -> `letter`), each once. */
export function classesOf(text: string): string[] {
  const names: string[] = [];
  try {
    walk(parse(text, { context: 'selectorList' }), (node) => {
      if (node.type === 'ClassSelector' && !names.includes(node.name)) names.push(node.name);
    });
  } catch {
    // a selector that does not parse defines nothing
  }
  return names;
}
