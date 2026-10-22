/**
 * Shared harness of the catalogue tests (feature 005 T041): a small fixture book, a fake
 * `CatalogueDeps` over a real `WorkingCopy` with a tiny FB2 serialiser / parser standing in for
 * the core's `doc.fragmentToXml` / `doc.fragmentFromXml` (plain paragraphs, `<emphasis>` /
 * `<strong>` marks, `<empty-line/>`, `<subtitle>`; `&nbsp;` is a 1001, an unknown element a
 * 1201), the in-place regex runner and a recording hook.
 */

import {
  createCatalogue,
  selectionHolder,
  type Catalogue,
  type CatalogueDeps,
  type ModelSelection,
  type ParsedFragment,
  type ToolErrorEnvelope,
} from '@/ai/catalogue';
import { runRegexSearch, type RegexRunner } from '@/ai/regexRunner';
import type { ModelNodeJson } from '@/editor/fromModel';
import type { BodyNode, Document, InlineNode, ParagraphNode, SectionNode } from '@/model/document';
import { RpcError } from '@/rpc/client';
import { WorkingCopy } from '@/scripting/workingCopy';

import { fakeDocument } from '../features/testUtils';

export function paragraph(nodeId: string, content: string | InlineNode[]) {
  return {
    type: 'p' as const,
    attrs: { nodeId },
    content: typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content,
  } as SectionNode['content'][number];
}

/**
 * The fixture: body 1 with a title and two sections (section 1: a title, three paragraphs - the
 * second with an emphasis and a footnote link -, an image, an empty line; section 2: a poem and
 * two paragraphs), and a notes body with one section; an annotation in the description.
 */
export function book(): Document {
  const base = fakeDocument();
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'n1' },
    content: [
      { type: 'title', attrs: { nodeId: 'n2' }, content: [paragraph('n3', 'The Book')] },
      {
        type: 'section',
        attrs: { nodeId: 'n10' },
        content: [
          { type: 'title', attrs: { nodeId: 'n11' }, content: [paragraph('n12', 'ONE')] },
          paragraph('n13', 'Alpha beta gamma.'),
          paragraph('n14', [
            { type: 'text', text: 'He ' },
            { type: 'text', text: 'went', marks: [{ type: 'emphasis' }] },
            { type: 'text', text: ' out' },
            {
              type: 'text',
              text: '1',
              marks: [{ type: 'link', attrs: { href: '#n_1', type: 'note' } }],
            },
            { type: 'text', text: '.' },
          ]),
          paragraph('n15', 'Beta again, and beta once more.'),
          { type: 'image', attrs: { nodeId: 'n16', href: '#cover.png', alt: 'Cover' } },
          { type: 'empty-line', attrs: { nodeId: 'n17' } },
        ],
      } as SectionNode,
      {
        type: 'section',
        attrs: { nodeId: 'n20' },
        content: [
          { type: 'title', attrs: { nodeId: 'n21' }, content: [paragraph('n22', 'TWO')] },
          {
            type: 'poem',
            attrs: { nodeId: 'n23' },
            content: [
              {
                type: 'stanza',
                attrs: { nodeId: 'n24' },
                content: [
                  {
                    type: 'v',
                    attrs: { nodeId: 'n25' },
                    content: [{ type: 'text', text: 'Line one' }],
                  },
                  {
                    type: 'v',
                    attrs: { nodeId: 'n26' },
                    content: [{ type: 'text', text: 'Line two' }],
                  },
                ],
              },
            ],
          },
          paragraph('n27', 'Second section beta.'),
          paragraph('n28', 'The last paragraph.'),
        ],
      } as SectionNode,
    ] as BodyNode['content'],
  };
  const notes: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'n30', name: 'notes' },
    content: [
      {
        type: 'section',
        attrs: { nodeId: 'n31', id: 'n_1' },
        content: [paragraph('n32', 'A note.')],
      },
    ] as BodyNode['content'],
  };
  return {
    ...base,
    description: {
      ...base.description,
      titleInfo: {
        ...base.description.titleInfo,
        annotation: {
          type: 'annotation',
          attrs: { nodeId: 'n40' },
          content: [paragraph('n41', 'About the book.') as ParagraphNode],
        },
      },
    },
    bodies: [body, notes],
  };
}

/* ------------------------------------------------------------------ fake XML */

const ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const esc = (text: string) => text.replace(/[&<>]/g, (c) => ESCAPE[c]!);

function inlineXml(content: readonly InlineNode[]): string {
  return content
    .map((node) => {
      if (node.type !== 'text')
        return `<image l:href="${(node as { attrs: { href: string } }).attrs.href}"/>`;
      let out = esc(node.text);
      for (const mark of node.marks ?? []) {
        if (mark.type === 'link') {
          const type = mark.attrs.type ? ` type="${mark.attrs.type}"` : '';
          out = `<a l:href="${mark.attrs.href}"${type}>${out}</a>`;
        } else if (mark.type === 'style') {
          out = `<style name="${mark.attrs.name}">${out}</style>`;
        } else {
          out = `<${mark.type}>${out}</${mark.type}>`;
        }
      }
      return out;
    })
    .join('');
}

const TEXT_CONTAINERS = new Set(['p', 'subtitle', 'text-author', 'v', 'td', 'th', 'date']);

/** A tiny FB2 writer for the tests (no tabs: the layout is the core's business). */
export function fakeToXml(nodes: readonly ModelNodeJson[]): string {
  const render = (node: ModelNodeJson): string => {
    if (node.type === 'text') return inlineXml([node as InlineNode]);
    if (node.type === 'empty-line') return '<empty-line/>';
    if (node.type === 'image') return `<image l:href="${String(node.attrs?.href)}"/>`;
    if (TEXT_CONTAINERS.has(node.type)) {
      return `<${node.type}>${inlineXml((node.content ?? []) as InlineNode[])}</${node.type}>`;
    }
    const attrs = Object.entries(node.attrs ?? {})
      .filter(([k, v]) => k !== 'nodeId' && v !== undefined && v !== null)
      .map(([k, v]) => ` ${k}="${String(v)}"`)
      .join('');
    return `<${node.type}${attrs}>${(node.content ?? []).map(render).join('\n')}</${node.type}>`;
  };
  const inline = nodes.every((node) => node.type === 'text' || node.type === 'inline-image');
  return inline ? inlineXml(nodes as InlineNode[]) : nodes.map(render).join('\n');
}

const KNOWN_BLOCKS = new Set([
  'p',
  'subtitle',
  'empty-line',
  'poem',
  'stanza',
  'v',
  'cite',
  'title',
  'section',
  'epigraph',
  'text-author',
]);
const KNOWN_INLINE = new Set([
  'emphasis',
  'strong',
  'strikethrough',
  'sub',
  'sup',
  'code',
  'a',
  'style',
]);

function unescape(text: string): string {
  if (/&nbsp;/.test(text)) {
    throw new RpcError(1001, 'xml parse error', {
      line: 1,
      column: text.indexOf('&nbsp;') + 1,
      message: "Entity 'nbsp' not defined",
    });
  }
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function parseInline(xml: string, parent: string): InlineNode[] {
  const out: InlineNode[] = [];
  const re =
    /<(emphasis|strong|strikethrough|sub|sup|code|a|style|[a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>([\s\S]*?)<\/\1>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[4] !== undefined) {
      out.push({ type: 'text', text: unescape(m[4]) });
      continue;
    }
    const tag = m[1]!;
    if (!KNOWN_INLINE.has(tag))
      throw new RpcError(1201, 'fragment not allowed', { element: tag, parent });
    const inner = parseInline(m[3]!, tag);
    const mark =
      tag === 'a'
        ? {
            type: 'link' as const,
            attrs: {
              href: /l:href="([^"]*)"/.exec(m[2] ?? '')?.[1] ?? '',
              ...(/type="note"/.test(m[2] ?? '') ? { type: 'note' } : {}),
            },
          }
        : tag === 'style'
          ? {
              type: 'style' as const,
              attrs: { name: /name="([^"]*)"/.exec(m[2] ?? '')?.[1] ?? '' },
            }
          : { type: tag as 'emphasis' };
    for (const node of inner) {
      if (node.type === 'text') out.push({ ...node, marks: [...(node.marks ?? []), mark] });
      else out.push(node);
    }
  }
  if (/<[^>]*$/.test(xml) || /^[^<]*>/.test(xml.replace(/&gt;/g, ''))) {
    throw new RpcError(1001, 'xml parse error', {
      line: 1,
      column: 1,
      message: 'Premature end of data in tag',
    });
  }
  return out;
}

function parseBlocks(xml: string, parent: string): ModelNodeJson[] {
  const out: ModelNodeJson[] = [];
  const re =
    /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?\/>|<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>([\s\S]*?)<\/\3>|([^<\s][^<]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    if (m[6] !== undefined)
      throw new RpcError(1201, 'fragment not allowed', { element: '#text', parent });
    const tag = (m[1] ?? m[3])!;
    if (tag === 'FictionBook' || tag === 'body') {
      throw new RpcError(1201, 'fragment not allowed', { element: tag, parent });
    }
    if (!KNOWN_BLOCKS.has(tag))
      throw new RpcError(1201, 'fragment not allowed', { element: tag, parent });
    if (m[1]) {
      out.push({ type: tag, attrs: {} });
      continue;
    }
    const inner = m[5]!;
    out.push(
      TEXT_CONTAINERS.has(tag)
        ? { type: tag, attrs: {}, content: parseInline(inner, tag) as ModelNodeJson[] }
        : { type: tag, attrs: {}, content: parseBlocks(inner, tag) },
    );
  }
  if (/<\?xml/.test(xml)) {
    throw new RpcError(1001, 'xml parse error', {
      line: 1,
      column: 1,
      message: 'XML declaration allowed only at the start of the document',
    });
  }
  return out;
}

/** The stand-in of `doc.fragmentFromXml` (the parent's element decides inline vs blocks). */
export function fakeFromXml(
  xml: string,
  parent: { nodeId: string } | { element: string },
  document: Document,
): ParsedFragment {
  let element: string;
  if ('element' in parent) element = parent.element;
  else {
    element = findType(document, parent.nodeId) ?? 'section';
  }
  if (TEXT_CONTAINERS.has(element)) {
    return { nodes: parseInline(xml, element) as never, inline: true };
  }
  return { nodes: parseBlocks(xml, element) as never, inline: false };
}

function findType(document: Document, nodeId: string): string | undefined {
  let found: string | undefined;
  const visit = (node: ModelNodeJson) => {
    if (found || node.type === 'text') return;
    if (node.attrs?.nodeId === nodeId) found = node.type;
    for (const child of node.content ?? []) visit(child);
  };
  for (const body of document.bodies) visit(body as unknown as ModelNodeJson);
  return found;
}

/* --------------------------------------------------------------- the deps */

export interface Harness {
  catalogue: Catalogue;
  copy: WorkingCopy;
  deps: CatalogueDeps;
  /** Strike keys the hook saw, in order. */
  hookCalls: string[];
  setSelection(selection: ModelSelection): void;
  selection(): ModelSelection;
}

export const inPlaceRegex: RegexRunner = (request) => Promise.resolve(runRegexSearch(request));

export async function harness(
  overrides: Partial<CatalogueDeps> & { document?: Document } = {},
): Promise<Harness> {
  const document = overrides.document ?? book();
  const copy = new WorkingCopy(document);
  const selection = selectionHolder({
    kind: 'none',
    anchor: { nodeId: 'n13', offset: 0 },
    head: { nodeId: 'n13', offset: 0 },
  });
  const hookCalls: string[] = [];
  let next = 1;
  const deps: CatalogueDeps = {
    copy,
    selection,
    context: () => ({
      editor: { name: 'Maxima Fiction Book Editor', version: 'test' },
      activeView: 'body',
      uiLanguage: 'en',
      uiLanguageName: 'English',
      documentLanguage: 'en',
      book: { title: 'Alpha' },
      counts: {
        characters: 1,
        words: 1,
        paragraphs: 1,
        sections: 1,
        images: 0,
        notes: 0,
        binaries: 0,
      },
      modified: false,
      selection: { kind: 'none', characters: 0, paragraphs: 0, hasInlineElements: false },
      caret: { id: 'n13', path: 'body[1]/section[1]/p[1]' },
      outline: [{ id: 'n1' }],
      request: { kind: 'general', source: 'panel' },
      preExistingErrors: 0,
      scriptsAvailable: true,
    }),
    changesInThisRequest: () => hookCalls.length,
    startedAt: Date.now() - 1000,
    fragmentToXml: (nodes) => Promise.resolve(fakeToXml(nodes as unknown as ModelNodeJson[])),
    fragmentFromXml: (xml, parent) => {
      try {
        return Promise.resolve(fakeFromXml(xml, parent, copy.document));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    nextNodeId: () => `sc_${next++}`,
    runRegex: inPlaceRegex,
    applyChange: async <T extends object>(
      key: string,
      change: () => Promise<T>,
    ): Promise<T | ToolErrorEnvelope> => {
      hookCalls.push(key);
      const checkpoint = copy.checkpoint();
      try {
        return await change();
      } catch (error) {
        copy.rollback(checkpoint);
        const body = (error as { body?: ToolErrorEnvelope['error'] }).body;
        return { error: body ?? { code: 'internal', message: String(error) } };
      }
    },
    ...overrides,
  };
  const catalogue = await createCatalogue(deps);
  return {
    catalogue,
    copy,
    deps,
    hookCalls,
    setSelection: (s) => selection.set(s),
    selection: () => selection.get(),
  };
}

export const inlineSelection = (nodeId: string, from: number, to: number): ModelSelection => ({
  kind: 'inline',
  anchor: { nodeId, offset: from },
  head: { nodeId, offset: to },
});

export const blocksSelection = (
  nodeIds: string[],
  options: {
    anchor?: { nodeId: string; offset: number };
    head?: { nodeId: string; offset: number };
    openStart?: boolean;
    openEnd?: boolean;
  } = {},
): ModelSelection => ({
  kind: 'blocks',
  anchor: options.anchor ?? { nodeId: nodeIds[0]!, offset: 0 },
  head: options.head ?? { nodeId: nodeIds[nodeIds.length - 1]!, offset: 0 },
  nodeIds,
  openStart: options.openStart ?? false,
  openEnd: options.openEnd ?? false,
});
