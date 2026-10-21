/**
 * Spelling dialog session (T089, `IDD_SPELL_CHECK`, data-model.md §2.4 / §4.4): walks the text
 * blocks of the document - the description's annotation and history (FR-070), then every body
 * including notes - word by word, stops at each misspelling and applies the dialog actions:
 *
 *  - Ignore: skip this occurrence;  Ignore All: skip the word for the rest of the session;
 *  - Change: replace this occurrence (one Body undo entry; description fields through a model
 *    step of the Body history);  Change All: replace every occurrence in the document as one
 *    undo entry (grouped) and auto-replace later occurrences;
 *  - Add: `spell.addWord` (persistent custom dictionary);
 *  - Undo last: reverts the previous Change / Change All (coordinator undo) or Add
 *    (`spell.removeWord`) and returns to that word;
 *  - the dictionaries in use can be switched (session override, FR-070).
 *
 * Body occurrences are shown in the Body editor (window moved when needed, word selected and
 * marked through the spell plugin) without stealing the dialog's focus. The walk ends with
 * "The spelling check is complete." (`phase: 'complete'`).
 */

import { Transform } from 'prosemirror-transform';

import type { CommandContext } from '@/app/commands';
import { nodeFromModel, type ModelNodeJson } from '@/editor/fromModel';
import { clearCurrentWord, markCurrentWord } from '@/editor/plugins/spellcheck';
import { fb2Schema, findNodeById } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';
import type { BodyEditorController, ModelStep } from '@/views/body/bodyEditor';
import { TextSelection } from 'prosemirror-state';

import { bodyController } from '../editing/common';
import { replaceNodeInDocument } from '../treeOps';

import type { SpellDictionaryInfo } from './checker';
import type { SpellFeature } from './index';
import type { LastSpellAction } from './session';
import { tokenizeWords, type WordToken } from './tokenizer';

export type SpellBlockWhere = 'annotation' | 'history' | 'body';

export interface SpellBlock {
  nodeId: string;
  where: SpellBlockWhere;
  /** Text as the tokenizer sees it (inline leaves U+FFFC, `code` text blanked). */
  text: string;
}

const TEXTBLOCK_TYPES = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th']);

/** Text of a model text block with `code` runs blanked and inline leaves as U+FFFC. */
export function spellTextOf(json: ModelNodeJson): string {
  let text = '';
  for (const child of json.content ?? []) {
    if (child.type === 'text') {
      const value = child.text ?? '';
      const code = child.marks?.some((mark) => mark.type === 'code');
      text += code ? ' '.repeat(value.length) : value;
    } else {
      text += '\uFFFC';
    }
  }
  return text;
}

function collectFrom(json: ModelNodeJson | undefined, where: SpellBlockWhere, out: SpellBlock[]) {
  if (!json) return;
  const visit = (node: ModelNodeJson) => {
    if (TEXTBLOCK_TYPES.has(node.type)) {
      const nodeId = node.attrs?.nodeId;
      if (typeof nodeId === 'string' && nodeId)
        out.push({ nodeId, where, text: spellTextOf(node) });
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(json);
}

/** Every text block to check, in order: annotation, history, then the bodies. */
export function collectSpellBlocks(document: Document): SpellBlock[] {
  const out: SpellBlock[] = [];
  collectFrom(
    document.description.titleInfo.annotation as unknown as ModelNodeJson | undefined,
    'annotation',
    out,
  );
  collectFrom(
    document.description.documentInfo.history as unknown as ModelNodeJson | undefined,
    'history',
    out,
  );
  for (const body of document.bodies) collectFrom(body as unknown as ModelNodeJson, 'body', out);
  return out;
}

/** Finds a text block (description fields or bodies) by nodeId. */
export function findTextblock(document: Document, nodeId: string): ModelNodeJson | null {
  let found: ModelNodeJson | null = null;
  const visit = (node: ModelNodeJson | undefined) => {
    if (!node || found) return;
    if (node.attrs?.nodeId === nodeId) {
      found = node;
      return;
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(document.description.titleInfo.annotation as unknown as ModelNodeJson | undefined);
  visit(document.description.documentInfo.history as unknown as ModelNodeJson | undefined);
  for (const body of document.bodies) visit(body as unknown as ModelNodeJson);
  return found;
}

/** Replaces the text block `nodeId` wherever it lives (annotation, history or a body). */
export function replaceTextblockInDocument(
  document: Document,
  nodeId: string,
  replacement: ModelNodeJson,
): Document {
  const replaceIn = (node: ModelNodeJson | undefined): ModelNodeJson | undefined => {
    if (!node) return node;
    if (node.attrs?.nodeId === nodeId) return replacement;
    if (!node.content) return node;
    let changed = false;
    const content = node.content.map((child) => {
      const next = replaceIn(child)!;
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, content } : node;
  };
  const { titleInfo, documentInfo } = document.description;
  const annotation = replaceIn(titleInfo.annotation as unknown as ModelNodeJson | undefined);
  if (annotation !== (titleInfo.annotation as unknown)) {
    return {
      ...document,
      description: {
        ...document.description,
        titleInfo: {
          ...titleInfo,
          annotation: annotation as unknown as typeof titleInfo.annotation,
        },
      },
    };
  }
  const history = replaceIn(documentInfo.history as unknown as ModelNodeJson | undefined);
  if (history !== (documentInfo.history as unknown)) {
    return {
      ...document,
      description: {
        ...document.description,
        documentInfo: {
          ...documentInfo,
          history: history as unknown as typeof documentInfo.history,
        },
      },
    };
  }
  return replaceNodeInDocument(document, nodeId, replacement);
}

/** `json` with `[from, to)` of its text replaced (marks of the start position kept). */
export function replaceInTextblockJson(
  json: ModelNodeJson,
  from: number,
  to: number,
  replacement: string,
): ModelNodeJson {
  const node = nodeFromModel(json);
  if (!node) return json;
  const transform = new Transform(node);
  const marks = node.resolve(Math.min(from, node.content.size)).marks();
  if (replacement) transform.replaceWith(from, to, fb2Schema.text(replacement, marks));
  else transform.delete(from, to);
  return nodeToModel(transform.doc);
}

/* ------------------------------------------------------------------------ */
/* Controller                                                               */
/* ------------------------------------------------------------------------ */

export type SpellDialogPhase = 'idle' | 'checking' | 'word' | 'complete' | 'unavailable';

export interface SpellDialogState {
  phase: SpellDialogPhase;
  /** The misspelled word as written. */
  word: string;
  check: string;
  suggestions: string[];
  where: SpellBlockWhere | null;
  canUndo: boolean;
  dictionaries: readonly SpellDictionaryInfo[];
  /** Dictionary tags / languages in use. */
  activeLangs: readonly string[];
  /** Language without a dictionary (phase `unavailable`). */
  unavailableLang: string | null;
}

interface Cursor {
  block: number;
  offset: number;
}

interface CurrentWord {
  blockIndex: number;
  block: SpellBlock;
  token: WordToken;
}

export interface SpellDialogControllerOptions {
  ctx: CommandContext;
  feature: SpellFeature;
}

export class SpellDialogController {
  private readonly ctx: CommandContext;
  private readonly feature: SpellFeature;
  private blocks: SpellBlock[] = [];
  private cursor: Cursor = { block: 0, offset: 0 };
  private current: CurrentWord | null = null;
  private generation = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private state: SpellDialogState = {
    phase: 'idle',
    word: '',
    check: '',
    suggestions: [],
    where: null,
    canUndo: false,
    dictionaries: [],
    activeLangs: [],
    unavailableLang: null,
  };

  constructor(options: SpellDialogControllerOptions) {
    this.ctx = options.ctx;
    this.feature = options.feature;
    this.feature.attachRpc(options.ctx.rpc);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): SpellDialogState => this.state;

  private setState(patch: Partial<SpellDialogState>): void {
    this.state = { ...this.state, ...patch, canUndo: this.feature.session.lastAction !== null };
    for (const listener of [...this.listeners]) listener();
  }

  private get controller(): BodyEditorController | null {
    return bodyController(this.ctx.store);
  }

  private get document(): Document | null {
    return this.ctx.store.getState().document;
  }

  /* ----------------------------------------------------------------- walk */

  /** Starts (or restarts) the walk from the beginning of the document. */
  async start(): Promise<void> {
    const document = this.document;
    if (!document) return;
    this.feature.session.lastAction = null;
    this.blocks = collectSpellBlocks(document);
    this.cursor = { block: 0, offset: 0 };
    const dictionaries = await this.feature.checker.loadDictionaries();
    if (this.disposed) return;
    this.setState({ dictionaries, activeLangs: this.feature.checker.activeLangs() });
    await this.next();
  }

  /** Continues from the cursor to the next misspelled word. */
  private async next(): Promise<void> {
    const generation = (this.generation += 1);
    const { checker, session } = this.feature;
    this.current = null;
    this.setState({ phase: 'checking', activeLangs: checker.activeLangs() });
    if (checker.activeLangs().length === 0) {
      this.setState({ phase: 'unavailable', unavailableLang: checker.documentLanguage() || '?' });
      return;
    }
    for (let i = this.cursor.block; i < this.blocks.length; i += 1) {
      const block = this.blocks[i]!;
      const minOffset = i === this.cursor.block ? this.cursor.offset : 0;
      const tokens = tokenizeWords(block.text).filter((token) => token.from >= minOffset);
      if (tokens.length === 0) continue;
      const unknown = checker.unknown(tokens.map((token) => token.check));
      if (unknown.length > 0) {
        try {
          await checker.check(unknown);
        } catch {
          // transport problem: treat the block as clean for now
        }
        if (this.disposed || generation !== this.generation) return;
        if (checker.isUnavailable()) {
          this.setState({
            phase: 'unavailable',
            unavailableLang: checker.activeLangs().join(', '),
          });
          return;
        }
      }
      for (const token of tokens) {
        if (checker.lookup(token.check) !== true) continue;
        const auto = session.replacementFor(token.check);
        if (auto !== undefined && auto !== token.text) {
          // Change All earlier in the session: replace silently and go on from there.
          this.replaceOccurrence(i, token, auto);
          this.cursor = { block: i, offset: token.from + auto.length };
          return this.next();
        }
        this.current = { blockIndex: i, block, token };
        this.cursor = { block: i, offset: token.from };
        this.showCurrent();
        this.setState({
          phase: 'word',
          word: token.text,
          check: token.check,
          where: block.where,
          suggestions: [],
        });
        const suggestions = await checker.suggest(token.check, 10);
        if (this.disposed || generation !== this.generation) return;
        this.setState({ suggestions });
        return;
      }
    }
    this.clearMarker();
    this.setState({ phase: 'complete', word: '', check: '', suggestions: [], where: null });
  }

  private advancePastCurrent(): void {
    if (!this.current) return;
    this.cursor = { block: this.current.blockIndex, offset: this.current.token.to };
  }

  /* -------------------------------------------------------------- display */

  /**
   * Shows the current word in the Body editor (window moved when needed) without focusing it -
   * the annotation and history blocks included, which the Body view shows above the bodies
   * (feature 004, FR-014; the "In:" text keeps naming the element).
   */
  private showCurrent(): void {
    const current = this.current;
    const controller = this.controller;
    if (!current || !controller) return;
    if (!controller.moveWindowTo(current.block.nodeId)) return;
    const state = controller.editorState;
    if (!state) return;
    const found = findNodeById(state.doc, current.block.nodeId);
    if (!found) return;
    const from = found.pos + 1 + current.token.from;
    const to = found.pos + 1 + current.token.to;
    const tr = markCurrentWord(state.tr, from, to)
      .setSelection(TextSelection.create(state.doc, from, to))
      .scrollIntoView();
    controller.apply(tr);
  }

  private clearMarker(): void {
    const controller = this.controller;
    const state = controller?.editorState;
    if (controller && state) controller.apply(clearCurrentWord(state.tr));
  }

  /* -------------------------------------------------------------- actions */

  async ignore(): Promise<void> {
    if (!this.current) return;
    this.advancePastCurrent();
    await this.next();
  }

  async ignoreAll(): Promise<void> {
    if (!this.current) return;
    this.feature.session.ignoreAll(this.current.token.check);
    this.advancePastCurrent();
    await this.next();
  }

  async change(replacement: string): Promise<void> {
    const current = this.current;
    if (!current || !replacement || replacement === current.token.text) {
      await this.ignore();
      return;
    }
    const { blockIndex, token } = current;
    this.replaceOccurrence(blockIndex, token, replacement, this.ctx.t('spell.undo.replaceWord'));
    this.feature.session.lastAction = {
      kind: 'change',
      word: token.check,
      replacement,
      blockId: current.block.nodeId,
      offset: token.from,
    };
    this.cursor = { block: blockIndex, offset: token.from + replacement.length };
    await this.next();
  }

  async changeAll(replacement: string): Promise<void> {
    const current = this.current;
    if (!current || !replacement || replacement === current.token.text) {
      await this.ignore();
      return;
    }
    const { token } = current;
    const label = this.ctx.t('spell.undo.replaceAll');
    const { undo } = this.ctx;
    undo.beginGroup(label);
    let count: number;
    try {
      count = this.replaceEverywhere(token.check, replacement, label);
    } finally {
      undo.endGroup();
    }
    this.feature.session.changeAll(token.check, replacement);
    this.feature.session.lastAction = {
      kind: 'changeAll',
      word: token.check,
      replacement,
      blockId: current.block.nodeId,
      offset: token.from,
    };
    actions.setStatusMessage(this.ctx.store, this.ctx.t('spell.status.replacedAll', { count }));
    this.cursor = { block: current.blockIndex, offset: token.from + replacement.length };
    await this.next();
  }

  async add(): Promise<void> {
    const current = this.current;
    if (!current) return;
    const { token } = current;
    try {
      await this.feature.checker.addWord(token.check);
      this.feature.session.lastAction = {
        kind: 'add',
        word: token.check,
        blockId: current.block.nodeId,
        offset: token.from,
      };
      actions.setStatusMessage(
        this.ctx.store,
        this.ctx.t('spell.status.wordAdded', { word: token.check }),
      );
    } catch {
      // the core refused the word (invalid); keep walking
    }
    if (this.disposed) return;
    this.advancePastCurrent();
    await this.next();
  }

  /** Reverts the last Change / Change All / Add and returns to that word. */
  async undoLast(): Promise<void> {
    const action: LastSpellAction | null = this.feature.session.lastAction;
    if (!action) return;
    this.feature.session.lastAction = null;
    if (action.kind === 'add') {
      try {
        await this.feature.checker.removeWord(action.word);
        actions.setStatusMessage(
          this.ctx.store,
          this.ctx.t('spell.status.wordRemoved', { word: action.word }),
        );
      } catch {
        // nothing to revert
      }
    } else {
      this.ctx.undo.undo();
      if (action.kind === 'changeAll') this.feature.session.forgetChangeAll(action.word);
      this.feature.checker.forget(action.word);
    }
    if (this.disposed) return;
    const document = this.document;
    if (document) this.blocks = collectSpellBlocks(document);
    const index = this.blocks.findIndex((block) => block.nodeId === action.blockId);
    this.cursor = index >= 0 ? { block: index, offset: action.offset } : { block: 0, offset: 0 };
    await this.next();
  }

  /** Switches the dictionaries in use (session override) and re-checks from the current word. */
  async setLanguages(langs: readonly string[]): Promise<void> {
    const documentLangs = [this.feature.checker.documentLanguage()].filter(Boolean);
    const sameAsDocument =
      langs.length === documentLangs.length && langs.every((lang, i) => lang === documentLangs[i]);
    this.feature.session.setLanguageOverride(sameAsDocument ? null : langs);
    if (this.current)
      this.cursor = { block: this.current.blockIndex, offset: this.current.token.from };
    await this.next();
  }

  /** Ends the session (clears the Body marker). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.clearMarker();
  }

  /* --------------------------------------------------------- replacement */

  /** Replaces one occurrence (Body: one transaction; description: one model step). */
  private replaceOccurrence(
    blockIndex: number,
    token: WordToken,
    replacement: string,
    label?: string,
    mountedOnly = false,
  ): void {
    const block = this.blocks[blockIndex];
    if (!block) return;
    const controller = this.controller;
    const document = this.document;
    if (!document) return;
    // A block paragraph of the Body view (bodies, annotation, history alike) changes through
    // an editor transaction; the controller writes a description block back into the model.
    const mounted =
      !!controller &&
      (mountedOnly
        ? !!controller.editorState &&
          findNodeById(controller.editorState.doc, block.nodeId) !== null
        : controller.moveWindowTo(block.nodeId));
    if (mounted && controller) {
      const state = controller.editorState!;
      const found = findNodeById(state.doc, block.nodeId);
      if (found) {
        const from = found.pos + 1 + token.from;
        const to = found.pos + 1 + token.to;
        const marks = state.doc.resolve(from).marks();
        const tr = clearCurrentWord(state.tr);
        if (replacement) tr.replaceWith(from, to, fb2Schema.text(replacement, marks));
        else tr.delete(from, to);
        controller.apply(tr);
        this.blocks[blockIndex] = {
          ...block,
          text: block.text.slice(0, token.from) + replacement + block.text.slice(token.to),
        };
        return;
      }
    }
    const json = findTextblock(document, block.nodeId);
    if (!json) return;
    const after = replaceInTextblockJson(json, token.from, token.to, replacement);
    const step: ModelStep = {
      apply: (model) => replaceTextblockInDocument(model, block.nodeId, after),
      revert: (model) => replaceTextblockInDocument(model, block.nodeId, json),
    };
    if (controller) controller.applyModelStep(step, label);
    else actions.updateDocument(this.ctx.store, step.apply(document));
    this.blocks[blockIndex] = {
      ...block,
      text: block.text.slice(0, token.from) + replacement + block.text.slice(token.to),
    };
  }

  /** Replaces every occurrence of `check` (whole words) in all blocks; returns the count. */
  private replaceEverywhere(check: string, replacement: string, label: string): number {
    let count = 0;
    for (let i = this.blocks.length - 1; i >= 0; i -= 1) {
      const block = this.blocks[i]!;
      const matches = tokenizeWords(block.text).filter((token) => token.check === check);
      for (let m = matches.length - 1; m >= 0; m -= 1) {
        // Unmounted blocks go through model steps (no window moves for every occurrence).
        this.replaceOccurrence(i, matches[m]!, replacement, label, true);
        count += 1;
      }
    }
    return count;
  }
}
