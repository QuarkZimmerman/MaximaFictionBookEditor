/**
 * Feature 023 (T023): unit tests for foreign DOCX parsing & FB2 2.1 conversion
 * (`docxOoxmlParser.ts` + `docxFb2Assembler.ts`).
 */
import { describe, expect, it } from 'vitest';

import { assembleDocxToFb2Xml } from '@/features/docx/import/docxFb2Assembler';
import { DocxEmptyError, parseDocxOoxml } from '@/features/docx/import/docxOoxmlParser';

const TEMPLATE_XML = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <genre>unrecognised</genre>
      <author><first-name/><last-name/></author>
      <book-title/>
      <lang>en</lang>
    </title-info>
    <document-info>
      <author><nickname>editor</nickname></author>
      <date>2026-11-28</date>
      <id>test-doc-id</id>
      <version>1.0</version>
    </document-info>
  </description>
  <body><section><p/></section></body>
</FictionBook>`;

const FOREIGN_RT = { mode: 'foreign' as const, payload: null, summary: [] };

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const ASVG_NS = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

function wrapDoc(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:asvg="${ASVG_NS}" xmlns:m="${M_NS}">` +
    `<w:body>${bodyXml}</w:body></w:document>`
  );
}

describe('Foreign DOCX OOXML parser and FB2 assembler', () => {
  it('converts headings, semantic marks, tracked changes, comments, OMML equations, lists, nested tables, footnotes, and Title fallback', () => {
    const documentXml = wrapDoc(`
      <w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>Fallback Heading Title</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part One</w:t></w:r></w:p>
      <w:p><w:r><w:t>Intro before subsection.</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Chapter 1</w:t></w:r></w:p>
      <w:p>
        <w:commentRangeStart w:id="10"/>
        <w:r><w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr><w:t>Strong</w:t></w:r>
        <w:r><w:t xml:space="preserve"> and </w:t></w:r>
        <w:ins w:id="1" w:author="Editor"><w:r><w:rPr><w:i/></w:rPr><w:t>inserted</w:t></w:r></w:ins>
        <w:del w:id="2" w:author="Editor"><w:r><w:delText>removed</w:delText></w:r></w:del>
        <w:r><w:footnoteReference w:id="1"/></w:r>
        <w:commentRangeEnd w:id="10"/>
        <w:r><w:commentReference w:id="10"/></w:r>
      </w:p>
      <w:p>
        <w:r><w:t xml:space="preserve">Formula: </w:t></w:r>
        <m:oMath>
          <m:f>
            <m:num><m:r><m:t>a+b</m:t></m:r></m:num>
            <m:den><m:r><m:t>2</m:t></m:r></m:den>
          </m:f>
        </m:oMath>
      </w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First item</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Second item</w:t></w:r></w:p>
      <w:tbl>
        <w:tr><w:trPr><w:tblHeader/></w:trPr>
          <w:tc><w:p><w:r><w:t>Col A</w:t></w:r></w:p></w:tc>
          <w:tc><w:p><w:r><w:t>Col B</w:t></w:r></w:p></w:tc>
        </w:tr>
        <w:tr>
          <w:tc><w:p><w:r><w:t>Outer</w:t></w:r></w:p></w:tc>
          <w:tc>
            <w:p><w:r><w:t>Has nested:</w:t></w:r></w:p>
            <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Inner1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Inner2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          </w:tc>
        </w:tr>
      </w:tbl>
    `);

    const numberingXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:numbering xmlns:w="${W_NS}">
        <w:abstractNum w:abstractNumId="1">
          <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
        </w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
      </w:numbering>`;

    const footnotesXml = `<?xml version="1.0" encoding="UTF-8"?>
      <w:footnotes xmlns:w="${W_NS}">
        <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
        <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
        <w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Footnote body text.</w:t></w:r></w:p></w:footnote>
      </w:footnotes>`;

    const coreXml = `<?xml version="1.0" encoding="UTF-8"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title></dc:title>
        <dc:creator>Jane Austen</dc:creator>
        <dc:language>en</dc:language>
      </cp:coreProperties>`;

    const parsed = parseDocxOoxml({
      documentXml,
      numberingXml,
      footnotesXml,
      coreXml,
      headerFooterCount: 1,
      roundtrip: FOREIGN_RT,
    });

    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: TEMPLATE_XML,
      fallbackTitle: 'filename',
    });

    expect(assembled.fb2Xml).toContain('<book-title>Fallback Heading Title</book-title>');
    expect(assembled.fb2Xml).toContain(
      '<first-name>Jane</first-name><last-name>Austen</last-name>',
    );
    expect(assembled.fb2Xml).toContain('<strong>Strong</strong>');
    expect(assembled.fb2Xml).toContain('<emphasis>inserted</emphasis>');
    expect(assembled.fb2Xml).not.toContain('removed');
    expect(assembled.fb2Xml).toContain('(a+b)/(2)');
    expect(assembled.fb2Xml).toContain('1. First item');
    expect(assembled.fb2Xml).toContain('2. Second item');
    expect(assembled.fb2Xml).toContain('Inner1 | Inner2');
    expect(assembled.fb2Xml).toContain('<body name="notes">');
    expect(assembled.fb2Xml).toContain('Footnote body text.');
    expect(assembled.fb2Xml).toContain('type="note"');

    // Summary items verify dropped styling, deletions, comments, equations, nested tables, headers/footers.
    expect(assembled.summary.some((s) => s.kind === 'skippedDeletions' && s.count === 1)).toBe(
      true,
    );
    expect(assembled.summary.some((s) => s.kind === 'skippedComments' && s.count === 1)).toBe(true);
    expect(assembled.summary.some((s) => s.kind === 'equationsAsText' && s.count === 1)).toBe(true);
    expect(assembled.summary.some((s) => s.kind === 'droppedStyling')).toBe(true);
    expect(assembled.summary.some((s) => s.kind === 'flattenedNestedTables' && s.count === 1)).toBe(
      true,
    );
    expect(assembled.summary.some((s) => s.kind === 'droppedHeadersFooters')).toBe(true);

    // Ensure valid nesting: Part One has intro paragraph wrapped in untitled child section before Chapter 1!
    expect(assembled.fb2Xml).toContain(
      '<section><p>Intro before subsection.</p></section><section><title><p>Chapter 1</p></title>',
    );
  });

  it('prefers paired raster PNG over svgBlip, flags standalone SVG for rasterization, and omits WMF/remote images', () => {
    const documentXml = wrapDoc(`
      <w:p><w:r><w:t>Images test</w:t></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="SvgWithPng" descr="Diagram"/><a:graphic><a:graphicData>
        <a:blip r:embed="rIdPng"><a:extLst><a:ext><asvg:svgBlip r:embed="rIdSvg1"/></a:ext></a:extLst></a:blip>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="StandaloneSvg"/><a:graphic><a:graphicData>
        <a:blip r:embed="rIdSvgOnly"/>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="3" name="OldWmf"/><a:graphic><a:graphicData>
        <a:blip r:embed="rIdWmf"/>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="4" name="RemoteImg"/><a:graphic><a:graphicData>
        <a:blip r:link="rIdRemote"/>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    `);

    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdPng" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/paired.png"/>
        <Relationship Id="rIdSvg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/paired.svg"/>
        <Relationship Id="rIdSvgOnly" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/vector.svg"/>
        <Relationship Id="rIdWmf" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/legacy.wmf"/>
        <Relationship Id="rIdRemote" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/pic.png" TargetMode="External"/>
      </Relationships>`;

    const parsed = parseDocxOoxml({
      documentXml,
      documentRelsXml: relsXml,
      roundtrip: FOREIGN_RT,
    });

    expect(parsed.neededImages.has('word/media/paired.png')).toBe(true);
    expect(parsed.neededImages.get('word/media/paired.png')?.isSvg).toBe(false);
    expect(parsed.neededImages.has('word/media/paired.svg')).toBe(false);

    expect(parsed.neededImages.has('word/media/vector.svg')).toBe(true);
    expect(parsed.neededImages.get('word/media/vector.svg')?.isSvg).toBe(true);
    expect(parsed.neededImages.get('word/media/vector.svg')?.suggestedBinaryId).toBe('vector.png');

    expect(
      parsed.summary.some((s) => s.kind === 'droppedUnsupportedDrawings' && s.count === 1),
    ).toBe(true);
    expect(parsed.summary.some((s) => s.kind === 'droppedRemoteImages' && s.count === 1)).toBe(
      true,
    );
  });

  it('keeps section header images XSD-valid before subsections and consecutive images', () => {
    const documentXml = wrapDoc(`
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part 1</w:t></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="PartImg"/><a:graphic><a:graphicData>
        <a:blip r:embed="rId1"/>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Sub</w:t></w:r></w:p>
      <w:p><w:r><w:t>Body text.</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Gallery</w:t></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="2" name="G1"/><a:graphic><a:graphicData>
        <a:blip r:embed="rId1"/>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
      <w:p><w:r><w:drawing><wp:inline><wp:docPr id="3" name="G2"/><a:graphic><a:graphicData>
        <a:blip r:embed="rId2"/>
      </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    `);
    const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img1.png"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img2.png"/>
      </Relationships>`;
    const parsed = parseDocxOoxml({
      documentXml,
      documentRelsXml: relsXml,
      roundtrip: FOREIGN_RT,
    });
    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: TEMPLATE_XML,
      fallbackTitle: 'Images',
      binaryIdByMedia: new Map([
        ['word/media/img1.png', 'img1.png'],
        ['word/media/img2.png', 'img2.png'],
      ]),
    });
    expect(assembled.fb2Xml).toContain(
      '<section><title><p>Part 1</p></title><image l:href="#img1.png"/><section><title><p>Sub</p></title><p>Body text.</p></section></section>',
    );
    expect(assembled.fb2Xml).toContain(
      '<section><title><p>Gallery</p></title><image l:href="#img1.png"/><empty-line/><image l:href="#img2.png"/></section>',
    );
  });

  it('falls back to unrecognised genre when no known genre matches and maps Calibre cp:keywords', () => {
    const documentXml = wrapDoc('<w:p><w:r><w:t>Body prose.</w:t></w:r></w:p>');
    const coreWithUnknown = `<?xml version="1.0" encoding="UTF-8"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
        xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Foreign Novel</dc:title>
        <dc:subject>NotAnFb2Genre</dc:subject>
        <cp:keywords>sf_fantasy, custom tag</cp:keywords>
      </cp:coreProperties>`;
    const genreMap = new Map([['sf_fantasy', 'sf_fantasy']]);
    const parsed = parseDocxOoxml({
      documentXml,
      coreXml: coreWithUnknown,
      roundtrip: FOREIGN_RT,
    });
    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: TEMPLATE_XML.replace('<genre>unrecognised</genre>', '<genre/>'),
      fallbackTitle: 'Fallback',
      genreMap,
    });
    expect(assembled.fb2Xml).toContain('<genre>sf_fantasy</genre>');
    expect(assembled.fb2Xml).toContain('<keywords>NotAnFb2Genre, custom tag</keywords>');

    // When no subject or keyword matches `genreMap`, `<genre>unrecognised</genre>` replaces empty `<genre/>`.
    const parsedNoMatch = parseDocxOoxml({
      documentXml,
      coreXml: coreWithUnknown.replace('sf_fantasy, ', ''),
      roundtrip: FOREIGN_RT,
    });
    const assembledNoMatch = assembleDocxToFb2Xml(parsedNoMatch, {
      templateXml: TEMPLATE_XML.replace('<genre>unrecognised</genre>', '<genre/>'),
      fallbackTitle: 'Fallback',
      genreMap,
    });
    expect(assembledNoMatch.fb2Xml).toContain('<genre>unrecognised</genre>');
  });

  it('throws DocxEmptyError when the DOCX has no importable text, tables, or images', () => {
    const emptyDoc = wrapDoc('<w:p><w:r><w:t>   </w:t></w:r></w:p>');
    expect(() => parseDocxOoxml({ documentXml: emptyDoc, roundtrip: FOREIGN_RT })).toThrow(
      DocxEmptyError,
    );
  });
});
