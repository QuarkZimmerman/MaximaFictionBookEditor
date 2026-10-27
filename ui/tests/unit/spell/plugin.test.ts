/**
 * T088 - the live spell checking plugin with a mocked host: dirty tracking, debounced batched
 * checks, decorations (`span.mfbe-misspelled`) only for misspelled words, `code` text skipped,
 * mapping through edits, re-check on `invalidate`, the current-word marker, and the checker's
 * batching / cache / 1020 handling with a fake RPC client.
 */

import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

import {
  applyVerdicts,
  clearCurrentWord,
  markCurrentWord,
  MISSPELLED_CLASS,
  misspelledDecorations,
  spellcheckPlugin,
  spellPluginKey,
  spellText,
  type SpellHostEvent,
  type SpellPluginHost,
} from '@/editor/plugins/spellcheck';
import { fb2Schema } from '@/editor/schema';
import { BATCH_SIZE, resolveDictionaryTag, SpellChecker } from '@/features/spell/checker';
import { SpellSession } from '@/features/spell/session';
import { createAppStore } from '@/model/store';
import { RpcError } from '@/rpc/client';

import { fakeDocument, fakeRpc } from '../features/testUtils';

const { nodes: N } = fb2Schema;

function paragraph(text: string, marks: { from: number; to: number }[] = []) {
  if (marks.length === 0) return N.p!.create({ nodeId: 'p1' }, fb2Schema.text(text));
  const parts = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.from > at) parts.push(fb2Schema.text(text.slice(at, mark.from)));
    parts.push(fb2Schema.text(text.slice(mark.from, mark.to), [fb2Schema.marks.code!.create()]));
    at = mark.to;
  }
  if (at < text.length) parts.push(fb2Schema.text(text.slice(at)));
  return N.p!.create({ nodeId: 'p1' }, parts);
}

function docWith(...paragraphs: ReturnType<typeof paragraph>[]) {
  return N.doc!.create(null, [
    N.body!.create({ nodeId: 'b1' }, [N.section!.create({ nodeId: 's1' }, paragraphs)]),
  ]);
}

/**
 * A host whose dictionary is the set of `known` words; everything else is misspelled. With
 * `gate`, every check answers only once that promise has settled.
 */
function mockHost(
  known: string[],
  options: { highlight?: boolean; delayMs?: number; gate?: Promise<void> } = {},
) {
  const cache = new Map<string, boolean>();
  const listeners = new Set<(event: SpellHostEvent) => void>();
  const calls: string[][] = [];
  let highlight = options.highlight ?? true;
  const host: SpellPluginHost & {
    calls: string[][];
    emit(event: SpellHostEvent): void;
    setHighlight(value: boolean): void;
    learn(word: string): void;
  } = {
    highlightEnabled: () => highlight,
    lookup: (check) => cache.get(check),
    check: async (checks) => {
      calls.push([...checks]);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      if (options.gate) await options.gate;
      for (const check of checks) cache.set(check, !known.includes(check));
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    debounceMs: 10,
    calls,
    emit: (event) => {
      for (const listener of [...listeners]) listener(event);
    },
    setHighlight: (value) => {
      highlight = value;
    },
    learn: (word) => {
      known.push(word);
      cache.set(word, false);
    },
  };
  return host;
}

function mount(doc: ReturnType<typeof docWith>, host: SpellPluginHost) {
  const state = EditorState.create({ doc, plugins: [spellcheckPlugin(host)] });
  const place = document.createElement('div');
  document.body.appendChild(place);
  const view = new EditorView(place, { state });
  return {
    view,
    words: () =>
      misspelledDecorations(view.state).map((d) => view.state.doc.textBetween(d.from, d.to)),
    destroy: () => {
      view.destroy();
      place.remove();
    },
  };
}

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('spellcheck plugin', () => {
  it('marks only the misspelled words after the debounce and renders the decoration class', async () => {
    const host = mockHost(['Привет', 'мир', 'hello']);
    const { view, words, destroy } = mount(
      docWith(paragraph('Привет мир, превет helo hello')),
      host,
    );
    expect(words()).toEqual([]);
    await tick();
    expect(host.calls).toEqual([['Привет', 'мир', 'превет', 'helo', 'hello']]);
    expect(words()).toEqual(['превет', 'helo']);
    expect(view.dom.querySelectorAll(`.${MISSPELLED_CLASS}`)).toHaveLength(2);
    expect(view.dom.querySelector(`.${MISSPELLED_CLASS}`)?.getAttribute('data-word')).toBe(
      'превет',
    );
    destroy();
  });

  it('skips text inside code marks and maps decorations through edits', async () => {
    const host = mockHost(['Привет', 'мир']);
    const text = 'Привет xyzzy мир';
    const { view, words, destroy } = mount(docWith(paragraph(text, [{ from: 7, to: 12 }])), host);
    await tick();
    expect(words()).toEqual([]); // "xyzzy" is code
    // Typing before the paragraph text shifts the existing decorations and re-checks the block.
    view.dispatch(view.state.tr.insertText('ошыбка ', 3));
    await tick();
    expect(words()).toEqual(['ошыбка']);
    const decoration = misspelledDecorations(view.state)[0]!;
    expect(view.state.doc.textBetween(decoration.from, decoration.to)).toBe('ошыбка');
    expect(host.calls.length).toBe(2);
    expect(host.calls[1]).toEqual(['ошыбка']); // cached words are not asked again
    destroy();
  });

  it('re-checks everything on invalidate and only applies cached verdicts on results', async () => {
    const host = mockHost(['Привет']);
    const { words, destroy } = mount(docWith(paragraph('Привет превет')), host);
    await tick();
    expect(words()).toEqual(['превет']);
    host.learn('превет'); // added to the dictionary
    host.emit('invalidate');
    await tick();
    expect(words()).toEqual([]);
    destroy();
  });

  it('does not render decorations while highlighting is off but keeps the current-word marker', async () => {
    const host = mockHost(['Привет'], { highlight: false });
    const { view, words, destroy } = mount(docWith(paragraph('Привет превет')), host);
    await tick();
    expect(host.calls).toEqual([]); // nothing is checked while highlighting is off
    expect(words()).toEqual([]);
    view.dispatch(markCurrentWord(view.state.tr, 10, 16));
    expect(view.dom.querySelectorAll('.mfbe-spell-current')).toHaveLength(1);
    view.dispatch(clearCurrentWord(view.state.tr));
    expect(view.dom.querySelectorAll('.mfbe-spell-current')).toHaveLength(0);
    host.setHighlight(true);
    host.emit('invalidate');
    await tick();
    expect(words()).toEqual(['превет']);
    destroy();
  });

  it('keeps a click whose selectionchange has not arrived when the verdicts come in between', async () => {
    // The browser moves its selection on a press and reports it by a `selectionchange` event,
    // a task of its own - after other tasks on a loaded machine. Verdicts arriving in between
    // were drawn on the selection from before the click, which ProseMirror wrote back into the
    // page: the first click after a book opened left the caret at the document start.
    let answer!: () => void;
    const gate = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const host = mockHost(['Hello', 'World'], { gate });
    const { view, words, destroy } = mount(
      docWith(paragraph('Hello helo'), paragraph('World')),
      host,
    );
    view.focus();
    await tick();
    expect(host.calls).toEqual([['Hello', 'helo', 'World']]); // the pass waits for its answer
    expect(view.state.selection.head).toBe(3); // the caret at the document start

    // The click into "World" (after "Wor"); its selectionchange is queued as a task.
    const world = view.dom.querySelectorAll('p')[1]!.firstChild!;
    document.getSelection()!.collapse(world, 3);
    let worldAt = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === 'World') worldAt = pos + 1;
    });

    // The answer arrives first: the decorations are drawn before that task runs.
    answer();
    for (let i = 0; i < 50 && words().length === 0; i += 1) await Promise.resolve();
    expect(words()).toEqual(['helo']);
    expect(view.state.selection.head).toBe(worldAt + 3);
    expect(document.getSelection()!.focusNode).toBe(world);
    expect(document.getSelection()!.focusOffset).toBe(3);

    await tick(); // the selectionchange task: the click stays
    expect(view.state.selection.head).toBe(worldAt + 3);
    destroy();
  });

  it('applyVerdicts keeps blocks with unknown words dirty', () => {
    const doc = docWith(paragraph('один два'));
    const state = EditorState.create({ doc, plugins: [spellcheckPlugin(mockHost([]))] });
    const initial = spellPluginKey.getState(state)!;
    const partial = applyVerdicts(doc, initial.decorations, initial.dirty, {
      lookup: (check) => (check === 'один' ? true : undefined),
    });
    expect(partial.dirty).toHaveLength(1);
    expect(partial.decorations.find()).toHaveLength(1);
    const complete = applyVerdicts(doc, partial.decorations, partial.dirty, {
      lookup: () => false,
    });
    expect(complete.dirty).toEqual([]);
    expect(complete.decorations.find()).toHaveLength(0);
    expect(spellText(paragraph('a b', [{ from: 0, to: 1 }]))).toBe('  b');
  });
});

describe('SpellChecker', () => {
  function checker(responses: Record<string, unknown>, lang = 'ru') {
    const store = createAppStore();
    const doc = fakeDocument();
    doc.description.titleInfo.lang = lang;
    store.setState({ document: doc, docId: doc.docId, connection: 'connected' });
    const rpc = fakeRpc({
      'spell.dictionaries': [
        { tag: 'en_US', lang: 'en', name: 'en_US', source: 'bundled' },
        { tag: 'ru_RU', lang: 'ru', name: 'ru_RU', source: 'bundled' },
      ],
      ...responses,
    });
    const session = new SpellSession();
    const unavailable: string[] = [];
    const instance = new SpellChecker({
      store,
      session,
      getRpc: () => rpc.client,
      onUnavailable: (l) => unavailable.push(l),
    });
    return { checker: instance, rpc, session, unavailable, store };
  }

  it('batches spell.check calls, caches verdicts and honours Ignore All', async () => {
    const words = Array.from({ length: BATCH_SIZE + 5 }, (_, i) => `w${i}`);
    const {
      checker: c,
      rpc,
      session,
    } = checker({
      'spell.check': (params: unknown) => {
        const { words: batch } = params as { words: string[] };
        return { misspelled: batch.filter((w) => w.endsWith('1')), langs: ['ru_RU'] };
      },
    });
    const bad = await c.check(words);
    const checks = rpc.calls.filter((call) => call.method === 'spell.check');
    expect(checks).toHaveLength(2);
    expect((checks[0]!.params as { words: string[] }).words).toHaveLength(BATCH_SIZE);
    expect((checks[0]!.params as { langs: string[] }).langs).toEqual(['ru']);
    expect(bad.has('w1')).toBe(true);
    expect(bad.has('w2')).toBe(false);
    expect(c.lookup('w11')).toBe(true);
    expect(c.lookup('w12')).toBe(false);
    expect(c.lookup('unknown')).toBeUndefined();
    // Cached: no further call.
    await c.check(['w1', 'w2']);
    expect(rpc.calls.filter((call) => call.method === 'spell.check')).toHaveLength(2);
    session.ignoreAll('w1');
    expect(c.lookup('w1')).toBe(false);
    expect((await c.check(['w1'])).size).toBe(0);
  });

  it('resolves document languages to dictionary tags once the list is known', async () => {
    const { checker: c } = checker({ 'spell.check': { misspelled: [] } });
    expect(c.activeLangs()).toEqual(['ru']);
    await c.loadDictionaries();
    expect(c.activeLangs()).toEqual(['ru_RU']);
    c.session.setLanguageOverride(['en_US', 'ru_RU']);
    expect(c.activeLangs()).toEqual(['en_US', 'ru_RU']);
    expect(resolveDictionaryTag('ru-RU', c.dictionaries!)).toBe('ru_RU');
    expect(resolveDictionaryTag('en', c.dictionaries!)).toBe('en_US');
    expect(resolveDictionaryTag('de', c.dictionaries!)).toBeNull();
  });

  it('reports a missing dictionary (1020) once and treats words as correct afterwards', async () => {
    const {
      checker: c,
      unavailable,
      rpc,
    } = checker(
      {
        'spell.check': new RpcError(1020, 'spell.dictionaryUnavailable', { lang: 'de' }),
      },
      'de',
    );
    expect(await c.check(['wort'])).toEqual(new Set());
    expect(unavailable).toEqual(['de']);
    expect(c.isUnavailable()).toBe(true);
    expect(c.lookup('wort')).toBe(false);
    await c.check(['anderes']);
    expect(rpc.calls.filter((call) => call.method === 'spell.check')).toHaveLength(1);
    expect(unavailable).toHaveLength(1);
  });

  it('adds and removes custom words and updates the cache', async () => {
    const { checker: c, rpc } = checker({
      'spell.check': { misspelled: ['превет'] },
      'spell.addWord': { added: true, words: ['превет'] },
      'spell.removeWord': { removed: true, words: [] },
      'spell.suggest': { suggestions: ['привет', 'привед'] },
    });
    await c.check(['превет']);
    expect(c.lookup('превет')).toBe(true);
    expect(await c.suggest('превет')).toEqual(['привет', 'привед']);
    expect(c.cachedSuggestions('превет')).toEqual(['привет', 'привед']);
    await c.addWord('превет');
    expect(rpc.calls.find((call) => call.method === 'spell.addWord')?.params).toEqual({
      word: 'превет',
    });
    expect(c.lookup('превет')).toBe(false);
    await c.removeWord('превет');
    expect(c.lookup('превет')).toBeUndefined();
  });
});
