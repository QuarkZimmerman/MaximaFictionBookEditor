// Feature 011 (D49, DP-24, FR-075a): Mermaid diagrams on import - the picture files (an indexed PNG
// of a drawing with few colours, the source inside the file), the converter's markers and the
// export's ```mermaid blocks.
import { inflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { convertMarkdown } from '@/features/markdown/convert';
import {
  diagramSource,
  indexedPng,
  jpegWithSource,
  pngWithSource,
} from '@/features/markdown/diagrams/files';
import { mermaidBlock, serializeMarkdown } from '@/features/markdown/export/serialize';
import type { BodyNode, Document } from '@/model/document';

import { fakeDocument } from '../features/testUtils';

const SOURCE = 'graph TD\n  A[Начало] --> B{«Решение»}\n  B -->|да| C';

/** The chunks of a PNG: type -> data. */
function chunks(png: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  let at = 8;
  while (at + 12 <= png.length) {
    const length = new DataView(png.buffer, png.byteOffset + at, 4).getUint32(0);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    out.set(type, png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  return out;
}

describe('diagram picture files', () => {
  it('writes a drawing of few colours as an 8-bit indexed PNG', async () => {
    const width = 4;
    const height = 2;
    const rgba = new Uint8Array(width * height * 4).fill(255);
    rgba.set([0, 0, 0, 255], 0); // one black pixel, the rest white
    const png = (await indexedPng(rgba, width, height))!;
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const parts = chunks(png);
    expect(parts.get('IHDR')![9]).toBe(3);
    expect([...parts.get('PLTE')!]).toEqual([0, 0, 0, 255, 255, 255]);
    // Each row: filter 0, then the palette indices.
    expect([...inflateSync(parts.get('IDAT')!)]).toEqual([0, 0, 1, 1, 1, 0, 1, 1, 1, 1]);
  });

  it('gives no indexed PNG for more than 256 colours', async () => {
    const rgba = new Uint8Array(17 * 16 * 4);
    for (let i = 0; i < 17 * 16; i += 1) rgba.set([i & 0xff, i >> 8, 7, 255], i * 4);
    expect(await indexedPng(rgba, 17, 16)).toBeNull();
  });

  it('carries the source inside a PNG and a JPEG, and reads it back', async () => {
    const png = (await indexedPng(new Uint8Array(4).fill(255), 1, 1))!;
    const withSource = pngWithSource(png, SOURCE);
    expect(chunks(withSource).has('iTXt')).toBe(true);
    expect([...withSource.subarray(-12, -8)]).toEqual([0, 0, 0, 0]); // IEND still last
    expect(diagramSource(withSource)).toBe(SOURCE);
    expect(diagramSource(png)).toBeNull();
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);
    expect(diagramSource(jpegWithSource(jpeg, SOURCE))).toBe(SOURCE);
    expect(diagramSource(jpeg)).toBeNull();
    // A source longer than a JPEG comment holds is not written there.
    expect(jpegWithSource(jpeg, 'x'.repeat(70_000))).toBe(jpeg);
  });
});

describe('the converter and the export', () => {
  const options = { fileName: 'd', baseDir: '', notesTitle: 'Notes', diagramAlt: 'Diagram' };

  it('leaves a marker and both forms for a mermaid block; one in a quote stays code', () => {
    const result = convertMarkdown(
      `# T\n\n\`\`\`mermaid\n${SOURCE}\n\`\`\`\n\n> \`\`\`mermaid\n> graph LR\n> \`\`\`\n`,
      options,
    );
    expect(result.diagrams).toHaveLength(1);
    const [diagram] = result.diagrams;
    expect(diagram).toMatchObject({ index: 0, id: 'mermaid-1', source: SOURCE });
    expect(diagram!.imageXml).toBe('<image l:href="#mermaid-1" alt="Diagram"/>');
    expect(diagram!.codeXml).toContain('<code>graph TD</code>');
    expect(result.bodyXml).toContain('<!--mfbe-diagram:0-->');
    // The quoted one is code in the body (FB2 has no block pictures in a quote).
    expect(result.bodyXml).toContain('<code>graph LR</code>');
  });

  it('writes a diagram picture back as a ```mermaid block, its fence longer than its backticks', () => {
    const body = {
      type: 'body',
      attrs: { nodeId: 'b' },
      content: [
        {
          type: 'section',
          attrs: { nodeId: 's' },
          content: [{ type: 'image', attrs: { nodeId: 'i', href: '#mermaid-1', alt: 'Diagram' } }],
        },
      ],
    };
    const document: Document = fakeDocument({ bodies: [body as unknown as BodyNode] });
    document.binaries = [
      { id: 'mermaid-1', contentType: 'image/png', size: 10 },
    ] as unknown as Document['binaries'];
    const out = serializeMarkdown(document, {
      form: 'zip',
      includePictures: true,
      diagramSources: new Map([['mermaid-1', SOURCE]]),
    });
    expect(out.text).toContain(`\`\`\`mermaid\n${SOURCE}\n\`\`\``);
    expect(out.pictures).toEqual([]);
    expect(mermaidBlock('a ``` b')).toBe('````mermaid\na ``` b\n````');
  });
});
