/** Feature 011 (rc.2 review): the choices of the Add style dialog (AddStyleDialog.tsx). */

/** The FB2 elements offered, in the order of a book; their names are `styles.element.<key>`. */
export const ELEMENT_CHOICES: readonly { key: string; selector: string }[] = [
  { key: 'body', selector: 'body' },
  { key: 'bodyTitle', selector: 'body > title' },
  { key: 'section', selector: 'section' },
  { key: 'sectionTitle', selector: 'section > title' },
  { key: 'epigraph', selector: 'epigraph' },
  { key: 'annotation', selector: 'annotation' },
  { key: 'p', selector: 'p' },
  { key: 'subtitle', selector: 'subtitle' },
  { key: 'emptyLine', selector: 'empty-line' },
  { key: 'cite', selector: 'cite' },
  { key: 'textAuthor', selector: 'text-author' },
  { key: 'poem', selector: 'poem' },
  { key: 'stanza', selector: 'stanza' },
  { key: 'v', selector: 'v' },
  { key: 'date', selector: 'date' },
  { key: 'table', selector: 'table' },
  { key: 'th', selector: 'th' },
  { key: 'td', selector: 'td' },
  { key: 'image', selector: 'image' },
  { key: 'emphasis', selector: 'emphasis' },
  { key: 'strong', selector: 'strong' },
  { key: 'strikethrough', selector: 'strikethrough' },
  { key: 'sub', selector: 'sub' },
  { key: 'sup', selector: 'sup' },
  { key: 'code', selector: 'code' },
  { key: 'a', selector: 'a' },
];

/** A CSS class name: letters, digits, hyphens and underscores, not starting with a digit. */
export const CLASS_NAME = /^-?[_\p{L}][-_\p{L}\p{N}]*$/u;

/** The choices whose name or selector holds `query` (letter case aside). */
export function filterChoices<T extends { label: string; selector: string }>(
  choices: readonly T[],
  query: string,
): T[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...choices];
  return choices.filter(
    (choice) => choice.label.toLowerCase().includes(wanted) || choice.selector.includes(wanted),
  );
}
