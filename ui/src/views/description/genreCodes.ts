/**
 * Feature 015 (FR-010, FR-012, FR-015): the genre code rule and the category the "add genre" form
 * proposes - the last one used in this session, the first time the standard "Other" category,
 * else the list's first category.
 */
import type { GenreCatalog } from './resources';

/**
 * A genre code is the FB2 schema's xs:token (the requester's rule: anything the schema allows is
 * allowed): its whitespace collapses as the schema collapses it.
 */
export function collapseToken(text: string): string {
  return text.replace(/[ \t\n\r]+/g, ' ').trim();
}

/** Any non-empty token without control characters (the core's is_valid_genre_code). */
export function isGenreCode(code: string): boolean {
  const token = collapseToken(code);
  // eslint-disable-next-line no-control-regex
  return token !== '' && !/[\u0000-\u001f]/.test(token);
}

let lastCategory: string | null = null;

export function rememberCategory(key: string): void {
  lastCategory = key;
}

export function proposedCategory(catalog: GenreCatalog): string {
  const keys = catalog.categories.map((c) => c.key);
  if (lastCategory && keys.includes(lastCategory)) return lastCategory;
  if (keys.includes('other')) return 'other';
  return keys[0] ?? 'other';
}

/**
 * Feature 015 (FR-016): how an entry of Choose a genre shows that it is one of the user's own
 * genres - a class for its colour and, not relying on colour, its source file in the tooltip (the
 * option's text carries the "[your file]" marker already).
 */
export function ownGenreMarks(entry: { source: string; file?: string }): {
  className?: string;
  title?: string;
} {
  if (!entry.source.startsWith('user')) return {};
  const file = entry.file ?? entry.source.replace(/^user:/, '');
  return { className: 'mfbe-genre-own', title: file };
}
