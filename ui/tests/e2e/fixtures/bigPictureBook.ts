/**
 * The book of the picture view's performance journey (feature 007, T100; FR-055): about
 * 150 MB with one 20 MB JPEG among its pictures, generated at run time into the test's
 * temporary folder and never committed. Standard library only: every picture is a baseline
 * JPEG of flat 8 x 8 blocks (as `tests/fixtures/books/make-fixtures.py` writes them), brought
 * to its file size by comment segments - so the 20 MB picture is also a large one to decode
 * (4000 x 6000 pixels, a 24-megapixel photograph's size).
 */

import { closeSync, openSync, statSync, writeSync } from 'node:fs';
import path from 'node:path';

/** The standard luminance DC table (ITU T.81 K.3). */
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

type Rgb = [number, number, number];

class BitWriter {
  private bytes = new Uint8Array(1 << 16);
  private length = 0;
  private acc = 0;
  private nbits = 0;

  private push(byte: number): void {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2);
      grown.set(this.bytes);
      this.bytes = grown;
    }
    this.bytes[this.length++] = byte;
  }

  put(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      this.nbits += 1;
      if (this.nbits === 8) {
        this.push(this.acc);
        if (this.acc === 0xff) this.push(0); // byte stuffing
        this.acc = 0;
        this.nbits = 0;
      }
    }
  }

  finish(): Uint8Array {
    if (this.nbits > 0) this.put((1 << (8 - this.nbits)) - 1, 8 - this.nbits);
    return this.bytes.subarray(0, this.length);
  }
}

function segment(marker: number, body: Uint8Array): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xff00 | marker, 0);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/**
 * A baseline JPEG of `width` x `height`, YCbCr 4:4:4, each 8 x 8 block of one colour
 * (`colourAt` of its top-left pixel), padded with comment segments to `fileBytes` when given.
 */
export function flatJpeg(
  width: number,
  height: number,
  colourAt: (x: number, y: number) => Rgb,
  fileBytes?: number,
): Buffer {
  const codes = new Map<number, [number, number]>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let i = 0; i < DC_BITS[length - 1]!; i += 1) {
      codes.set(DC_VALUES[k]!, [code, length]);
      code += 1;
      k += 1;
    }
    code <<= 1;
  }
  const bits = new BitWriter();
  const previous = [0, 0, 0];
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const [r, g, b] = colourAt(x, y);
      const ycc = [
        0.299 * r + 0.587 * g + 0.114 * b,
        -0.168736 * r - 0.331264 * g + 0.5 * b + 128,
        0.5 * r - 0.418688 * g - 0.081312 * b + 128,
      ];
      for (let c = 0; c < 3; c += 1) {
        const dc = Math.max(-128, Math.min(127, Math.round(ycc[c]!) - 128));
        const diff = dc - previous[c]!;
        previous[c] = dc;
        const size = diff === 0 ? 0 : Math.floor(Math.log2(Math.abs(diff))) + 1;
        const [huff, huffLength] = codes.get(size)!;
        bits.put(huff, huffLength);
        if (size > 0) bits.put(diff > 0 ? diff : diff + (1 << size) - 1, size);
        bits.put(0, 1); // end of block: the AC table's only code
      }
    }
  }
  const scan = bits.finish();
  const frame = Buffer.alloc(6 + 9);
  frame.writeUInt8(8, 0);
  frame.writeUInt16BE(height, 1);
  frame.writeUInt16BE(width, 3);
  frame.writeUInt8(3, 5);
  for (let c = 0; c < 3; c += 1) frame.set([c + 1, 0x11, 0], 6 + c * 3);
  const huffman = Buffer.from([
    0x00,
    ...DC_BITS,
    ...DC_VALUES,
    0x10,
    1,
    ...new Array<number>(15).fill(0),
    0x00,
  ]);
  const parts = [
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    segment(0xdb, Buffer.from([0x00, ...new Array<number>(64).fill(8)])),
    segment(0xc0, frame),
    segment(0xc4, huffman),
    segment(0xda, Buffer.from([0x03, 1, 0, 2, 0, 3, 0, 0x00, 0x3f, 0x00])),
    Buffer.from(scan),
    Buffer.from([0xff, 0xd9]),
  ];
  let size = parts.reduce((sum, part) => sum + part.length, 0);
  if (fileBytes !== undefined && size < fileBytes) {
    const padding: Buffer[] = [];
    while (size < fileBytes) {
      const body = Math.max(1, Math.min(65533, fileBytes - size - 4));
      padding.push(segment(0xfe, Buffer.alloc(body, 0x20)));
      size += body + 4;
    }
    parts.splice(2, 0, ...padding);
  }
  return Buffer.concat(parts);
}

export interface BigPictureBook {
  file: string;
  /** The id of the large picture (`big.jpg`), its size and its file size. */
  bigId: string;
  bigWidth: number;
  bigHeight: number;
  bigBytes: number;
  /** The book's file size. */
  bytes: number;
}

/** Base64 in lines of 76 characters, as the classic editor writes binaries. */
function writeBase64(fd: number, data: Buffer): void {
  const text = data.toString('base64');
  const line = 76;
  const chunk = line * 4096;
  for (let start = 0; start < text.length; start += chunk) {
    const piece = text.slice(start, start + chunk);
    const lines: string[] = [];
    for (let i = 0; i < piece.length; i += line) lines.push(piece.slice(i, i + line));
    writeSync(fd, `${lines.join('\n')}\n`);
  }
}

/**
 * Writes the book into `dir`: `big.jpg` (4000 x 6000, `bigMegabytes` MB) and `others` pictures
 * of 1600 x 1200 that bring the file to about `bookMegabytes` MB, each in a section of its own.
 */
export function writeBigPictureBook(
  dir: string,
  { bookMegabytes = 150, bigMegabytes = 20, others = 23 } = {},
): BigPictureBook {
  const file = path.join(dir, 'big-pictures.fb2');
  const MB = 1024 * 1024;
  const big = flatJpeg(
    4000,
    6000,
    (x, y) => [(x * 255) / 4000, (y * 255) / 6000, ((x + y) * 128) / 10000],
    bigMegabytes * MB,
  );
  // Base64 grows the bytes by 4/3 (and a line break per 76 characters).
  const remaining = Math.max(0, bookMegabytes * MB - (big.length * 4 * 77) / (3 * 76));
  const otherBytes = Math.floor((remaining * 3 * 76) / (4 * 77) / Math.max(1, others));
  const ids = ['big.jpg', ...Array.from({ length: others }, (_, i) => `picture-${i + 1}.jpg`)];

  const fd = openSync(file, 'w');
  try {
    writeSync(
      fd,
      `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description>
<title-info>
<genre>sf</genre>
<author><first-name>Perf</first-name><last-name>Pictures</last-name></author>
<book-title>Big pictures</book-title>
<lang>en</lang>
</title-info>
<document-info>
<author><nickname>perf</nickname></author>
<date value="2026-10-31">2026</date>
<id>perf-picture-view</id>
<version>1.0</version>
</document-info>
</description>
<body>
${ids
  .map(
    (id, i) => `<section>
<title><p>Picture ${i + 1}</p></title>
<p>The picture ${id} of the picture view's performance journey.</p>
<image l:href="#${id}"/>
</section>`,
  )
  .join('\n')}
</body>
`,
    );
    writeSync(fd, `<binary id="big.jpg" content-type="image/jpeg">\n`);
    writeBase64(fd, big);
    writeSync(fd, `</binary>\n`);
    for (let i = 0; i < others; i += 1) {
      const shade = (i * 37) % 256;
      const picture = flatJpeg(
        1600,
        1200,
        (x, y) => [shade, (x * 255) / 1600, (y * 255) / 1200],
        otherBytes,
      );
      writeSync(fd, `<binary id="${ids[i + 1]}" content-type="image/jpeg">\n`);
      writeBase64(fd, picture);
      writeSync(fd, `</binary>\n`);
    }
    writeSync(fd, '</FictionBook>\n');
  } finally {
    closeSync(fd);
  }
  const { size } = statSync(file);
  return {
    file,
    bigId: 'big.jpg',
    bigWidth: 4000,
    bigHeight: 6000,
    bigBytes: big.length,
    bytes: size,
  };
}
