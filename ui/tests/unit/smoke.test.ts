describe('unit test toolchain', () => {
  it('runs with Vitest globals', () => {
    expect(1 + 1).toBe(2);
  });

  it('provides a jsdom document', () => {
    const div = document.createElement('div');
    div.textContent = 'hello';
    document.body.append(div);
    expect(div).toBeInTheDocument();
    div.remove();
  });

  it('exposes the compile-time constants from vite.config.ts', () => {
    expect(__MFBE_UI_VERSION__).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof __MFBE_TOKEN__).toBe('string');
  });
});
