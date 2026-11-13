/**
 * Feature 014 (D7, FR-006, research R5; tasks T030): the fonts the book's stylesheets name. Each named
 * font keeps its kind: it becomes the text font when that is of the same kind, else the shipped
 * family of its kind, so sans-serif titles over serif text keep their contrast. A declaration's kind
 * is its generic family when it names one ("Arial, sans-serif"), else the kind of the first font of
 * the list below that it names, else serif. Each replaced name is listed once in the summary (D23).
 */
import type { CssNode } from 'css-tree';

import { familyName } from './layout';

export type FontKind = 'serif' | 'sans-serif' | 'monospace';

/** R5: well-known font names and their kinds (lower case). */
const KNOWN: Readonly<Record<string, FontKind>> = {
  arial: 'sans-serif',
  helvetica: 'sans-serif',
  'helvetica neue': 'sans-serif',
  verdana: 'sans-serif',
  tahoma: 'sans-serif',
  'trebuchet ms': 'sans-serif',
  'segoe ui': 'sans-serif',
  calibri: 'sans-serif',
  'open sans': 'sans-serif',
  roboto: 'sans-serif',
  'pt sans': 'sans-serif',
  'noto sans': 'sans-serif',
  'dejavu sans': 'sans-serif',
  'liberation sans': 'sans-serif',
  'lucida grande': 'sans-serif',
  'lucida sans': 'sans-serif',
  'gill sans': 'sans-serif',
  futura: 'sans-serif',
  ubuntu: 'sans-serif',
  times: 'serif',
  'times new roman': 'serif',
  georgia: 'serif',
  garamond: 'serif',
  'eb garamond': 'serif',
  baskerville: 'serif',
  'book antiqua': 'serif',
  'palatino linotype': 'serif',
  palatino: 'serif',
  cambria: 'serif',
  'pt serif': 'serif',
  'noto serif': 'serif',
  'dejavu serif': 'serif',
  'liberation serif': 'serif',
  charter: 'serif',
  courier: 'monospace',
  'courier new': 'monospace',
  consolas: 'monospace',
  monaco: 'monospace',
  menlo: 'monospace',
  'lucida console': 'monospace',
  'dejavu sans mono': 'monospace',
  'liberation mono': 'monospace',
  'pt mono': 'monospace',
  'noto sans mono': 'monospace',
};

const GENERIC: Readonly<Record<string, FontKind>> = {
  serif: 'serif',
  'sans-serif': 'sans-serif',
  monospace: 'monospace',
  'ui-serif': 'serif',
  'ui-sans-serif': 'sans-serif',
  'ui-monospace': 'monospace',
  'system-ui': 'sans-serif',
};

/** CSS's absolute and relative size keywords, which a `font` shorthand may give as its size. */
const SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'smaller',
  'larger',
]);

/** Value nodes written back as CSS text: spaces between words, ", " between list items. */
function joined(nodes: readonly CssNode[], generate: (node: CssNode) => string): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'Operator' && node.value === ',') out += ', ';
    else if (node.type === 'Operator' && node.value === '/') out += '/';
    else out += (out && !out.endsWith(' ') && !out.endsWith('/') ? ' ' : '') + generate(node);
  }
  return out;
}

/** The names of a font-family value, unquoted, in order. */
export function familyNames(value: string): string[] {
  const names: string[] = [];
  for (const part of value.split(',')) {
    const name = part
      .trim()
      .replace(/^(['"])(.*)\1$/, '$2')
      .trim();
    if (name) names.push(name);
  }
  return names;
}

/** D7: the kind of a font-family value. */
export function kindOf(value: string): FontKind {
  const names = familyNames(value).map((name) => name.toLowerCase());
  for (const name of names) {
    if (GENERIC[name]) return GENERIC[name];
  }
  for (const name of names) {
    if (KNOWN[name]) return KNOWN[name];
  }
  return 'serif';
}

/** The text font and its kind (D25): a shipped family, or an added font of its declared kind. */
export interface TextFont {
  id: string;
  kind: FontKind;
  /** D7(c): a font the user added, followed by the shipped family of its kind. */
  added?: boolean;
}

/** The family list a declaration of `kind` gets: the font of that kind, then the scripts' families. */
export function replacementFamilies(kind: FontKind, text: TextFont): string {
  const sans = kind === 'sans-serif';
  const main =
    kind === text.kind
      ? text.id
      : kind === 'monospace'
        ? 'dejavu-sans-mono'
        : sans
          ? 'noto-sans'
          : 'noto-serif';
  const shippedOfKind =
    kind === 'monospace' ? 'dejavu-sans-mono' : sans ? 'noto-sans' : 'noto-serif';
  const families = [
    main,
    ...(text.added && main === text.id ? [shippedOfKind] : []),
    sans ? 'noto-sans-georgian' : 'noto-serif-georgian',
    sans ? 'noto-sans-armenian' : 'noto-serif-armenian',
    kind === 'monospace' ? 'noto-sans' : 'dejavu-sans-mono',
  ];
  return [...new Set(families)].map((id) => `'${familyName(id)}'`).join(', ');
}

/**
 * The stylesheet `css` with every font-family declaration (and the family of every `font`
 * shorthand) replaced by D7's families; `replaced` gets each name it replaced. css-tree is loaded
 * with the export's part, as Preview loads it. A stylesheet css-tree cannot read is kept as is.
 */
export async function replaceBookFonts(
  css: string,
  text: TextFont,
  replaced: Set<string>,
): Promise<string> {
  const { generate, parse, walk } = await import('css-tree');
  let ast;
  try {
    ast = parse(css, {
      onParseError: () => {
        throw new Error('unreadable');
      },
    });
  } catch {
    return css;
  }
  walk(ast, {
    visit: 'Declaration',
    enter(node) {
      const property = node.property.toLowerCase();
      if ((property !== 'font-family' && property !== 'font') || node.value.type !== 'Value')
        return;
      const children = node.value.children.toArray();
      // `font` shorthand: the family list follows the size and the optional line height.
      let from = 0;
      if (property === 'font') {
        from = children.findIndex(
          (c: CssNode) =>
            c.type === 'Dimension' ||
            c.type === 'Percentage' ||
            (c.type === 'Identifier' && SIZE_KEYWORDS.has(c.name.toLowerCase())) ||
            (c.type === 'Number' && Number(c.value) === 0),
        );
        if (from < 0) return;
        from += 1;
        const slash = children[from];
        if (slash?.type === 'Operator' && slash.value === '/') from += 2;
        if (from >= children.length) return;
      }
      const familyPart = joined(children.slice(from), generate);
      if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(familyPart.trim())) return;
      for (const name of familyNames(familyPart)) {
        if (!GENERIC[name.toLowerCase()]) replaced.add(name);
      }
      const families = replacementFamilies(kindOf(familyPart), text);
      const prefix = joined(children.slice(0, from), generate);
      node.value = { type: 'Raw', value: prefix ? `${prefix} ${families}` : families };
    },
  });
  return generate(ast);
}
