/**
 * Live spell checking plugin of the Body editor (T088, FR-071).
 *
 * The plugin keeps a `DecorationSet` of misspelled words (`span.mfbe-misspelled`, red wavy
 * underline) plus the optional "current word" marker of the Spelling dialog
 * (`span.mfbe-spell-current`). Document changes mark the touched text blocks dirty; a debounced
 * (300 ms) pass tokenises the dirty blocks (`features/spell/tokenizer.ts`, text inside `code`
 * marks masked), asks the host to check the words it does not know yet (the host batches the
 * `spell.check` calls and caches per word) and then rebuilds the decorations of those blocks
 * from the cache. Decorations are mapped through every transaction so typing elsewhere does
 * not flicker; a host notification (`invalidate`) re-checks the whole mounted window
 * (languages, "Ignore all", custom dictionary changed), `results` applies verdicts that became
 * known through other callers (the dialog). Highlighting off = decorations are not rendered
 * (the current-word marker still is); the plugin itself is inert without a host (no core).
 *
 * The plugin is editor-agnostic: `features/spell/index.ts` provides the host and installs it
 * into the Body editor state.
 */

import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { tokenizeWords, type WordToken } from '@/features/spell/tokenizer';

export type SpellHostEvent = 'results' | 'invalidate';

export interface SpellPluginHost {
  /** Live highlighting on (settings `view.spellEnabled` && `view.spellHighlight`). */
  highlightEnabled(): boolean;
  /** Synchronous verdict: true misspelled, false correct (or ignored / no dictionary), undefined unknown. */
  lookup(check: string): boolean | undefined;
  /** Fetches the verdicts of normalised words into the cache. */
  check(checks: string[]): Promise<unknown>;
  /** `results`: new verdicts are cached; `invalidate`: everything must be re-checked. */
  subscribe(listener: (event: SpellHostEvent) => void): () => void;
  /** Delay between the last change and the check (default 300 ms). */
  debounceMs?: number;
}

export interface DirtyRange {
  from: number;
  to: number;
}

export interface SpellPluginState {
  decorations: DecorationSet;
  /** Ranges (current document positions) whose text blocks need a check. */
  dirty: DirtyRange[];
}

type SpellMeta =
  | { type: 'recheck' }
  | { type: 'results' }
  | { type: 'current'; from: number; to: number }
  | { type: 'clearCurrent' };

export const spellPluginKey = new PluginKey<SpellPluginState>('mfbe-spellcheck');

export const MISSPELLED_CLASS = 'mfbe-misspelled';
export const CURRENT_WORD_CLASS = 'mfbe-spell-current';
export const DEFAULT_SPELL_DEBOUNCE_MS = 300;

/* ------------------------------------------------------------------------ */
/* Text blocks                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Text of a text block as the tokenizer sees it: inline leaves count as one character
 * (U+FFFC), text inside `code` marks is blanked (not spell-checked).
 */
export function spellText(block: PMNode): string {
  let text = '';
  block.forEach((child) => {
    if (child.isText) {
      const code = child.marks.some((mark) => mark.type.name === 'code');
      text += code ? ' '.repeat(child.text!.length) : child.text!;
    } else {
      text += '\uFFFC';
    }
  });
  return text;
}

export function blockTokens(block: PMNode): WordToken[] {
  return tokenizeWords(spellText(block));
}

/** Text blocks (with their positions) intersecting any of the ranges, each once, in order. */
export function dirtyBlocks(
  doc: PMNode,
  ranges: readonly DirtyRange[],
): { node: PMNode; pos: number }[] {
  const seen = new Set<number>();
  const out: { node: PMNode; pos: number }[] = [];
  const size = doc.content.size;
  for (const range of ranges) {
    const from = Math.max(0, Math.min(size, range.from) - 1);
    const to = Math.min(size, Math.max(range.to, range.from) + 1);
    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isTextblock) return true;
      if (!seen.has(pos)) {
        seen.add(pos);
        out.push({ node, pos });
      }
      return false;
    });
  }
  out.sort((a, b) => a.pos - b.pos);
  return out;
}

function removeKind(decorations: DecorationSet, kind: string, from?: number, to?: number) {
  const found = decorations.find(from, to, (spec) => spec.kind === kind);
  return found.length > 0 ? decorations.remove(found) : decorations;
}

/**
 * Rebuilds the decorations of the dirty text blocks from the host's cache; blocks with words
 * the host does not know yet stay dirty.
 */
export function applyVerdicts(
  doc: PMNode,
  decorations: DecorationSet,
  dirty: readonly DirtyRange[],
  host: Pick<SpellPluginHost, 'lookup'>,
): SpellPluginState {
  let next = decorations;
  const remaining: DirtyRange[] = [];
  for (const { node, pos } of dirtyBlocks(doc, dirty)) {
    const start = pos + 1;
    const end = pos + node.nodeSize - 1;
    next = removeKind(next, 'misspelled', start, end);
    const added: Decoration[] = [];
    let unknown = false;
    for (const token of blockTokens(node)) {
      const verdict = host.lookup(token.check);
      if (verdict === undefined) unknown = true;
      else if (verdict) {
        added.push(
          Decoration.inline(
            start + token.from,
            start + token.to,
            { class: MISSPELLED_CLASS, 'data-word': token.check },
            { kind: 'misspelled', word: token.check },
          ),
        );
      }
    }
    if (added.length > 0) next = next.add(doc, added);
    if (unknown) remaining.push({ from: start, to: end });
  }
  return { decorations: next, dirty: remaining };
}

/* ------------------------------------------------------------------------ */
/* Plugin                                                                   */
/* ------------------------------------------------------------------------ */

function applyTransaction(
  tr: Transaction,
  previous: SpellPluginState,
  newState: EditorState,
  host: SpellPluginHost,
): SpellPluginState {
  let { decorations, dirty } = previous;
  if (tr.docChanged) {
    decorations = decorations.map(tr.mapping, tr.doc);
    dirty = dirty.map((range) => ({
      from: tr.mapping.map(range.from, -1),
      to: tr.mapping.map(range.to, 1),
    }));
    tr.mapping.maps.forEach((stepMap, index) => {
      const rest = tr.mapping.slice(index + 1);
      stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        dirty.push({ from: rest.map(newStart, -1), to: rest.map(newEnd, 1) });
      });
    });
  }
  const meta = tr.getMeta(spellPluginKey) as SpellMeta | undefined;
  if (!meta) return tr.docChanged ? { decorations, dirty } : previous;
  switch (meta.type) {
    case 'recheck':
      return {
        decorations: removeKind(decorations, 'misspelled'),
        dirty: [{ from: 0, to: newState.doc.content.size }],
      };
    case 'results':
      return applyVerdicts(newState.doc, decorations, dirty, host);
    case 'current': {
      const size = newState.doc.content.size;
      const from = Math.max(0, Math.min(meta.from, size));
      const to = Math.max(from, Math.min(meta.to, size));
      const cleared = removeKind(decorations, 'current');
      return {
        decorations:
          to > from
            ? cleared.add(newState.doc, [
                Decoration.inline(from, to, { class: CURRENT_WORD_CLASS }, { kind: 'current' }),
              ])
            : cleared,
        dirty,
      };
    }
    case 'clearCurrent':
      return { decorations: removeKind(decorations, 'current'), dirty };
    default:
      return { decorations, dirty };
  }
}

class SpellViewPlugin {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribe: () => void;
  private destroyed = false;
  private running = false;
  private rerun = false;
  /** Set when a pass made no progress (no core yet): wait for a change instead of polling. */
  private stalled = false;

  constructor(
    private readonly view: EditorView,
    private readonly host: SpellPluginHost,
  ) {
    this.unsubscribe = host.subscribe((event) => {
      if (this.destroyed) return;
      this.stalled = false;
      if (event === 'invalidate') this.dispatchMeta({ type: 'recheck' });
      else this.dispatchMeta({ type: 'results' });
    });
    this.schedule();
  }

  update(view: EditorView, previousState: EditorState): void {
    if (view.state.doc !== previousState.doc) this.stalled = false;
    const state = spellPluginKey.getState(view.state);
    if (state && state.dirty.length > 0 && !this.stalled && this.host.highlightEnabled()) {
      this.schedule();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.unsubscribe();
  }

  private dispatchMeta(meta: SpellMeta): void {
    this.view.dispatch(this.view.state.tr.setMeta(spellPluginKey, meta));
  }

  private schedule(delay = this.host.debounceMs ?? DEFAULT_SPELL_DEBOUNCE_MS): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  private async run(): Promise<void> {
    if (this.destroyed || !this.host.highlightEnabled()) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    const state = spellPluginKey.getState(this.view.state);
    if (!state || state.dirty.length === 0) return;
    const words = new Set<string>();
    for (const { node } of dirtyBlocks(this.view.state.doc, state.dirty)) {
      for (const token of blockTokens(node)) {
        if (this.host.lookup(token.check) === undefined) words.add(token.check);
      }
    }
    this.running = true;
    try {
      if (words.size > 0) await this.host.check([...words]);
      if (this.destroyed) return;
      const unresolved = [...words].filter((word) => this.host.lookup(word) === undefined);
      if (words.size > 0 && unresolved.length === words.size) this.stalled = true;
      this.dispatchMeta({ type: 'results' });
    } catch {
      // Transport problem: try again later.
      if (!this.destroyed) this.schedule(5000);
    } finally {
      this.running = false;
      if (this.rerun && !this.destroyed) {
        this.rerun = false;
        this.schedule(0);
      }
    }
  }
}

/** Creates the plugin; `host` connects it to the checker, the settings and the session. */
export function spellcheckPlugin(host: SpellPluginHost): Plugin<SpellPluginState> {
  return new Plugin<SpellPluginState>({
    key: spellPluginKey,
    state: {
      init: (_config, state) => ({
        decorations: DecorationSet.empty,
        dirty: [{ from: 0, to: state.doc.content.size }],
      }),
      apply: (tr, previous, _old, newState) => applyTransaction(tr, previous, newState, host),
    },
    props: {
      decorations(state) {
        const pluginState = spellPluginKey.getState(state);
        if (!pluginState) return DecorationSet.empty;
        if (host.highlightEnabled()) return pluginState.decorations;
        const current = pluginState.decorations.find(
          undefined,
          undefined,
          (spec) => spec.kind === 'current',
        );
        return current.length > 0 ? DecorationSet.create(state.doc, current) : DecorationSet.empty;
      },
    },
    view: (view) => new SpellViewPlugin(view, host),
  });
}

/** The misspelled-word decorations of a state (tests, context menu). */
export function misspelledDecorations(state: EditorState): Decoration[] {
  const pluginState = spellPluginKey.getState(state);
  if (!pluginState) return [];
  return pluginState.decorations.find(undefined, undefined, (spec) => spec.kind === 'misspelled');
}

/** Transaction helpers for the Spelling dialog's current-word marker. */
export function markCurrentWord(tr: Transaction, from: number, to: number): Transaction {
  return tr.setMeta(spellPluginKey, { type: 'current', from, to } satisfies SpellMeta);
}

export function clearCurrentWord(tr: Transaction): Transaction {
  return tr.setMeta(spellPluginKey, { type: 'clearCurrent' } satisfies SpellMeta);
}

export function requestRecheck(tr: Transaction): Transaction {
  return tr.setMeta(spellPluginKey, { type: 'recheck' } satisfies SpellMeta);
}
