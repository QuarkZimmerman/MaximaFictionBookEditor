/**
 * Feature 016 (SC-002 as the requester revised it, 2026-11-17: "the import should always be valid"): the bodies
 * of an imported book mended to FB2 2.1's content models (resources/schema/FictionBook.xsd), so that an invalid
 * original - or the PDF of one - comes in as a valid book. A book that is valid already comes back untouched,
 * the very string. The description is not touched: the editor's own PDFs give it back as written, genres outside
 * the schema's list too (the requester's exception).
 */
import { FB2_NS } from './fb2';

/** What a section's content may begin with; an image may follow. */
const FIRST_CONTENT = new Set(['p', 'poem', 'subtitle', 'cite', 'empty-line', 'table']);
/** Blocks that hold a paragraph's text. */
const TEXT_LIKE = new Set(['p', 'v', 'subtitle', 'text-author', 'date']);

export function mendFb2(xml: string): { xml: string; mended: number } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return { xml, mended: 0 };
  let mended = 0;
  const make = (name: string): Element => doc.createElementNS(FB2_NS, name);
  const fb = (node: Element | null | undefined, ...names: string[]): boolean =>
    !!node &&
    node.namespaceURI === FB2_NS &&
    (names.length === 0 || names.includes(node.localName));
  const children = (element: Element): Element[] => [...element.children];
  /** The element renamed, its attributes and content kept. */
  const rename = (element: Element, name: string): Element => {
    const next = make(name);
    for (const attribute of [...element.attributes])
      next.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
    next.append(...element.childNodes);
    element.replaceWith(next);
    mended++;
    return next;
  };
  /** The paragraphs a block holds, however deep, as `name` elements (an empty line stays one). */
  const paragraphs = (element: Element, name: string): Element[] => {
    if (fb(element, 'empty-line')) return [make('empty-line')];
    if (fb(element, ...TEXT_LIKE) || ![...element.children].length) {
      const out = make(name);
      out.append(...element.childNodes);
      return [out];
    }
    return children(element).flatMap((child) => paragraphs(child, name));
  };
  const flatten = (element: Element, name: string): void => {
    element.replaceWith(...paragraphs(element, name));
    mended++;
  };

  // A book has one body and at most one notes body - unnamed, or named "notes" (notesBodyType): of more, the
  // notes body is the one named so, else the first named one; other named bodies' notes join it (D6's C5), and
  // every other body becomes a section of the first (D32's library run: a book of 192 bodies).
  const bodies = [...doc.documentElement.children].filter((child) => fb(child, 'body'));
  // The first body takes no name (bodyType); a book that named it gives it back without.
  if (bodies[0]?.hasAttribute('name')) {
    bodies[0].removeAttribute('name');
    mended++;
  }
  const named = bodies.slice(1).filter((body) => body.hasAttribute('name'));
  const notes = named.find((body) => body.getAttribute('name') === 'notes') ?? named[0] ?? null;
  if (bodies.length > 2 || (notes && notes.getAttribute('name') !== 'notes')) {
    for (const body of bodies.slice(1)) {
      if (body === notes) continue;
      if (body.hasAttribute('name') && notes) {
        notes.append(...children(body).filter((child) => fb(child, 'section')));
      } else {
        const section = make('section');
        section.append(...body.childNodes);
        bodies[0].append(section);
      }
      body.remove();
      mended++;
    }
    if (notes && notes.getAttribute('name') !== 'notes') {
      notes.setAttribute('name', 'notes');
      mended++;
    }
    // The notes body right after the first.
    if (notes && bodies[0].nextElementSibling !== notes) bodies[0].after(notes);
  }

  const all = (name: string): Element[] => [...doc.getElementsByTagNameNS(FB2_NS, name)].reverse();
  const inBody = (element: Element): boolean => {
    for (let at = element.parentElement; at; at = at.parentElement) if (fb(at, 'body')) return true;
    return false;
  };

  // A title holds paragraphs and empty lines.
  /** A block picture where none may stand goes out, after its container. */
  const moveOut = (picture: Element, container: Element): void => {
    container.after(picture);
    mended++;
  };
  for (const title of all('title').filter(inBody)) {
    for (const child of children(title)) {
      if (fb(child, 'p', 'empty-line')) continue;
      if (fb(child, 'image')) {
        moveOut(child, title);
        continue;
      }
      if (fb(child, ...TEXT_LIKE)) rename(child, 'p');
      else flatten(child, 'p');
    }
  }
  // A stanza: title?, subtitle?, v+.
  for (const stanza of all('stanza').filter(inBody)) {
    for (const child of children(stanza)) {
      if (fb(child, 'title', 'subtitle', 'v')) continue;
      if (fb(child, ...TEXT_LIKE)) rename(child, 'v');
      else flatten(child, 'v');
    }
    if (!children(stanza).some((child) => fb(child, 'v'))) {
      stanza.append(make('v'));
      mended++;
    }
  }
  // A poem: title?, epigraph*, (subtitle | stanza)+, text-author*, date? - loose verses go into stanzas.
  for (const poem of all('poem').filter(inBody)) {
    let stanza: Element | null = null;
    for (const child of children(poem)) {
      if (fb(child, 'v', 'p', 'empty-line')) {
        if (!stanza) {
          stanza = make('stanza');
          child.before(stanza);
        }
        if (fb(child, 'empty-line')) child.remove();
        else stanza.append(fb(child, 'v') ? child : rename(child, 'v'));
        mended++;
      } else stanza = null;
    }
    if (!children(poem).some((child) => fb(child, 'stanza', 'subtitle'))) {
      const added = make('stanza');
      added.append(make('v'));
      const tail = children(poem).find((child) => fb(child, 'text-author', 'date'));
      if (tail) tail.before(added);
      else poem.append(added);
      mended++;
    }
  }
  // An epigraph: (p | poem | cite | empty-line)*, text-author*; a cite: (p | poem | empty-line | subtitle |
  // table)*, text-author*; an annotation: (p | poem | cite | subtitle | table | empty-line)*.
  const quote = (element: Element, allowed: string[], authors: boolean): void => {
    const list = children(element);
    list.forEach((child, index) => {
      if (fb(child, ...allowed)) return;
      if (fb(child, 'image')) {
        moveOut(child, element);
        return;
      }
      if (authors && fb(child, 'text-author')) {
        // Only at the end: one with text after it is a paragraph.
        if (list.slice(index + 1).some((after) => !fb(after, 'text-author'))) rename(child, 'p');
        return;
      }
      if (fb(child, 'epigraph', 'cite', 'annotation')) {
        child.replaceWith(...child.childNodes);
        mended++;
      } else if (fb(child, ...TEXT_LIKE)) rename(child, 'p');
      else flatten(child, 'p');
    });
  };
  for (const element of all('epigraph').filter(inBody))
    quote(element, ['p', 'poem', 'cite', 'empty-line'], true);
  for (const element of all('cite').filter(inBody))
    quote(element, ['p', 'poem', 'empty-line', 'subtitle', 'table'], true);
  for (const element of all('annotation').filter(inBody))
    quote(element, ['p', 'poem', 'cite', 'subtitle', 'table', 'empty-line'], false);

  // A section: title?, epigraph*, image?, annotation?, then subsections or blocks (not both), the blocks
  // beginning with a text block.
  const header = (element: Element, stage: number): number => {
    if (fb(element, 'title')) return stage <= 0 ? 1 : -1;
    if (fb(element, 'epigraph')) return stage <= 1 ? 1 : -1;
    if (fb(element, 'image')) return stage <= 2 ? 3 : -1;
    if (fb(element, 'annotation')) return stage <= 3 ? 4 : -1;
    return -1;
  };
  const mendSection = (section: Element): void => {
    let stage = 0;
    const content: Element[] = [];
    for (const child of children(section)) {
      const next = content.length ? -1 : header(child, stage);
      if (next >= 0) {
        stage = next;
        continue;
      }
      // Out of the header's place: a title's lines as subtitles, an epigraph or an annotation as a quote.
      if (fb(child, 'title')) {
        const lines = paragraphs(child, 'subtitle');
        child.replaceWith(...lines);
        mended++;
        content.push(...lines);
      } else if (fb(child, 'epigraph', 'annotation')) content.push(rename(child, 'cite'));
      else if (fb(child, 'section') || fb(child, ...FIRST_CONTENT) || fb(child, 'image'))
        content.push(child);
      else if (fb(child, ...TEXT_LIKE)) content.push(rename(child, 'p'));
      else {
        const lines = paragraphs(child, 'p');
        child.replaceWith(...lines);
        mended++;
        content.push(...lines);
      }
    }
    const subsections = content.some((child) => fb(child, 'section'));
    const blocks = content.filter((child) => !fb(child, 'section'));
    if (subsections && blocks.length) {
      // Blocks beside subsections: each run of them a section of its own.
      let run: Element[] = [];
      for (const child of content) {
        if (fb(child, 'section')) {
          if (run.length) wrap(run);
          run = [];
        } else run.push(child);
      }
      if (run.length) wrap(run);
    } else if (!subsections) {
      if (blocks.length && fb(blocks[0], 'image')) {
        blocks[0].before(make('empty-line'));
        mended++;
      } else if (!blocks.length && children(section).length) {
        // A header and nothing after it.
        section.append(make('empty-line'));
        mended++;
      }
    }
  };
  /** A run of blocks made a section of its own, mended as one. */
  const wrap = (run: Element[]): void => {
    const section = make('section');
    run[0].before(section);
    section.append(...run);
    mended++;
    mendSection(section);
  };
  for (const section of all('section').filter(inBody)) mendSection(section);
  // A body: image?, title?, epigraph*, section+ - anything else goes into sections.
  for (const body of [...doc.getElementsByTagNameNS(FB2_NS, 'body')]) {
    let stage = 0;
    let run: Element[] = [];
    const flush = (): void => {
      if (run.length) wrap(run);
      run = [];
    };
    for (const child of children(body)) {
      if (fb(child, 'section')) {
        flush();
        stage = 3;
        continue;
      }
      if (!run.length && stage <= 0 && fb(child, 'image')) {
        stage = 1;
        continue;
      }
      if (!run.length && stage <= 1 && fb(child, 'title')) {
        stage = 2;
        continue;
      }
      if (!run.length && stage <= 2 && fb(child, 'epigraph')) {
        stage = 2;
        continue;
      }
      if (fb(child, 'title')) {
        // A title after the body's sections begins a section of its own.
        flush();
        run.push(child);
      } else if (fb(child, 'epigraph', 'annotation')) run.push(rename(child, 'cite'));
      else if (fb(child, ...TEXT_LIKE) && !fb(child, 'p', 'subtitle')) run.push(rename(child, 'p'));
      else run.push(child);
    }
    flush();
    if (!children(body).some((child) => fb(child, 'section'))) {
      body.append(make('section'));
      mended++;
    }
  }
  if (mended === 0) return { xml, mended: 0 };
  return { xml: new XMLSerializer().serializeToString(doc), mended };
}
