/**
 * Feature 011 (US8; D42; contracts/styles.md §3; research DP-13): the book's stylesheets as the
 * Styles view shows them - one group per stylesheet, never joined. A CSS stylesheet css-tree reads
 * without a fault is editable, its rules one per selector; another type, or CSS with faults the user
 * did not write, is shown read only with its faults and kept exactly as read (D31). An edited
 * stylesheet is written again in one canonical form; the others travel byte for byte (guard G13).
 * This module loads css-tree: import it lazily (PD2).
 */
import { generate, parse, walk, type CssNode } from 'css-tree';

import type { Stylesheet } from '@/model/document';

import { classNamesOf } from './classNames';
import { canonicalDeclarations, checkDeclarations } from './declarations';

export interface StyleRule {
  /** The selector list as written, white space collapsed. */
  selector: string;
  /** The rule's declarations in the canonical form (`  name: value;` per line). */
  declarations: string;
}

export interface StyleGroup {
  /** The stylesheet's place in the book (0-based). */
  index: number;
  type: string;
  /** A CSS stylesheet css-tree reads without a fault: the Styles view edits it. */
  editable: boolean;
  /** What css-tree could not read (empty for an editable group). */
  faults: string[];
  rules: StyleRule[];
  /** At-rules (`@media …`) as written: kept in place when the stylesheet is written again. */
  atrules: string[];
  /** The stylesheet's text as read. */
  text: string;
}

const isCss = (type: string) => /css/i.test(type);

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The stylesheet at `index` as a group of the Styles view. */
export function readStylesheet(sheet: Stylesheet, index: number): StyleGroup {
  const group: StyleGroup = {
    index,
    type: sheet.type,
    editable: false,
    faults: [],
    rules: [],
    atrules: [],
    text: sheet.content,
  };
  if (!isCss(sheet.type)) return group;
  let ast: CssNode;
  try {
    ast = parse(sheet.content, {
      context: 'stylesheet',
      positions: true,
      onParseError: (error) => {
        group.faults.push(error.line ? `${error.line}: ${error.message}` : error.message);
      },
    });
  } catch (error) {
    group.faults.push(error instanceof Error ? error.message : String(error));
    return group;
  }
  for (const node of ast.children.toArray() as CssNode[]) {
    if (node.type === 'Rule') {
      const selector = collapse(
        sheet.content.slice(node.prelude.loc.start.offset, node.prelude.loc.end.offset),
      );
      const declarations = sheet.content.slice(
        node.block.loc.start.offset + 1,
        node.block.loc.end.offset - 1,
      );
      group.rules.push({
        selector,
        declarations: canonicalDeclarations(checkDeclarations(declarations).declarations),
      });
    } else if (node.type === 'Atrule') {
      group.atrules.push(generate(node));
    } else if (node.type === 'Raw') {
      group.faults.push(collapse(node.value));
    }
  }
  // A rule css-tree could not read (a Raw block) marks the stylesheet as faulty too.
  walk(ast, (node) => {
    if (node.type === 'Raw' && node.value.trim() && !group.faults.includes(collapse(node.value))) {
      group.faults.push(collapse(node.value));
    }
  });
  group.editable = group.faults.length === 0;
  return group;
}

/** The groups of a book's stylesheets, in the book's order. */
export function readStylesheets(sheets: readonly Stylesheet[]): StyleGroup[] {
  return sheets.map((sheet, index) => readStylesheet(sheet, index));
}

/** An edited group's text in the canonical form: its at-rules, then one block per rule. */
export function writeStylesheet(group: Pick<StyleGroup, 'rules' | 'atrules'>): string {
  const parts = [
    ...group.atrules,
    ...group.rules.map((rule) =>
      rule.declarations.trim()
        ? `${rule.selector} {\n${rule.declarations}\n}`
        : `${rule.selector} {\n}`,
    ),
  ];
  return parts.length > 0 ? `${parts.join('\n')}\n` : '';
}

/** The default group: the first editable CSS stylesheet (null when the book has none). */
export function defaultGroup(groups: readonly StyleGroup[]): StyleGroup | null {
  return groups.find((group) => group.editable) ?? null;
}

/** The class names of every CSS stylesheet's selectors, each once, in stylesheet order (D43). */
export function namedStyles(sheets: readonly Stylesheet[]): string[] {
  return classNamesOf(sheets);
}
