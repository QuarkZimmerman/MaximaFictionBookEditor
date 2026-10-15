import { compareVersions } from '@/features/help/versionCheck';

describe('version check (feature 002 FR-080)', () => {
  it('compares dot-separated numbers; missing or non-numeric parts count as 0', () => {
    expect(compareVersions('0.0.2', '0.0.1')).toBeGreaterThan(0);
    expect(compareVersions('0.0.1', '0.0.2')).toBeLessThan(0);
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.0.2', '0.0.2.0')).toBe(0);
    expect(compareVersions('2', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('0.0.2-rebuild', '0.0.2')).toBe(0);
    expect(compareVersions('', '0')).toBe(0);
  });
});
