/**
 * Feature 012 (US2; D17, D25, D29; contracts/epub-import.md §1, research DP-3): the pages of an EPUB
 * as DOM documents. The page's declared encoding is used (an XML declaration, a meta charset,
 * else UTF-8); XHTML is parsed as XML and, when it is not well-formed, as HTML; DTBook is read as
 * XML; OEB 1 documents as HTML. Parsed documents are inert: no script runs, nothing is loaded and no
 * external entity is ever fetched.
 */

const XML_DECLARATION = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?([A-Za-z0-9._-]+)/i;

/** The text of a page in its declared encoding (UTF-8 when none is declared or known). */
export function decodePage(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const declared = XML_DECLARATION.exec(head)?.[1] ?? META_CHARSET.exec(head)?.[1];
  if (declared) {
    try {
      return new TextDecoder(declared.toLowerCase()).decode(bytes);
    } catch {
      // an encoding the engine does not know: read as UTF-8
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

export type PageKind = 'xhtml' | 'dtbook' | 'html' | 'svg';

export function pageKind(mediaType: string): PageKind | null {
  switch (mediaType) {
    case 'application/xhtml+xml':
      return 'xhtml';
    case 'application/x-dtbook+xml':
      return 'dtbook';
    case 'text/x-oeb1-document':
    case 'text/html':
      return 'html';
    case 'image/svg+xml':
      return 'svg';
    default:
      return null;
  }
}

function broken(doc: Document): boolean {
  return doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement;
}

/** A page as a DOM document; `broken` when it had to be read as HTML (listed, D17). */
export function parsePage(text: string, kind: PageKind): { doc: Document; recovered: boolean } {
  const parser = new DOMParser();
  if (kind === 'html') return { doc: parser.parseFromString(text, 'text/html'), recovered: false };
  const xml = parser.parseFromString(text, kind === 'svg' ? 'image/svg+xml' : 'application/xml');
  if (!broken(xml)) return { doc: xml, recovered: false };
  // Not well-formed (HTML entities such as &nbsp;, unclosed elements): read as HTML.
  return { doc: parser.parseFromString(text, 'text/html'), recovered: true };
}
