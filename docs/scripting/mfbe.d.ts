// Maxima Fiction Book Editor - public typings of the user script API (`mfbe`), version 1.
// Copy of specs/001-maxima-fb2-editor/contracts/script-api.d.ts (the complete allow-list) with
// this header; the contract is the source of truth - update it first, then this file.
// Usage in a script project: /// <reference path="./mfbe.d.ts" /> (or add it to tsconfig "files").

/**
 * Maxima Fiction Book Editor — User Script API (`mfbe`), version 1.
 *
 * THIS FILE IS THE COMPLETE ALLOW-LIST. A script running in the editor can use
 * the JavaScript language, the standard built-ins (String, RegExp, Array, Map,
 * Math, Date, Intl, JSON, Promise, …) and the `mfbe` object below — nothing
 * else. There is no file system, no network, no access to the editor's own
 * HTML, no nested workers, no storage. Widening this list is a product
 * decision made by the editor's maintainers, never by a script.
 *
 * Execution model: each script is an ES module run inside a dedicated,
 * sandboxed Web Worker. All editor interaction is asynchronous (`await`).
 * A script exports a default async function:
 *
 *   export default async function run(ctx: mfbe.Context): Promise<void> { … }
 *
 * The editor opens one undo group for the whole run; everything the script
 * changes is undone by a single Undo. A running script can be cancelled by the
 * user (the worker is terminated and the undo group rolled back).
 */

declare namespace mfbe {

  /* ---------------------------------------------------------------------- */
  /* Context passed to run()                                                */
  /* ---------------------------------------------------------------------- */

  interface Context {
    /** Script metadata from script.json. */
    readonly script: { id: string; name: string; group: string; kind: 'menu' | 'tree' };
    /** Interface language of the editor ('en' | 'ru' | …). */
    readonly uiLanguage: string;
    /** For kind === 'tree': the node the user right-clicked in the Document Tree. */
    readonly treeNode?: NodeRef;
    /** True when the user asked to cancel; long loops should check it. */
    readonly cancelled: boolean;
  }

  /* ---------------------------------------------------------------------- */
  /* Document access                                                        */
  /* ---------------------------------------------------------------------- */

  /** A reference to a structural node (section, paragraph, …) by nodeId. */
  interface NodeRef {
    readonly nodeId: string;
    readonly type: string;                 // 'section' | 'p' | 'title' | 'poem' | … (document-model.d.ts)
  }

  interface Doc {
    /** Snapshot of the whole book as JSON (document-model.d.ts Document), read-only. */
    get(): Promise<import('./document-model').Document>;

    /** Snapshot of one node and its subtree. */
    getNode(ref: NodeRef | string): Promise<import('./document-model').BodyNode | import('./document-model').SectionNode | import('./document-model').BlockNode>;

    /**
     * Replace a node's subtree (type must stay compatible with its parent). The whole subtree
     * is schema-checked first; a violation rejects with a `ScriptApiError` whose `code` is
     * 'invalidNode' (message: `invalid node at "<path>": …`), a wrong position with 'notAllowed'.
     */
    replaceNode(ref: NodeRef | string, node: object): Promise<NodeRef>;

    /**
     * Insert a node before/after/inside (append) a reference node. 'before'/'after' a body
     * with a `{ type: 'body', … }` node creates a new body (e.g. the `notes` body).
     */
    insertNode(where: 'before' | 'after' | 'append', ref: NodeRef | string, node: object): Promise<NodeRef>;

    /**
     * Remove a node (and its subtree). Any body except the first one may be removed; the last
     * section of a body may not ('notAllowed').
     */
    removeNode(ref: NodeRef | string): Promise<void>;

    /** Replace the whole description block. */
    setDescription(description: import('./document-model').Description): Promise<void>;

    /**
     * Legacy-friendly traversal helpers (make porting FBE scripts mechanical):
     * element names are FB2 names ('p', 'section', 'title', 'v', 'emphasis' …).
     */
    getElementsByTagName(name: string, within?: NodeRef | string): Promise<NodeRef[]>;
    textOf(ref: NodeRef | string): Promise<string>;            // plain text of the subtree
    setText(ref: NodeRef | string, text: string): Promise<void>; // replaces inline content with plain text
    parentOf(ref: NodeRef | string): Promise<NodeRef | null>;
    childrenOf(ref: NodeRef | string): Promise<NodeRef[]>;

    /** Text search/replace across the body with the editor's engine (regex supported). */
    find(query: FindQuery): Promise<Match[]>;
    replaceAll(query: FindQuery, replacement: string): Promise<{ count: number }>;

    /** Binary objects — metadata only (no bytes). */
    binaries(): Promise<import('./document-model').BinaryMeta[]>;

    /** Document statistics used by the "Статистика" scripts. */
    stats(): Promise<{ characters: number; words: number; paragraphs: number; sections: number; images: number; notes: number; binaryBytes: number }>;
  }

  interface FindQuery {
    text: string;
    regex?: boolean;
    matchCase?: boolean;
    wholeWord?: boolean;
    within?: NodeRef | string;            // limit to a subtree
  }

  interface Match {
    nodeId: string;
    from: number;                         // text offset within the node
    to: number;
    text: string;
  }

  /* ---------------------------------------------------------------------- */
  /* Selection and caret                                                    */
  /* ---------------------------------------------------------------------- */

  interface Selection {
    /**
     * null only without an open book. With no selection in the Body view the result is a
     * collapsed selection (anchor = head, text '') at the start of the first text block; a
     * selected image gives nodes [] and text '\uFFFC'.
     */
    get(): Promise<{ anchor: Position; head: Position; text: string; nodes: NodeRef[] } | null>;
    set(anchor: Position, head?: Position): Promise<void>;
    replaceText(text: string): Promise<void>;        // replaces the selected text
    wrap(mark: MarkName | { style: string } | { link: string; note?: boolean }): Promise<void>;
    unwrap(mark: MarkName | 'style' | 'link'): Promise<void>;
    selectNode(ref: NodeRef | string): Promise<void>;
    scrollIntoView(): Promise<void>;
  }

  interface Position { nodeId: string; offset: number }
  type MarkName = 'strong' | 'emphasis' | 'strikethrough' | 'sub' | 'sup' | 'code';

  /* ---------------------------------------------------------------------- */
  /* User interface                                                         */
  /* ---------------------------------------------------------------------- */

  interface UI {
    /** Message box. Returns the id of the pressed button. */
    message(text: string, options?: { caption?: string; buttons?: ButtonSpec[]; icon?: 'info' | 'warning' | 'error' | 'question' }): Promise<string>;
    /** Single-line input prompt; null when cancelled. */
    prompt(text: string, options?: { caption?: string; defaultValue?: string; yesNoCancel?: boolean }): Promise<string | null>;
    /** Declarative form dialog (replaces the legacy HTML dialogs). null when cancelled. */
    form(spec: FormSpec): Promise<Record<string, string | number | boolean | string[]> | null>;
    /** Status bar text (cleared when the script ends unless sticky). */
    status(text: string, options?: { sticky?: boolean }): Promise<void>;
    /** Progress indicator for long runs; also serves as a cancel point. */
    progress(done: number, total?: number, label?: string): Promise<void>;
  }

  interface ButtonSpec { id: string; label: string; default?: boolean; cancel?: boolean }

  interface FormSpec {
    title: string;
    width?: number;
    fields: FormField[];
    okLabel?: string;
    cancelLabel?: string;
  }

  type FormField =
    | { kind: 'text';     id: string; label: string; value?: string; placeholder?: string; multiline?: boolean }
    | { kind: 'number';   id: string; label: string; value?: number; min?: number; max?: number }
    | { kind: 'checkbox'; id: string; label: string; value?: boolean }
    | { kind: 'select';   id: string; label: string; options: { value: string; label: string }[]; value?: string }
    | { kind: 'radio';    id: string; label: string; options: { value: string; label: string }[]; value?: string }
    | { kind: 'list';     id: string; label: string; options: { value: string; label: string }[]; value?: string[]; multiple?: boolean }
    | { kind: 'static';   id: string; text: string };

  /* ---------------------------------------------------------------------- */
  /* Editing helpers                                                        */
  /* ---------------------------------------------------------------------- */

  interface Edit {
    /** Mark a sub-step; purely informational for the undo label. */
    label(text: string): Promise<void>;
    /** Typographic constants the original scripts fetched from the host. */
    readonly nbsp: '\u00A0';
    readonly symbols: () => Promise<Array<{ codepoint: number; name: string }>>;
  }

  /* ---------------------------------------------------------------------- */
  /* Read-only environment                                                  */
  /* ---------------------------------------------------------------------- */

  interface Env {
    /** Selected read-only settings relevant to scripts. */
    settings(): Promise<{ nbspDisplayChar: string; pasteImageFormat: 'jpeg' | 'png'; jpegQuality: number; uiLanguage: string }>;
    /** Document language (title-info/lang) for language-aware scripts. */
    docLanguage(): Promise<string>;
  }

  /* ---------------------------------------------------------------------- */
  /* Legacy compatibility façade (thin wrappers over the above)             */
  /* ---------------------------------------------------------------------- */

  /** `await MsgBox(text, caption?, flags?)` → button id, mirroring the old FBE helper. */
  function MsgBox(text: string, caption?: string, flags?: number): Promise<number>;
  /** `await InputBox(prompt, caption?, defaultValue?)` → string | null. */
  function InputBox(prompt: string, caption?: string, defaultValue?: string): Promise<string | null>;
  /** No-ops kept for ported code: the whole run is already one undo unit. */
  function BeginUndoUnit(label?: string): Promise<void>;
  function EndUndoUnit(): Promise<void>;

  /* ---------------------------------------------------------------------- */
  /* Root object                                                            */
  /* ---------------------------------------------------------------------- */

  const doc: Doc;
  const selection: Selection;
  const ui: UI;
  const edit: Edit;
  const env: Env;
  const version: 1;
}

export = mfbe;
export as namespace mfbe;
