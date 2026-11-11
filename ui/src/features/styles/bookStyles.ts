/**
 * Feature 012 (US4; D36-D39; FR-060-FR-065; contracts/book-styles.md §1-§3): View > Show Book Styles -
 * the book's own stylesheets drawn in the Body view while editing.
 *
 * The book's CSS is translated to the Body view's markup (§2) and scoped under
 * `.mfbe-book-styles .fb-editor`, in the cascade layer `fb-book` between the editor's look (`fb-look`)
 * and its marks (`fb-marks`): the book's look wins over the editor's, the editor's marks - caret,
 * selection, spelling, ids, named-style underline, table marks, search - win over the book. Each
 * declaration is drawn, drawn within limits, or held back (§3): nothing the book says may hide text,
 * move it off the view, block editing or load anything. Colours are drawn as written (D38).
 * `!important` is dropped: in a lower layer it would win over the marks.
 */

import { generate, parse, type CssNode } from 'css-tree';

import type { Stylesheet } from '@/model/document';

import { PROPERTY_TREATMENTS, type Treatment } from './bookStyleProperties';

export const ROOT_CLASS = 'mfbe-book-styles';
export const LAYERS = '@layer fb-look, fb-book, fb-marks;';
const SCOPE = `.${ROOT_CLASS} .fb-editor`;

/** FB2 elements in the book's selectors and the Body view's markup for them (§2). */
const ELEMENTS: Readonly<Record<string, string>> = {
  p: '.fb-p',
  section: '.fb-section',
  title: '.fb-title',
  subtitle: '.fb-subtitle',
  epigraph: '.fb-epigraph',
  cite: '.fb-cite',
  annotation: '.fb-annotation',
  poem: '.fb-poem',
  stanza: '.fb-stanza',
  v: '.fb-v',
  'text-author': '.fb-text-author',
  date: '.fb-date',
  'empty-line': '.fb-empty-line',
  emphasis: '.fb-emphasis',
  strong: '.fb-strong',
  strikethrough: '.fb-strikethrough',
  sub: '.fb-sub',
  sup: '.fb-sup',
  code: '.fb-code',
  a: ':is(.fb-link, .fb-note)',
  image: ':is(.fb-image, .fb-inline-image)',
  table: '.fb-table',
  tr: '.fb-tr',
  th: 'th',
  td: 'td',
  body: '.fb-body',
};

/** The book's `*`: every FB2 element the view draws, none of the editor's own pieces (marks, tabs). */
const EVERY_ELEMENT = `:is(${[
  ...new Set(
    Object.values(ELEMENTS).flatMap((one) => one.replace(/^:is\((.*)\)$/, '$1').split(', ')),
  ),
].join(', ')})`;

export type { Treatment };

/**
 * How a property is treated (§3): drawn as written, drawn within limits, or held back - from the
 * table of every standard property (T056); what is not in it (a vendor property, an unknown name) is
 * held back.
 */
export function treatmentOf(property: string): Treatment {
  return PROPERTY_TREATMENTS[property.toLowerCase()] ?? 'held';
}

const LENGTH = /^(-?\d*\.?\d+)(px|em|rem|pt|%)?$/;
/** The farthest a relative offset, a negative margin or indent may move text (two lines' worth). */
const MAX_SHIFT_EM = 2;

function emOf(value: string): number | null {
  const match = LENGTH.exec(value.trim());
  if (!match) return null;
  const n = Number(match[1]);
  switch (match[2]) {
    case 'px':
      return n / 16;
    case 'pt':
      return n / 12;
    case '%':
      return null;
    default:
      return n;
  }
}

/**
 * The value written for `property: value`, or null when it is held back (§3). Within limits: a text
 * size of at least 6 px, an opacity of at least 0.3, relative positions and negative margins or
 * indents of at most two lines, the displays that keep text in its blocks, the wrapping that keeps
 * lines reachable, a z-index below the marks.
 */
export function treat(property: string, value: string): string | null {
  const name = property.toLowerCase();
  const v = value.trim().toLowerCase();
  if (/url\(/i.test(value) && !/url\(\s*['"]?data:/i.test(value)) return null;
  const treatment = treatmentOf(name);
  if (treatment === 'held') return null;
  if (treatment === 'drawn') return value.trim();
  switch (name) {
    case 'font-size': {
      const match = LENGTH.exec(v);
      if (!match) return value.trim();
      const n = Number(match[1]);
      if (n <= 0) return null;
      return match[2] === 'px' && n < 6
        ? '6px'
        : match[2] === 'pt' && n < 4.5
          ? '4.5pt'
          : value.trim();
    }
    case 'opacity': {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) && n < 0.3 ? null : value.trim();
    }
    case 'visibility':
      return v === 'hidden' || v === 'collapse' ? null : value.trim();
    case 'color':
      return v === 'transparent' ? null : value.trim();
    case 'position':
      return v === 'relative' || v === 'static' ? value.trim() : null;
    case 'display':
      return /^(block|inline|inline-block|flow-root|list-item|run-in)$/.test(v)
        ? value.trim()
        : null;
    case 'font': {
      // The shorthand's size is its first token with a unit (or a bare 0) - a weight has none -,
      // optionally followed by `/line-height`: held under a readable size.
      for (const token of v.split(/\s+/)) {
        const size = /^(\d*\.?\d+)([a-z%]+)?(\/.*)?$/.exec(token);
        if (!size || (!size[2] && size[1] !== '0')) continue;
        const n = Number(size[1]);
        const px = size[2] === 'px' ? n : size[2] === 'pt' ? (n * 4) / 3 : null;
        if (n <= 0 || (px !== null && px < 6)) return null;
        break;
      }
      return value.trim();
    }
    case 'white-space':
      return /^(pre-wrap|break-spaces|normal|pre-line)$/.test(v) ? 'pre-wrap' : null;
    case 'text-wrap':
      return /\bnowrap\b/.test(v) ? null : value.trim();
    case 'z-index': {
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) ? String(Math.min(n, 0)) : null;
    }
    default: {
      // Offsets, margins and indents: each part at most two lines away, in either direction for an
      // offset, only within the view for a negative margin or indent.
      // A positive margin or indent is a look, drawn as written.
      const negativeOnly = /^(margin|text-indent)/.test(name);
      const parts = v.split(/\s+/);
      const out: string[] = [];
      for (const part of parts) {
        const em = emOf(part);
        if (em === null) {
          if (part === 'auto' || part === '0' || /%$/.test(part)) out.push(part);
          else return null;
          continue;
        }
        const limited = negativeOnly ? em < -MAX_SHIFT_EM : Math.abs(em) > MAX_SHIFT_EM;
        out.push(limited ? `${Math.sign(em) * MAX_SHIFT_EM}em` : part);
      }
      return out.join(' ');
    }
  }
}

/** A selector in the Body view's terms (§2), scoped; null when it names nothing the view draws. */
function translateSelector(selector: CssNode): string | null {
  let out = '';
  for (const part of selector.children.toArray() as CssNode[]) {
    switch (part.type) {
      case 'TypeSelector': {
        const name = String(part.name).toLowerCase();
        if (name === '*') {
          out += EVERY_ELEMENT;
          break;
        }
        const mapped = ELEMENTS[name];
        if (!mapped) return null;
        out += mapped;
        break;
      }
      case 'ClassSelector': {
        const name = String(part.name).replace(/"/g, '\\"');
        out += `:is(.fb-style[data-style="${name}"], [data-style~="${name}"])`;
        break;
      }
      case 'PseudoElementSelector': {
        const name = String(part.name).toLowerCase();
        if (!/^(first-letter|first-line|before|after|marker)$/.test(name)) return null;
        out += `::${name}`;
        break;
      }
      case 'PseudoClassSelector': {
        const name = String(part.name).toLowerCase();
        if (
          !/^(first-child|last-child|nth-child|nth-of-type|first-of-type|last-of-type|only-child|not|is|where)$/.test(
            name,
          )
        ) {
          return null;
        }
        out += generate(part);
        break;
      }
      case 'Combinator':
        out += part.name === ' ' ? ' ' : ` ${String(part.name)} `;
        break;
      case 'AttributeSelector':
      case 'IdSelector':
        // The Body view's elements carry neither the book's attributes nor its ids.
        return null;
      default:
        out += generate(part);
    }
  }
  return out.trim() ? `${SCOPE} ${out.trim()}` : null;
}

function rule(node: CssNode, heldBack: string[]): string {
  if (node.prelude?.type !== 'SelectorList') return '';
  const selectors = (node.prelude.children.toArray() as CssNode[])
    .map((selector) => {
      const translated = translateSelector(selector);
      if (!translated) heldBack.push(generate(selector));
      return translated;
    })
    .filter((one): one is string => one !== null);
  if (selectors.length === 0) return '';
  const declarations: string[] = [];
  for (const declaration of (node.block?.children?.toArray() ?? []) as CssNode[]) {
    if (declaration.type !== 'Declaration') continue;
    const property = String(declaration.property);
    const value = treat(property, generate(declaration.value));
    if (value === null) heldBack.push(property);
    else declarations.push(`${property}: ${value};`);
  }
  return declarations.length > 0 ? `${selectors.join(', ')} { ${declarations.join(' ')} }` : '';
}

function rules(nodes: readonly CssNode[], heldBack: string[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'Rule') {
      const written = rule(node, heldBack);
      if (written) out.push(written);
    } else if (node.type === 'Atrule') {
      const name = String(node.name).toLowerCase();
      if (name === 'media' || name === 'supports') {
        const inner = rules((node.block?.children?.toArray() ?? []) as CssNode[], heldBack);
        if (inner.length > 0) out.push(`@${name} ${generate(node.prelude)} { ${inner.join(' ')} }`);
      } else if (name === 'font-face' && !/url\(\s*['"]?(?!data:)/i.test(generate(node))) {
        out.push(generate(node));
      } else {
        heldBack.push(`@${name}`);
      }
    }
  }
  return out;
}

export interface BookStylesSheet {
  /** The text of the generated `<style>`, '' when the book's stylesheets draw nothing. */
  css: string;
  /** What was held back: selectors the view cannot draw, properties and at-rules (§3). */
  heldBack: string[];
}

/** The generated stylesheet for the book's stylesheets, in their order. */
export function bookStylesCss(stylesheets: readonly Stylesheet[]): BookStylesSheet {
  const heldBack: string[] = [];
  const parts: string[] = [];
  for (const sheet of stylesheets) {
    if ((sheet.type || 'text/css').trim().toLowerCase() !== 'text/css') continue;
    let ast: CssNode;
    try {
      ast = parse(sheet.content, { parseValue: true, onParseError: () => undefined });
    } catch {
      continue;
    }
    parts.push(...rules((ast.children?.toArray() ?? []) as CssNode[], heldBack));
  }
  return {
    css: parts.length > 0 ? `${LAYERS}\n@layer fb-book {\n${parts.join('\n')}\n}\n` : '',
    heldBack,
  };
}
