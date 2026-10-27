/**
 * The id and language checks of the Table bar, the attribute plans and the assistant (feature
 * 006, T115; FR-020, FR-022; U16; I13; data-model §10.2; research R2.17; quickstart §7 "Unit
 * and core tests"): `isNcName` is an XML 1.0 Fifth Edition NCName (productions [4], [4a] and [5]
 * without `:`), the classes the core's validator applies to `xs:ID`, and `isLanguageTag` the
 * `xs:language` pattern. The names whose verdict depends on the character classes are shared
 * with the core: `tests/fixtures/tables/ncnames.json`, which the Catch2 case "validator: table
 * ids are xs:ID exactly where ncnames.json says" (`tests/core/test_validator.cpp`) validates as
 * table ids, so the UI's check and the core's validator cannot drift. The `collectBookIds` cases
 * are `ui/tests/unit/model/ids.test.ts`'s (T039).
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isLanguageTag, isNcName } from '@/editor/table/attrs';

const NCNAMES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../tests/fixtures/tables/ncnames.json',
);

interface NcNames {
  version: number;
  names: { name: string; valid: boolean; note: string }[];
}

describe('isNcName (FR-022; I13)', () => {
  it('accepts XML names without a colon and refuses the rest', () => {
    for (const name of ['t1', '_x', 'ä-1', 'x-1.y_2']) expect(isNcName(name), name).toBe(true);
    for (const name of ['1t', 'a b', 'a:b', '-x', '.x', '']) {
      expect(isNcName(name), JSON.stringify(name)).toBe(false);
    }
  });

  it('U16: decides every name of the shared ncnames.json as the core’s validator does', () => {
    const list = JSON.parse(readFileSync(NCNAMES, 'utf8')) as NcNames;
    expect(list.version).toBe(1);
    expect(list.names.length).toBeGreaterThanOrEqual(15);
    // Both verdicts occur, and the names that show the character classes are there.
    expect(list.names.some((one) => one.valid)).toBe(true);
    expect(list.names.some((one) => !one.valid)).toBe(true);
    for (const name of ['ä-1', 'Таблица1', '表1', '\u00b7x', 'x\u00b7', '\u0661x', '\u{10000}x']) {
      expect(
        list.names.map((one) => one.name),
        name,
      ).toContain(name);
    }
    for (const { name, valid, note } of list.names) {
      expect(isNcName(name), `${JSON.stringify(name)}: ${note}`).toBe(valid);
    }
  });

  it('refuses a lone surrogate, white space around a name and characters of no class', () => {
    for (const name of ['\ud800', 'x\udc00', ' t1', 't1 ', 't\u00a01', 'x\u2028', 'x;y']) {
      expect(isNcName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe('isLanguageTag (FR-020; I13)', () => {
  it('accepts the xs:language pattern and refuses the rest; an empty field is no tag', () => {
    for (const tag of ['de', 'de-CH', 'en-GB', 'x-klingon', 'zh-Hant-TW']) {
      expect(isLanguageTag(tag), tag).toBe(true);
    }
    for (const tag of ['de_CH', 'toolonglanguage', 'de-', '-de', 'de--CH', '']) {
      expect(isLanguageTag(tag), JSON.stringify(tag)).toBe(false);
    }
  });

  it('parts of one to eight letters, then of letters or digits; nothing around them', () => {
    expect(isLanguageTag('abcdefgh')).toBe(true);
    expect(isLanguageTag('abcdefghi')).toBe(false);
    expect(isLanguageTag('de-12345678')).toBe(true);
    expect(isLanguageTag('de-123456789')).toBe(false);
    expect(isLanguageTag('1de')).toBe(false);
    expect(isLanguageTag(' de')).toBe(false);
    expect(isLanguageTag('de ')).toBe(false);
    expect(isLanguageTag('dé')).toBe(false);
  });
});
