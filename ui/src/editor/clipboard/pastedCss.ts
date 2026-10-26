/**
 * The project's own CSS reader for pasted HTML (feature 006; FR-059; data-model §8.5 steps 2 and
 * 6; research R5 item 4, R5 probe P8 and "Alternatives considered: CSS"). Word, Excel and
 * LibreOffice put their formatting into a `<style>` element and classes, Google Docs and
 * browsers into `style` attributes; the conversion of a pasted table reads both through this
 * module.
 *
 * Every value is read from text - the `<style>` elements' text and the `style` attributes -,
 * never from CSSOM or `getComputedStyle`: a parsed document gets no stylesheets in jsdom, and
 * jsdom drops `-webkit-center` where Chromium keeps it, so the tests and the editor agree. There
 * is no specificity: Office writes its general rules first, so the rules apply in stylesheet
 * order, then the element's own `style` attribute.
 *
 * The module imports nothing outside `ui/src/editor/` (it imports nothing at all).
 */

/** One rule of a pasted stylesheet: a single selector and its declarations. */
export interface CssRule {
  selector: string;
  declarations: Map<string, string>;
}

/** Splits `text` at the top-level occurrences of `separator`, outside quotes and brackets. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if ((char === ')' || char === ']') && depth > 0) depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

const PROPERTY = /^-?[a-z_][a-z0-9_-]*$/;

/**
 * The declarations of a `style` text or a rule body: property names lower-cased, values trimmed
 * and kept as given, `!important` dropped, the last declaration of a property winning; a
 * declaration without a name or a value is skipped. Semicolons and colons inside quotes and
 * parentheses (`font-family:"A;B"`, `url(data:…;base64,…)`) belong to the value.
 */
export function parseDeclarations(text: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const part of splitTopLevel(text, ';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/\s*!\s*important\s*$/i, '')
      .trim();
    if (!PROPERTY.test(name) || value === '') continue;
    // A later declaration wins; the property keeps the place of its first declaration.
    declarations.set(name, value);
  }
  return declarations;
}

/** The position after the block that opens at `open` (a `{`), quotes respected. */
function blockEnd(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]!;
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

/** True when `selector` is one the DOM accepts (`querySelector` throws on the others). */
function validSelector(doc: Document, selector: string): boolean {
  try {
    doc.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

/** The rules of one stylesheet text, at-rules dropped with their blocks. */
function rulesOf(doc: Document, css: string, out: CssRule[]): void {
  const text = css
    .replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ')
    .replace(/<!--/g, ' ')
    .replace(/-->/g, ' ');
  let at = 0;
  while (at < text.length) {
    while (at < text.length && /\s/.test(text[at]!)) at += 1;
    if (at >= text.length) break;
    const open = text.indexOf('{', at);
    if (text[at] === '@') {
      // `@import …;` ends at its semicolon; a block at-rule at the end of its block.
      const semicolon = text.indexOf(';', at);
      if (semicolon >= 0 && (open < 0 || semicolon < open)) at = semicolon + 1;
      else at = open < 0 ? text.length : blockEnd(text, open);
      continue;
    }
    if (open < 0) break;
    const end = blockEnd(text, open);
    const body = text.slice(open + 1, Math.max(open + 1, end - 1));
    const declarations = parseDeclarations(body);
    for (const part of splitTopLevel(text.slice(at, open), ',')) {
      const selector = part.trim();
      if (selector !== '' && validSelector(doc, selector)) {
        out.push({ selector, declarations });
      }
    }
    at = end;
  }
}

/**
 * The rules of every `<style>` element of `doc`, in document order: comments and Office's
 * `<!--` / `-->` wrappers removed, at-rules (`@page`, `@list`, `@font-face`, `@media` and any
 * other) dropped with their blocks, each `selector-list {declarations}` kept as one rule per
 * selector; a selector the DOM does not accept is ignored.
 */
export function readPastedCss(doc: Document): CssRule[] {
  const rules: CssRule[] = [];
  for (const style of Array.from(doc.querySelectorAll('style'))) {
    rulesOf(doc, style.textContent ?? '', rules);
  }
  return rules;
}

/** `el.matches(selector)`, false for a selector that throws. */
function matchesSafely(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/**
 * The declarations that apply to `el`: those of the rules whose selector it matches, in
 * stylesheet order (a selector that throws is ignored), then its own `style` attribute - read
 * from text, never from CSSOM.
 */
export function effectiveDeclarations(el: Element, rules: readonly CssRule[]): Map<string, string> {
  const out = new Map<string, string>();
  const apply = (declarations: Map<string, string>) => {
    for (const [name, value] of declarations) out.set(name, value);
  };
  for (const rule of rules) {
    if (matchesSafely(el, rule.selector)) apply(rule.declarations);
  }
  const style = el.getAttribute('style');
  if (style) apply(parseDeclarations(style));
  return out;
}

/** `display: none` or `visibility: hidden`. */
export function isHidden(declarations: Map<string, string>): boolean {
  const display = declarations.get('display')?.trim().toLowerCase();
  const visibility = declarations.get('visibility')?.trim().toLowerCase();
  return display === 'none' || visibility === 'hidden';
}

/**
 * A horizontal alignment as FB2 takes it: `left`, `center` and `right`, also with a `-webkit-`
 * or `-moz-` prefix; anything else (`justify`, `start`, Excel's `general`) gives null.
 */
export function mapAlign(value: string | null | undefined): 'left' | 'center' | 'right' | null {
  const plain = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^-(webkit|moz)-/, '');
  return plain === 'left' || plain === 'center' || plain === 'right' ? plain : null;
}

/**
 * A vertical alignment as FB2 takes it: `top` and `text-top` give `top`, `middle` and `center`
 * give `middle`, `bottom` and `text-bottom` give `bottom`; anything else gives null.
 */
export function mapVAlign(value: string | null | undefined): 'top' | 'middle' | 'bottom' | null {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'top':
    case 'text-top':
      return 'top';
    case 'middle':
    case 'center':
      return 'middle';
    case 'bottom':
    case 'text-bottom':
      return 'bottom';
    default:
      return null;
  }
}
