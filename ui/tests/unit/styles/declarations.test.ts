// Feature 011 (US8; contracts/styles.md §2): the declarations the Styles view accepts.
import { describe, expect, it } from 'vitest';

import {
  canonicalDeclarations,
  checkDeclarations,
  isStandardProperty,
  standardProperties,
} from '@/features/styles/declarations';

describe('Styles view declarations (contracts/styles.md §2)', () => {
  it('accepts standard properties with valid values, !important included', () => {
    const check = checkDeclarations('text-indent: 1.5em; font-style: italic !important;');
    expect(check.issues).toEqual([]);
    expect(check.declarations).toEqual([
      { property: 'text-indent', value: '1.5em', important: false },
      { property: 'font-style', value: 'italic', important: true },
    ]);
  });

  it('refuses vendor-prefixed, unknown and custom properties as not standard', () => {
    for (const text of ['-webkit-hyphens: auto;', 'colr: red;', '--x: 1;']) {
      expect(checkDeclarations(text).issues, text).toEqual([
        { property: text.split(':')[0], reason: 'notStandard' },
      ]);
    }
    expect(isStandardProperty('hyphens')).toBe(true);
    expect(isStandardProperty('-webkit-hyphens')).toBe(false);
  });

  it('refuses a value the property does not allow, with the lexer’s reason', () => {
    const issues = checkDeclarations('text-indent: red;').issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ property: 'text-indent', reason: 'invalidValue' });
    expect(issues[0]!.detail).toBeTruthy();
  });

  it('writes declarations in one canonical form and lists the standard properties', () => {
    expect(
      canonicalDeclarations([
        { property: 'color', value: 'red', important: false },
        { property: 'margin', value: '0 1em', important: true },
      ]),
    ).toBe('  color: red;\n  margin: 0 1em !important;');
    const names = standardProperties();
    expect(names).toContain('text-indent');
    expect(names.some((name) => name.startsWith('-'))).toBe(false);
  });
});
