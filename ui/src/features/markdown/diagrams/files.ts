/**
 * Feature 011 (D49, DP-24): the picture files of Mermaid diagrams. An indexed PNG for a drawing of
 * at most 256 colours (a palette instead of full colour, usually the smallest form of line art), and
 * the diagram's source inside the file - a PNG iTXt chunk or a JPEG comment, both invisible in the
 * book (a picture's title would show as its caption) - which the Markdown export reads back.
 */

/** The keyword of the source chunk (PNG) and the prefix of the source comment (JPEG). */
export const SOURCE_KEYWORD = 'mermaid';
/** Feature 011 (D50): the keyword of a formula's TeX source. */
export const FORMULA_KEYWORD = 'tex';
/** Feature 012 (D24): the keyword of a formula's MathML source (an EPUB's formula). */
export const MATHML_KEYWORD = 'mathml';

const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
/** A JPEG comment holds at most 65,533 bytes (its length field counts itself). */
const MAX_COMMENT = 65_533;

const utf8 = new TextEncoder();
const decoder = new TextDecoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  // Through a Response, not Blob.stream(): the test environment's Blob has no streams.
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const isPng = (bytes: Uint8Array) =>
  bytes.length > 8 && PNG_SIGNATURE.every((byte, i) => bytes[i] === byte);
const isJpeg = (bytes: Uint8Array) => bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;

/** An 8-bit indexed PNG of opaque `rgba` pixels, or null when they hold more than 256 colours. */
export async function indexedPng(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const palette = new Map<number, number>();
  const rows = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width + 1);
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const key = (rgba[i]! << 16) | (rgba[i + 1]! << 8) | rgba[i + 2]!;
      let index = palette.get(key);
      if (index === undefined) {
        if (palette.size === 256) return null;
        index = palette.size;
        palette.set(key, index);
      }
      rows[row + 1 + x] = index;
    }
  }
  const plte = new Uint8Array(palette.size * 3);
  for (const [key, index] of palette) {
    plte[index * 3] = key >>> 16;
    plte[index * 3 + 1] = (key >>> 8) & 0xff;
    plte[index * 3 + 2] = key & 0xff;
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  return concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', await deflate(rows)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The PNG with an iTXt chunk `mermaid` holding `source` (UTF-8, uncompressed) before IEND. */
export function pngWithSource(
  png: Uint8Array,
  source: string,
  keyword: string = SOURCE_KEYWORD,
): Uint8Array {
  if (!isPng(png)) return png;
  let at = 8;
  while (at + 12 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + at, 4).getUint32(0);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === 'IEND') {
      // keyword NUL, compression flag 0, method 0, language "" NUL, translated keyword "" NUL, text
      const data = concat([
        utf8.encode(keyword),
        Uint8Array.of(0, 0, 0, 0, 0),
        utf8.encode(source),
      ]);
      return concat([png.subarray(0, at), chunk('iTXt', data), png.subarray(at)]);
    }
    at += 12 + length;
  }
  return png;
}

/** The JPEG with a comment `mermaid\0<source>` after its start marker (a longer source: none). */
export function jpegWithSource(
  jpeg: Uint8Array,
  source: string,
  keyword: string = SOURCE_KEYWORD,
): Uint8Array {
  if (!isJpeg(jpeg)) return jpeg;
  const data = concat([utf8.encode(`${keyword}\0`), utf8.encode(source)]);
  if (data.length > MAX_COMMENT) return jpeg;
  const segment = new Uint8Array(4 + data.length);
  segment[0] = 0xff;
  segment[1] = 0xfe;
  segment[2] = (data.length + 2) >> 8;
  segment[3] = (data.length + 2) & 0xff;
  segment.set(data, 4);
  return concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

/** The Mermaid source a picture file carries (see pngWithSource, jpegWithSource), or null. */
export function diagramSource(bytes: Uint8Array, keyword: string = SOURCE_KEYWORD): string | null {
  if (isPng(bytes)) {
    let at = 8;
    while (at + 12 <= bytes.length) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      if (type === 'IEND') break;
      if (type === 'iTXt') {
        const data = bytes.subarray(at + 8, at + 8 + length);
        const nul = data.indexOf(0);
        if (nul > 0 && decoder.decode(data.subarray(0, nul)) === keyword && data[nul + 1] === 0) {
          const language = data.indexOf(0, nul + 3);
          const translated = language >= 0 ? data.indexOf(0, language + 1) : -1;
          if (translated >= 0) return decoder.decode(data.subarray(translated + 1));
        }
      }
      at += 12 + length;
    }
    return null;
  }
  if (isJpeg(bytes)) {
    const prefix = utf8.encode(`${keyword}\0`);
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1]!;
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[at + 2]! << 8) | bytes[at + 3]!;
      if (marker === 0xfe) {
        const data = bytes.subarray(at + 4, at + 2 + length);
        if (prefix.every((byte, i) => data[i] === byte)) {
          return decoder.decode(data.subarray(prefix.length));
        }
      }
      at += 2 + length;
    }
  }
  return null;
}
