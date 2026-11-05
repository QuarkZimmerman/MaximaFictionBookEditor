/**
 * Attribute, value and text completion in the Source view (feature 009, User Story 6; FR-060
 * to FR-067, research DP-15, data-model §9), beside the tag completion of `completion.ts`:
 *  - after an element name and a space: the element's attributes from the schema table,
 *    the ones present left out, the required ones first; the link attributes with the prefix
 *    the root declares for the XLink namespace (none declared: none offered); accepting one
 *    inserts `name=""` with the cursor between the quotes and opens its values (D25);
 *  - inside a value: `#` and the book's ids for a link, `#` and its pictures for an image,
 *    `note` for a link's type, the schema's values (`align`, `valign`), the languages for
 *    `xml:lang`, the picture types for `content-type`, `notes` and `comments` for a body name;
 *  - inside `genre`, `lang` and `src-lang`: the genre and language codes the Description view
 *    loads. Nothing in comments, CDATA or processing instructions.
 * The ids and pictures are scanned once per version of the text.
 */

import {
  pickedCompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import { FB2_ELEMENTS } from './completion';

const LOOKBEHIND = 2_000;
const XLINK_ROOT =
  /<FictionBook\b[^>]*?\sxmlns:([\w.-]+)\s*=\s*["']http:\/\/www\.w3\.org\/1999\/xlink["']/;
const OPAQUE = new Set(['Comment', 'ProcessingInst', 'Cdata', 'DoctypeDecl']);

/** The genre and language codes the Description view loads (feature 009, FR-064). */
export interface CompletionLists {
  genres: readonly string[];
  languages: readonly string[];
}

let lists: () => CompletionLists = () => ({ genres: [], languages: [] });

/** Where the genre and language codes come from (set once the core is known). */
export function provideCompletionLists(provider: () => CompletionLists): void {
  lists = provider;
}

interface BookScan {
  ids: string[];
  pictures: string[];
  linkPrefix: string | null;
}

const scans = new WeakMap<Text, BookScan>();

/** The book's ids in order (the `binary` elements' apart: they are the pictures). */
export function scanBook(doc: Text): BookScan {
  const known = scans.get(doc);
  if (known) return known;
  const text = doc.toString();
  const ids: string[] = [];
  const pictures: string[] = [];
  for (const match of text.matchAll(/<([\w.:-]+)\s[^<>]*?\bid\s*=\s*["']([^"'<>]*)["']/g)) {
    const element = match[1]!.slice(match[1]!.indexOf(':') + 1);
    (element === 'binary' ? pictures : ids).push(match[2]!);
  }
  const scan = { ids, pictures, linkPrefix: XLINK_ROOT.exec(text)?.[1] ?? null };
  scans.set(doc, scan);
  return scan;
}

const localName = (name: string) => name.slice(name.indexOf(':') + 1);

/** The schema's attributes of `element`, the link ones under the book's own prefix. */
function attributesOf(element: string, linkPrefix: string | null) {
  const declared = FB2_ELEMENTS.elements[localName(element)]?.attributes ?? [];
  return declared.flatMap((attribute) => {
    if (!attribute.name.startsWith('xlink:')) return [attribute];
    if (!linkPrefix) return [];
    return [{ ...attribute, name: `${linkPrefix}:${attribute.name.slice('xlink:'.length)}` }];
  });
}

/** `name=""` with the cursor between the quotes, then the values (D25). */
function applyAttribute(view: EditorView, completion: Completion, from: number, to: number) {
  const text = `${completion.label}=""`;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length - 1 },
    userEvent: 'input.complete',
    annotations: pickedCompletion.of(completion),
  });
  startCompletion(view);
}

function valuesFor(element: string, attribute: string, doc: Text): readonly string[] {
  const name = localName(element);
  const local = localName(attribute);
  if (local === 'href' && attribute.includes(':')) {
    const scan = scanBook(doc);
    return (name === 'image' ? scan.pictures : scan.ids).map((id) => `#${id}`);
  }
  if (name === 'a' && attribute === 'type') return ['note'];
  if (attribute === 'xml:lang') return lists().languages;
  if (name === 'binary' && attribute === 'content-type') return ['image/jpeg', 'image/png'];
  if (name === 'body' && attribute === 'name') return ['notes', 'comments'];
  const declared = FB2_ELEMENTS.elements[name]?.attributes ?? [];
  return declared.find((a) => a.name === attribute)?.values ?? [];
}

export function attributeCompletion(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  // Nothing inside comments, CDATA, processing instructions or the doctype.
  for (
    let node: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent as typeof node
  ) {
    if (OPAQUE.has(node.name)) return null;
  }
  const before = state.sliceDoc(Math.max(0, pos - LOOKBEHIND), pos);
  const open = before.lastIndexOf('<');
  const tag = open >= 0 ? before.slice(open) : '';

  // Inside a start tag, after its name.
  const start = /^<([\w.:-]+)\s/.exec(tag);
  if (start && !tag.includes('>')) {
    const element = start[1]!;
    const quotes = (tag.match(/["']/g) ?? []).length;
    if (quotes % 2 === 1) {
      const value = /([\w.:-]+)\s*=\s*["']([^"']*)$/.exec(tag);
      if (!value) return null;
      const options = valuesFor(element, value[1]!, state.doc);
      if (options.length === 0) return null;
      return {
        from: pos - value[2]!.length,
        options: options.map((label) => ({ label })),
        validFor: /^[^"'<>]*$/,
      };
    }
    const typed = /\s([\w.:-]*)$/.exec(tag);
    if (!typed) return null;
    const present = new Set([...tag.matchAll(/\s([\w.:-]+)\s*=/g)].map((m) => m[1]!));
    const attributes = attributesOf(element, scanBook(state.doc).linkPrefix)
      .filter((a) => !present.has(a.name))
      .sort((a, b) => Number(b.required) - Number(a.required));
    if (attributes.length === 0) return null;
    return {
      from: pos - typed[1]!.length,
      options: attributes.map((a, index) => ({
        label: a.name,
        boost: 99 - index,
        apply: applyAttribute,
      })),
      validFor: /^[\w.:-]*$/,
    };
  }

  // The text of genre, lang and src-lang.
  const text = /<((?:[\w.-]+:)?(?:genre|lang|src-lang))(?:\s[^<>]*)?>([^<]*)$/.exec(before);
  if (text) {
    const element = localName(text[1]!);
    const options = element === 'genre' ? lists().genres : lists().languages;
    if (options.length === 0) return null;
    return {
      from: pos - text[2]!.length,
      options: options.map((label) => ({ label })),
      validFor: /^[^<]*$/,
    };
  }
  return null;
}
