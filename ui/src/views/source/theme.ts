/**
 * CodeMirror theme of the Source view for the light and the dark interface theme
 * (Settings > View > Theme, `app/theme.ts`).
 *
 * The editor chrome (background, gutters, selection, active line, search matches, bracket
 * matching, fold placeholders, search panel, tooltips) reads the `--mfbe-*` variables of
 * `app/layout.css`, so the same spec serves both themes and only CodeMirror's `dark` flag
 * differs (it selects the base-theme defaults for anything not listed here, e.g. the text
 * colour of the special-character widgets). The light values of those variables are the
 * CodeMirror light defaults, so the light look is unchanged.
 *
 * Syntax colours cannot come from the stylesheet: `defaultHighlightStyle` is tuned for white
 * paper, so the dark theme uses its own compact `HighlightStyle` covering the tags the XML
 * grammar emits (tag names, attributes, values, entities, comments, processing instructions,
 * doctype, CDATA, mismatched tags).
 */

import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const EDITOR_THEME_SPEC = {
  '&': {
    color: 'var(--mfbe-color-fg)',
    backgroundColor: 'var(--mfbe-color-bg)',
  },
  '.cm-content': {
    caretColor: 'var(--mfbe-source-caret)',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--mfbe-source-caret)',
  },
  '.cm-selectionBackground, .cm-content ::selection': {
    background: 'var(--mfbe-source-selection)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--mfbe-source-selection-focused)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'var(--mfbe-source-selection-match)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--mfbe-source-active-line)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--mfbe-color-chrome-bg)',
    color: 'var(--mfbe-color-fg-muted)',
    borderRight: '1px solid var(--mfbe-color-border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--mfbe-source-active-gutter)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--mfbe-source-search-match)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--mfbe-source-search-selected)',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--mfbe-source-bracket-match)',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--mfbe-source-bracket-mismatch)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--mfbe-color-chrome-bg-2)',
    border: '1px solid var(--mfbe-color-border-strong)',
    color: 'var(--mfbe-color-fg-muted)',
  },
  '.cm-specialChar': {
    color: 'var(--mfbe-color-danger)',
  },
  '.cm-placeholder': {
    color: 'var(--mfbe-color-fg-muted)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--mfbe-color-chrome-bg)',
    color: 'var(--mfbe-color-fg)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--mfbe-color-border)',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--mfbe-color-border)',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--mfbe-color-input-bg)',
    border: '1px solid var(--mfbe-color-border-strong)',
    color: 'inherit',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--mfbe-color-button-bg)',
    border: '1px solid var(--mfbe-color-border-strong)',
    color: 'inherit',
  },
  '.cm-button:active': {
    backgroundImage: 'none',
    backgroundColor: 'var(--mfbe-color-button-hover)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--mfbe-color-dialog-bg)',
    border: '1px solid var(--mfbe-color-border-strong)',
    color: 'var(--mfbe-color-fg)',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--mfbe-color-highlight-bg)',
    color: 'var(--mfbe-color-highlight-fg)',
  },
};

const lightEditorTheme = EditorView.theme(EDITOR_THEME_SPEC, { dark: false });
const darkEditorTheme = EditorView.theme(EDITOR_THEME_SPEC, { dark: true });

/** Syntax colours for the dark theme (same roles as `defaultHighlightStyle`, lifted). */
export const darkHighlightStyle = HighlightStyle.define([
  { tag: t.tagName, color: '#6ccfae' },
  { tag: t.attributeName, color: '#9cdcfe' },
  { tag: [t.attributeValue, t.string], color: '#f0a07a' },
  { tag: [t.special(t.string), t.regexp, t.escape], color: '#ffa657' },
  { tag: [t.character, t.literal, t.inserted], color: '#d7ba7d' },
  { tag: t.angleBracket, color: '#8d9aa5' },
  { tag: t.definitionOperator, color: '#c8c8c8' },
  { tag: [t.comment, t.blockComment], color: '#8b949e', fontStyle: 'italic' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta], color: '#c586c0' },
  { tag: t.keyword, color: '#c586c0' },
  { tag: [t.atom, t.bool, t.url, t.contentSeparator, t.labelName], color: '#8ab4ff' },
  { tag: [t.typeName, t.namespace], color: '#6ccfae' },
  { tag: t.className, color: '#4ec9b0' },
  { tag: t.definition(t.variableName), color: '#9cdcfe' },
  { tag: t.definition(t.propertyName), color: '#9cdcfe' },
  { tag: t.deleted, color: '#f28b82' },
  { tag: t.invalid, color: '#ff7b72', textDecoration: 'underline wavy' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, fontWeight: 'bold', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
]);

/** The editor theme (chrome colours and CodeMirror's `dark` flag) of the resolved theme. */
export function sourceThemeExtension(dark: boolean): Extension {
  return dark ? darkEditorTheme : lightEditorTheme;
}

/** Syntax highlighting (Settings > "Syntax highlighting") for the resolved theme. */
export function sourceHighlightExtension(on: boolean, dark: boolean): Extension {
  if (!on) return [];
  return syntaxHighlighting(dark ? darkHighlightStyle : defaultHighlightStyle, {
    fallback: true,
  });
}
