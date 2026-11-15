/**
 * Feature 015 (FR-010, FR-012, FR-015): the genre code rule and the category the "add genre" form
 * proposes - the last one used in this session, the first time the standard "Other" category,
 * else the list's first category.
 */
import type { GenreCatalog } from './resources';

/** Lowercase Latin letters, digits and `_` (the core's is_valid_genre_code). */
export function isGenreCode(code: string): boolean {
  return /^[a-z0-9_]+$/.test(code);
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
