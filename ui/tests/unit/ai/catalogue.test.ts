// @vitest-environment node
/**
 * The catalogue over `InMemoryTransport` (feature 005 T041, T051; ai-catalogue §1, §3.1–§3.3,
 * §3.5, §3.7, §5; data-model §6.3, §8): the tools registered so far in the §3 order, the name
 * rule, description lengths, object schemas, coercion of numeric strings, the §1.4 envelopes
 * for an unknown tool and bad arguments, every tool's happy path and refusals against a
 * fixture book, the continuation protocol on an oversize part, the six structural change
 * tools of US3 (each through the hook with its strike key - the pre-check refusals included,
 * review C4), the `set_description` merge and the prompts. US4/US6 extend this file.
 */

import {
  CATALOGUE_VERSION,
  CHANGE_TOOL_NAMES,
  MAX_DESCRIPTION_LENGTH,
  RESOURCE_URIS,
  SCHEMA_FILE_NAMES,
  TOOL_NAME_RULE,
  TOOL_NAMES,
  US2_TOOL_NAMES,
  US3_TOOL_NAMES,
  US4_TOOL_NAMES,
  type PromptText,
} from '@/ai/catalogue';
import { multiset } from '@/ai/hook';
import type { ModelNodeJson } from '@/editor/fromModel';
import type { ValidationIssue, ValidationReport } from '@/model/document';
import type { SchemaTextResult } from '@/rpc/types';

import { blocksSelection, harness, inlineSelection, type Harness } from './catalogueHarness';

let h: Harness;

beforeEach(async () => {
  h = await harness();
});

afterEach(async () => {
  await h.catalogue.close();
});

const call = (name: string, args?: Record<string, unknown> | string) =>
  h.catalogue.call(name, args);

function textOf(copy: Harness['copy'], nodeId: string): string {
  const place = copy.place(nodeId);
  return (place?.node.content ?? [])
    .map((c: ModelNodeJson) => (c.type === 'text' ? c.text : '\uFFFC'))
    .join('');
}

describe('tools/list', () => {
  it('lists the US2, US4 and US3 tools in the §3 order with the name rule, short descriptions and object schemas', () => {
    const tools = h.catalogue.listed();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    // §3 order: the read tools (US2's six, then US4's validate and get_schema), the selection
    // tools, the structural change tools.
    expect(TOOL_NAMES).toEqual([
      'get_context',
      'get_outline',
      'read_part',
      'get_selection',
      'get_description',
      'find',
      'validate',
      'get_schema',
      'set_selection',
      'replace_selection',
      ...US3_TOOL_NAMES,
    ]);
    expect(US4_TOOL_NAMES).toEqual(['validate', 'get_schema']);
    expect(TOOL_NAMES).toHaveLength(US2_TOOL_NAMES.length + US4_TOOL_NAMES.length + 6);
    expect(US3_TOOL_NAMES).toEqual([
      'replace_node',
      'insert_node',
      'remove_node',
      'set_text',
      'replace_all',
      'set_description',
    ]);
    expect(CHANGE_TOOL_NAMES).toEqual(['replace_selection', ...US3_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.name).toMatch(TOOL_NAME_RULE);
      expect(tool.title).toBeTruthy();
      expect(tool.description!.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.properties).toBeTypeOf('object');
    }
    // A tool without parameters: `{type: 'object', properties: {}}`.
    const context = tools.find((t) => t.name === 'get_context')!;
    expect(context.inputSchema.properties).toEqual({});
    expect(context.annotations?.readOnlyHint).toBe(true);
    const replace = tools.find((t) => t.name === 'replace_selection')!;
    expect(replace.annotations?.destructiveHint).toBe(true);
    // The change tools: never read-only; the destructive ones say so (§3.3).
    for (const name of CHANGE_TOOL_NAMES) {
      const tool = tools.find((t) => t.name === name)!;
      expect(tool.annotations?.readOnlyHint, name).toBe(false);
    }
    expect(tools.find((t) => t.name === 'remove_node')!.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'insert_node')!.inputSchema.required).toEqual([
      'where',
      'node',
      'content',
    ]);
    expect(
      (
        tools.find((t) => t.name === 'insert_node')!.inputSchema.properties as Record<
          string,
          { enum?: string[] }
        >
      ).where!.enum,
    ).toEqual(['before', 'after', 'append']);
    expect(tools.find((t) => t.name === 'replace_all')!.inputSchema.required).toEqual([
      'text',
      'replacement',
    ]);
    expect(tools.find((t) => t.name === 'set_description')!.inputSchema.required).toEqual([
      'description',
    ]);
  });

  it('builds the service tools array once, with $schema stripped and nothing else changed', () => {
    const tools = h.catalogue.tools();
    expect(h.catalogue.tools()).toBe(tools);
    expect(tools).toHaveLength(TOOL_NAMES.length);
    const listed = h.catalogue.listed();
    tools.forEach((tool, i) => {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBe(listed[i]!.name);
      expect(tool.function.description).toBe(listed[i]!.description);
      expect(tool.function.parameters).not.toHaveProperty('$schema');
      const { $schema: _s, ...rest } = listed[i]!.inputSchema as Record<string, unknown>;
      void _s;
      expect(tool.function.parameters).toEqual(rest);
    });
  });

  it('registers the prompts selection_edit and general', async () => {
    const { prompts } = await h.catalogue.client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['selection_edit', 'general']);
    expect(prompts[0]!.arguments?.map((a) => a.name)).toEqual(['instruction']);
    const result = await h.catalogue.client.getPrompt({
      name: 'selection_edit',
      arguments: { instruction: 'Fix it' },
    });
    expect(result.messages[0]!.role).toBe('user');
    expect((result.messages[0]!.content as { text: string }).text).toContain('Fix it');
  });

  it('the general prompt takes instruction and caretContext and lays out the history turns, never tool traffic (§5.2)', async () => {
    const { prompts } = await h.catalogue.client.listPrompts();
    const general = prompts.find((p) => p.name === 'general')!;
    expect(general.arguments?.map((a) => [a.name, a.required])).toEqual([
      ['instruction', true],
      ['caretContext', false],
    ]);
    // The panel's message builder (context.ts) is what the prompt renders: the conversation
    // turns - each earlier request's user text and the assistant's final text with its
    // `[Changes applied …]` / `[No change]` line - then the instruction.
    const asked: [string, Record<string, unknown>][] = [];
    const turns: PromptText[] = [
      { role: 'user', text: 'Make the titles title case' },
      { role: 'assistant', text: 'Done.\n[Changes applied in this turn: replace_node ×3]' },
      { role: 'user', text: 'How many sections are there?' },
      { role: 'assistant', text: 'Four.\n[No change]' },
    ];
    const withHistory = await harness({
      promptMessages: (name, args) => {
        asked.push([name, args]);
        return [...turns, { role: 'user', text: String(args.instruction) }];
      },
    });
    try {
      const result = await withHistory.catalogue.client.getPrompt({
        name: 'general',
        arguments: { instruction: 'Now the epigraph', caretContext: 'true' },
      });
      expect(asked).toEqual([['general', { instruction: 'Now the epigraph', caretContext: true }]]);
      expect(result.messages.map((m) => m.role)).toEqual([
        'user',
        'assistant',
        'user',
        'assistant',
        'user',
      ]);
      const texts = result.messages.map((m) => (m.content as { text: string }).text);
      expect(texts[1]).toContain('[Changes applied in this turn: replace_node ×3]');
      expect(texts[3]).toContain('[No change]');
      expect(texts[4]).toBe('Now the epigraph');
      expect(texts.join('\n')).not.toMatch(/tool_call|"role": ?"tool"/);
    } finally {
      await withHistory.catalogue.close();
    }
  });
});

describe('the envelopes of §1.4', () => {
  it('answers an unknown tool with unknownTool and the names as hint', async () => {
    const out = await call('read_section', { node: 'n10' });
    expect(out.isError).toBe(true);
    expect(out.error?.code).toBe('unknownTool');
    expect(out.error?.hint).toContain('read_part');
    expect(JSON.parse(out.text)).toEqual(out.result);
  });

  it('answers bad arguments with invalidArguments and the schema as expected', async () => {
    const out = await call('read_part', { format: 'text' });
    expect(out.error?.code).toBe('invalidArguments');
    expect(out.error?.message).toContain('node');
    expect(out.error?.expected).toMatchObject({ type: 'object', required: ['node'] });
    expect(out.error?.expected).not.toHaveProperty('$schema');
    const wrongType = await call('get_outline', { depth: 'x' });
    expect(wrongType.error?.code).toBe('invalidArguments');
  });

  it('parses a JSON string of arguments, coercing numeric and boolean strings', async () => {
    const out = await call('get_outline', '{"node": "n1", "depth": "1"}');
    expect(out.isError).toBe(false);
    const entries = out.result.entries as { id: string; children: unknown[] }[];
    expect(entries).toHaveLength(1);
    expect(entries[0]!.children).toEqual([]);
    const found = await call('find', '{"text": "BETA", "matchCase": "false", "regex": "0"}');
    expect(found.isError).toBe(false);
    expect(found.result.total).toBe(4);
    const broken = await call('find', '{"text": ');
    expect(broken.error?.code).toBe('invalidArguments');
    const notObject = await call('find', '[1]');
    expect(notObject.error?.code).toBe('invalidArguments');
  });

  it('answers an unknown node reference with unknownNode (id and path forms)', async () => {
    for (const node of [
      'n9123',
      'body[3]',
      'body[1]/section[9]/p[1]',
      'title-info/annotation[1]/p[2]',
    ]) {
      const out = await call('read_part', { node });
      expect(out.error?.code, node).toBe('unknownNode');
      expect(out.error?.hint).toContain('get_outline');
    }
  });
});

describe('get_context', () => {
  it('returns the context without the outline plus the request counters', async () => {
    const out = await call('get_context', {});
    expect(out.isError).toBe(false);
    expect(out.result.catalogueVersion).toBe(CATALOGUE_VERSION);
    expect(out.result).not.toHaveProperty('outline');
    expect(out.result.book).toEqual({ title: 'Alpha' });
    expect(out.result.changesInThisRequest).toBe(0);
    expect(out.result.requestElapsedMs).toBeGreaterThanOrEqual(1000);
  });
});

describe('get_outline', () => {
  it('returns every body with nested sections, whole titles, counts and paths', async () => {
    const out = await call('get_outline', {});
    const entries = out.result.entries as Record<string, unknown>[];
    expect(entries.map((e) => e.path)).toEqual(['body[1]', 'body[2]']);
    expect(entries[0]).toMatchObject({ id: 'n1', type: 'body', title: 'The Book', images: 1 });
    expect(entries[1]).toMatchObject({ id: 'n30', type: 'body', name: 'notes', title: '' });
    const sections = entries[0]!.children as Record<string, unknown>[];
    expect(sections.map((s) => s.path)).toEqual(['body[1]/section[1]', 'body[1]/section[2]']);
    expect(sections[0]).toMatchObject({ id: 'n10', title: 'ONE', paragraphs: 4, images: 1 });
    expect(sections[0]!.characters).toBe(
      'ONE'.length +
        'Alpha beta gamma.'.length +
        'He went out1.'.length +
        'Beta again, and beta once more.'.length,
    );
    expect(out.result).not.toHaveProperty('more');
  });

  it('starts at a node, limits the depth and refuses a non-section node', async () => {
    const out = await call('get_outline', { node: 'body[1]/section[2]', depth: 1 });
    const entries = out.result.entries as Record<string, unknown>[];
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: 'n20', title: 'TWO', children: [] });
    const bad = await call('get_outline', { node: 'n13' });
    expect(bad.error?.code).toBe('invalidArguments');
  });

  it('delivers whole top-level entries in parts under a result budget', async () => {
    const small = await harness({ resultBudget: () => 400 });
    try {
      const first = await small.catalogue.call('get_outline', {});
      const entries = first.result.entries as { id: string }[];
      expect(entries.map((e) => e.id)).toEqual(['n1']);
      const more = first.result.more as { cursor: string; hint: string };
      expect(more.cursor).toBe('after:n1');
      expect(more.hint).toContain('get_outline');
      const second = await small.catalogue.call('get_outline', { cursor: more.cursor });
      expect((second.result.entries as { id: string }[]).map((e) => e.id)).toEqual(['n30']);
      expect(second.result).not.toHaveProperty('more');
    } finally {
      await small.catalogue.close();
    }
  });
});

describe('read_part', () => {
  it('reads a section as text blocks: text containers, images, empty lines, atoms as U+FFFC', async () => {
    const out = await call('read_part', { node: 'body[1]/section[1]' });
    expect(out.isError).toBe(false);
    expect(out.result.node).toEqual({
      id: 'n10',
      path: 'body[1]/section[1]',
      type: 'section',
      characters: expect.any(Number),
    });
    expect(out.result.parent).toMatchObject({ id: 'n1', path: 'body[1]', type: 'body' });
    expect(out.result.format).toBe('text');
    const blocks = out.result.blocks as Record<string, unknown>[];
    expect(blocks.map((b) => b.type)).toEqual(['p', 'p', 'p', 'p', 'image', 'empty-line']);
    expect(blocks[0]).toEqual({
      id: 'n12',
      path: 'body[1]/section[1]/title[1]/p[1]',
      type: 'p',
      text: 'ONE',
    });
    expect(blocks[2]).toMatchObject({ id: 'n14', text: 'He went out1.' });
    expect(blocks[4]).toEqual({
      id: 'n16',
      path: 'body[1]/section[1]/image[1]',
      type: 'image',
      href: '#cover.png',
      alt: 'Cover',
    });
    expect(out.result.from).toMatchObject({ id: 'n12' });
    expect(out.result.to).toMatchObject({ id: 'n17' });
    expect(out.result).not.toHaveProperty('more');
  });

  it('reads a part as FB2 XML through doc.fragmentToXml and a description root by path', async () => {
    const out = await call('read_part', { node: 'n24', format: 'fb2xml' });
    expect(out.result.xml).toBe('<v>Line one</v>\n<v>Line two</v>');
    expect(out.result.from).toMatchObject({ id: 'n25' });
    expect(out.result.to).toMatchObject({ id: 'n26' });
    const leaf = await call('read_part', { node: 'n14', format: 'fb2xml' });
    expect(leaf.result.xml).toBe(
      '<p>He <emphasis>went</emphasis> out<a l:href="#n_1" type="note">1</a>.</p>',
    );
    const annotation = await call('read_part', { node: 'title-info/annotation[1]' });
    expect((annotation.result.blocks as { path: string }[])[0]!.path).toBe(
      'title-info/annotation[1]/p[1]',
    );
    const bad = await call('read_part', { node: 'n10', format: 'html' });
    expect(bad.error?.code).toBe('invalidArguments');
  });

  it('delivers an oversize part in consecutive parts of whole blocks (§3.7)', async () => {
    const small = await harness({ resultBudget: () => 420 });
    try {
      const first = await small.catalogue.call('read_part', { node: 'n10' });
      expect(first.isError).toBe(false);
      const blocks = first.result.blocks as { id: string }[];
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks.length).toBeLessThan(6);
      const more = first.result.more as {
        cursor: string;
        remaining: { blocks: number };
        hint: string;
      };
      expect(more.cursor).toBe(`after:${blocks[blocks.length - 1]!.id}`);
      expect(more.remaining.blocks).toBe(6 - blocks.length);
      expect(more.hint).toContain('read_part');
      // The next parts follow the cursor until nothing remains; every block appears once.
      const seen = blocks.map((b) => b.id);
      let cursor: string | undefined = more.cursor;
      while (cursor) {
        const next = await small.catalogue.call('read_part', { node: 'n10', cursor });
        expect(next.isError).toBe(false);
        seen.push(...(next.result.blocks as { id: string }[]).map((b) => b.id));
        cursor = (next.result.more as { cursor: string } | undefined)?.cursor;
      }
      expect(seen).toEqual(['n12', 'n13', 'n14', 'n15', 'n16', 'n17']);
      const bad = await small.catalogue.call('read_part', { node: 'n10', cursor: 'after:nope' });
      expect(bad.error?.code).toBe('invalidArguments');
    } finally {
      await small.catalogue.close();
    }
  });

  it('descends into a child too large for one fb2xml part and continues after it (§3.7 descent)', async () => {
    const small = await harness({ resultBudget: () => 300 });
    try {
      const parts: { parent: string; from: string; to: string; xml: string }[] = [];
      let cursor: string | undefined;
      do {
        const out = await small.catalogue.call('read_part', {
          node: 'n20',
          format: 'fb2xml',
          ...(cursor ? { cursor } : {}),
        });
        expect(out.isError).toBe(false);
        parts.push({
          parent: (out.result.parent as { id: string }).id,
          from: (out.result.from as { id: string }).id,
          to: (out.result.to as { id: string }).id,
          xml: out.result.xml as string,
        });
        cursor = (out.result.more as { cursor: string } | undefined)?.cursor;
      } while (cursor);
      // The title alone; the poem does not fit, so its stanza becomes a part of its own
      // (parent = the poem); then the two paragraphs after the poem under the section.
      expect(parts.map((p) => [p.parent, p.from, p.to])).toEqual([
        ['n20', 'n21', 'n21'],
        ['n23', 'n24', 'n24'],
        ['n20', 'n27', 'n28'],
      ]);
      expect(parts[1]!.xml).toBe('<stanza><v>Line one</v>\n<v>Line two</v></stanza>');
      expect(parts[2]!.xml).toBe('<p>Second section beta.</p>\n<p>The last paragraph.</p>');
    } finally {
      await small.catalogue.close();
    }
  });

  it('answers tooLarge for a single text container larger than the budget', async () => {
    const small = await harness({ resultBudget: () => 300 });
    try {
      const out = await small.catalogue.call('read_part', { node: 'n15' });
      expect(out.error?.code).toBe('tooLarge');
      expect(out.error?.node).toMatchObject({ id: 'n15' });
      expect(out.error?.characters).toBe('Beta again, and beta once more.'.length);
    } finally {
      await small.catalogue.close();
    }
  });
});

describe('get_selection and set_selection', () => {
  it('reports a caret as kind none', async () => {
    const out = await call('get_selection', {});
    expect(out.result).toMatchObject({
      kind: 'none',
      characters: 0,
      paragraphs: 0,
      hasInlineElements: false,
    });
    expect(out.result.anchor).toMatchObject({
      node: { id: 'n13', path: 'body[1]/section[1]/p[1]' },
      offset: 0,
    });
  });

  it('reports an inline selection with its text, FB2 form and inline elements', async () => {
    h.setSelection(inlineSelection('n14', 3, 13));
    const text = await call('get_selection', {});
    expect(text.result).toMatchObject({
      kind: 'inline',
      text: 'went out1.',
      characters: 10,
      paragraphs: 1,
      hasInlineElements: true,
    });
    const xml = await call('get_selection', { format: 'fb2xml' });
    expect(xml.result.xml).toBe('<emphasis>went</emphasis> out<a l:href="#n_1" type="note">1</a>.');
    expect(xml.result.parent).toMatchObject({ id: 'n14' });
  });

  it('reports a block selection with open ends as complete elements holding the selected part (C6)', async () => {
    h.setSelection(
      blocksSelection(['n13', 'n14', 'n15'], {
        anchor: { nodeId: 'n13', offset: 6 },
        head: { nodeId: 'n15', offset: 4 },
        openStart: true,
        openEnd: true,
      }),
    );
    const out = await call('get_selection', { format: 'fb2xml' });
    expect(out.result).toMatchObject({
      kind: 'blocks',
      openStart: true,
      openEnd: true,
      paragraphs: 3,
    });
    expect(out.result.from).toMatchObject({ id: 'n13' });
    expect(out.result.to).toMatchObject({ id: 'n15' });
    expect(out.result.parent).toMatchObject({ id: 'n10' });
    expect(out.result.xml).toBe(
      '<p>beta gamma.</p>\n<p>He <emphasis>went</emphasis> out<a l:href="#n_1" type="note">1</a>.</p>\n<p>Beta</p>',
    );
    expect(out.result.characters).toBe(
      'beta gamma.'.length + 'He went out1.'.length + 'Beta'.length,
    );
  });

  it('set_selection takes {anchor, head} with clamped offsets or {node}, and exactly one form', async () => {
    const inline = await call('set_selection', {
      anchor: { node: 'n13', offset: '2' },
      head: { node: 'body[1]/section[1]/p[1]', offset: 999 },
    });
    expect(inline.result).toMatchObject({ kind: 'inline', text: 'pha beta gamma.' });
    expect(h.selection()).toMatchObject({
      kind: 'inline',
      anchor: { nodeId: 'n13', offset: 2 },
      head: { nodeId: 'n13', offset: 17 },
    });
    const blocks = await call('set_selection', {
      anchor: { node: 'n13', offset: 0 },
      head: { node: 'n15', offset: 31 },
    });
    expect(blocks.result).toMatchObject({ kind: 'blocks', openStart: false, openEnd: false });
    expect(h.selection()).toMatchObject({ kind: 'blocks', nodeIds: ['n13', 'n14', 'n15'] });
    const partial = await call('set_selection', {
      anchor: { node: 'n13', offset: 6 },
      head: { node: 'n15', offset: 4 },
    });
    expect(partial.result).toMatchObject({ kind: 'blocks', openStart: true, openEnd: true });
    const across = await call('set_selection', {
      anchor: { node: 'n13' },
      head: { node: 'n28', offset: 19 },
    });
    expect(h.selection()).toMatchObject({
      kind: 'blocks',
      nodeIds: ['n10', 'n20'],
      openStart: true,
      openEnd: false,
    });
    expect(across.result.parent).toMatchObject({ id: 'n1' });
    const whole = await call('set_selection', { node: 'n23' });
    expect(whole.result).toMatchObject({ kind: 'blocks', openStart: false, openEnd: false });
    expect(h.selection()).toMatchObject({ kind: 'blocks', nodeIds: ['n23'] });
    const wholeText = await call('set_selection', { node: 'n27' });
    expect(wholeText.result).toMatchObject({ kind: 'inline', text: 'Second section beta.' });
    const caret = await call('set_selection', { anchor: { node: 'n27', offset: 3 } });
    expect(caret.result).toMatchObject({ kind: 'none' });
    const both = await call('set_selection', { anchor: { node: 'n13' }, node: 'n13' });
    expect(both.error?.code).toBe('invalidArguments');
    const none = await call('set_selection', {});
    expect(none.error?.code).toBe('invalidArguments');
    const unknown = await call('set_selection', { node: 'n999' });
    expect(unknown.error?.code).toBe('unknownNode');
    expect(h.hookCalls).toEqual([]); // no change, no hook
  });
});

describe('get_description', () => {
  it('returns the description with the annotation as {xml} and outputs as {xml}', async () => {
    const out = await call('get_description', {});
    const description = out.result.description as Record<string, Record<string, unknown>>;
    expect(description.titleInfo!.bookTitle).toBe('Alpha');
    expect(description.titleInfo!.annotation).toEqual({ xml: '<p>About the book.</p>' });
    expect(description.titleInfo!.authors).toEqual([
      { firstName: 'Ivan', lastName: 'Petrov', homePages: [], emails: [] },
    ]);
    expect(description.documentInfo!.id).toBe('id');
    expect(description.documentInfo).not.toHaveProperty('history');
    expect(description.outputs).toEqual([]);
  });
});

describe('find', () => {
  it('returns every match of the bodies with node info, offsets and ±40 characters of context', async () => {
    const out = await call('find', { text: 'beta' });
    expect(out.isError).toBe(false);
    expect(out.result.total).toBe(4);
    const matches = out.result.matches as Record<string, unknown>[];
    expect(matches[0]).toMatchObject({
      node: { id: 'n13', path: 'body[1]/section[1]/p[1]' },
      from: 6,
      to: 10,
      text: 'beta',
      context: 'Alpha beta gamma.',
    });
    expect(matches.map((m) => (m.node as { id: string }).id)).toEqual(['n13', 'n15', 'n15', 'n27']);
    const cased = await call('find', { text: 'Beta', matchCase: true });
    expect(cased.result.total).toBe(1);
    const within = await call('find', { text: 'beta', within: 'body[1]/section[2]' });
    expect(within.result.total).toBe(1);
    const whole = await call('find', { text: 'Line \\w+', regex: true, wholeWord: true });
    expect((whole.result.matches as { text: string }[]).map((m) => m.text)).toEqual([
      'Line one',
      'Line two',
    ]);
    expect(out.result).not.toHaveProperty('more');
  });

  it('answers invalidArguments for an invalid expression and unknownNode for within', async () => {
    const bad = await call('find', { text: '(', regex: true });
    expect(bad.error?.code).toBe('invalidArguments');
    expect(bad.error?.message).toMatch(/regular expression/);
    const unknown = await call('find', { text: 'a', within: 'n999' });
    expect(unknown.error?.code).toBe('unknownNode');
    const empty = await call('find', { text: '' });
    expect(empty.error?.code).toBe('invalidArguments');
  });

  it('delivers whole matches in parts with offset cursors under a budget', async () => {
    const small = await harness({ resultBudget: () => 260 });
    try {
      const first = await small.catalogue.call('find', { text: 'beta' });
      const matches = first.result.matches as unknown[];
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.length).toBeLessThan(4);
      const more = first.result.more as { cursor: string };
      expect(more.cursor).toBe(`offset:${matches.length}`);
      const rest = await small.catalogue.call('find', { text: 'beta', cursor: more.cursor });
      expect(rest.result.total).toBe(4);
      expect((rest.result.matches as unknown[]).length + matches.length).toBeLessThanOrEqual(4);
    } finally {
      await small.catalogue.close();
    }
  });
});

describe('replace_selection', () => {
  it('refuses a caret with noSelection and exactly-one content with invalidArguments', async () => {
    const none = await call('replace_selection', { content: { text: 'x' } });
    expect(none.error?.code).toBe('noSelection');
    h.setSelection(inlineSelection('n13', 0, 5));
    const both = await call('replace_selection', { content: { text: 'x', xml: 'y' } });
    expect(both.error?.code).toBe('invalidArguments');
    const neither = await call('replace_selection', { content: {} });
    expect(neither.error?.code).toBe('invalidArguments');
    expect(h.copy.changed).toBe(false);
  });

  it('replaces inline text with the marks at the selection start and selects the replacement', async () => {
    // Inside the emphasised "went": the replacement takes the emphasis (as selection.replaceText).
    h.setSelection(inlineSelection('n14', 4, 7)); // "ent"
    const out = await call('replace_selection', { content: { text: 'alked' } });
    expect(out.isError).toBe(false);
    expect(out.result.replaced).toEqual({ characters: 3, paragraphs: 1 });
    expect(out.result.inserted).toEqual([
      { id: 'n14', path: 'body[1]/section[1]/p[2]', type: 'p', characters: 15 },
    ]);
    expect(h.hookCalls).toEqual(['replace_selection:selection']);
    const content = h.copy.place('n14')!.node.content!;
    expect(content[1]).toEqual({ type: 'text', text: 'walked', marks: [{ type: 'emphasis' }] });
    expect(textOf(h.copy, 'n14')).toBe('He walked out1.');
    expect(h.selection()).toEqual({
      kind: 'inline',
      anchor: { nodeId: 'n14', offset: 4 },
      head: { nodeId: 'n14', offset: 9 },
    });
    expect(out.result.selection).toMatchObject({ kind: 'inline', text: 'alked' });
    // At the boundary before "went" the marks of the text before apply (ProseMirror's rule):
    // the replacement is plain and the runs merge.
    h.setSelection(inlineSelection('n13', 0, 5)); // "Alpha"
    const plain = await call('replace_selection', { content: { text: 'Omega' } });
    expect(plain.isError).toBe(false);
    expect(h.copy.place('n13')!.node.content).toEqual([
      { type: 'text', text: 'Omega beta gamma.' },
    ]);
    // Deleting the selection leaves a caret.
    const deleted = await call('replace_selection', { content: { text: '' } });
    expect(deleted.isError).toBe(false);
    expect(textOf(h.copy, 'n13')).toBe(' beta gamma.');
    expect(h.selection()).toEqual({
      kind: 'none',
      anchor: { nodeId: 'n13', offset: 0 },
      head: { nodeId: 'n13', offset: 0 },
    });
  });

  it('replaces inline content with inline XML keeping marks and footnote links, refusing blocks', async () => {
    h.setSelection(inlineSelection('n14', 0, 13));
    const out = await call('replace_selection', {
      content: {
        xml: '```xml\nShe <strong>left</strong> the house<a l:href="#n_1" type="note">1</a>.\n```',
      },
    });
    expect(out.isError).toBe(false);
    const content = h.copy.place('n14')!.node.content!;
    expect(content).toEqual([
      { type: 'text', text: 'She ' },
      { type: 'text', text: 'left', marks: [{ type: 'strong' }] },
      { type: 'text', text: ' the house' },
      { type: 'text', text: '1', marks: [{ type: 'link', attrs: { href: '#n_1', type: 'note' } }] },
      { type: 'text', text: '.' },
    ]);
    h.setSelection(inlineSelection('n13', 0, 5));
    const blocks = await call('replace_selection', { content: { xml: '<p>New</p>' } });
    expect(blocks.error?.code).toBe('fragmentNotAllowed');
    const entity = await call('replace_selection', { content: { xml: 'a&nbsp;b' } });
    expect(entity.error?.code).toBe('invalidXml');
    expect(entity.error?.hint).toContain('U+00A0');
    expect(textOf(h.copy, 'n13')).toBe('Alpha beta gamma.');
  });

  it('replaces whole blocks with block XML (several siblings, sc_ ids) and with text lines as paragraphs', async () => {
    h.setSelection(blocksSelection(['n13', 'n14']));
    const out = await call('replace_selection', {
      content: { xml: '<p>First.</p>\n<subtitle>Sub</subtitle>\n<empty-line/>' },
    });
    expect(out.isError).toBe(false);
    expect(out.result.replaced).toEqual({
      characters: 'Alpha beta gamma.'.length + 'He went out1.'.length,
      paragraphs: 2,
    });
    const inserted = out.result.inserted as { id: string; type: string; path: string }[];
    expect(inserted.map((n) => n.type)).toEqual(['p', 'subtitle', 'empty-line']);
    expect(inserted.every((n) => n.id.startsWith('sc_'))).toBe(true);
    expect(inserted.map((n) => n.path)).toEqual([
      'body[1]/section[1]/p[1]',
      'body[1]/section[1]/subtitle[1]',
      'body[1]/section[1]/empty-line[1]',
    ]);
    const section = h.copy.place('n10')!.node.content!.map((c) => c.type);
    expect(section).toEqual(['title', 'p', 'subtitle', 'empty-line', 'p', 'image', 'empty-line']);
    expect(h.copy.place('n13')).toBeUndefined();
    expect(h.selection()).toMatchObject({
      kind: 'blocks',
      nodeIds: inserted.map((n) => n.id),
      openStart: false,
      openEnd: false,
    });

    h.setSelection(blocksSelection(['n27', 'n28']));
    const text = await call('replace_selection', { content: { text: 'One line.\n\nTwo line.\n' } });
    expect(text.isError).toBe(false);
    const paragraphs = h.copy.place('n20')!.node.content!.filter((c) => c.type === 'p');
    expect(paragraphs.map((p) => p.content![0]!.text)).toEqual(['One line.', 'Two line.']);
    expect(h.hookCalls).toEqual(['replace_selection:selection', 'replace_selection:selection']);
  });

  it('applies a replacement with open ends so that the unselected text is never touched (C6)', async () => {
    h.setSelection(
      blocksSelection(['n13', 'n15'].length === 2 ? ['n13', 'n14', 'n15'] : [], {
        anchor: { nodeId: 'n13', offset: 6 },
        head: { nodeId: 'n15', offset: 4 },
        openStart: true,
        openEnd: true,
      }),
    );
    const out = await call('replace_selection', {
      content: { xml: '<p>BETA GAMMA.</p>\n<p>Middle.</p>\n<p>BETA</p>' },
    });
    expect(out.isError).toBe(false);
    const section = h.copy.place('n10')!.node.content!;
    const texts = section
      .filter((c) => c.type === 'p')
      .map((p) => (p.content ?? []).map((c) => c.text ?? '').join(''));
    expect(texts).toEqual(['Alpha BETA GAMMA.', 'Middle.', 'BETA again, and beta once more.']);
    expect(section[1]!.attrs!.nodeId).toBe('n13'); // the partly selected first block keeps its id
    expect(h.copy.place('n14')).toBeUndefined();
    expect(h.copy.place('n15')).toBeUndefined();
    expect(h.selection()).toMatchObject({
      kind: 'blocks',
      openStart: true,
      openEnd: true,
      anchor: { nodeId: 'n13', offset: 6 },
    });
    const summary = out.result.selection as Record<string, unknown>;
    expect(summary.text).toBe('BETA GAMMA.\nMiddle.\nBETA');
  });

  it('refuses content the parent cannot hold and rolls the copy back (nothing applied)', async () => {
    h.setSelection(blocksSelection(['n13']));
    const before = JSON.stringify(h.copy.document);
    const section = await call('replace_selection', {
      content: { xml: '<section><p>x</p></section>' },
    });
    expect(section.error?.code).toBe('notAllowed');
    const unknown = await call('replace_selection', { content: { xml: '<chapter>x</chapter>' } });
    expect(unknown.error?.code).toBe('fragmentNotAllowed');
    expect(unknown.error).toMatchObject({ element: 'chapter', parent: 'section' });
    const wrapper = await call('replace_selection', { content: { xml: '<body><p>x</p></body>' } });
    expect(wrapper.error?.code).toBe('fragmentNotAllowed');
    expect(wrapper.error?.hint).toContain('without a document wrapper');
    const inline = await call('replace_selection', { content: { xml: 'bare text' } });
    expect(inline.error?.code).toBe('fragmentNotAllowed');
    expect(JSON.stringify(h.copy.document)).toBe(before);
    expect(h.hookCalls).toHaveLength(4); // every attempt went through the hook (a strike each, C4)
  });

  it('answers unavailable for a Source selection without the text path, and refuses {text} there', async () => {
    h.setSelection({ kind: 'source', from: 10, to: 20, text: '<p>x</p>' });
    const get = await call('get_selection', {});
    expect(get.result).toMatchObject({
      kind: 'source',
      xml: '<p>x</p>',
      anchor: { offset: 10 },
      head: { offset: 20 },
    });
    const text = await call('replace_selection', { content: { text: 'x' } });
    expect(text.error?.code).toBe('invalidArguments');
    const xml = await call('replace_selection', { content: { xml: '<p>y</p>' } });
    expect(xml.error?.code).toBe('unavailable');
  });
});

/* ------------------------------------------------------------------------ */
/* The structural change tools of US3 (T051 / T054; ai-catalogue §3.3, §3.5) */
/* ------------------------------------------------------------------------ */

/** The types of the children of a node of the copy. */
function childTypes(copy: Harness['copy'], nodeId: string): string[] {
  return (copy.place(nodeId)?.node.content ?? []).map((c: ModelNodeJson) => c.type);
}

describe('read tools and set_selection never reach the hook', () => {
  it('leaves the hook untouched for every read tool (no strike, no checkpoint)', async () => {
    await call('get_context', {});
    await call('get_outline', {});
    await call('read_part', { node: 'n10' });
    await call('get_selection', {});
    await call('get_description', {});
    await call('find', { text: 'beta' });
    await call('validate', {});
    await call('get_schema', { element: 'section' });
    await call('set_selection', { node: 'n13' });
    expect(h.hookCalls).toEqual([]);
    expect(h.copy.changed).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */
/* US4 (T059 / T061): validate, get_schema, the schema resources             */
/* ------------------------------------------------------------------------ */

const TITLE_UNEXPECTED = "Element 'title': This element is not expected.";

function issue(
  element: string,
  message: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return {
    severity: 'error',
    code: 'schema.invalid',
    params: { element, message },
    ...extra,
  } as ValidationIssue;
}

function report(issues: ValidationIssue[]): ValidationReport {
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    durationMs: 7,
  };
}

const fakeSchema = (): SchemaTextResult => ({
  files: SCHEMA_FILE_NAMES.map((name) => ({
    name,
    text:
      name === 'FictionNotes.xsd'
        ? `<?xml version="1.0"?>\r\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\r\n  <!-- ${name} -->\r\n</xs:schema>\r\n`
        : `<?xml version="1.0"?>\n<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">\n  <!-- ${name} -->\n  <xs:element name="x"/>\n</xs:schema>\n`,
  })),
  notice: 'Copyright (c) 2004, Dmitry Gribov\nAll rights reserved.\n',
});

describe('validate (US4)', () => {
  it('splits the errors of the working copy into new and pre-existing by the multiset rule; ok = no new error', async () => {
    await h.catalogue.close();
    const FOO = "Element 'section', attribute 'foo': The attribute 'foo' is not allowed.";
    const baseline = multiset([
      issue('title', TITLE_UNEXPECTED, { line: 20, path: 'body[1]/section[2]/title[1]' }),
      issue('section', FOO, { line: 40, path: 'body[1]/section[3]' }),
    ]);
    let reports = 0;
    h = await harness({
      baseline: () => baseline,
      validate: () => {
        reports += 1;
        return Promise.resolve(
          report([
            // The pre-existing title error, moved by an insertion (another line and path) …
            issue('title', TITLE_UNEXPECTED, { line: 31, path: 'body[1]/section[2]/title[2]' }),
            // … and a second occurrence of its key: the key's count (2) exceeds the baseline's
            // (1), so every issue of the key is reported as new (§6.10.5, all of them).
            issue('title', TITLE_UNEXPECTED, { line: 44, path: 'body[1]/section[3]/title[2]' }),
            // The pre-existing attribute error, moved: its count is within the baseline.
            issue('section', FOO, { line: 52, path: 'body[1]/section[4]' }),
            // Another kind: new.
            issue(
              'a',
              "Element 'a': The attribute '{http://www.w3.org/1999/xlink}href' is required but missing.",
              {
                line: 60,
                path: 'body[1]/section[4]/p[1]',
              },
            ),
            {
              severity: 'warning',
              code: 'link.dangling',
              params: { href: '#x' },
            } as ValidationIssue,
          ]),
        );
      },
    });
    const out = await call('validate', {});
    expect(out.isError).toBe(false);
    expect(reports).toBe(1);
    expect(out.result).toMatchObject({ ok: false, warnings: 1, durationMs: 7 });
    const fresh = out.result.newErrors as { element: string; path: string; line: number }[];
    const old = out.result.preExistingErrors as { element: string; path: string }[];
    expect(old).toEqual([
      {
        code: 'schema.invalid',
        element: 'section',
        path: 'body[1]/section[4]',
        line: 52,
        message: FOO,
      },
    ]);
    expect(fresh.map((e) => [e.element, e.path, e.line])).toEqual([
      ['title', 'body[1]/section[2]/title[2]', 31],
      ['title', 'body[1]/section[3]/title[2]', 44],
      ['a', 'body[1]/section[4]/p[1]', 60],
    ]);
    // No change record, no strike: a read tool.
    expect(h.hookCalls).toEqual([]);
  });

  it('answers ok with empty lists for a clean copy, and unavailable without a validator', async () => {
    await h.catalogue.close();
    h = await harness({ baseline: () => new Map(), validate: () => Promise.resolve(report([])) });
    const clean = await call('validate', {});
    expect(clean.result).toEqual({
      ok: true,
      newErrors: [],
      preExistingErrors: [],
      warnings: 0,
      durationMs: 7,
    });
    await h.catalogue.close();
    h = await harness();
    const none = await call('validate', {});
    expect(none.error?.code).toBe('unavailable');
  });
});

describe('get_schema (US4)', () => {
  it('serves one element from the generated table: children, attributes, text (rpc-api §3.13); unknown → known false', async () => {
    const section = await call('get_schema', { element: 'section' });
    expect(section.isError).toBe(false);
    expect(section.result.known).toBe(true);
    expect(section.result.name).toBe('section');
    const children = (section.result.children as { name: string }[]).map((c) => c.name);
    for (const name of [
      'title',
      'epigraph',
      'p',
      'poem',
      'subtitle',
      'cite',
      'empty-line',
      'table',
      'image',
      'section',
      'annotation',
    ]) {
      expect(children, name).toContain(name);
    }
    expect(children).not.toContain('v');
    const attributes = section.result.attributes as { name: string; required: boolean }[];
    expect(attributes.map((a) => a.name)).toEqual(['id', 'xml:lang']);
    expect(attributes.every((a) => a.required === false)).toBe(true);
    expect(section.result.text).toBe(false);

    const p = await call('get_schema', { element: 'p' });
    expect(p.result.text).toBe(true);
    expect((p.result.children as { name: string }[]).map((c) => c.name)).toContain('emphasis');
    const a = await call('get_schema', { element: 'a' });
    expect(a.result.attributes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'xlink:href', required: true })]),
    );
    expect(a.result.note).toContain('l:href');

    // A prefixed name is read by its local part; an unknown name is a result, not an error.
    const prefixed = await call('get_schema', { element: 'fb:stanza' });
    expect(prefixed.result.name).toBe('stanza');
    const unknown = await call('get_schema', { element: 'chapter' });
    expect(unknown.isError).toBe(false);
    expect(unknown.result).toEqual({ known: false, name: 'chapter' });
  });

  it('serves the whole schema from schema.text() - fetched once and cached - and in parts of whole lines under a budget', async () => {
    await h.catalogue.close();
    let fetches = 0;
    const budget: { value: number | undefined } = { value: undefined };
    h = await harness({
      schemaText: () => {
        fetches += 1;
        return Promise.resolve(fakeSchema());
      },
      resultBudget: () => budget.value,
    });
    const whole = await call('get_schema', {});
    expect(whole.isError).toBe(false);
    const files = whole.result.files as { name: string; text: string }[];
    expect(files.map((f) => f.name)).toEqual([...SCHEMA_FILE_NAMES]);
    expect(files[0]!.text).toContain('<xs:schema');
    expect(files[4]!.text).toContain('\r\n'); // byte-exact: the CRLF of FictionNotes.xsd kept
    expect(whole.result.notice).toContain('Dmitry Gribov');
    expect(whole.result.more).toBeUndefined();
    await call('get_schema', {});
    expect(fetches).toBe(1);

    // A budget: whole lines, a cursor `<file>:<line>` to the next part, every line delivered once.
    budget.value = 400;
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let part = 0; part < 20; part += 1) {
      const out = await call('get_schema', cursor ? { cursor } : {});
      expect(out.isError).toBe(false);
      for (const file of out.result.files as { name: string; text: string }[]) {
        seen.push(...file.text.split('\n').map((line) => `${file.name}|${line}`));
      }
      const more = out.result.more as { cursor: string; remaining: { lines: number } } | undefined;
      if (!more) break;
      expect(more.cursor).toMatch(/^[A-Za-z.]+:\d+$/);
      expect(more.remaining.lines).toBeGreaterThan(0);
      cursor = more.cursor;
    }
    const all = fakeSchema().files.flatMap((f) =>
      f.text.split('\n').map((line) => `${f.name}|${line}`),
    );
    expect(seen).toEqual(all);
    expect(fetches).toBe(1);

    // No RPC in this context: unavailable (a result envelope, the request goes on).
    await h.catalogue.close();
    h = await harness();
    const none = await call('get_schema', {});
    expect(none.error?.code).toBe('unavailable');
  });
});

describe('the schema resources (ai-catalogue §4)', () => {
  it('lists fb2://schema/<name> for the five files as application/xml with the notice, readable through the client', async () => {
    await h.catalogue.close();
    let fetches = 0;
    h = await harness({
      schemaText: () => {
        fetches += 1;
        return Promise.resolve(fakeSchema());
      },
    });
    const { resources } = await h.catalogue.client.listResources();
    expect(resources.map((r) => r.uri)).toEqual([...RESOURCE_URIS]);
    expect(RESOURCE_URIS).toEqual([
      'fb2://schema/FictionBook.xsd',
      'fb2://schema/FictionBookGenres.xsd',
      'fb2://schema/FictionBookLang.xsd',
      'fb2://schema/FictionBookLinks.xsd',
      'fb2://schema/FictionNotes.xsd',
    ]);
    for (const resource of resources) {
      expect(resource.name).toMatch(TOOL_NAME_RULE);
      expect(resource.mimeType).toBe('application/xml');
      expect(resource.description).toContain('Dmitry Gribov');
    }
    // Read lazily: nothing fetched until a read; one fetch serves every file.
    expect(fetches).toBe(0);
    const read = await h.catalogue.client.readResource({ uri: 'fb2://schema/FictionNotes.xsd' });
    const content = read.contents[0] as { uri: string; mimeType?: string; text?: string };
    expect(content.uri).toBe('fb2://schema/FictionNotes.xsd');
    expect(content.mimeType).toBe('application/xml');
    expect(content.text).toContain('FictionNotes.xsd');
    expect(content.text).toContain('\r\n');
    const again = await h.catalogue.client.readResource({ uri: 'fb2://schema/FictionBook.xsd' });
    expect((again.contents[0] as { text?: string }).text).toContain('FictionBook.xsd');
    expect(fetches).toBe(1);
    // Once the text is known the descriptions carry the notice itself.
    const after = (await h.catalogue.client.listResources()).resources;
    expect(after[0]!.description).toContain('All rights reserved.');
  });
});

describe('replace_node', () => {
  it('replaces a node by one XML element parsed in the parent context; the node keeps its id', async () => {
    const out = await call('replace_node', {
      node: 'body[1]/section[1]/p[1]',
      content: { xml: '```fb2\n<p>ALPHA <emphasis>beta</emphasis> gamma.</p>\n```' },
    });
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({
      node: { id: 'n13', path: 'body[1]/section[1]/p[1]', type: 'p', characters: 17 },
    });
    expect(h.hookCalls).toEqual(['replace_node:n13']);
    expect(h.copy.place('n13')!.node.content).toEqual([
      { type: 'text', text: 'ALPHA ' },
      { type: 'text', text: 'beta', marks: [{ type: 'emphasis' }] },
      { type: 'text', text: ' gamma.' },
    ]);
    expect(childTypes(h.copy, 'n10')).toEqual(['title', 'p', 'p', 'p', 'image', 'empty-line']);
  });

  it('replaces a node by Document JSON: the top node keeps its id, the nodes inside get sc_ ids', async () => {
    const out = await call('replace_node', {
      node: 'n21',
      content: {
        node: {
          type: 'title',
          attrs: { nodeId: 'ignored' },
          content: [
            {
              type: 'p',
              attrs: { nodeId: 'also-ignored' },
              content: [{ type: 'text', text: 'Two' }],
            },
          ],
        },
      },
    });
    expect(out.isError).toBe(false);
    expect(out.result.node).toMatchObject({ id: 'n21', path: 'body[1]/section[2]/title[1]' });
    const title = h.copy.place('n21')!.node;
    expect(title.attrs!.nodeId).toBe('n21');
    const inner = title.content![0]!;
    expect(String(inner.attrs!.nodeId)).toMatch(/^sc_\d+$/);
    expect(inner.content).toEqual([{ type: 'text', text: 'Two' }]);
    expect(h.copy.place('n22')).toBeUndefined();
    expect(h.hookCalls).toEqual(['replace_node:n21']);
  });

  it('replaces a paragraph of the description annotation through the description', async () => {
    const out = await call('replace_node', {
      node: 'title-info/annotation[1]/p[1]',
      content: { xml: '<p>About the novel.</p>' },
    });
    expect(out.isError).toBe(false);
    expect(out.result.node).toMatchObject({ id: 'n41', path: 'title-info/annotation[1]/p[1]' });
    const annotation = h.copy.document.description.titleInfo.annotation!;
    expect(annotation.attrs.nodeId).toBe('n40');
    expect(annotation.content).toEqual([
      {
        type: 'p',
        attrs: { nodeId: 'n41' },
        content: [{ type: 'text', text: 'About the novel.' }],
      },
    ]);
    const read = await call('read_part', { node: 'title-info/annotation[1]' });
    expect((read.result.blocks as { text: string }[])[0]!.text).toBe('About the novel.');
    // The annotation element itself belongs to set_description.
    const root = await call('replace_node', {
      node: 'title-info/annotation[1]',
      content: { xml: '<p>x</p>' },
    });
    expect(root.error?.code).toBe('notAllowed');
    expect(root.error?.hint).toContain('set_description');
    const beside = await call('insert_node', {
      where: 'before',
      node: 'n40',
      content: { xml: '<p>x</p>' },
    });
    expect(beside.error?.code).toBe('notAllowed');
    expect(h.hookCalls).toEqual(['replace_node:n41', 'replace_node:n40', 'insert_node:before@n40']);
  });

  it('refuses several elements (use insert_node), empty or inline content, both forms, and counts each attempt', async () => {
    const before = JSON.stringify(h.copy.document);
    const several = await call('replace_node', {
      node: 'n13',
      content: { xml: '<p>One</p><p>Two</p>' },
    });
    expect(several.error?.code).toBe('invalidArguments');
    expect(several.error?.hint).toContain('insert_node');
    const empty = await call('replace_node', { node: 'n13', content: { xml: '   ' } });
    expect(empty.error?.code).toBe('invalidArguments');
    const inline = await call('replace_node', { node: 'n13', content: { xml: 'bare text' } });
    expect(inline.error?.code).toBe('fragmentNotAllowed');
    const both = await call('replace_node', {
      node: 'n13',
      content: { xml: '<p>x</p>', node: { type: 'p' } },
    });
    expect(both.error?.code).toBe('invalidArguments');
    const neither = await call('replace_node', { node: 'n13', content: {} });
    expect(neither.error?.code).toBe('invalidArguments');
    expect(neither.error?.expected).toMatchObject({ content: {} });
    expect(JSON.stringify(h.copy.document)).toBe(before);
    // Every refused attempt went through the hook with the key of the node (C4).
    expect(h.hookCalls).toEqual(Array(5).fill('replace_node:n13'));
  });

  it('refuses an unknown node (the key names the reference as given), an invalid node and a misplaced one', async () => {
    const unknown = await call('replace_node', { node: 'n999', content: { xml: '<p>x</p>' } });
    expect(unknown.error?.code).toBe('unknownNode');
    const byPath = await call('replace_node', {
      node: 'body[1]/section[9]/p[1]',
      content: { xml: '<p>x</p>' },
    });
    expect(byPath.error?.code).toBe('unknownNode');
    // Document JSON the editor cannot build: a paragraph holding a section.
    const invalid = await call('replace_node', {
      node: 'n13',
      content: { node: { type: 'p', content: [{ type: 'section', content: [] }] } },
    });
    expect(invalid.error?.code).toBe('invalidNode');
    expect(invalid.error?.message).toMatch(/invalid node at/);
    const unknownType = await call('replace_node', {
      node: 'n13',
      content: { node: { type: 'chapter' } },
    });
    expect(unknownType.error?.code).toBe('invalidNode');
    const text = await call('replace_node', {
      node: 'n13',
      content: { node: { type: 'text', text: 'x' } },
    });
    expect(text.error?.code).toBe('invalidArguments');
    // A section among the blocks of a section: the parent's content expression refuses it.
    const misplaced = await call('replace_node', {
      node: 'n13',
      content: { xml: '<section><p>x</p></section>' },
    });
    expect(misplaced.error?.code).toBe('notAllowed');
    expect(misplaced.error?.hint).toContain('content model of "section"');
    const foreign = await call('replace_node', {
      node: 'n13',
      content: { xml: '<chapter>x</chapter>' },
    });
    expect(foreign.error?.code).toBe('fragmentNotAllowed');
    expect(foreign.error).toMatchObject({ element: 'chapter', parent: 'section' });
    expect(h.hookCalls).toEqual([
      'replace_node:n999',
      'replace_node:body[1]/section[9]/p[1]',
      'replace_node:n13',
      'replace_node:n13',
      'replace_node:n13',
      'replace_node:n13',
      'replace_node:n13',
    ]);
    expect(h.copy.changed).toBe(false);
  });

  it('never replaces the first body by a non-body; a body by a body is fine', async () => {
    const refused = await call('replace_node', {
      node: 'body[1]',
      content: {
        node: { type: 'section', content: [{ type: 'p', content: [{ type: 'text', text: 'x' }] }] },
      },
    });
    expect(refused.error?.code).toBe('notAllowed');
    expect(refused.error?.message).toMatch(/body/);
    const ok = await call('replace_node', {
      node: 'n30',
      content: {
        node: {
          type: 'body',
          attrs: { name: 'notes' },
          content: [
            {
              type: 'section',
              attrs: { id: 'n_1' },
              content: [{ type: 'p', content: [{ type: 'text', text: 'A new note.' }] }],
            },
          ],
        },
      },
    });
    expect(ok.isError).toBe(false);
    expect(ok.result.node).toMatchObject({ id: 'n30', path: 'body[2]', type: 'body' });
    expect(h.copy.document.bodies[1]!.attrs).toEqual({ nodeId: 'n30', name: 'notes' });
    expect(h.hookCalls).toEqual(['replace_node:n1', 'replace_node:n30']);
  });
});

describe('insert_node', () => {
  it('inserts several siblings after a node, in order, with fresh sc_ ids and paths', async () => {
    const out = await call('insert_node', {
      where: 'after',
      node: 'n13',
      content: { xml: '<p>One.</p>\n<empty-line/>\n<subtitle>Sub</subtitle>' },
    });
    expect(out.isError).toBe(false);
    const nodes = out.result.nodes as { id: string; path: string; type: string }[];
    expect(nodes.map((n) => n.type)).toEqual(['p', 'empty-line', 'subtitle']);
    expect(nodes.map((n) => n.path)).toEqual([
      'body[1]/section[1]/p[2]',
      'body[1]/section[1]/empty-line[1]',
      'body[1]/section[1]/subtitle[1]',
    ]);
    expect(nodes.every((n) => /^sc_\d+$/.test(n.id))).toBe(true);
    expect(childTypes(h.copy, 'n10')).toEqual([
      'title',
      'p',
      'p',
      'empty-line',
      'subtitle',
      'p',
      'p',
      'image',
      'empty-line',
    ]);
    expect(h.hookCalls).toEqual(['insert_node:after@n13']);
  });

  it('inserts before a node from Document JSON and appends as the last child (parse context = the node)', async () => {
    const before = await call('insert_node', {
      where: 'before',
      node: 'body[1]/section[1]/p[1]',
      content: {
        nodes: [
          { type: 'subtitle', content: [{ type: 'text', text: 'First' }] },
          { type: 'p', content: [{ type: 'text', text: 'Second' }] },
        ],
      },
    });
    expect(before.isError).toBe(false);
    expect((before.result.nodes as { path: string }[]).map((n) => n.path)).toEqual([
      'body[1]/section[1]/subtitle[1]',
      'body[1]/section[1]/p[1]',
    ]);
    expect(childTypes(h.copy, 'n10').slice(0, 4)).toEqual(['title', 'subtitle', 'p', 'p']);
    const append = await call('insert_node', {
      where: 'append',
      node: 'n20',
      content: { xml: '<p>Appended.</p>' },
    });
    expect(append.isError).toBe(false);
    expect((append.result.nodes as { path: string }[])[0]!.path).toBe('body[1]/section[2]/p[3]');
    expect(childTypes(h.copy, 'n20')).toEqual(['title', 'poem', 'p', 'p', 'p']);
    const appendBody = await call('insert_node', {
      where: 'append',
      node: 'n30',
      content: { xml: '<section><p>Another note.</p></section>' },
    });
    expect(appendBody.isError).toBe(false);
    expect(childTypes(h.copy, 'n30')).toEqual(['section', 'section']);
    expect(h.hookCalls).toEqual([
      'insert_node:before@n13',
      'insert_node:append@n20',
      'insert_node:append@n30',
    ]);
  });

  it('inserts into the description annotation and a body beside a body', async () => {
    const out = await call('insert_node', {
      where: 'after',
      node: 'n41',
      content: { xml: '<p>More about it.</p>' },
    });
    expect(out.isError).toBe(false);
    expect((out.result.nodes as { path: string }[])[0]!.path).toBe('title-info/annotation[1]/p[2]');
    expect(
      h.copy.document.description.titleInfo.annotation!.content.map((c) => c.attrs.nodeId),
    ).toEqual(['n41', expect.stringMatching(/^sc_/)]);
    const body = await call('insert_node', {
      where: 'before',
      node: 'n30',
      content: {
        nodes: [
          {
            type: 'body',
            content: [
              { type: 'section', content: [{ type: 'p', content: [{ type: 'text', text: 'x' }] }] },
            ],
          },
        ],
      },
    });
    expect(body.isError).toBe(false);
    expect((body.result.nodes as { path: string }[])[0]!.path).toBe('body[2]');
    expect(h.copy.document.bodies.map((b) => b.attrs.nodeId)).toEqual([
      'n1',
      expect.stringMatching(/^sc_/),
      'n30',
    ]);
  });

  it('refuses empty xml / nodes, content the parent cannot hold, appending to a leaf and unknown nodes - each a strike', async () => {
    const before = JSON.stringify(h.copy.document);
    const empty = await call('insert_node', { where: 'after', node: 'n13', content: { xml: '' } });
    expect(empty.error?.code).toBe('invalidArguments');
    const noNodes = await call('insert_node', {
      where: 'after',
      node: 'n13',
      content: { nodes: [] },
    });
    expect(noNodes.error?.code).toBe('invalidArguments');
    const misplaced = await call('insert_node', {
      where: 'after',
      node: 'n13',
      content: { xml: '<section><p>x</p></section>' },
    });
    expect(misplaced.error?.code).toBe('notAllowed');
    expect(misplaced.error?.hint).toContain('content model of "section"');
    const foreign = await call('insert_node', {
      where: 'before',
      node: 'n13',
      content: { xml: '<chapter/>' },
    });
    expect(foreign.error?.code).toBe('fragmentNotAllowed');
    const inline = await call('insert_node', {
      where: 'before',
      node: 'n13',
      content: { xml: 'loose text' },
    });
    expect(inline.error?.code).toBe('fragmentNotAllowed');
    const leaf = await call('insert_node', {
      where: 'append',
      node: 'n13',
      content: { xml: '<p>x</p>' },
    });
    expect(leaf.error?.code).toBe('notAllowed');
    const unknown = await call('insert_node', {
      where: 'after',
      node: 'n999',
      content: { xml: '<p>x</p>' },
    });
    expect(unknown.error?.code).toBe('unknownNode');
    const where = await call('insert_node', {
      where: 'inside',
      node: 'n13',
      content: { xml: '<p>x</p>' },
    });
    expect(where.error?.code).toBe('invalidArguments');
    expect(where.error?.expected).toMatchObject({ type: 'object' });
    expect(JSON.stringify(h.copy.document)).toBe(before);
    expect(h.hookCalls).toEqual([
      'insert_node:after@n13',
      'insert_node:after@n13',
      'insert_node:after@n13',
      'insert_node:before@n13',
      'insert_node:before@n13',
      'insert_node:append@n13',
      'insert_node:after@n999',
    ]);
  });
});

describe('remove_node', () => {
  it('removes a node and reports it with its character count', async () => {
    const out = await call('remove_node', { node: 'n15' });
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({
      removed: { id: 'n15', path: 'body[1]/section[1]/p[3]', type: 'p', characters: 31 },
      characters: 31,
    });
    expect(h.copy.place('n15')).toBeUndefined();
    expect(childTypes(h.copy, 'n10')).toEqual(['title', 'p', 'p', 'image', 'empty-line']);
    const poem = await call('remove_node', { node: 'body[1]/section[2]/poem[1]' });
    expect(poem.result.removed).toMatchObject({ id: 'n23', type: 'poem' });
    expect(poem.result.characters).toBe('Line one'.length + 'Line two'.length);
    const emptyLine = await call('remove_node', { node: 'n17' });
    expect(emptyLine.result).toEqual({
      removed: { id: 'n17', path: 'body[1]/section[1]/empty-line[1]', type: 'empty-line' },
      characters: 0,
    });
    expect(h.hookCalls).toEqual(['remove_node:n15', 'remove_node:n23', 'remove_node:n17']);
  });

  it('refuses the first body and a removal the parent needs, with the content model in the hint', async () => {
    const first = await call('remove_node', { node: 'body[1]' });
    expect(first.error?.code).toBe('notAllowed');
    expect(first.error?.hint).toContain('image? title? epigraph* section+');
    // The only section of the notes body.
    const lastSection = await call('remove_node', { node: 'n31' });
    expect(lastSection.error?.code).toBe('notAllowed');
    expect(lastSection.error?.hint).toContain('image? title? epigraph* section+');
    expect(lastSection.error?.contentModel).toBe('image? title? epigraph* section+');
    // The last line of a stanza.
    expect((await call('remove_node', { node: 'n25' })).isError).toBe(false);
    const lastVerse = await call('remove_node', { node: 'n26' });
    expect(lastVerse.error?.code).toBe('notAllowed');
    expect(lastVerse.error?.hint).toContain('title? subtitle? v+');
    const unknown = await call('remove_node', { node: 'n999' });
    expect(unknown.error?.code).toBe('unknownNode');
    // Another body may go, like a whole section of body 1.
    expect((await call('remove_node', { node: 'body[2]' })).isError).toBe(false);
    expect(h.copy.document.bodies).toHaveLength(1);
    expect(h.hookCalls).toEqual([
      'remove_node:n1',
      'remove_node:n31',
      'remove_node:n25',
      'remove_node:n26',
      'remove_node:n999',
      'remove_node:n30',
    ]);
  });

  it('removes a paragraph of the annotation and the annotation itself through the description', async () => {
    const paragraph = await call('remove_node', { node: 'title-info/annotation[1]/p[1]' });
    expect(paragraph.isError).toBe(false);
    expect(h.copy.document.description.titleInfo.annotation!.content).toEqual([]);
    const root = await call('remove_node', { node: 'title-info/annotation[1]' });
    expect(root.isError).toBe(false);
    expect(root.result.removed).toMatchObject({ id: 'n40', type: 'annotation' });
    expect(h.copy.document.description.titleInfo).not.toHaveProperty('annotation');
    expect(h.copy.document.bodies).toBe(h.copy.document.bodies); // the bodies untouched
  });
});

describe('set_text', () => {
  it('replaces the whole inline content by plain text - every mark and link is lost', async () => {
    const out = await call('set_text', { node: 'n14', text: 'He stayed in.' });
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({
      node: { id: 'n14', path: 'body[1]/section[1]/p[2]', type: 'p', characters: 13 },
    });
    expect(h.copy.place('n14')!.node).toEqual({
      type: 'p',
      attrs: { nodeId: 'n14' },
      content: [{ type: 'text', text: 'He stayed in.' }],
    });
    const verse = await call('set_text', {
      node: 'body[1]/section[2]/poem[1]/stanza[1]/v[2]',
      text: 'Line 2',
    });
    expect(verse.result.node).toMatchObject({ id: 'n26', type: 'v', characters: 6 });
    const cleared = await call('set_text', { node: 'n13', text: '' });
    expect(cleared.isError).toBe(false);
    expect(h.copy.place('n13')!.node.content).toEqual([]);
    expect(h.hookCalls).toEqual(['set_text:n14', 'set_text:n26', 'set_text:n13']);
  });

  it('refuses anything but a text container with textOnly and the replace_node hint', async () => {
    for (const node of ['n10', 'body[1]/section[2]/poem[1]', 'n16', 'n2']) {
      const out = await call('set_text', { node, text: 'x' });
      expect(out.error?.code, node).toBe('textOnly');
      expect(out.error?.hint).toContain('replace_node');
    }
    const unknown = await call('set_text', { node: 'n999', text: 'x' });
    expect(unknown.error?.code).toBe('unknownNode');
    const missing = await call('set_text', { node: 'n13' });
    expect(missing.error?.code).toBe('invalidArguments');
    expect(h.copy.changed).toBe(false);
    expect(h.hookCalls).toEqual([
      'set_text:n10',
      'set_text:n23',
      'set_text:n16',
      'set_text:n2',
      'set_text:n999',
    ]);
  });
});

describe('replace_all', () => {
  it('replaces every match in the bodies with the exact count and the changed blocks listed', async () => {
    const out = await call('replace_all', { text: 'beta', replacement: 'BETA' });
    expect(out.isError).toBe(false);
    expect(out.result.count).toBe(4);
    const blocks = out.result.blocks as { id: string; path: string }[];
    expect(blocks.map((b) => b.id)).toEqual(['n13', 'n15', 'n27']);
    expect(blocks[0]!.path).toBe('body[1]/section[1]/p[1]');
    expect(textOf(h.copy, 'n13')).toBe('Alpha BETA gamma.');
    expect(textOf(h.copy, 'n15')).toBe('BETA again, and BETA once more.');
    expect(textOf(h.copy, 'n27')).toBe('Second section BETA.');
    expect(h.copy.document.description.titleInfo.annotation!.content[0]!).toMatchObject({
      attrs: { nodeId: 'n41' },
    });
    expect(h.hookCalls).toEqual(['replace_all:beta']);
  });

  it('count 0 is a success without the hook, a strike or a change', async () => {
    const out = await call('replace_all', { text: 'nothing like this', replacement: 'x' });
    expect(out.isError).toBe(false);
    expect(out.result).toEqual({ count: 0, blocks: [] });
    expect(h.hookCalls).toEqual([]);
    expect(h.copy.changed).toBe(false);
  });

  it('keeps the marks around a match and expands $-groups, case and style flags for a regex', async () => {
    // Inside the emphasised "went": the replacement keeps the emphasis (as mfbe.doc.replaceAll).
    const inside = await call('replace_all', { text: 'en', replacement: 'EN', within: 'n14' });
    expect(inside.result.count).toBe(1);
    expect(h.copy.place('n14')!.node.content![1]).toEqual({
      type: 'text',
      text: 'wENt',
      marks: [{ type: 'emphasis' }],
    });
    const regex = await call('replace_all', {
      text: 'line (\\w+)',
      regex: 'true',
      replacement: 'Verse $E$1$Q!',
    });
    expect(regex.result.count).toBe(2);
    expect((regex.result.blocks as { id: string }[]).map((b) => b.id)).toEqual(['n25', 'n26']);
    expect(h.copy.place('n25')!.node.content).toEqual([
      { type: 'text', text: 'Verse ' },
      { type: 'text', text: 'one', marks: [{ type: 'emphasis' }] },
      { type: 'text', text: '!' },
    ]);
    const upper = await call('replace_all', {
      text: '(second) section',
      regex: true,
      matchCase: true,
      replacement: '$U$1$Q part',
    });
    expect(upper.result.count).toBe(0); // matchCase: "Second" is capitalised
    const titled = await call('replace_all', {
      text: '(second) section',
      regex: true,
      replacement: '$U$1$Q part',
    });
    expect(titled.result.count).toBe(1);
    expect(textOf(h.copy, 'n27')).toBe('SECOND part BETA.'.replace('BETA', 'beta'));
    expect(h.hookCalls).toEqual([
      'replace_all:en',
      'replace_all:line (\\w+)',
      'replace_all:(second) section',
    ]);
  });

  it('replaces inside a node only, in the description annotation too', async () => {
    const within = await call('replace_all', {
      text: 'beta',
      replacement: 'B',
      within: 'body[1]/section[2]',
    });
    expect(within.result.count).toBe(1);
    expect(textOf(h.copy, 'n13')).toBe('Alpha beta gamma.');
    const annotation = await call('replace_all', {
      text: 'book',
      replacement: 'novel',
      within: 'title-info/annotation[1]',
    });
    expect(annotation.result.count).toBe(1);
    expect((annotation.result.blocks as { path: string }[])[0]!.path).toBe(
      'title-info/annotation[1]/p[1]',
    );
    const first = h.copy.document.description.titleInfo.annotation!.content[0] as ModelNodeJson;
    expect(first.content).toEqual([{ type: 'text', text: 'About the novel.' }]);
  });

  it('an invalid expression or an unknown within is a refused attempt of the query key', async () => {
    const bad = await call('replace_all', { text: '(', regex: true, replacement: 'x' });
    expect(bad.error?.code).toBe('invalidArguments');
    expect(bad.error?.message).toMatch(/regular expression/);
    const unknown = await call('replace_all', { text: 'a', replacement: 'b', within: 'n999' });
    expect(unknown.error?.code).toBe('unknownNode');
    const missing = await call('replace_all', { text: 'a' });
    expect(missing.error?.code).toBe('invalidArguments');
    expect(h.hookCalls).toEqual(['replace_all:(', 'replace_all:a']);
    expect(h.copy.changed).toBe(false);
  });
});

describe('set_description', () => {
  it('merges one level deep: given members replace, absent members stay, lists replace whole; the fields are listed', async () => {
    const out = await call('set_description', {
      description: {
        titleInfo: {
          bookTitle: 'Omega',
          genres: ['prose', { code: 'sf', match: '50' }],
          keywords: 'alpha, omega',
        },
        documentInfo: { authors: [{ lastName: 'Sidorov' }], version: 1.1 },
      },
    });
    expect(out.isError).toBe(false);
    expect(out.result.fields).toEqual([
      'titleInfo.bookTitle',
      'titleInfo.genres',
      'titleInfo.keywords',
      'documentInfo.authors',
      'documentInfo.version',
    ]);
    expect(out.result.validation).toEqual({ newErrors: 0, preExistingErrors: 0 });
    const description = out.result.description as Record<string, Record<string, unknown>>;
    expect(description.titleInfo).toMatchObject({
      bookTitle: 'Omega',
      genres: [{ code: 'prose' }, { code: 'sf', match: 50 }],
      keywords: 'alpha, omega',
      authors: [{ firstName: 'Ivan', lastName: 'Petrov', homePages: [], emails: [] }],
      lang: 'en',
      annotation: { xml: '<p>About the book.</p>' },
    });
    expect(description.documentInfo).toMatchObject({
      authors: [{ lastName: 'Sidorov', homePages: [], emails: [] }],
      version: '1.1',
      id: 'id',
      date: { text: '2026' },
    });
    expect(h.hookCalls).toEqual(['set_description:description']);
    const copy = h.copy.document.description;
    expect(copy.titleInfo.bookTitle).toBe('Omega');
    expect(copy.titleInfo.annotation!.attrs.nodeId).toBe('n40');
    expect(copy.documentInfo.publishers).toEqual([]);
    // The same through get_description afterwards.
    const read = await call('get_description', {});
    expect(read.result.description).toEqual(out.result.description);
  });

  it('takes annotation and history as {xml} (ids kept / issued) or null to remove, and whole blocks', async () => {
    const out = await call('set_description', {
      description: {
        titleInfo: { annotation: { xml: '<p>New.</p>\n<p>Second.</p>' } },
        documentInfo: { history: { xml: '```xml\n<p>v1.1 - fixed</p>\n```' } },
        srcTitleInfo: { bookTitle: 'Original', lang: 'fr' },
        publishInfo: { publisher: 'X', year: 2001 },
        customInfo: [{ infoType: 'note', text: 'kept' }],
        outputs: [{ xml: '<output mode="free"/>' }],
      },
    });
    expect(out.isError).toBe(false);
    expect(out.result.fields).toEqual([
      'titleInfo.annotation',
      'documentInfo.history',
      'srcTitleInfo.bookTitle',
      'srcTitleInfo.lang',
      'publishInfo.publisher',
      'publishInfo.year',
      'customInfo',
      'outputs',
    ]);
    const copy = h.copy.document.description;
    expect(copy.titleInfo.annotation!.attrs.nodeId).toBe('n40'); // the existing node keeps its id
    expect(copy.titleInfo.annotation!.content.map((c) => c.attrs.nodeId)).toEqual([
      expect.stringMatching(/^sc_/),
      expect.stringMatching(/^sc_/),
    ]);
    expect(copy.documentInfo.history!.type).toBe('annotation');
    expect(copy.documentInfo.history!.attrs.nodeId).toMatch(/^sc_/);
    expect(copy.srcTitleInfo).toEqual({
      genres: [],
      authors: [],
      bookTitle: 'Original',
      coverpage: [],
      lang: 'fr',
      translators: [],
      sequences: [],
    });
    expect(copy.publishInfo).toEqual({ publisher: 'X', year: '2001', sequences: [] });
    expect(copy.customInfo).toEqual([{ infoType: 'note', text: 'kept' }]);
    expect(copy.outputs[0]).toMatchObject({
      type: 'raw-xml',
      attrs: { xml: '<output mode="free"/>' },
    });
    const description = out.result.description as Record<string, Record<string, unknown>>;
    expect(description.titleInfo!.annotation).toEqual({ xml: '<p>New.</p>\n<p>Second.</p>' });
    expect(description.documentInfo!.history).toEqual({ xml: '<p>v1.1 - fixed</p>' });
    expect(description.outputs).toEqual([{ xml: '<output mode="free"/>' }]);
    // The new history paragraph is addressable like any node.
    const read = await call('read_part', { node: 'document-info/history[1]' });
    expect((read.result.blocks as { text: string }[]).map((b) => b.text)).toEqual(['v1.1 - fixed']);

    const removed = await call('set_description', {
      description: { titleInfo: { annotation: null }, srcTitleInfo: null, publishInfo: null },
    });
    expect(removed.isError).toBe(false);
    expect(removed.result.fields).toEqual(['titleInfo.annotation', 'srcTitleInfo', 'publishInfo']);
    const after = h.copy.document.description;
    expect(after.titleInfo).not.toHaveProperty('annotation');
    expect(after).not.toHaveProperty('srcTitleInfo');
    expect(after).not.toHaveProperty('publishInfo');
    expect(after.documentInfo.history).toBeDefined(); // untouched
    expect(h.hookCalls).toEqual(['set_description:description', 'set_description:description']);
  });

  it('refuses removing titleInfo / documentInfo, unknown members, wrong shapes and an empty patch - each a strike, nothing applied', async () => {
    const before = JSON.stringify(h.copy.document);
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ titleInfo: null }, /titleInfo cannot be removed/],
      [{ documentInfo: null }, /documentInfo cannot be removed/],
      [{}, /nothing to change/],
      [{ title: 'x' }, /unknown description member/],
      [{ titleInfo: { title: 'x' } }, /unknown titleInfo member/],
      [{ titleInfo: { genres: 'sf' } }, /genres must be a list/],
      [{ titleInfo: { authors: ['Ivan Petrov'] } }, /person object/],
      [{ documentInfo: { date: null } }, /cannot be removed/],
      [{ outputs: [{}] }, /outputs\[0\]/],
    ];
    for (const [description, message] of cases) {
      const out = await call('set_description', { description });
      expect(out.error?.code, JSON.stringify(description)).toBe('invalidArguments');
      expect(out.error?.message).toMatch(message);
      expect(out.error?.expected).toBeDefined();
    }
    const unknownHint = await call('set_description', { description: { bookTitle: 'x' } });
    expect(unknownHint.error?.hint).toContain('titleInfo');
    // Not an object at all: the schema refuses it before the handler (the SDK's validation,
    // re-shaped into invalidArguments with the schema as `expected`; no hook, no strike).
    const notObject = await call('set_description', { description: 'Omega' });
    expect(notObject.error?.code).toBe('invalidArguments');
    expect(notObject.error?.expected).toMatchObject({ required: ['description'] });
    // An annotation that is not well-formed, or holds bare text: the core's refusals.
    const entity = await call('set_description', {
      description: { titleInfo: { annotation: { xml: '<p>a&nbsp;b</p>' } } },
    });
    expect(entity.error?.code).toBe('invalidXml');
    const inline = await call('set_description', {
      description: { documentInfo: { history: { xml: 'bare text' } } },
    });
    expect(inline.error?.code).toBe('fragmentNotAllowed');
    expect(JSON.stringify(h.copy.document)).toBe(before);
    expect(h.hookCalls).toEqual(Array(cases.length + 3).fill('set_description:description'));
  });
});
