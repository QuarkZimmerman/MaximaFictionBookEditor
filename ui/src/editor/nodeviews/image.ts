/**
 * Image node views (T064): block (`image`) and inline (`inline_image`) pictures loaded from the
 * core's `GET /binary/{docId}/{id}/preview?w=` endpoint (binary payloads never travel through
 * JSON-RPC); a missing binary, an external `href` or the clear-image placeholder (`#undefined`)
 * shows a dashed placeholder with the reference. The node is an atom: clicking selects it
 * (selection outline), the title/alt/href appear as tooltip, the caption shows the title.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView, NodeViewConstructor } from 'prosemirror-view';

import { resolveToken } from '@/rpc/client';

export interface ImageViewOptions {
  /** Current document id (binaries are addressed per document). */
  getDocId: () => string | null;
  /** Preview width requested from the core. */
  previewWidth?: number;
  /** Text shown for images whose binary cannot be loaded (localised by the caller). */
  getMissingText: () => string;
}

/** `#id` -> preview URL on the core; null for external, empty or placeholder references. */
export function binaryPreviewUrl(docId: string | null, href: string, width = 800): string | null {
  if (!docId || !href.startsWith('#') || href.length < 2 || href === '#undefined') return null;
  const id = encodeURIComponent(href.slice(1));
  const url = `${import.meta.env.BASE_URL}binary/${encodeURIComponent(docId)}/${id}/preview?w=${width}`;
  const token = resolveToken();
  return token ? `${url}&token=${encodeURIComponent(token)}` : url;
}

export class ImageView implements NodeView {
  readonly dom: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly caption: HTMLElement | null;
  private readonly missing: HTMLElement;

  constructor(
    private node: PMNode,
    private readonly inline: boolean,
    private readonly options: ImageViewOptions,
  ) {
    this.dom = document.createElement(inline ? 'span' : 'figure');
    this.dom.className = inline ? 'fb-inline-image' : 'fb-image';
    this.dom.setAttribute('data-testid', inline ? 'body-inline-image' : 'body-image');
    this.dom.setAttribute('draggable', 'false');
    this.img = document.createElement('img');
    this.img.draggable = false;
    this.img.addEventListener('error', () => this.dom.classList.add('fb-image-missing'));
    this.img.addEventListener('load', () => this.dom.classList.remove('fb-image-missing'));
    this.dom.appendChild(this.img);
    this.missing = document.createElement('span');
    this.missing.className = 'fb-image-placeholder';
    this.dom.appendChild(this.missing);
    this.caption = inline ? null : document.createElement('figcaption');
    if (this.caption) {
      this.caption.className = 'fb-image-caption';
      this.dom.appendChild(this.caption);
    }
    this.render();
  }

  private render(): void {
    const href = String(this.node.attrs.href ?? '');
    const alt = (this.node.attrs.alt as string | null) ?? '';
    const title = (this.node.attrs.title as string | null) ?? '';
    const nodeId = this.node.attrs.nodeId as string | null;
    this.dom.setAttribute('data-href', href);
    if (nodeId) this.dom.setAttribute('data-node-id', nodeId);
    else this.dom.removeAttribute('data-node-id');
    if (this.node.attrs.id) this.dom.setAttribute('data-id', String(this.node.attrs.id));
    else this.dom.removeAttribute('data-id');
    this.dom.title = [title, alt, href].filter(Boolean).join('\n');
    this.img.alt = alt;
    this.missing.textContent = `${this.options.getMissingText()} ${href}`.trim();
    const url = binaryPreviewUrl(this.options.getDocId(), href, this.options.previewWidth);
    if (url) {
      if (this.img.getAttribute('src') !== url) this.img.setAttribute('src', url);
      this.dom.classList.remove('fb-image-external');
    } else {
      this.img.removeAttribute('src');
      this.dom.classList.add('fb-image-missing');
      this.dom.classList.toggle('fb-image-external', !!href && !href.startsWith('#'));
    }
    if (this.caption) {
      this.caption.textContent = title;
      this.caption.hidden = !title;
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  selectNode(): void {
    this.dom.classList.add('fb-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('fb-selected');
  }

  stopEvent(): boolean {
    return false;
  }

  ignoreMutation(): boolean {
    return true;
  }

  get isInline(): boolean {
    return this.inline;
  }
}

/** Node views keyed by schema node name, ready for `EditorView`'s `nodeViews` prop. */
export function createImageNodeViews(
  options: ImageViewOptions,
): Record<string, NodeViewConstructor> {
  return {
    image: (node) => new ImageView(node, false, options),
    inline_image: (node) => new ImageView(node, true, options),
  };
}
