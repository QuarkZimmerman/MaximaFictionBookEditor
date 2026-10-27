import { compareVersions } from '@/features/help/versionCheck';

describe('version check (feature 002 FR-080)', () => {
  it('compares dot-separated numbers; missing or non-numeric parts count as 0', () => {
    expect(compareVersions('0.0.2', '0.0.1')).toBeGreaterThan(0);
    expect(compareVersions('0.0.1', '0.0.2')).toBeLessThan(0);
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.0.2', '0.0.2.0')).toBe(0);
    expect(compareVersions('2', '1.99.99')).toBeGreaterThan(0);
    // Not newer: a pre-release of 0.0.2 (feature 006, decision 13).
    expect(compareVersions('0.0.2-rebuild', '0.0.2')).toBeLessThan(0);
    expect(compareVersions('', '0')).toBe(0);
  });

  it('pre-releases are older than their final (feature 006, decision 13)', () => {
    expect(compareVersions('0.0.6', '0.0.6-rc')).toBeGreaterThan(0);
    expect(compareVersions('0.0.6', '0.0.6-rc.3')).toBeGreaterThan(0);
    expect(compareVersions('0.0.6-rc.2', '0.0.6-rc.10')).toBeLessThan(0);
    expect(compareVersions('0.0.5', '0.0.6-rc')).toBeLessThan(0);
    expect(compareVersions('0.0.6+abc', '0.0.6')).toBe(0);
    expect(compareVersions('0.0.6-rc+abc', '0.0.6-rc')).toBe(0);
    expect(compareVersions('0.0.6-rc.0', '0.0.6-rc')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-1', '1.0.0-alpha')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);

    // Antisymmetric over every pair of these: a before b exactly when b is after a.
    const versions = [
      '0.0.6',
      '0.0.6-rc',
      '0.0.6-rc.3',
      '0.0.6-rc.2',
      '0.0.6-rc.10',
      '0.0.5',
      '0.0.6+abc',
      '0.0.6-rc+abc',
      '0.0.6-rc.0',
      '1.0.0-1',
      '1.0.0-alpha',
      '1.0.0-beta',
    ];
    for (const a of versions) {
      for (const b of versions) {
        expect(
          Math.sign(compareVersions(a, b)) + Math.sign(compareVersions(b, a)),
          `${a} against ${b}`,
        ).toBe(0);
      }
    }
  });
});
