/**
 * Feature 012 (US1; D12, FR-014; contracts/epub-export.md §5, research DP-11): the publication's
 * look. A base look after Preview's e-reader page that sets no font, text size or colour - those
 * stay the reading app's - then the book's CSS stylesheets, their FB2 selectors translated to the
 * exported markup with css-tree. What the Styles view's checker marks invalid, addresses other than
 * `data:` and stylesheets that are not CSS are left out and listed.
 */

import { generate, lexer, parse, walk, type CssNode } from 'css-tree';

import { isStandardProperty } from '@/features/styles/declarations';
import type { Stylesheet } from '@/model/document';

import type { SummaryItem } from './render';

export const BASE_CSS = `/* Maxima Fiction Book Editor: the base look of an exported book. */
body { margin: 0; padding: 0 0.5em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
h1, h2, h3, h4, h5, h6 { text-align: center; text-indent: 0; margin: 1em 0 0.5em; page-break-after: avoid; break-after: avoid; }
.fb2-section { margin: 0; }
.fb2-subtitle { text-align: center; text-indent: 0; font-weight: bold; margin: 0.5em 0; }
.fb2-empty-line { text-indent: 0; }
.fb2-epigraph { margin: 1em 0 1em 30%; font-style: italic; }
.fb2-epigraph p { text-indent: 0; }
.fb2-cite { margin: 1em 2em; }
.fb2-annotation { margin: 1em 0; font-style: italic; }
.fb2-poem { margin: 1em 0 1em 2em; }
.fb2-poem .fb2-title p, .fb2-stanza-title p { text-align: left; text-indent: 0; font-weight: bold; }
.fb2-stanza { margin: 0.5em 0; }
.fb2-v { text-indent: 0; text-align: left; }
.fb2-text-author { text-align: right; text-indent: 0; font-style: italic; }
.fb2-date { text-align: right; text-indent: 0; }
.fb2-image { text-align: center; margin: 1em 0; }
.fb2-image img { max-width: 100%; }
figcaption { text-align: center; font-style: italic; margin-top: 0.3em; }
.fb2-inline-image { vertical-align: middle; max-width: 100%; }
.fb2-table { border-collapse: collapse; margin: 1em auto; }
.fb2-table td, .fb2-table th { border: 1px solid; padding: 0.2em 0.4em; text-indent: 0; }
.fb2-align-left { text-align: left; }
.fb2-align-center { text-align: center; }
.fb2-align-right { text-align: right; }
.fb2-valign-top { vertical-align: top; }
.fb2-valign-middle { vertical-align: middle; }
.fb2-valign-bottom { vertical-align: bottom; }
.fb2-cover { text-align: center; margin: 0; padding: 0; }
.fb2-cover img { max-width: 100%; max-height: 100%; }
.fb2-title-page { text-align: center; margin-top: 3em; }
.fb2-title-page p { text-indent: 0; text-align: center; }
.fb2-book-title { margin: 1em 0; }
.fb2-series { font-style: italic; }
.fb2-author { margin-top: 0.5em; }
.fb2-title-page .fb2-annotation { text-align: justify; margin-top: 2em; }
.fb2-note { margin: 1em 0; }
.fb2-note-title p { text-indent: 0; font-weight: bold; }
.fb2-backlink { text-indent: 0; }
`;

/** FB2 element names in the book's selectors, and what the export writes for them. */
const TYPE_MAP: Readonly<Record<string, { type: 'TypeSelector' | 'ClassSelector'; name: string }>> =
  {
    p: { type: 'TypeSelector', name: 'p' },
    section: { type: 'ClassSelector', name: 'fb2-section' },
    title: { type: 'ClassSelector', name: 'fb2-title' },
    subtitle: { type: 'ClassSelector', name: 'fb2-subtitle' },
    epigraph: { type: 'ClassSelector', name: 'fb2-epigraph' },
    cite: { type: 'ClassSelector', name: 'fb2-cite' },
    annotation: { type: 'ClassSelector', name: 'fb2-annotation' },
    poem: { type: 'ClassSelector', name: 'fb2-poem' },
    stanza: { type: 'ClassSelector', name: 'fb2-stanza' },
    v: { type: 'ClassSelector', name: 'fb2-v' },
    'text-author': { type: 'ClassSelector', name: 'fb2-text-author' },
    date: { type: 'ClassSelector', name: 'fb2-date' },
    'empty-line': { type: 'ClassSelector', name: 'fb2-empty-line' },
    emphasis: { type: 'TypeSelector', name: 'em' },
    strong: { type: 'TypeSelector', name: 'strong' },
    strikethrough: { type: 'TypeSelector', name: 's' },
    code: { type: 'TypeSelector', name: 'code' },
    sub: { type: 'TypeSelector', name: 'sub' },
    sup: { type: 'TypeSelector', name: 'sup' },
    image: { type: 'TypeSelector', name: 'img' },
    table: { type: 'TypeSelector', name: 'table' },
    tr: { type: 'TypeSelector', name: 'tr' },
    td: { type: 'TypeSelector', name: 'td' },
    th: { type: 'TypeSelector', name: 'th' },
    a: { type: 'TypeSelector', name: 'a' },
    body: { type: 'TypeSelector', name: 'body' },
  };

interface ListLike {
  remove(item: unknown): void;
}

function usesForeignAddress(node: CssNode): boolean {
  let foreign = false;
  walk(node, {
    visit: 'Url',
    enter: (url) => {
      const value = String(url.value ?? '').trim();
      if (!/^data:/i.test(value)) foreign = true;
    },
  });
  return foreign;
}

/** One stylesheet's text, translated; the dropped parts reported to `summary`. */
export function translateCss(css: string, summary: SummaryItem[]): string {
  let syntax = false;
  const ast = parse(css, {
    parseValue: true,
    onParseError: () => {
      syntax = true;
    },
  });
  if (syntax) summary.push({ kind: 'cssDropped', detail: 'syntax' });
  walk(ast, {
    enter: (node, item, list) => {
      if (node.type === 'Raw') {
        (list as ListLike | null)?.remove(item);
        return;
      }
      if (node.type === 'Atrule') {
        const name = String(node.name).toLowerCase();
        if (name === 'import' || name === 'charset' || name === 'namespace') {
          summary.push({ kind: 'cssDropped', detail: `@${name}` });
          (list as ListLike | null)?.remove(item);
        } else if (name === 'font-face' && usesForeignAddress(node)) {
          summary.push({ kind: 'cssDropped', detail: '@font-face' });
          (list as ListLike | null)?.remove(item);
        }
        return;
      }
      if (node.type === 'TypeSelector') {
        const mapped = TYPE_MAP[String(node.name).toLowerCase()];
        if (mapped) {
          node.type = mapped.type;
          node.name = mapped.name;
        }
        return;
      }
      if (node.type === 'Declaration') {
        const name = String(node.property);
        const custom = name.startsWith('--');
        const invalid =
          !custom && (!isStandardProperty(name) || lexer.matchDeclaration(node).error !== null);
        if (invalid || usesForeignAddress(node)) {
          summary.push({ kind: 'cssDropped', detail: name });
          (list as ListLike | null)?.remove(item);
        }
      }
    },
  });
  // Rules left without a declaration are dropped too: they say nothing.
  walk(ast, {
    visit: 'Rule',
    enter: (node, item, list) => {
      const block = node.block as CssNode | undefined;
      const children = block?.children as { isEmpty?: boolean; size?: number } | undefined;
      if (children && (children.isEmpty === true || children.size === 0))
        (list as ListLike | null)?.remove(item);
    },
  });
  return generate(ast);
}

/** The publication's `style.css`: the base look, then every CSS stylesheet of the book, translated. */
export function publicationCss(stylesheets: readonly Stylesheet[], summary: SummaryItem[]): string {
  const parts = [BASE_CSS];
  for (const sheet of stylesheets) {
    const type = (sheet.type || 'text/css').trim().toLowerCase();
    if (type !== 'text/css') {
      summary.push({ kind: 'stylesheetDropped', detail: type });
      continue;
    }
    const translated = translateCss(sheet.content, summary);
    if (translated.trim())
      parts.push(`/* The book's stylesheet. */\n${translated.replace(/}/g, '}\n')}`);
  }
  return parts.join('\n');
}
