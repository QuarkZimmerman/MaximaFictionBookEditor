/**
 * Feature 010, US4 (D11, FR-040): the tooltip of a Description view field, found from its field
 * key. List positions are left out (`titleInfo.authors.0.firstName` -> `titleInfo.authors.
 * firstName`); the catalogue key `tip.description.<key>` is tried for the whole key, then for its
 * last two parts, then for its last part, so that one text serves the same field of every
 * person, sequence or date. A field without a text gets none - the Description view's coverage
 * test names it.
 */

import i18next, { type TFunction } from 'i18next';

export function descriptionFieldTip(t: TFunction, fieldKey: string): string | undefined {
  const parts = fieldKey.split('.').filter((part) => !/^\d+$/.test(part));
  const candidates = [parts.join('.'), parts.slice(-2).join('.'), parts.slice(-1).join('.')];
  for (const candidate of candidates) {
    const key = `tip.description.${candidate}`;
    if (candidate && i18next.exists(key)) return t(key);
  }
  return undefined;
}
