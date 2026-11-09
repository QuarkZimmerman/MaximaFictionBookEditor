// Feature 011 (US8, PD2): the part of css-tree 3's API the editor uses (css-tree ships no type
// declarations; its README and docs/ describe these functions).
declare module 'css-tree' {
  /** An AST node; the fields each type has are those of css-tree's docs/ast.md. */
  export interface CssNode {
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [field: string]: any;
  }

  export interface SyntaxParseError extends Error {
    rawMessage?: string;
    offset?: number;
    line?: number;
    column?: number;
  }

  export interface ParseOptions {
    context?:
      | 'stylesheet'
      | 'atrule'
      | 'atrulePrelude'
      | 'mediaQueryList'
      | 'mediaQuery'
      | 'rule'
      | 'selectorList'
      | 'selector'
      | 'block'
      | 'declarationList'
      | 'declaration'
      | 'value';
    parseValue?: boolean;
    positions?: boolean;
    onParseError?: (error: SyntaxParseError, fallbackNode: CssNode) => void;
  }

  export function parse(text: string, options?: ParseOptions): CssNode;
  export function generate(ast: CssNode): string;

  export type WalkCallback = (node: CssNode, item: unknown, list: unknown) => void;
  export function walk(
    ast: CssNode,
    options: WalkCallback | { visit?: string; enter?: WalkCallback; leave?: WalkCallback },
  ): void;

  export interface MatchResult {
    matched: unknown;
    error: (Error & { rawMessage?: string }) | null;
  }

  export interface Lexer {
    properties: Record<string, unknown>;
    getProperty(name: string): unknown;
    matchProperty(name: string, value: CssNode | string): MatchResult;
    matchDeclaration(node: CssNode): MatchResult;
  }
  export const lexer: Lexer;

  export interface PropertyName {
    basename: string;
    name: string;
    hack: string;
    vendor: string;
    prefix: string;
    custom: boolean;
  }
  export function property(name: string): PropertyName;
}
