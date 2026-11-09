// Maxima Fiction Book Editor - public typings of the user script API (`mfbe`), version 3.
// Copy of specs/001-maxima-fb2-editor/contracts/script-api.d.ts (the complete allow-list), as
// amended by specs/007-fourth-feedback-batch/contracts/script-api.md (version 1 -> 2, additive:
// a version-1 script runs unchanged) and specs/011-seventh-feedback-batch/contracts/script-api.md
// (version 2 -> 3, additive: the Document tree's rows of a treeRows script), with this header;
// the contracts are the source of truth - update them first, then this file.
// Usage in a script project: /// <reference path="./mfbe.d.ts" /> (or add it to tsconfig "files").

/**
 * Maxima Fiction Book Editor — User Script API (`mfbe`), version 3.
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
    /**
     * Version 3: kind 'treeRows' - a script of the Document tree bar's Scripts menu, which lists
     * places in the tree through mfbe.tree.showRows.
     */
    readonly script: { id: string; name: string; group: string; kind: 'menu' | 'tree' | 'treeRows' };
    /** Interface language of the editor ('en' | 'ru' | …). */
    readonly uiLanguage: string;
    /** For kind === 'tree': the node the user right-clicked in the Document Tree. */
    readonly treeNode?: NodeRef;
    /**
     * Version 2: who started this run - a menu, toolbar, hotkey or tree command ('user'), the AI
     * assistant ('assistant'), or another script through mfbe.scripts.run ('script').
     */
    readonly startedBy: 'user' | 'assistant' | 'script';
    /** Version 2: the calling script's id when startedBy is 'script'. */
    readonly caller?: string;
    /** Version 2: the `args` the caller passed to mfbe.scripts.run (structured-cloned). */
    readonly args?: unknown;
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
    /**
     * Version 2: opens a report window - modeless, display only. `html` is shown in a sandboxed
     * frame with no scripts and no network (pictures only as data: URLs), `text` as pre-wrapped
     * text. The window has Copy and Save as... buttons operated by the user and stays open after
     * the run ends. Resolves when the window is shown.
     */
    report(report: { title: string; text?: string; html?: string }): Promise<void>;
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
    | { kind: 'static';   id: string; text: string }
    /** Version 2: a pattern with named presets (choosing one puts its value in the field) and a
     *  validity check - OK stays disabled while `new RegExp(value, flags)` throws. The value is
     *  the pattern string. */
    | { kind: 'regexp';   id: string; label: string; value?: string; presets?: { value: string; label: string }[]; presetsLabel?: string; flags?: string };

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
  /* Version 2: the powers the editor performs at a script's request        */
  /* (constitution principle V; specs/007-fourth-feedback-batch/contracts/  */
  /* script-api.md §2, §3, §5)                                              */
  /* ---------------------------------------------------------------------- */

  interface Clipboard {
    /**
     * Plain text on the system clipboard ('' when it holds no text). Rejects with a
     * ScriptApiError of code 'clipboard.readNotAllowed' unless the chain's root was started by
     * the user: what a script reads in a chain the assistant started would reach the AI service.
     */
    readText(): Promise<string>;
    /** Replaces the clipboard's content with plain text. */
    writeText(text: string): Promise<void>;
  }

  interface Files {
    /**
     * The editor's Save dialog proposes `suggestedName`; the user chooses where (or cancels) and
     * the editor writes the text atomically. Overwriting asks in the dialog itself. `name` is the
     * file name alone - a script never sees a folder or a path.
     */
    saveText(options: {
      suggestedName: string;
      text: string;
      encoding?: 'utf-8' | 'utf-16' | 'windows-1251';
      title?: string;
    }): Promise<{ saved: boolean; name?: string }>;
    /**
     * The editor's folder dialog; the editor writes each binary of the open book (`ids`, all when
     * omitted) with its original bytes, named by its id. For files that exist already the editor
     * asks the user (Overwrite / Skip / Overwrite all / Cancel).
     */
    saveBinaries(options?: { ids?: string[]; title?: string }): Promise<{ saved: number; skipped: number }>;
  }

  interface Scripts {
    /**
     * Runs another script of the Scripts menu in this run and resolves with what its run()
     * returned (structured-cloned). `ref` is a script id ("16/next-cite") or the FictionBook
     * Editor path its manifest names in legacy.source ("16_Поиск форматирования\\52_Перейти на
     * следующую цитату.js"; separators and case do not matter). The callee runs in a worker the
     * editor creates, with ctx.startedBy 'script', ctx.caller and ctx.args; the whole chain is
     * one undo step and one Cancel. At most 8 deep. Rejects with a ScriptApiError of code
     * 'scripts.notFound', 'scripts.depthExceeded' or 'scripts.needsSelection', or with the
     * callee's own error.
     */
    run(ref: string, args?: unknown): Promise<unknown>;
  }

  /** Version 3: the rows a treeRows script shows in the Document tree (display only). */
  interface Tree {
    /**
     * Shows `entries` as rows of the Document tree under this script's name and icon, in their
     * places (under the nearest row above each node), replacing this script's earlier rows.
     * Nothing in the book changes. A `caption` shows at most 80 characters; without one, the
     * script's name. Unknown or stale nodes are skipped; resolves with the number of rows shown.
     * The rows stay until the tree bar's Clean, the row's Clean, the script's next run or their
     * node's deletion, and are never saved. Only in a run of a treeRows script; elsewhere it
     * rejects with a ScriptApiError of code 'notAllowed'.
     */
    showRows(entries: ReadonlyArray<{ node: NodeRef | string; caption?: string }>): Promise<number>;
    /** Removes this script's rows ('notAllowed' outside a treeRows run). */
    clearRows(): Promise<void>;
  }

  /**
   * Errors of the API reach a script as Error objects whose `name` is 'ScriptApiError' and whose
   * `code` says why: 'apiError', 'invalidNode', 'notAllowed', 'unknownNode', and in version 2
   * 'clipboard.readNotAllowed', 'scripts.notFound', 'scripts.depthExceeded',
   * 'scripts.needsSelection', 'files.failed'. A cancelled Save or folder dialog is no error.
   */
  type ScriptApiErrorCode =
    | 'apiError'
    | 'invalidNode'
    | 'notAllowed'
    | 'unknownNode'
    | 'clipboard.readNotAllowed'
    | 'scripts.notFound'
    | 'scripts.depthExceeded'
    | 'scripts.needsSelection'
    | 'files.failed';

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
  const clipboard: Clipboard;
  const files: Files;
  const scripts: Scripts;
  const tree: Tree;
  const version: 3;
}

export = mfbe;
export as namespace mfbe;
