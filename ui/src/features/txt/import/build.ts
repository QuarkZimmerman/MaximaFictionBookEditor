/**
 * Feature 017 (D27, D30): the FB2 book of a foreign text file - one body holding one untitled section
 * with the paragraphs and empty lines, and the template's description with the file's name as the
 * title, as File > New makes a book. Valid by construction; nothing the file lacks is invented.
 */

export const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';

/** Text escaped for XML content and attributes. */
export function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The template's description with `title` as its book title (File > New's description). */
export function templateDescription(templateXml: string, title: string): string {
  const description =
    /<description[\s\S]*?<\/description>/.exec(templateXml)?.[0] ??
    '<description><title-info><genre/><author><last-name/></author><book-title/><lang>en</lang></title-info></description>';
  const titled = `<book-title>${xmlText(title)}</book-title>`;
  return /<book-title\b[^>]*\/>|<book-title\b[^>]*>[\s\S]*?<\/book-title>/.test(description)
    ? description.replace(/<book-title\b[^>]*\/>|<book-title\b[^>]*>[\s\S]*?<\/book-title>/, titled)
    : description.replace(/<\/author>/, `</author>${titled}`);
}

/** The body of the paragraphs (null: an empty line). */
export function bodyXml(items: readonly (string | null)[]): string {
  const content = items
    .map((item) => (item === null ? '<empty-line/>' : `<p>${xmlText(item)}</p>`))
    .join('');
  return `<body><section>${content || '<empty-line/>'}</section></body>`;
}

/** The whole book. */
export function bookXml(description: string, bodies: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<FictionBook xmlns="${FB2_NS}" xmlns:l="http://www.w3.org/1999/xlink">` +
    description +
    bodies +
    '</FictionBook>'
  );
}
