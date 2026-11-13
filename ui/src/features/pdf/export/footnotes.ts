/**
 * Feature 014 (D19, DP-9; tasks T039): the notes at the foot of the page that refers to them.
 * - A note is printed once, at the foot of the page of its first reference, under a short rule and
 *   in smaller text, beginning with its label: the note's title, else the reference's own text.
 * - The reference keeps the book's text and leads to the note; the label leads back to the first
 *   reference.
 * - Notes nothing refers to are printed after the text (paginator.ts).
 * Notes are the sections of the bodies named "notes" or "comments" that have an id.
 */
import { FB2_NS, XHTML_NS } from '@/features/preview/buildPreview';

const NOTES_BODY = /^(notes|comments)$/i;

export const isNotesBody = (element: Element): boolean =>
  element.namespaceURI === FB2_NS &&
  element.localName === 'body' &&
  NOTES_BODY.test(element.getAttribute('name') ?? '');

/** The notes of the book: each note section of a notes body, by its id. */
export function noteSections(root: Element): Map<string, Element> {
  const notes = new Map<string, Element>();
  for (const body of root.getElementsByTagNameNS(FB2_NS, 'body')) {
    if (!isNotesBody(body)) continue;
    for (const section of body.children) {
      const id = section.getAttribute('id');
      if (section.localName === 'section' && id && !notes.has(id)) notes.set(id, section);
    }
  }
  return notes;
}

/** The note references of a block, in order: [note id, the reference's anchor]. */
export function noteRefs(block: Element, notes: Map<string, Element>): [string, Element][] {
  const out: [string, Element][] = [];
  for (const anchor of block.getElementsByTagNameNS(XHTML_NS, 'a')) {
    const href = anchor.getAttribute('href') ?? '';
    if (anchor.getAttribute('data-note') !== 'true' || !href.startsWith('#')) continue;
    if (notes.has(href.slice(1))) out.push([href.slice(1), anchor]);
  }
  return out;
}

/** The id the first reference to note `id` gets, which the note's label leads back to. */
export const referenceId = (id: string): string => `mfbe-ref-${id}`;

/**
 * The footnote of note `id`: its label (DP-9: the note's title, else `referenceText`) leading back
 * to the first reference, then the note's own paragraphs, as the book has them.
 */
export function footnoteElement(
  doc: globalThis.Document,
  id: string,
  section: Element,
  referenceText: string,
): HTMLElement {
  const note = doc.createElementNS(XHTML_NS, 'div') as HTMLElement;
  note.className = 'mfbe-footnote';
  note.id = id;
  const title = [...section.children].find((c) => c.localName === 'title');
  const label = doc.createElementNS(XHTML_NS, 'a') as HTMLAnchorElement;
  label.className = 'mfbe-footnote-label';
  label.setAttribute('href', `#${referenceId(id)}`);
  label.textContent =
    (title?.textContent ?? '').replace(/\s+/g, ' ').trim() ||
    referenceText.replace(/\s+/g, ' ').trim();
  note.append(label, ' ');
  for (const child of section.children) {
    if (child === title) continue;
    const copy = child.cloneNode(true) as Element;
    // The note's own ids stay with the book's note; on the page the footnote carries `id`.
    copy.removeAttribute('id');
    for (const inner of copy.querySelectorAll('[id]')) inner.removeAttribute('id');
    note.append(copy);
  }
  return note;
}
