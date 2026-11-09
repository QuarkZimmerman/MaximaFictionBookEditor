/**
 * Feature 011 (US8; D42 and its clarifications; contracts/styles.md §2): the declarations the Styles
 * view accepts - standard CSS properties with values the CSS grammar allows. A property is standard
 * when it is no custom property, carries no vendor prefix and css-tree's lexer knows it; its value
 * must match the lexer's syntax for it; `!important` is allowed. This module loads css-tree: import
 * it lazily (PD2).
 */
import { generate, lexer, parse, property, walk, type CssNode } from 'css-tree';

export interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

export interface DeclarationIssue {
  property: string;
  reason: 'notStandard' | 'invalidValue' | 'syntax';
  /** The lexer's or the parser's words (`invalidValue`, `syntax`). */
  detail?: string;
}

export interface DeclarationCheck {
  declarations: Declaration[];
  issues: DeclarationIssue[];
}

/** The first line of css-tree's message ("Mismatch", "Unknown property"...). */
function firstLine(message: string): string {
  return message.split('\n')[0]!.trim();
}

/** Whether `name` is a standard CSS property (contracts/styles.md §2). */
export function isStandardProperty(name: string): boolean {
  const info = property(name);
  return !info.custom && !info.vendor && !info.hack && !!lexer.getProperty(name);
}

/** The standard property names the lexer knows, sorted (the editor's completion list). */
export function standardProperties(): string[] {
  return Object.keys(lexer.properties)
    .filter((name) => isStandardProperty(name))
    .sort();
}

/** The declarations of a rule's text (`a: b; c: d`) and what is wrong with them. */
export function checkDeclarations(text: string): DeclarationCheck {
  const issues: DeclarationIssue[] = [];
  const declarations: Declaration[] = [];
  let ast: CssNode;
  try {
    ast = parse(text, {
      context: 'declarationList',
      parseValue: true,
      onParseError: (error) => {
        issues.push({ property: '', reason: 'syntax', detail: firstLine(error.message) });
      },
    });
  } catch (error) {
    return {
      declarations,
      issues: [
        { property: '', reason: 'syntax', detail: error instanceof Error ? error.message : '' },
      ],
    };
  }
  walk(ast, {
    visit: 'Declaration',
    enter: (node) => {
      const name = node.property;
      const value = generate(node.value).trim();
      declarations.push({ property: name, value, important: node.important !== false });
      if (!isStandardProperty(name)) {
        issues.push({ property: name, reason: 'notStandard' });
        return;
      }
      const match = lexer.matchDeclaration(node);
      if (match.error) {
        issues.push({
          property: name,
          reason: 'invalidValue',
          detail: firstLine(match.error.message),
        });
      }
    },
  });
  return { declarations, issues };
}

/** One rule's declarations in the editor's canonical form (`  name: value;` per line). */
export function canonicalDeclarations(declarations: readonly Declaration[]): string {
  return declarations
    .map((one) => `  ${one.property}: ${one.value}${one.important ? ' !important' : ''};`)
    .join('\n');
}
