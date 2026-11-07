/**
 * Image node views (T064): block (`image`) and inline (`inline_image`) pictures loaded from the
 * core's preview of the binary (`binaryPreviewUrl`, `@/model/binaryUrls`; binary payloads never
 * travel through JSON-RPC); a missing binary, an external `href` or the clear-image placeholder (`#undefined`)
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
import type { EditorView, NodeView, NodeViewConstructor } from 'prosemirror-view';

import { binaryPreviewUrl, previewSize, PREVIEW_WIDTH } from '@/model/binaryUrls';
import type { BinaryMeta } from '@/model/document';
import {
  confirmTransparency,
  hasTransparentPixels,
  pictureBackground,
  subscribePictureBackgrounds,
  togglePictureBackground,
  transparencyConfirmed,
  type PictureBackground,
} from '@/model/pictureBackground';

export interface ImageViewOptions {
  /** Current document id (binaries are addressed per document). */
  getDocId: () => string | null;
  /** Preview width requested from the core. */
  previewWidth?: number;
  /** Text shown for images whose binary cannot be loaded (localised by the caller). */
  getMissingText: () => string;
  /** The document's binary for an id (Document.binaries), or null when there is none. */
  getBinary?: (id: string) => BinaryMeta | null;
  /**
   * Registers a listener for every new binary list of the document; returns its removal. The
   * view draws itself again then, so a picture whose binary appears, goes or changes shows it at
   * once - no refresh (feature 007).
   */
  onBinariesChange?: (listener: () => void) => () => void;
  /**
   * Feature 010 (D8): the placeholder's text for each kind of picture without an image; when
   * absent, `getMissingText` and the reference as before.
   */
  getPlaceholderText?: (kind: PictureKind, href: string) => string;
  /**
   * Feature 010 (D10): the title of the background switch for the picture's current background;
   * without it no switch is shown.
   */
  getBackgroundSwitchText?: (background: PictureBackground) => string;
}

/** Feature 010 (D8): the kinds of pictures that show no image. */
export type PictureKind = 'empty' | 'missing' | 'external';

/** The kind of a picture without an image from its reference (D8). */
export function pictureKind(href: string): PictureKind {
  if (href === '' || href === '#' || href === '#undefined') return 'empty';
  return href.startsWith('#') ? 'missing' : 'external';
}

/**
 * Feature 010 (D4): what a double-click on a picture without an image does - the images feature
 * installs it (the picture chooser for that node); none until then.
 */
let placeholderAction: ((view: EditorView, pos: number) => void) | null = null;

export function setPicturePlaceholderAction(
  action: ((view: EditorView, pos: number) => void) | null,
): void {
  placeholderAction = action;
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

export class ImageView implements NodeView {
  readonly dom: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly caption: HTMLElement | null;
  private readonly missing: HTMLElement;
  private readonly backgroundSwitch: HTMLElement;
  private readonly stopListening: (() => void) | undefined;
  private readonly stopBackgrounds: () => void;

  constructor(
    private node: PMNode,
    private readonly inline: boolean,
    private readonly options: ImageViewOptions,
    private readonly view?: EditorView,
    private readonly getPos?: () => number | undefined,
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
      this.checkTransparency();
    });
    this.dom.appendChild(this.img);
    // Feature 010 (D4): a double-click on a picture without an image opens the picture chooser.
    this.dom.addEventListener('dblclick', (event) => {
      if (!this.dom.classList.contains('fb-image-missing') || !this.view || !placeholderAction) {
        return;
      }
      const pos = this.getPos?.();
      if (pos === undefined) return;
      event.preventDefault();
      placeholderAction(this.view, pos);
    });
    this.missing = document.createElement('span');
    this.missing.className = 'fb-image-placeholder';
    this.dom.appendChild(this.missing);
    // Feature 010 (D10): the background switch in the picture's top-right corner, shown on hover
    // for a picture with transparent areas; it never moves the caret or the selection.
    this.backgroundSwitch = document.createElement('span');
    this.backgroundSwitch.className = 'fb-picture-bg-switch';
    this.backgroundSwitch.setAttribute('role', 'button');
    this.backgroundSwitch.setAttribute('contenteditable', 'false');
    this.backgroundSwitch.setAttribute('data-testid', 'picture-bg-switch');
    this.backgroundSwitch.hidden = true;
    this.backgroundSwitch.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    this.backgroundSwitch.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const docId = this.options.getDocId();
      const id = this.binaryId();
      if (docId && id) togglePictureBackground(docId, id);
    });
    this.dom.appendChild(this.backgroundSwitch);
    this.dom.addEventListener('mouseenter', () => this.placeSwitch());
    this.caption = inline ? null : document.createElement('figcaption');
    if (this.caption) {
      this.caption.className = 'fb-image-caption';
      this.dom.appendChild(this.caption);
    }
    this.render();
    this.stopListening = this.options.onBinariesChange?.(() => this.render());
    this.stopBackgrounds = subscribePictureBackgrounds(() => this.renderBackground());
  }

  destroy(): void {
    this.stopListening?.();
    this.stopBackgrounds();
  }

  /** The id of the book's binary the picture shows, or null. */
  private binaryId(): string | null {
    const href = String(this.node.attrs.href ?? '');
    return href.startsWith('#') && href.length > 1 && href !== '#undefined' ? href.slice(1) : null;
  }

  /** Settles once per image whether the loaded picture really has transparent pixels (D10). */
  private checkTransparency(): void {
    const docId = this.options.getDocId();
    const id = this.binaryId();
    if (!docId || !id || !this.options.getBinary?.(id)?.transparent) return;
    if (transparencyConfirmed(docId, id) !== undefined) return;
    const found = hasTransparentPixels(this.img);
    if (found !== null) confirmTransparency(docId, id, found);
  }

  /** The background class and the switch for the picture's image (D9, D10). */
  private renderBackground(): void {
    const docId = this.options.getDocId();
    const id = this.binaryId();
    const background = id ? pictureBackground(docId, id) : 'white';
    this.dom.classList.toggle('fb-picture-on-page', background === 'page');
    const offered =
      !!id && !!this.options.getBackgroundSwitchText && transparencyConfirmed(docId, id) === true;
    this.backgroundSwitch.hidden = !offered;
    if (offered && this.options.getBackgroundSwitchText) {
      const text = this.options.getBackgroundSwitchText(background);
      this.backgroundSwitch.title = text;
      this.backgroundSwitch.setAttribute('aria-label', text);
    }
  }

  /** Puts the switch at the top-right corner of the picture itself (a block figure is wider). */
  private placeSwitch(): void {
    if (this.backgroundSwitch.hidden) return;
    const right = this.img.offsetLeft + this.img.offsetWidth;
    this.backgroundSwitch.style.left = `${Math.max(0, right - 22)}px`;
    this.backgroundSwitch.style.top = `${this.img.offsetTop + 2}px`;
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
    if (this.options.getPlaceholderText) {
      // Feature 010 (D8): a block picture says its kind and how to fix it; an inline picture,
      // inside a line of text, only its kind - the whole sentence is its tooltip.
      const text = this.options.getPlaceholderText(pictureKind(href), href);
      this.missing.textContent = this.inline ? (text.split(' - ')[0] ?? text) : text;
      this.missing.title = text;
    } else {
      this.missing.textContent = `${this.options.getMissingText()} ${href}`.trim();
    }
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
    this.renderBackground();
  }

  /**
   * The reserved box, decided before the `src` changes: `fb-sized` while a listed binary's
   * preview has not loaded, and `--mfbe-nw` / `--mfbe-nh` from the loaded picture, else from the
   * size the preview will have, else none.
   */
  private reserveBox(url: string | null, href: string): void {
    const meta = url && this.options.getBinary ? this.options.getBinary(href.slice(1)) : null;
    const size = meta ? previewSize(meta, this.options.previewWidth ?? PREVIEW_WIDTH) : null;
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
    image: (node, view, getPos) => new ImageView(node, false, options, view, getPos),
    inline_image: (node, view, getPos) => new ImageView(node, true, options, view, getPos),
  };
}
