// @vitest-environment node
/**
 * The catalogue over `InMemoryTransport` (feature 005 T041; ai-catalogue §1, §3.1–§3.2, §3.7,
 * §5; data-model §8): the tools registered so far in the §3 order, the name rule, description
 * lengths, object schemas, coercion of numeric strings, the §1.4 envelopes for an unknown tool
 * and bad arguments, every tool's happy path and refusals against a fixture book, the
 * continuation protocol on an oversize part and the prompts. US3/US4/US6 extend this file.
 */

import {
  CATALOGUE_VERSION,
  MAX_DESCRIPTION_LENGTH,
  TOOL_NAME_RULE,
  US2_TOOL_NAMES,
} from '@/ai/catalogue';
import type { ModelNodeJson } from '@/editor/fromModel';

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
  it('lists the US2 tools in the §3 order with the name rule, short descriptions and object schemas', () => {
    const tools = h.catalogue.listed();
    expect(tools.map((t) => t.name)).toEqual([...US2_TOOL_NAMES]);
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
  });

  it('builds the service tools array once, with $schema stripped and nothing else changed', () => {
    const tools = h.catalogue.tools();
    expect(h.catalogue.tools()).toBe(tools);
    expect(tools).toHaveLength(US2_TOOL_NAMES.length);
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
