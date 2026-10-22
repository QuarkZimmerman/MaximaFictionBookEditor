// @vitest-environment node
/**
 * The tools mapping and the regex budget (feature 005 T041; ai-catalogue §1.5, §3.1 `find`,
 * review C15; data-model §8.3): `toOpenAiTools()` strips `$schema` and nothing else, the chat
 * request carries `tool_choice: 'auto'` with the tools and no `tools` member at all for an
 * entry with `tools: false`; a catastrophic pattern is stopped by the worker budget and
 * answered as `invalidArguments` "the pattern took too long". US4 adds `get_schema` here.
 */

import { chatToolsMembers, toOpenAiTools } from '@/ai/catalogue';
import {
  createRegexRunner,
  REGEX_BUDGET_MS,
  runRegexSearch,
  type RegexSearchRequest,
  type RegexWorkerLike,
} from '@/ai/regexRunner';

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
