/**
 * Feature 012 (US1; contracts/epub-export.md §1, §4): XML text of the export - escaping, the XHTML
 * page every content document of the EPUB is wrapped in, and XML ids. Pages are XHTML (HTML5 in its
 * XML form) using only the elements EPUB 2 reading systems also show (D5).
 */

// The characters XML 1.0 does not allow, removed from every text the export writes.
// eslint-disable-next-line no-control-regex
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** Text content: XML 1.0 characters only, `&`, `<` and `>` escaped. */
export function text(value: string): string {
  return value
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** An attribute value in double quotes. */
export function attr(value: string): string {
  return text(value).replace(/"/g, '&quot;');
}

const NAME_START = /[A-Za-z_\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF]/;
const NAME_REST = /[A-Za-z0-9_.\-\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF]/;

/** An XML id (NCName) from any text: other characters become "_", a leading digit gains "id_". */
export function ncName(value: string): string {
  let out = '';
  for (const ch of value) out += NAME_REST.test(ch) ? ch : '_';
  if (out.length === 0) return 'id';
  return NAME_START.test(out[0]!) ? out : `id_${out}`;
}

/** Hands out XML ids unique within the whole publication (D4: duplicated ids made unique). */
export class IdAllocator {
  private readonly used = new Set<string>();

  allocate(wanted: string): string {
    const base = ncName(wanted);
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}_${n}`;
    this.used.add(id);
    return id;
  }
}

export interface PageOptions {
  title: string;
  lang: string;
  body: string;
  bodyClass?: string;
  /** The stylesheet's path relative to the page. */
  css?: string;
  epubTypeBody?: string;
}

/** One XHTML content document. */
export function page(options: PageOptions): string {
  const css = options.css ?? '../style.css';
  const bodyClass = options.bodyClass ? ` class="${attr(options.bodyClass)}"` : '';
  const bodyType = options.epubTypeBody ? ` epub:type="${attr(options.epubTypeBody)}"` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"` +
    ` xml:lang="${attr(options.lang)}" lang="${attr(options.lang)}">\n` +
    `<head>\n<title>${text(options.title || '-')}</title>\n` +
    `<link rel="stylesheet" type="text/css" href="${attr(css)}"/>\n</head>\n` +
    `<body${bodyClass}${bodyType}>\n${options.body}\n</body>\n</html>\n`
  );
}
