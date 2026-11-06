/**
 * The note tooltip of the Body view (feature 009, User Story 3; FR-030 to FR-033, data-model
 * §6, research DP-11): resting the pointer on a note link for half a second shows the note's
 * text in a tooltip. The text comes from the document model, so a note outside the part of the
 * book the view holds shows too. The note's title is skipped; paragraphs, subtitles and verse
 * lines become lines, stanzas are set apart by a blank line, pictures and tables are named.
 * The tooltip hides on leaving the link, Esc or any key, a click, a scroll, the wheel and when
 * the window loses focus; it never shows during a drag selection or with a menu or dialog open.
 */

import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { ModelNodeJson } from '@/editor/fromModel';
import type { Document } from '@/model/document';

export const NOTE_TOOLTIP_DELAY_MS = 500;
const NOTE_BODIES = new Set(['notes', 'comments']);

export interface NoteTooltipTexts {
  picture: string;
  table: string;
  notFound: string;
}

type Model = Pick<Document, 'bodies'>;

function bodiesOf(model: Model): ModelNodeJson[] {
  return model.bodies as unknown as ModelNodeJson[];
}

function findJsonById(node: ModelNodeJson, id: string): ModelNodeJson | null {
  if (node.attrs?.id === id) return node;
  for (const child of node.content ?? []) {
    const found = findJsonById(child, id);
    if (found) return found;
  }
  return null;
}

/** The model node carrying the XML id `id`, in any body. */
function findTarget(model: Model, id: string): { node: ModelNodeJson; body: ModelNodeJson } | null {
  for (const body of bodiesOf(model)) {
    const node = findJsonById(body, id);
    if (node) return { node, body };
  }
  return null;
}

/**
 * A note link: one with `type="note"`, or an internal one whose target lies in a body named
 * `notes` or `comments` (data-model §6). Other links have no tooltip.
 */
export function isNoteLink(model: Model, href: string, type?: string | null): boolean {
  if (!href.startsWith('#') || href.length < 2) return false;
  if (type === 'note') return true;
  const target = findTarget(model, href.slice(1));
  return target !== null && NOTE_BODIES.has(String(target.body.attrs?.name ?? ''));
}

function inlineText(node: ModelNodeJson, texts: NoteTooltipTexts): string {
  let out = '';
  for (const child of node.content ?? []) {
    if (child.type === 'text') out += child.text ?? '';
    else if (child.type === 'inline-image') out += texts.picture;
    else out += inlineText(child, texts);
  }
  return out;
}

/**
 * The plain text of the note `id` (data-model §6): lines of text without formatting, the title
 * skipped, a blank line between stanzas, `[picture]` and `[table]` for what has no text;
 * `notFound` when no element has that id.
 */
export function noteText(model: Model, id: string, texts: NoteTooltipTexts): string {
  const target = findTarget(model, id);
  if (!target) return texts.notFound;
  const lines: string[] = [];
  const blank = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  };
  const walk = (node: ModelNodeJson, top: boolean) => {
    switch (node.type) {
      case 'title':
        if (!top) return; // the note's own title is skipped; a title asked for is shown
        break;
      case 'p':
      case 'subtitle':
      case 'v':
      case 'text-author':
        lines.push(inlineText(node, texts));
        return;
      case 'empty-line':
        blank();
        return;
      case 'image':
      case 'inline-image':
        lines.push(texts.picture);
        return;
      case 'table':
        lines.push(texts.table);
        return;
      case 'stanza':
        blank();
        for (const child of node.content ?? []) walk(child, false);
        blank();
        return;
      default:
        break;
    }
    for (const child of node.content ?? []) walk(child, false);
  };
  walk(target.node, true);
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

export interface NoteTooltipOptions {
  getModel: () => Model | null;
  getTexts: () => NoteTooltipTexts;
  /** A menu or dialog is open: no tooltip. */
  isBlocked: () => boolean;
}

/** The note tooltip plugin: one `role="tooltip"` element beside the editor (DP-11). */
export function noteTooltipPlugin(options: NoteTooltipOptions): Plugin {
  return new Plugin({
    view(view: EditorView) {
      const tip = document.createElement('div');
      tip.className = 'mfbe-note-tooltip';
      tip.setAttribute('role', 'tooltip');
      tip.dataset.testid = 'note-tooltip';
      tip.hidden = true;
      document.body.appendChild(tip);
      let timer: number | undefined;
      let anchor: Element | null = null;
      let pressed = false;

      const hide = () => {
        window.clearTimeout(timer);
        timer = undefined;
        anchor = null;
        tip.hidden = true;
      };
      const show = (link: Element, href: string) => {
        const model = options.getModel();
        if (!model || options.isBlocked() || pressed) return;
        tip.textContent = noteText(model, href.slice(1), options.getTexts());
        tip.hidden = false;
        const box = link.getBoundingClientRect();
        const below = box.bottom + 4;
        const height = tip.offsetHeight;
        tip.style.left = `${Math.max(4, Math.min(box.left, window.innerWidth - tip.offsetWidth - 4))}px`;
        tip.style.top = `${below + height > window.innerHeight ? Math.max(4, box.top - height - 4) : below}px`;
      };
      const onMove = (event: MouseEvent) => {
        if (pressed || event.buttons !== 0) return;
        const link = (event.target as Element | null)?.closest?.('a.fb-link') ?? null;
        if (link === anchor) return;
        hide();
        if (!link || !view.dom.contains(link)) return;
        const href = link.getAttribute('href') ?? '';
        const model = options.getModel();
        if (!model || !isNoteLink(model, href, link.getAttribute('data-type'))) return;
        anchor = link;
        timer = window.setTimeout(() => show(link, href), NOTE_TOOLTIP_DELAY_MS);
      };
      const onDown = () => {
        pressed = true;
        hide();
      };
      const onUp = () => {
        pressed = false;
      };
      view.dom.addEventListener('mousemove', onMove);
      view.dom.addEventListener('mouseleave', hide);
      view.dom.addEventListener('mousedown', onDown);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('keydown', hide, true);
      window.addEventListener('wheel', hide, { capture: true, passive: true });
      window.addEventListener('scroll', hide, true);
      window.addEventListener('blur', hide);
      return {
        update() {
          if (options.isBlocked()) hide();
        },
        destroy() {
          hide();
          view.dom.removeEventListener('mousemove', onMove);
          view.dom.removeEventListener('mouseleave', hide);
          view.dom.removeEventListener('mousedown', onDown);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('keydown', hide, true);
          window.removeEventListener('wheel', hide, true);
          window.removeEventListener('scroll', hide, true);
          window.removeEventListener('blur', hide);
          tip.remove();
        },
      };
    },
  });
}
