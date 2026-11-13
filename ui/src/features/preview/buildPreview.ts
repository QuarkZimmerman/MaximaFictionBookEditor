/**
 * Feature 011 (US10; D44 and its clarifications; contracts/styles.md §5; research DP-17): the book as
 * a reader lays it out. The builder writes the book's own elements into Preview's frame in the FB2
 * namespace, so the book's selectors (`p`, `epigraph`, `section > title`, `.letter`) match them as
 * they match in a reader, under the e-reader base sheet and the book's stylesheets in order. Tables
 * are written as the HTML elements of the same names, so merged cells keep their shape and the same
 * selectors still match. Pictures use the route of the Body view's pictures; links and note
 * references carry their targets for the overlay's navigation. Building goes section by section,
 * reports its progress and stops when cancelled.
 */
import type { ModelNodeJson } from '@/editor/fromModel';
import { binaryPreviewUrl } from '@/model/binaryUrls';
import type { Document } from '@/model/document';

import readerBase from './readerBase.css?raw';

export const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
export const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** Elements written as their HTML namesakes (tables keep their spans). */
const HTML_ELEMENTS = new Set(['table', 'tr', 'th', 'td']);

const MARK_ELEMENTS: Readonly<Record<string, string>> = {
  strong: 'strong',
  emphasis: 'emphasis',
  strikethrough: 'strikethrough',
  sub: 'sub',
  sup: 'sup',
  code: 'code',
};

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface PreviewBuildOptions {
  docId: string | null;
  signal?: AbortSignal;
  /** Called while building: the units (top-level elements of the bodies) done and in all. */
  onProgress?: (done: number, total: number) => void;
}

export interface PreviewBuild {
  /** The element of each model node id. */
  elements: Map<string, Element>;
  /** The element of each FB2 `id` (link targets). */
  ids: Map<string, Element>;
}

class Builder {
  readonly elements = new Map<string, Element>();
  readonly ids = new Map<string, Element>();

  constructor(
    readonly doc: globalThis.Document,
    readonly docId: string | null,
  ) {}

  element(name: string, node?: ModelNodeJson): Element {
    const element = this.doc.createElementNS(HTML_ELEMENTS.has(name) ? XHTML_NS : FB2_NS, name);
    const attrs = node?.attrs ?? {};
    const nodeId = attrs.nodeId;
    if (typeof nodeId === 'string' && nodeId) {
      element.setAttribute('data-node-id', nodeId);
      this.elements.set(nodeId, element);
    }
    const id = attrs.id;
    if (typeof id === 'string' && id) {
      element.setAttribute('id', id);
      this.ids.set(id, element);
    }
    // A named style of an element is its class, as readers apply it (contracts/styles.md §4).
    if (typeof attrs.style === 'string' && attrs.style) element.setAttribute('class', attrs.style);
    if (typeof attrs.lang === 'string' && attrs.lang) element.setAttribute('lang', attrs.lang);
    for (const span of ['colspan', 'rowspan'] as const) {
      const value = Number(attrs[span] ?? 1);
      if (value > 1) element.setAttribute(span, String(value));
    }
    if (typeof attrs.align === 'string' && attrs.align) element.setAttribute('align', attrs.align);
    return element;
  }

  picture(node: ModelNodeJson): Element {
    const element = this.element('image', node);
    const href = String(node.attrs?.href ?? '');
    // The picture's reference, for the PDF export's boxes (feature 014, R4); no selector reads it.
    if (href) element.setAttribute('data-href', href);
    const url = binaryPreviewUrl(this.docId, href, 1600);
    if (url) {
      const img = this.doc.createElementNS(XHTML_NS, 'img') as HTMLImageElement;
      img.src = url;
      img.alt = String(node.attrs?.alt ?? '');
      if (typeof node.attrs?.title === 'string') img.title = node.attrs.title;
      element.append(img);
    }
    return element;
  }

  text(node: ModelNodeJson): Node {
    let out: Node = this.doc.createTextNode(node.text ?? '');
    const marks = ((node.marks ?? []) as Mark[]).slice().reverse();
    for (const mark of marks) {
      let wrapper: Element | null = null;
      if (MARK_ELEMENTS[mark.type])
        wrapper = this.doc.createElementNS(FB2_NS, MARK_ELEMENTS[mark.type]!);
      else if (mark.type === 'style') {
        wrapper = this.doc.createElementNS(FB2_NS, 'style');
        const name = String(mark.attrs?.name ?? '');
        if (name) wrapper.setAttribute('class', name);
      } else if (mark.type === 'link') {
        wrapper = this.doc.createElementNS(FB2_NS, 'a');
        const href = String(mark.attrs?.href ?? '');
        wrapper.setAttribute('data-href', href);
        wrapper.setAttribute('title', href);
        if (mark.attrs?.type === 'note') wrapper.setAttribute('data-note', 'true');
      }
      if (wrapper) {
        wrapper.append(out);
        out = wrapper;
      }
    }
    return out;
  }

  build(node: ModelNodeJson): Node | null {
    if (node.type === 'text') return this.text(node);
    if (node.type === 'raw-xml' || node.type === 'raw-xml-inline') return null;
    if (node.type === 'image' || node.type === 'inline-image') return this.picture(node);
    const element = this.element(node.type, node);
    for (const child of node.content ?? []) {
      const built = this.build(child);
      if (built) element.append(built);
    }
    return element;
  }
}

/**
 * A book stylesheet as Preview's frame applies it: its class and id selectors written as the
 * attribute selectors they stand for (`.x` -> `[class~="x"]`, `#x` -> `[id="x"]`). Chromium uses
 * `.x` and `#x` in style resolution only for HTML, SVG and MathML elements - the book's elements are
 * FB2 ones - while attribute selectors apply to elements of any namespace. CSS css-tree cannot read
 * is kept as read (D31). css-tree is loaded only when Preview opens (PD2).
 */
export async function frameCss(text: string): Promise<string> {
  try {
    const { generate, parse, walk } = await import('css-tree');
    const ast = parse(text, {
      onParseError: () => {
        throw new Error('unreadable');
      },
    });
    walk(ast, (node) => {
      if (node.type !== 'ClassSelector' && node.type !== 'IdSelector') return;
      const attribute = node.type === 'ClassSelector' ? 'class' : 'id';
      const value = String(node.name);
      node.type = 'AttributeSelector';
      node.name = { type: 'Identifier', name: attribute };
      node.matcher = attribute === 'class' ? '~=' : '=';
      node.value = { type: 'String', value };
      node.flags = null;
    });
    return generate(ast);
  } catch {
    return text;
  }
}

/** Fills `target` (Preview's frame document) with the book; resolves with its element maps. */
export async function buildPreview(
  target: globalThis.Document,
  book: Pick<Document, 'bodies' | 'stylesheets' | 'description'>,
  options: PreviewBuildOptions,
): Promise<PreviewBuild> {
  const builder = new Builder(target, options.docId);
  const head = target.head ?? target.documentElement;
  const base = target.createElement('style');
  base.textContent = readerBase;
  head.append(base);
  for (const sheet of book.stylesheets) {
    if (!/css/i.test(sheet.type)) continue;
    const style = target.createElement('style');
    style.textContent = await frameCss(sheet.content);
    head.append(style);
  }
  const root = target.createElementNS(FB2_NS, 'FictionBook');
  target.body.append(root);
  // The cover first, as readers show it.
  const cover = book.description.titleInfo.coverpage[0];
  if (cover) {
    root.append(builder.picture({ type: 'image', attrs: { href: cover.href, alt: '' } }));
  }
  const units: { parent: Element; node: ModelNodeJson }[] = [];
  for (const body of book.bodies) {
    const json = body as unknown as ModelNodeJson;
    const element = builder.element('body', json);
    root.append(element);
    for (const child of json.content ?? []) units.push({ parent: element, node: child });
  }
  const total = units.length;
  let lastYield = performance.now();
  for (let done = 0; done < total; done += 1) {
    if (options.signal?.aborted) throw new DOMException('Preview cancelled', 'AbortError');
    const unit = units[done]!;
    const built = builder.build(unit.node);
    if (built) unit.parent.append(built);
    if (performance.now() - lastYield > 16) {
      options.onProgress?.(done + 1, total);
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
  if (options.signal?.aborted) throw new DOMException('Preview cancelled', 'AbortError');
  options.onProgress?.(total, total);
  return { elements: builder.elements, ids: builder.ids };
}
