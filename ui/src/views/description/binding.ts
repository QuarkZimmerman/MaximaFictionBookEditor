/**
 * Form <-> model binding of the Description view (T077).
 *
 * One `DescriptionController` exists per application store (created by the description
 * feature registrar, `descriptionControllerFor(store)`), so the raw form state - what the user
 * typed, including incomplete rows - survives view switches exactly like the Body editor's
 * state does. The controller:
 *
 *  - keeps the raw form (`DescriptionForm`: the model's shape plus the "Other persons" list
 *    derived from the role rows, feature 004 US3) and writes its *clean* projection
 *    (`cleanDescription()`: trimmed, empty optional fields omitted, the person rule applied, the
 *    role entries folded back into `custom-info` rows) into the document on every change
 *    through `actions.updateDocument` (marks modified), so Save always sees the latest values;
 *  - re-initialises from the model when the document is replaced from outside (New / Open /
 *    Reload / Source re-parse) - recognised because the description object is not the one the
 *    controller produced; a description that differs from the committed one only in the
 *    annotation / history nodes - the Body view's blocks edit the same datum (feature 004,
 *    FR-011) - is *adopted* instead: form and committed description follow, no undo entry, no
 *    re-initialisation, so the Description history survives a block edit;
 *  - records one `description` undo entry per field edit burst (consecutive keystrokes in the
 *    same field within a second are one entry; a blur or another field starts a new one) and
 *    one per structural change (row added / removed, genre picked...), replaying them through
 *    whole-form snapshots (`ViewHistoryAdapter` registered as the `description` view);
 *  - exposes the Find / Replace target over the plain text fields (`SearchTarget`, FR-035),
 *    a caret provider and the registry of mounted inputs the search uses to select matches.
 */

import type { Description, Document } from '@/model/document';
import { actions, type AppStore } from '@/model/store';
import type { UndoCoordinator, ViewHistoryAdapter } from '@/model/undo';
import type { CaretProvider } from '@/model/caret';
import type { Caret } from '@/rpc/types';
import { findMatch, type Match, type ModelTextblock } from '@/features/search/bodyTarget';
import { allMatches, buildSearchRegExp, expandReplacement } from '@/features/search/replacement';
import type { FindMode, FindOptions, FindResult, SearchTarget } from '@/features/search/search';

import {
  cleanDescription,
  formFromDescription,
  getAtPath,
  requiredIssues,
  setAtPath,
  textFields,
  type DescriptionForm,
  type FieldKey,
  type RequiredIssues,
} from './model';

export const DESCRIPTION_UNDO_VIEW = 'description';

/** Keystrokes in the same field closer than this are one undo entry. */
const COALESCE_MS = 1000;

export interface DescriptionSnapshot {
  form: DescriptionForm | null;
  docId: string | null;
  issues: RequiredIssues | null;
  /** Monotonic counter, bumped on every form change. */
  revision: number;
}

const EMPTY_SNAPSHOT: DescriptionSnapshot = { form: null, docId: null, issues: null, revision: 0 };

interface HistoryEntry {
  before: DescriptionForm;
  after: DescriptionForm;
}

interface OpenEntry {
  entry: HistoryEntry;
  key: FieldKey;
  time: number;
}

export type FormInput = HTMLInputElement | HTMLTextAreaElement;

export interface DescriptionControllerOptions {
  store: AppStore;
  undo: UndoCoordinator;
  /** Localised undo label (updated through `setTranslate`). */
  translate?: (key: string) => string;
  now?: () => number;
}

interface SearchCursor {
  nodeId: string | null;
  from: number;
  to: number;
}

export class DescriptionController {
  private readonly store: AppStore;
  private readonly undo: UndoCoordinator;
  private translate: (key: string) => string;
  private readonly now: () => number;

  private form: DescriptionForm | null = null;
  private docId: string | null = null;
  /** The description object the controller last wrote into (or read from) the model. */
  private committed: Description | null = null;
  private snapshot: DescriptionSnapshot = EMPTY_SNAPSHOT;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  private history: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private open: OpenEntry | null = null;
  private replaying = false;

  private readonly inputs = new Map<FieldKey, FormInput>();
  private lastMatch: Match | null = null;
  private anchor: SearchCursor | null = null;

  constructor(options: DescriptionControllerOptions) {
    this.store = options.store;
    this.undo = options.undo;
    this.translate = options.translate ?? ((key) => key);
    this.now = options.now ?? (() => Date.now());
    const state = this.store.getState();
    this.initFrom(state.document);
    this.store.subscribe((state, previous) => {
      if (state.document === previous.document && state.docId === previous.docId) return;
      if (!state.document) {
        this.initFrom(null);
        return;
      }
      if (state.docId !== this.docId) {
        this.initFrom(state.document);
        return;
      }
      const description = state.document.description;
      if (description === this.committed) return;
      if (this.committed && this.form && differsOnlyInBlocks(this.committed, description)) {
        this.adopt(description);
      } else {
        this.initFrom(state.document);
      }
    });
  }

  /* ------------------------------------------------------------ snapshot */

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): DescriptionSnapshot => this.snapshot;

  get currentForm(): DescriptionForm | null {
    return this.form;
  }

  get currentDocId(): string | null {
    return this.docId;
  }

  setTranslate(translate: (key: string) => string): void {
    this.translate = translate;
  }

  private publish(): void {
    this.revision += 1;
    this.snapshot = {
      form: this.form,
      docId: this.docId,
      issues: this.form ? requiredIssues(this.form) : null,
      revision: this.revision,
    };
    for (const listener of [...this.listeners]) listener();
  }

  /* -------------------------------------------------------- model binding */

  /** Rebuilds the form from a model replaced outside the controller; forgets the history. */
  private initFrom(document: Document | null): void {
    const hadHistory = this.history.length > 0 || this.future.length > 0;
    this.form = document ? formFromDescription(document.description) : null;
    this.docId = document?.docId ?? null;
    this.committed = document?.description ?? null;
    this.history = [];
    this.future = [];
    this.open = null;
    this.lastMatch = null;
    this.anchor = null;
    if (hadHistory) this.undo.clearView(DESCRIPTION_UNDO_VIEW);
    this.publish();
  }

  /**
   * Takes over the annotation / history nodes of a description the Body view's blocks wrote
   * (or a script, Replace, an undo of a block edit): the form shows them, `committed` is the
   * model's object again, no undo entry is recorded and the history is kept (data-model §2.3).
   * The open edit burst is closed so a later keystroke starts an entry of its own.
   */
  private adopt(description: Description): void {
    if (!this.form) return;
    let form = setAtPath(this.form, 'titleInfo.annotation', description.titleInfo.annotation);
    form = setAtPath(form, 'documentInfo.history', description.documentInfo.history);
    this.form = form;
    this.committed = description;
    this.open = null;
    this.publish();
  }

  /** Writes the clean projection of `form` into the document (marks it modified). */
  private commitModel(form: DescriptionForm): void {
    const state = this.store.getState();
    if (!state.document || state.docId !== this.docId) return;
    const cleaned = cleanDescription(form);
    this.committed = cleaned;
    actions.updateDocument(this.store, { ...state.document, description: cleaned });
  }

  /**
   * Applies a new form state. `key` is the edited text field (consecutive edits of the same
   * key are coalesced into one undo entry); `null` records an entry of its own; `false` records
   * nothing (undo/redo replay).
   */
  private apply(next: DescriptionForm, key: FieldKey | null | false): void {
    const previous = this.form;
    if (!previous) return;
    this.form = next;
    if (key !== false && !this.replaying && !this.undo.isReplaying) {
      const time = this.now();
      if (
        key !== null &&
        this.open &&
        this.open.key === key &&
        time - this.open.time < COALESCE_MS
      ) {
        this.open.entry.after = next;
        this.open.time = time;
      } else {
        const entry: HistoryEntry = { before: previous, after: next };
        this.history.push(entry);
        this.future = [];
        this.open = key === null ? null : { entry, key, time };
        this.undo.record(DESCRIPTION_UNDO_VIEW, this.translate('descriptionForm.undoLabel'));
      }
    }
    this.commitModel(next);
    this.publish();
  }

  /** Sets a text field (`titleInfo.bookTitle`, `documentInfo.srcUrls.1`...). */
  setField(key: FieldKey, value: string): void {
    if (!this.form) return;
    if (getAtPath(this.form, key) === value) return;
    this.apply(setAtPath(this.form, key, value), key);
  }

  /**
   * Sets any value at `key` (selects, numbers, rich fields) as its own undo entry, or
   * coalesced with the previous edits of the same key when `coalesce` is set.
   */
  setValue(key: FieldKey, value: unknown, options: { coalesce?: boolean } = {}): void {
    if (!this.form) return;
    if (getAtPath(this.form, key) === value) return;
    this.apply(setAtPath(this.form, key, value), options.coalesce ? key : null);
  }

  /** Structural change (rows added / removed / moved) as one undo entry. */
  update(mutate: (form: DescriptionForm) => DescriptionForm): void {
    if (!this.form) return;
    const next = mutate(this.form);
    if (next === this.form) return;
    this.apply(next, null);
  }

  /** Ends the current edit burst: the next keystroke starts a new undo entry (blur). */
  closeEntry(): void {
    this.open = null;
  }

  /* ----------------------------------------------------------------- undo */

  readonly undoAdapter: ViewHistoryAdapter = (() => {
    const canUndo = () => this.canUndo;
    const canRedo = () => this.canRedo;
    return {
      undo: () => this.undoStep(),
      redo: () => this.redoStep(),
      get canUndo() {
        return canUndo();
      },
      get canRedo() {
        return canRedo();
      },
    };
  })();

  private replay(form: DescriptionForm): void {
    this.replaying = true;
    try {
      this.apply(form, false);
    } finally {
      this.replaying = false;
    }
  }

  undoStep(): boolean {
    this.open = null;
    const entry = this.history.pop();
    if (!entry || !this.form) return false;
    this.future.push(entry);
    this.replay(entry.before);
    return true;
  }

  redoStep(): boolean {
    this.open = null;
    const entry = this.future.pop();
    if (!entry || !this.form) return false;
    this.history.push(entry);
    this.replay(entry.after);
    return true;
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /* --------------------------------------------------------------- inputs */

  /** Registers the DOM input of a text field (search selection, caret); returns the unregister. */
  registerInput(key: FieldKey, input: FormInput): () => void {
    this.inputs.set(key, input);
    return () => {
      if (this.inputs.get(key) === input) this.inputs.delete(key);
    };
  }

  inputOf(key: FieldKey): FormInput | undefined {
    return this.inputs.get(key);
  }

  /** Focuses a text field and selects `[from, to)` of it; false when it is not mounted. */
  focusField(key: FieldKey, from?: number, to?: number): boolean {
    const input = this.inputs.get(key);
    if (!input) return false;
    input.focus();
    if (from !== undefined) {
      const end = to ?? from;
      try {
        input.setSelectionRange(from, end);
      } catch {
        // input types without a selection API
      }
    }
    if (typeof input.scrollIntoView === 'function') {
      input.scrollIntoView({ block: 'nearest' });
    }
    return true;
  }

  /** Key of the focused text field, if any. */
  activeFieldKey(): FieldKey | null {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (!active) return null;
    for (const [key, input] of this.inputs) {
      if (input === active) return key;
    }
    return null;
  }

  /* ---------------------------------------------------------------- caret */

  readonly caretProvider: CaretProvider = {
    get: (): Caret | null => {
      if (!this.form) return null;
      const key = this.activeFieldKey();
      const input = key ? this.inputs.get(key) : undefined;
      return {
        view: 'description',
        nodeId: key ?? undefined,
        offset: input?.selectionStart ?? undefined,
      };
    },
    set: (caret: Caret): boolean => {
      if (!caret.nodeId) return true;
      return this.focusField(caret.nodeId, caret.offset, caret.offset);
    },
  };

  /* --------------------------------------------------------------- search */

  private blocks(): ModelTextblock[] {
    if (!this.form) return [];
    return textFields(this.form).map((field) => ({
      nodeId: field.key,
      text: field.value,
      json: { type: 'field' },
    }));
  }

  private cursor(): SearchCursor {
    const key = this.activeFieldKey();
    const input = key ? this.inputs.get(key) : undefined;
    if (key && input) {
      return { nodeId: key, from: input.selectionStart ?? 0, to: input.selectionEnd ?? 0 };
    }
    if (this.lastMatch) return { ...this.lastMatch };
    return { nodeId: null, from: 0, to: 0 };
  }

  private replacementText(options: FindOptions, replacement: string, match: Match): string {
    return options.regex ? expandReplacement(replacement, match.groups).text : replacement;
  }

  readonly searchTarget: SearchTarget = {
    view: 'description',
    findNext: (options: FindOptions, mode: FindMode = 'next'): FindResult => {
      const re = buildSearchRegExp(options);
      if (!re) return false;
      const cursor = mode === 'fromAnchor' && this.anchor ? this.anchor : this.cursor();
      const start = mode === 'fromAnchor' ? { ...cursor, to: cursor.from } : cursor;
      const match = findMatch(this.blocks(), re, start, options.direction);
      if (!match) return false;
      if (!this.focusField(match.nodeId, match.from, match.to)) return false;
      this.lastMatch = match;
      return match.wrapped ? 'wrapped' : true;
    },
    replaceCurrent: (options: FindOptions, replacement: string): boolean => {
      const match = this.lastMatch;
      const cursor = this.cursor();
      if (
        !match ||
        !this.form ||
        cursor.nodeId !== match.nodeId ||
        cursor.from !== match.from ||
        cursor.to !== match.to
      ) {
        return false;
      }
      const value = getAtPath(this.form, match.nodeId);
      if (typeof value !== 'string') return false;
      const text = this.replacementText(options, replacement, match);
      const next = value.slice(0, match.from) + text + value.slice(match.to);
      this.apply(setAtPath(this.form, match.nodeId, next), null);
      // Update the DOM value now so React's re-render finds it unchanged and keeps the caret.
      const input = this.inputs.get(match.nodeId);
      if (input) input.value = next;
      this.focusField(match.nodeId, match.from, match.from + text.length);
      this.lastMatch = null;
      return true;
    },
    replaceAll: (options: FindOptions, replacement: string): number => {
      const re = buildSearchRegExp(options);
      if (!re || !this.form) return 0;
      let count = 0;
      for (const field of textFields(this.form)) {
        const matches = allMatches(re, field.value);
        if (matches.length === 0) continue;
        let value = field.value;
        for (let i = matches.length - 1; i >= 0; i -= 1) {
          const m = matches[i]!;
          const match: Match = {
            nodeId: field.key,
            from: m.index,
            to: m.index + m[0].length,
            groups: [...m],
          };
          const text = this.replacementText(options, replacement, match);
          value = value.slice(0, match.from) + text + value.slice(match.to);
          count += 1;
        }
        this.apply(setAtPath(this.form, field.key, value), null);
        const input = this.inputs.get(field.key);
        if (input) input.value = value;
      }
      this.lastMatch = null;
      return count;
    },
    selectedText: (): string => {
      const key = this.activeFieldKey();
      const input = key ? this.inputs.get(key) : undefined;
      if (!input) return '';
      return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
    },
    markAnchor: () => {
      this.anchor = this.cursor();
    },
    restoreAnchor: () => {
      if (this.anchor?.nodeId) {
        this.focusField(this.anchor.nodeId, this.anchor.from, this.anchor.to);
      }
    },
    clearAnchor: () => {
      this.anchor = null;
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Adoption rule                                                            */
/* ------------------------------------------------------------------------ */

/**
 * True when `next` is `committed` with nothing but `titleInfo.annotation` and / or
 * `documentInfo.history` replaced - the change of a Body view block (feature 004, US2).
 */
export function differsOnlyInBlocks(committed: Description, next: Description): boolean {
  if (next === committed) return false;
  const sameExcept = <T extends object>(a: T, b: T, except: ReadonlySet<string>): boolean => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (except.has(key)) continue;
      if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) return false;
    }
    return true;
  };
  if (!sameExcept(committed, next, new Set(['titleInfo', 'documentInfo']))) return false;
  if (!sameExcept(committed.titleInfo, next.titleInfo, new Set(['annotation']))) return false;
  if (!sameExcept(committed.documentInfo, next.documentInfo, new Set(['history']))) return false;
  return (
    committed.titleInfo.annotation !== next.titleInfo.annotation ||
    committed.documentInfo.history !== next.documentInfo.history
  );
}

/* ------------------------------------------------------------------------ */
/* Registry                                                                 */
/* ------------------------------------------------------------------------ */

const controllers = new WeakMap<AppStore, DescriptionController>();

/** The Description controller of `store` (created on first use; the registrar creates it). */
export function descriptionControllerFor(
  store: AppStore,
  undo?: UndoCoordinator,
  options: Partial<DescriptionControllerOptions> = {},
): DescriptionController {
  let controller = controllers.get(store);
  if (!controller) {
    if (!undo) throw new Error('descriptionControllerFor: the controller has not been created yet');
    controller = new DescriptionController({ store, undo, ...options });
    controllers.set(store, controller);
  }
  return controller;
}

export function hasDescriptionController(store: AppStore): boolean {
  return controllers.has(store);
}
