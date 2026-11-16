/**
 * Feature 016: writing FB2 XML - escaping, and a block's runs as inline markup (strong, emphasis, code,
 * links, named styles, strikethrough, sub- and superscripts, inline pictures).
 */

import type { Run } from './parts';

export const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';

// XML 1.0 forbids these; they are left out (as the export leaves them out, 014 D22).
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;

export const text = (value: string): string =>
  value.replace(FORBIDDEN, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const attr = (value: string): string => text(value).replace(/"/g, '&quot;');

/** A span of a block's text: [from, to) in characters, and what it is. */
export interface Span {
  from: number;
  to: number;
  kind: 'style' | 'strikethrough' | 'sub' | 'sup' | 'bold' | 'italic';
  name?: string;
}

/** Where an inline picture goes: its binary id. */
export type PictureId = (run: Run) => string | null;

interface Format {
  href?: string;
  /** Which link of the structure: two links in a row with one address stay two. */
  link?: number;
  note?: boolean;
  style?: string;
  strikethrough?: boolean;
  sub?: boolean;
  sup?: boolean;
  bold?: boolean;
  italic?: boolean;
  mono?: boolean;
}

const same = (a: Format, b: Format): boolean =>
  a.href === b.href &&
  a.link === b.link &&
  a.note === b.note &&
  a.style === b.style &&
  a.strikethrough === b.strikethrough &&
  a.sub === b.sub &&
  a.sup === b.sup &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.mono === b.mono;

function wrap(content: string, format: Format): string {
  let out = content;
  if (format.mono) out = `<code>${out}</code>`;
  if (format.italic) out = `<emphasis>${out}</emphasis>`;
  if (format.bold) out = `<strong>${out}</strong>`;
  if (format.sup) out = `<sup>${out}</sup>`;
  if (format.sub) out = `<sub>${out}</sub>`;
  if (format.strikethrough) out = `<strikethrough>${out}</strikethrough>`;
  if (format.style) out = `<style name="${attr(format.style)}">${out}</style>`;
  if (format.href) {
    out = `<a l:href="${attr(format.href)}"${format.note ? ' type="note"' : ''}>${out}</a>`;
  }
  return out;
}

/**
 * The runs of a block as FB2 inline markup. `link` maps a run's target to an FB2 reference (an id of the
 * book, an address) and says whether it is a note; `spans` are the hints' marks and named styles.
 */
export function inline(
  runs: readonly Run[],
  spans: readonly Span[],
  link: (run: Run) => { href: string; note: boolean } | null,
  picture: PictureId,
): string {
  const pieces: { char: string; format: Format }[] = [];
  const pictures = new Map<number, string[]>();
  for (const run of runs) {
    if (run.picture) {
      const id = picture(run);
      if (id) {
        const list = pictures.get(pieces.length) ?? [];
        const alt = run.picture.alt ? ` alt="${attr(run.picture.alt)}"` : '';
        list.push(`<image l:href="#${attr(id)}"${alt}/>`);
        pictures.set(pieces.length, list);
      }
      continue;
    }
    const target = link(run);
    for (const char of run.text) {
      pieces.push({
        char,
        format: {
          ...(target
            ? {
                href: target.href,
                ...(target.note ? { note: true } : {}),
                ...(run.link !== undefined ? { link: run.link } : {}),
              }
            : {}),
          ...(run.bold ? { bold: true } : {}),
          ...(run.italic ? { italic: true } : {}),
          ...(run.mono ? { mono: true } : {}),
          ...(run.sub ? { sub: true } : {}),
          ...(run.sup ? { sup: true } : {}),
        },
      });
    }
  }
  // The hints count UTF-16 units of the block's text, as the export measured it.
  const units: number[] = [];
  let unit = 0;
  for (const piece of pieces) {
    units.push(unit);
    unit += piece.char.length;
  }
  for (const span of spans) {
    pieces.forEach((piece, index) => {
      const at = units[index];
      if (at < span.from || at >= span.to) return;
      if (span.kind === 'style') piece.format.style = span.name;
      else piece.format[span.kind] = true;
    });
  }
  let out = '';
  let index = 0;
  while (index <= pieces.length) {
    for (const image of pictures.get(index) ?? []) out += image;
    if (index === pieces.length) break;
    const format = pieces[index].format;
    let content = '';
    while (index < pieces.length && same(pieces[index].format, format)) {
      content += pieces[index].char;
      index++;
      if (pictures.has(index)) break;
    }
    out += wrap(text(content), format);
  }
  return out;
}
