/**
 * Feature 012 (T030; D17, D23, D28; contracts/epub-import.md §1, §5): the package of every EPUB
 * version, the table of contents in both forms and the guide, the description with the people by
 * role, and the editor's own description read back exactly.
 */
import { describe as group, expect, it } from 'vitest';

import { describe } from '@/features/epub/import/description';
import { readNavigation, readPackage, resolvePath } from '@/features/epub/import/package';

function opf(version: string | null, metadata: string, extra = ''): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<package xmlns="http://www.idpf.org/2007/opf"${version === null ? '' : ` version="${version}"`}` +
    ' unique-identifier="uid" xmlns:opf="http://www.idpf.org/2007/opf">' +
    `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${metadata}</metadata>` +
    '<manifest><item id="c1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c2" href="text/notes.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    '<item id="img" href="images/cover.jpg" media-type="image/jpeg"/>' +
    `${extra}</manifest>` +
    '<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2" linear="no"/></spine>' +
    '<guide><reference type="cover" href="text/ch%201.xhtml" title="Cover"/></guide></package>'
  );
}

const BASIC =
  '<dc:identifier id="uid">x</dc:identifier><dc:title>A Title</dc:title><dc:language>ru-RU</dc:language>';

group('the EPUB package', () => {
  it('reads every version, 3.1 and no version included (D17)', () => {
    for (const version of ['2.0', '2.0.1', null, '3.0', '3.0.1', '3.1', '3.2', '3.3']) {
      const pkg = readPackage(opf(version, BASIC), 'OEBPS/content.opf');
      expect(pkg.version, String(version)).toBe(version ?? '');
      expect(pkg.metadata.titles).toEqual(['A Title']);
      expect(pkg.spine.map((one) => [one.item.path, one.linear])).toEqual([
        ['OEBPS/text/ch 1.xhtml', true],
        ['OEBPS/text/notes.xhtml', false],
      ]);
      expect(pkg.ncx?.path).toBe('OEBPS/toc.ncx');
      expect(pkg.guide).toEqual([{ type: 'cover', path: 'OEBPS/text/ch 1.xhtml' }]);
    }
  });

  it('finds the cover picture in either form, and the navigation document', () => {
    const three = readPackage(
      opf(
        '3.0',
        BASIC,
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      ).replace('media-type="image/jpeg"/>', 'media-type="image/jpeg" properties="cover-image"/>'),
      'OEBPS/content.opf',
    );
    expect(three.coverImage?.path).toBe('OEBPS/images/cover.jpg');
    expect(three.nav?.path).toBe('OEBPS/nav.xhtml');
    const two = readPackage(
      opf('2.0', `${BASIC}<meta name="cover" content="img"/>`),
      'OEBPS/content.opf',
    );
    expect(two.coverImage?.path).toBe('OEBPS/images/cover.jpg');
  });

  it('keeps every reference inside the container', () => {
    expect(resolvePath('OEBPS/text/a.xhtml', '../images/b%20c.png#x')).toBe('OEBPS/images/b c.png');
    expect(resolvePath('OEBPS/a.xhtml', '../../etc/passwd')).toBe('');
    expect(resolvePath('OEBPS/a.xhtml', 'https://example.com/x.png')).toBe('');
  });

  it('reads the contents from the navigation document and from the NCX', () => {
    const nav =
      '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">' +
      '<head><title>t</title></head><body><nav epub:type="toc"><ol><li><a href="text/a.xhtml">One</a>' +
      '<ol><li><a href="text/a.xhtml#s2">One.1</a></li></ol></li></ol></nav></body></html>';
    expect(readNavigation(nav, 'OEBPS/nav.xhtml', false)).toEqual([
      { label: 'One', path: 'OEBPS/text/a.xhtml', fragment: '', depth: 1 },
      { label: 'One.1', path: 'OEBPS/text/a.xhtml', fragment: 's2', depth: 2 },
    ]);
    const ncx =
      '<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
      '<navMap><navPoint id="n1" playOrder="1"><navLabel><text>Глава 1</text></navLabel><content src="ch1.xhtml"/>' +
      '</navPoint></navMap></ncx>';
    expect(readNavigation(ncx, 'OEBPS/toc.ncx', true)).toEqual([
      { label: 'Глава 1', path: 'OEBPS/ch1.xhtml', fragment: '', depth: 1 },
    ]);
  });

  it('gives people their FB2 places by role, in the FBD Maker form, and lists the rest (D28)', () => {
    const metadata =
      `${BASIC}` +
      '<dc:creator id="a1">Anna B. Example</dc:creator><meta refines="#a1" property="role" scheme="marc:relators">aut</meta>' +
      '<meta refines="#a1" property="file-as">Example, Anna B.</meta>' +
      '<dc:creator>Nobody Inparticular</dc:creator>' +
      '<dc:contributor opf:role="trl" opf:file-as="Translator, Peter">Peter Translator</dc:contributor>' +
      '<dc:contributor id="c1">Vincent Van Gogh</dc:contributor><meta refines="#c1" property="role" scheme="marc:relators">ill</meta>' +
      '<meta refines="#c1" property="file-as">Van Gogh, Vincent</meta>' +
      '<dc:contributor id="c2">Ю Редактор</dc:contributor><meta refines="#c2" property="role" scheme="marc:relators">edt</meta>' +
      '<dc:contributor id="c3">Paula Photographer</dc:contributor><meta refines="#c3" property="role" scheme="marc:relators">pht</meta>' +
      '<dc:contributor id="c4">Calibre</dc:contributor><meta refines="#c4" property="role" scheme="marc:relators">bkp</meta>' +
      '<dc:subject>Science Fiction</dc:subject><dc:subject>robots</dc:subject>' +
      '<dc:date>2026-11-10T00:00:00Z</dc:date><dc:publisher>Example Press</dc:publisher>' +
      '<dc:identifier>urn:isbn:978-0-00-000000-2</dc:identifier>' +
      '<meta property="belongs-to-collection" id="s1">The Series</meta>' +
      '<meta refines="#s1" property="collection-type">series</meta><meta refines="#s1" property="group-position">3</meta>' +
      '<dc:description>&lt;p&gt;First.&lt;/p&gt;&lt;p&gt;Second.&lt;/p&gt;</dc:description>';
    const pkg = readPackage(opf('3.0', metadata), 'OEBPS/content.opf');
    const { description, summary } = describe(
      pkg.metadata,
      [
        {
          code: 'sf',
          category: 'sf',
          names: { en: 'Science Fiction', ru: 'Фантастика' },
          source: 'standard',
        },
      ],
      'fallback',
    );
    expect(description.authors).toEqual([
      { lastName: 'Example', firstName: 'Anna', middleName: 'B.' },
      { firstName: 'Nobody', middleName: undefined, lastName: 'Inparticular' },
    ]);
    expect(description.translators).toEqual([
      { lastName: 'Translator', firstName: 'Peter', middleName: undefined },
    ]);
    expect(description.custom).toEqual([
      { type: 'mlillustrator', text: 'Van_Gogh Vincent' },
      { type: 'mleditor', text: 'Редактор Ю.' },
    ]);
    expect(summary).toEqual([
      { kind: 'listedData', detail: 'pht: Paula Photographer' },
      { kind: 'listedData', detail: 'bkp: Calibre' },
    ]);
    expect(description.lang).toBe('ru');
    expect(description.genres).toEqual(['sf']);
    expect(description.keywords).toBe('robots');
    expect(description.date).toBe('2026-11-10');
    expect(description.publish).toMatchObject({
      publisher: 'Example Press',
      isbn: '978-0-00-000000-2',
    });
    expect(description.sequences).toEqual([{ name: 'The Series', number: 3 }]);
    expect(description.annotation).toEqual(['First.', 'Second.']);
  });

  it("reads the editor's own description back exactly (D7)", () => {
    const original = {
      titleInfo: { bookTitle: 'Кавычки "и" <угловые> & амперсанд', genres: [{ code: 'sf' }] },
    };
    const escaped = JSON.stringify(original)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const pkg = readPackage(
      opf('3.0', `${BASIC}<meta property="mfbe:fb2-description">${escaped}</meta>`).replace(
        '<package ',
        '<package prefix="mfbe: https://github.com/QuarkZimmerman/MaximaFictionBookEditor/ns/epub#" ',
      ),
      'OEBPS/content.opf',
    );
    expect(JSON.parse(pkg.metadata.mfbeDescription!)).toEqual(original);
  });
});
