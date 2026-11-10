/**
 * Feature 011 (US7; D46; FR-074; contracts/markdown-export.md §7): CSS written for HTML, as the
 * Markdown import finds it in Pandoc's header, in a local `css:` file or in a `<style>` block, made
 * into CSS for the book. Element selectors with an FB2 counterpart are translated (`blockquote` ->
 * `cite`, `em` -> `emphasis`, headings -> `title`...), classes and ids are kept, an HTML element
 * beside a class or an id is dropped from its compound (`div.note` -> `.note`); a selector without
 * a counterpart, an at-rule and a declaration that is not standard CSS are dropped and listed. What
 * remains passes the Styles view's checks (contracts/styles.md §1-§2). Loads css-tree: import it
 * lazily (PD2).
 */
import { generate, parse, type CssNode } from 'css-tree';

import { checkDeclarations } from '@/features/styles/declarations';
import { checkSelector } from '@/features/styles/selectors';

/** HTML elements and their FB2 counterparts (§7). */
const ELEMENTS: Readonly<Record<string, string>> = {
  p: 'p',
  blockquote: 'cite',
  em: 'emphasis',
  i: 'emphasis',
  strong: 'strong',
  b: 'strong',
  code: 'code',
  tt: 'code',
  kbd: 'code',
  samp: 'code',
  del: 'strikethrough',
  s: 'strikethrough',
  strike: 'strikethrough',
  sub: 'sub',
  sup: 'sup',
  table: 'table',
  tr: 'tr',
  th: 'th',
  td: 'td',
  h1: 'title',
  h2: 'title',
  h3: 'title',
  h4: 'title',
  h5: 'title',
  h6: 'title',
  img: 'image',
  a: 'a',
  body: 'body',
  section: 'section',
};

export interface CssTranslation {
  /** The translated stylesheet ('' when nothing could be used). */
  css: string;
  /** What was dropped: selectors, at-rules (`@media`), properties. */
  dropped: string[];
}

/** One selector of a list in FB2's terms, or null when it has no counterpart. */
function translateSelector(selector: CssNode): string | null {
  const groups: CssNode[][] = [[]];
  const combinators: string[] = [];
  for (const item of selector.children.toArray() as CssNode[]) {
    if (item.type === 'Combinator') {
      combinators.push(String(item.name));
      groups.push([]);
    } else {
      groups[groups.length - 1]!.push(item);
    }
  }
  let out = '';
  for (let g = 0; g < groups.length; g += 1) {
    const parts = groups[g]!;
    const named = parts.some((part) => part.type === 'ClassSelector' || part.type === 'IdSelector');
    let compound = '';
    for (const part of parts) {
      if (part.type === 'TypeSelector') {
        const name = String(part.name).toLowerCase();
        const mapped = name === '*' ? '*' : ELEMENTS[name];
        if (mapped) compound += mapped;
        else if (!named) return null;
      } else {
        compound += generate(part);
      }
    }
    if (!compound) return null;
    out += compound;
    const combinator = combinators[g];
    if (combinator !== undefined) out += combinator === ' ' ? ' ' : ` ${combinator} `;
  }
  return out.trim() || null;
}

/** The stylesheet `text` written for HTML, as CSS for the book. */
export function translateCss(text: string): CssTranslation {
  const dropped: string[] = [];
  let ast: CssNode;
  try {
    ast = parse(text);
  } catch {
    return { css: '', dropped: [text.trim().slice(0, 60)] };
  }
  const rules: string[] = [];
  for (const node of (ast.children?.toArray() ?? []) as CssNode[]) {
    if (node.type === 'Atrule') {
      dropped.push(`@${String(node.name)}`);
      continue;
    }
    if (node.type !== 'Rule' || node.prelude?.type !== 'SelectorList') continue;
    const selectors: string[] = [];
    for (const selector of node.prelude.children.toArray() as CssNode[]) {
      const translated = translateSelector(selector);
      if (translated && checkSelector(translated).ok) {
        if (!selectors.includes(translated)) selectors.push(translated);
      } else {
        dropped.push(generate(selector));
      }
    }
    if (selectors.length === 0) continue;
    const kept: string[] = [];
    for (const declaration of node.block.children.toArray() as CssNode[]) {
      if (declaration.type !== 'Declaration') continue;
      const important = declaration.important ? ' !important' : '';
      const written = `${String(declaration.property)}: ${generate(declaration.value).trim()}${important}`;
      if (checkDeclarations(written).issues.length > 0) dropped.push(String(declaration.property));
      else kept.push(`  ${written};`);
    }
    if (kept.length > 0) rules.push(`${selectors.join(', ')} {\n${kept.join('\n')}\n}`);
  }
  return { css: rules.length > 0 ? `${rules.join('\n')}\n` : '', dropped };
}
