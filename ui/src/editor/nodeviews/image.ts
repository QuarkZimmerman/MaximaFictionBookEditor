/**
 * Image node views (T064): block (`image`) and inline (`inline_image`) pictures loaded from the
 * core's `GET /binary/{docId}/{id}/preview?w=` endpoint (binary payloads never travel through
 * JSON-RPC); a missing binary, an external `href` or the clear-image placeholder (`#undefined`)
 * shows a dashed placeholder with the reference. The node is an atom: clicking selects it
 * (selection outline), the title/alt/href appear as tooltip, the caption shows the title.
 *
 * The reserved box (feature 006, US3; research R9.2; data-model §9.8): with the document's
 * binary list (`getBinary`), a picture's `img` carries its natural size as `--mfbe-nw` and
 * `--mfbe-nh` - the size the preview will have (`previewSize`) until it has loaded, the loaded
 * picture's afterwards - and the class `fb-sized` until it has loaded, so the display rules of
 * pictures in table cells (`styles.css`) reserve its box and apply the floor of FR-031. Every
 * picture is still requested as before; an undecodable binary, an id the list lacks or a view
 * without a list reserves nothing.
 */

import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView, NodeViewConstructor } from 'prosemirror-view';

import type { BinaryMeta } from '@/model/document';
import { resolveToken } from '@/rpc/client';

export interface ImageViewOptions {
  /** Current document id (binaries are addressed per document). */
  getDocId: () => string | null;
  /** Preview width requested from the core. */
  previewWidth?: number;
  /** Text shown for images whose binary cannot be loaded (localised by the caller). */
  getMissingText: () => string;
  /** The document's binary for an id (Document.binaries), or null when there is none. */
  getBinary?: (id: string) => BinaryMeta | null;
}

/** The width the node views request a preview at when the host passes none. */
const DEFAULT_PREVIEW_WIDTH = 800;

/**
 * The size `preview?w=` serves (contracts/rpc-api.md §2 "The preview's size"): the binary's own
 * size up to `width`; a wider picture `width` wide, its height scaled, rounded half away from
 * zero and at least 1 px, as the core's `scale_to_fit` does (`core/src/images/converter.cpp`).
 * Null for a binary the core does not decode and for one without both dimensions.
 */
export function previewSize(
  meta: BinaryMeta,
  width = DEFAULT_PREVIEW_WIDTH,
): [number, number] | null {
  if (!meta.decodable || !meta.width || !meta.height) return null;
  if (meta.width <= width) return [meta.width, meta.height];
  return [width, Math.max(1, Math.round(meta.height * (width / meta.width)))];
}

/**
 * Binaries by id over a list that the store replaces on every change: the map is rebuilt only
 * when `list()` returns another array (the node views render on every update of their node).
 */
export function binaryLookup(
  list: () => readonly BinaryMeta[] | undefined,
): (id: string) => BinaryMeta | null {
  let source: readonly BinaryMeta[] | undefined;
  let byId = new Map<string, BinaryMeta>();
  return (id) => {
    const current = list();
    if (current !== source) {
      source = current;
      byId = new Map((current ?? []).map((meta) => [meta.id, meta]));
    }
    return byId.get(id) ?? null;
  };
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
    this.img.addEventListener('load', () => {
      this.dom.classList.remove('fb-image-missing');
      // The loaded picture lays itself out: its own natural size from now on (an SVG without a
      // listed size gets the floor, an EXIF-rotated JPEG its real proportions).
      this.img.classList.remove('fb-sized');
      if (this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
        this.setNaturalSize(this.img.naturalWidth, this.img.naturalHeight);
      }
    });
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
    this.reserveBox(url, href);
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

  /**
   * The reserved box, decided before the `src` changes: `fb-sized` while a listed binary's
   * preview has not loaded, and `--mfbe-nw` / `--mfbe-nh` from the loaded picture, else from the
   * size the preview will have, else none.
   */
  private reserveBox(url: string | null, href: string): void {
    const meta = url && this.options.getBinary ? this.options.getBinary(href.slice(1)) : null;
    const size = meta
      ? previewSize(meta, this.options.previewWidth ?? DEFAULT_PREVIEW_WIDTH)
      : null;
    const loaded =
      !!url &&
      this.img.getAttribute('src') === url &&
      this.img.complete &&
      this.img.naturalWidth > 0;
    this.img.classList.toggle('fb-sized', !!size && !loaded);
    if (loaded) this.setNaturalSize(this.img.naturalWidth, this.img.naturalHeight);
    else if (size) this.setNaturalSize(size[0], size[1]);
    else {
      this.img.style.removeProperty('--mfbe-nw');
      this.img.style.removeProperty('--mfbe-nh');
    }
  }

  private setNaturalSize(width: number, height: number): void {
    this.img.style.setProperty('--mfbe-nw', String(width));
    this.img.style.setProperty('--mfbe-nh', String(height));
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
