/**
 * Feature 011 (US8, PD3): the editor of a rule's declarations - CodeMirror 6 with the CSS language
 * of `@codemirror/lang-css`, completing the standard property names and, after a property's colon,
 * the keywords its CSS grammar allows (css-tree's lexer). The checks of `declarations.ts` judge the
 * text; the Styles view lists what they find under the editor.
 */
import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { lexer } from 'css-tree';

import { standardProperties } from '@/features/styles/declarations';

interface SyntaxNode {
  type: string;
  name?: string;
  term?: SyntaxNode;
  terms?: SyntaxNode[];
}

/** The keywords a property's grammar allows (through its types, at most a few levels deep). */
export function propertyKeywords(property: string): string[] {
  const found = new Set<string>();
  const seen = new Set<string>();
  const types = (lexer as unknown as { types: Record<string, { syntax?: SyntaxNode }> }).types;
  const visit = (node: SyntaxNode | undefined, depth: number) => {
    if (!node || depth > 10) return;
    switch (node.type) {
      case 'Keyword':
        if (node.name) found.add(node.name);
        break;
      case 'Group':
        for (const term of node.terms ?? []) visit(term, depth + 1);
        break;
      case 'Multiplier':
        visit(node.term, depth + 1);
        break;
      case 'Type':
      case 'Property': {
        const key = `${node.type}:${node.name}`;
        if (!node.name || seen.has(key)) break;
        seen.add(key);
        const target =
          node.type === 'Type'
            ? types[node.name]
            : (lexer.getProperty(node.name) as { syntax?: SyntaxNode } | null);
        visit(target?.syntax, depth + 1);
        break;
      }
      default:
        break;
    }
  };
  visit((lexer.getProperty(property) as { syntax?: SyntaxNode } | null)?.syntax, 0);
  return [...found].sort();
}

let propertyOptions: Completion[] | null = null;

/** Completion of property names, and of a property's keywords after its colon. */
export function completeDeclarations(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(0, context.pos);
  const statement = before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('{')) + 1);
  const word = /[-\w]*$/.exec(statement)![0];
  const from = context.pos - word.length;
  const colon = statement.indexOf(':');
  if (colon < 0) {
    if (!word && !context.explicit) return null;
    propertyOptions ??= standardProperties().map((name) => ({ label: name, type: 'property' }));
    return { from, options: propertyOptions, validFor: /^[-\w]*$/ };
  }
  const property = statement.slice(0, colon).trim().toLowerCase();
  const options = propertyKeywords(property).map((name) => ({ label: name, type: 'keyword' }));
  if (options.length === 0 || (!word && !context.explicit)) return null;
  return { from, options, validFor: /^[-\w]*$/ };
}

export interface DeclarationEditor {
  readonly view: EditorView;
  text(): string;
  setText(text: string): void;
  /** Puts the caret into the editor (feature 011: after *Add selector…*). */
  focus(): void;
  destroy(): void;
}

/** Mounts the editor in `parent` with `text`; `onChange` gets every new text. */
export function createDeclarationEditor(
  parent: HTMLElement,
  text: string,
  options: {
    onChange: (text: string) => void;
    onApply: () => void;
    label: string;
    /** What the empty editor shows: what to type and how to apply it. */
    hint?: string;
  },
): DeclarationEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(),
        css(),
        autocompletion({ override: [completeDeclarations] }),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              options.onApply();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        ...(options.hint ? [placeholder(options.hint)] : []),
        EditorView.contentAttributes.of({ 'aria-label': options.label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });
  return {
    view,
    text: () => view.state.doc.toString(),
    setText(next) {
      if (next === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}
