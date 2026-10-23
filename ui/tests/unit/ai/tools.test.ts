// @vitest-environment node
/**
 * The tools mapping and the regex budget (feature 005 T041; ai-catalogue §1.5, §3.1 `find`,
 * review C15; data-model §8.3): `toOpenAiTools()` strips `$schema` and nothing else, the chat
 * request carries `tool_choice: 'auto'` with the tools and no `tools` member at all for an
 * entry with `tools: false`; a catastrophic pattern is stopped by the worker budget and
 * answered as `invalidArguments` "the pattern took too long". US4 adds `get_schema` here.
 */

import { chatToolsMembers, toOpenAiTools, type ModelSelection } from '@/ai/catalogue';
import {
  createRegexRunner,
  REGEX_BUDGET_MS,
  runRegexSearch,
  type RegexSearchRequest,
  type RegexWorkerLike,
} from '@/ai/regexRunner';
import {
  SOURCE_TEXT_MODE_TOOL_NAMES,
  sourceToolGate,
  TEXT_CHANGED_HINT,
  TEXT_MODE_HINT,
} from '@/ai/source';

import { harness } from './catalogueHarness';

describe('toOpenAiTools', () => {
  it('maps every tool to {type: function, function: {name, description, parameters}} without $schema', () => {
    const tools = toOpenAiTools([
      {
        name: 'read_part',
        description: 'Reads a part.',
        inputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            node: { type: 'string' },
            depth: { type: 'integer', minimum: 1, maximum: 100 },
          },
          required: ['node'],
        },
      },
      { name: 'get_context', inputSchema: { type: 'object', properties: {} } },
    ]);
    expect(tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read_part',
          description: 'Reads a part.',
          parameters: {
            type: 'object',
            properties: {
              node: { type: 'string' },
              depth: { type: 'integer', minimum: 1, maximum: 100 },
            },
            required: ['node'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_context',
          description: '',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
    // Non-strict mode: nothing injected (no strict, no additionalProperties).
    expect(tools[0]!.function).not.toHaveProperty('strict');
    expect(tools[0]!.function.parameters).not.toHaveProperty('additionalProperties');
  });

  it('is what the catalogue instance offers, built once', async () => {
    const h = await harness();
    try {
      const tools = h.catalogue.tools();
      expect(tools.map((t) => t.function.name)).toEqual(h.catalogue.listed().map((t) => t.name));
      expect(tools.every((t) => !('$schema' in t.function.parameters))).toBe(true);
      expect(h.catalogue.tools()).toBe(tools);
    } finally {
      await h.catalogue.close();
    }
  });
});

describe('chatToolsMembers', () => {
  const tools = toOpenAiTools([{ name: 'find', inputSchema: { type: 'object', properties: {} } }]);

  it('offers the tools with tool_choice auto', () => {
    const members = chatToolsMembers(tools, true);
    expect(members).toEqual({ tools, tool_choice: 'auto' });
    expect((members as { tools: unknown[] }).tools).not.toBe(tools);
  });

  it('sends no tools member at all for an entry with tools: false (never tools: [])', () => {
    expect(chatToolsMembers(tools, false)).toEqual({});
    expect(Object.keys(chatToolsMembers(tools, false))).toEqual([]);
    expect(chatToolsMembers([], true)).toEqual({});
  });
});

describe('the Source view gate through the catalogue (US5, ai-catalogue §8)', () => {
  const sourceSelection: ModelSelection = { kind: 'source', from: 10, to: 20, text: '<p>x</p>' };

  it('Source text mode: the tools array holds the six, every other tool answers unavailable without running or striking', async () => {
    const state = { wellFormed: false, structuredAllowed: true };
    const h = await harness({
      gate: sourceToolGate(() => state),
      replaceSourceText: (xml) => Promise.resolve({ from: 10, to: 10 + xml.length }),
    });
    try {
      h.setSelection(sourceSelection);
      const offered = h.catalogue
        .tools()
        .filter((tool) =>
          (SOURCE_TEXT_MODE_TOOL_NAMES as readonly string[]).includes(tool.function.name),
        )
        .map((tool) => tool.function.name);
      // The six of §8.4, `read_resource` (US6) among them, in the catalogue's order.
      expect(offered).toEqual([
        'get_context',
        'get_selection',
        'validate',
        'get_schema',
        'read_resource',
        'replace_selection',
      ]);
      expect(
        chatToolsMembers(
          h.catalogue.tools().filter((t) => offered.includes(t.function.name)),
          true,
        ),
      ).toMatchObject({
        tool_choice: 'auto',
      });
      const before = JSON.stringify(h.copy.document);
      for (const name of [
        'get_outline',
        'read_part',
        'find',
        'list_scripts',
        'read_script',
        'set_selection',
        'replace_node',
        'insert_node',
        'remove_node',
        'set_text',
        'replace_all',
        'set_description',
        'run_script',
        'propose_script',
        'reload_scripts',
      ]) {
        const out = await h.catalogue.call(name, {
          node: 'n13',
          id: 'x',
          text: 'x',
          replacement: 'y',
          where: 'after',
          content: { xml: '<p>x</p>' },
        });
        expect(out.isError, name).toBe(true);
        expect(out.error?.code, name).toBe('unavailable');
        expect(out.error?.hint, name).toBe(TEXT_MODE_HINT);
      }
      expect(h.hookCalls).toEqual([]);
      expect(JSON.stringify(h.copy.document)).toBe(before);
      // The six work: get_selection reports the text selection, replace_selection splices.
      const selection = await h.catalogue.call('get_selection', {});
      expect(selection.result).toMatchObject({ kind: 'source', xml: '<p>x</p>' });
      const replaced = await h.catalogue.call('replace_selection', {
        content: { xml: '<p>y</p>' },
      });
      expect(replaced.isError).toBe(false);
      expect(h.hookCalls).toEqual(['replace_selection:selection']);
      expect(h.selection()).toEqual({ kind: 'source', from: 10, to: 18, text: '<p>y</p>' });
    } finally {
      await h.catalogue.close();
    }
  });

  it('after a text-path change the structured change tools answer unavailable, the read tools and the text replacement go on', async () => {
    const state = { wellFormed: true, structuredAllowed: true };
    const h = await harness({
      gate: sourceToolGate(() => state),
      replaceSourceText: (xml) => Promise.resolve({ from: 10, to: 10 + xml.length }),
    });
    try {
      h.setSelection(sourceSelection);
      // Before the text change the structured tools work.
      const structured = await h.catalogue.call('set_text', { node: 'n13', text: 'Changed.' });
      expect(structured.isError).toBe(false);
      // The text change (the request loop flips the flag when the hook accepts it).
      const replaced = await h.catalogue.call('replace_selection', {
        content: { xml: '<p>y</p>' },
      });
      expect(replaced.isError).toBe(false);
      state.structuredAllowed = false;
      const hookCallsBefore = h.hookCalls.length;
      for (const name of [
        'replace_node',
        'insert_node',
        'remove_node',
        'set_text',
        'replace_all',
        'set_description',
        'run_script',
      ]) {
        const out = await h.catalogue.call(name, {
          node: 'n13',
          id: '18/remove-spaces',
          text: 'x',
          replacement: 'y',
          where: 'after',
          content: { xml: '<p>x</p>' },
        });
        expect(out.error?.code, name).toBe('unavailable');
        expect(out.error?.hint, name).toBe(TEXT_CHANGED_HINT);
      }
      expect(h.hookCalls).toHaveLength(hookCallsBefore);
      for (const name of [
        'get_context',
        'get_outline',
        'read_part',
        'get_selection',
        'find',
        'validate',
        'get_schema',
      ]) {
        const out = await h.catalogue.call(name, { node: 'n13', text: 'beta', element: 'section' });
        // (`validate` and `get_schema` answer their own `unavailable` in this bare harness.)
        expect(out.error?.hint, name).not.toBe(TEXT_CHANGED_HINT);
      }
      // Another text replacement of the selection is still allowed ...
      const again = await h.catalogue.call('replace_selection', { content: { xml: '<p>z</p>' } });
      expect(again.isError).toBe(false);
      // ... but not a structured one once the selection is a model selection.
      h.setSelection({
        kind: 'inline',
        anchor: { nodeId: 'n13', offset: 0 },
        head: { nodeId: 'n13', offset: 3 },
      });
      const inline = await h.catalogue.call('replace_selection', { content: { text: 'x' } });
      expect(inline.error?.code).toBe('unavailable');
      expect(inline.error?.hint).toBe(TEXT_CHANGED_HINT);
    } finally {
      await h.catalogue.close();
    }
  });
});

/** A worker double: runs the search in the test's own thread, or never answers. */
class FakeWorker implements RegexWorkerLike {
  static created = 0;
  static terminated = 0;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(private readonly hang: (request: RegexSearchRequest) => boolean) {
    FakeWorker.created += 1;
  }
  postMessage(message: unknown): void {
    const request = message as RegexSearchRequest;
    if (this.hang(request)) return;
    const result = runRegexSearch(request);
    queueMicrotask(() => this.onmessage?.({ data: result }));
  }
  terminate(): void {
    FakeWorker.terminated += 1;
  }
}

describe('the regex worker budget (C15)', () => {
  beforeEach(() => {
    FakeWorker.created = 0;
    FakeWorker.terminated = 0;
  });

  it('runs a model-supplied expression in the worker and literal searches in place', async () => {
    const runner = createRegexRunner(() => new FakeWorker(() => false));
    const literal = await runner({
      query: 'b.t',
      regex: false,
      matchCase: false,
      wholeWord: false,
      texts: ['a b.t c'],
    });
    expect(literal).toMatchObject({
      ok: true,
      matches: [{ block: 0, from: 2, to: 5, text: 'b.t' }],
    });
    expect(FakeWorker.created).toBe(0);
    const regex = await runner({
      query: '(b)\\w+',
      regex: true,
      matchCase: true,
      wholeWord: false,
      texts: ['beta Beta', 'bo'],
    });
    expect(regex).toMatchObject({
      ok: true,
      matches: [
        { block: 0, from: 0, to: 4, text: 'beta', groups: ['b'] },
        { block: 1, text: 'bo' },
      ],
    });
    expect(FakeWorker.created).toBe(1);
    await runner({ query: 'x', regex: true, matchCase: true, wholeWord: false, texts: [] });
    expect(FakeWorker.created).toBe(1); // reused
    const invalid = await runner({
      query: '(',
      regex: true,
      matchCase: false,
      wholeWord: false,
      texts: ['a'],
    });
    expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('terminates a worker that exceeds the budget, reports the time-out and recreates the worker', async () => {
    const budgetMs = 60;
    const runner = createRegexRunner(
      () => new FakeWorker((r) => r.query.includes('(a+)+')),
      budgetMs,
    );
    const started = Date.now();
    const result = await runner({
      query: '(a+)+$',
      regex: true,
      matchCase: false,
      wholeWord: false,
      texts: ['a'.repeat(40) + 'b'],
    });
    expect(Date.now() - started).toBeLessThan(budgetMs * 10);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect((result as { message: string }).message).toContain('took too long');
    expect(FakeWorker.terminated).toBe(1);
    const next = await runner({
      query: 'a',
      regex: true,
      matchCase: false,
      wholeWord: false,
      texts: ['a'],
    });
    expect(next).toMatchObject({ ok: true });
    expect(FakeWorker.created).toBe(2);
  });

  it('has a 2-second budget by default and the catalogue answers invalidArguments on a time-out', async () => {
    expect(REGEX_BUDGET_MS).toBe(2000);
    const runner = createRegexRunner(() => new FakeWorker((r) => r.regex), 40);
    const h = await harness({ runRegex: runner });
    try {
      const out = await h.catalogue.call('find', { text: '(a+)+$', regex: true });
      expect(out.isError).toBe(true);
      expect(out.error?.code).toBe('invalidArguments');
      expect(out.error?.message).toContain('the pattern took too long');
      expect(h.hookCalls).toEqual([]); // a read tool: no strike
      // A literal search needs no worker and still works.
      const literal = await h.catalogue.call('find', { text: 'beta' });
      expect(literal.result.total).toBe(4);
    } finally {
      await h.catalogue.close();
    }
  });

  it('replace_all runs its regex under the same budget; a time-out is a refused attempt of the query key', async () => {
    const runner = createRegexRunner(() => new FakeWorker((r) => r.regex), 40);
    const h = await harness({ runRegex: runner });
    try {
      const before = JSON.stringify(h.copy.document);
      const out = await h.catalogue.call('replace_all', {
        text: '(a+)+$',
        regex: true,
        replacement: 'x',
      });
      expect(out.error?.code).toBe('invalidArguments');
      expect(out.error?.message).toContain('the pattern took too long');
      expect(h.hookCalls).toEqual(['replace_all:(a+)+$']);
      expect(JSON.stringify(h.copy.document)).toBe(before);
      // The worker was recreated: a literal replacement works afterwards (no worker needed).
      const literal = await h.catalogue.call('replace_all', { text: 'beta', replacement: 'BETA' });
      expect(literal.result.count).toBe(4);
    } finally {
      await h.catalogue.close();
    }
  });
});
