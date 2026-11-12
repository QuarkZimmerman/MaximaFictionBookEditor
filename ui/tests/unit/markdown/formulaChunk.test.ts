// @vitest-environment node
/**
 * Feature 013 (FR-003): the formula drawing stays lazy. In a production build, the entry chunk and
 * every chunk it imports statically - what the page loads at start - hold no MathJax module and no
 * part of its font; the bundler itself reports which modules each chunk holds. The build goes to a
 * temporary folder; `dist/` is untouched.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build, type Plugin } from 'vite';

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** MathJax 4 and its fonts, or MathJax 3. */
const MATHJAX = /[\\/]node_modules[\\/](?:@mathjax[\\/]|mathjax-full[\\/])/;

interface Chunk {
  isEntry: boolean;
  imports: string[];
  modules: string[];
}

describe('the formula drawing in a production build (FR-003)', () => {
  const chunks = new Map<string, Chunk>();
  let outDir = '';

  beforeAll(async () => {
    outDir = mkdtempSync(path.join(tmpdir(), 'mfbe-ui-formula-chunk-'));
    const collect: Plugin = {
      name: 'mfbe-collect-chunks',
      generateBundle(_options, bundle) {
        for (const [file, out] of Object.entries(bundle)) {
          if (out.type !== 'chunk') continue;
          const ids = (out as { moduleIds?: string[] }).moduleIds ?? Object.keys(out.modules);
          chunks.set(file, { isEntry: out.isEntry, imports: [...out.imports], modules: ids });
        }
      },
    };
    await build({
      root: UI_ROOT,
      configFile: path.join(UI_ROOT, 'vite.config.ts'),
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true, sourcemap: false, write: true },
      plugins: [collect],
    });
  }, 180_000);

  afterAll(() => {
    if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  });

  it('keeps MathJax and its font out of everything the page loads at start', () => {
    const atStart = new Set<string>();
    const visit = (file: string) => {
      if (atStart.has(file)) return;
      atStart.add(file);
      for (const next of chunks.get(file)?.imports ?? []) visit(next);
    };
    for (const [file, chunk] of chunks) if (chunk.isEntry) visit(file);
    expect(atStart.size, 'the entry chunk').toBeGreaterThan(0);
    const found = [...atStart].flatMap((file) =>
      (chunks.get(file)?.modules ?? [])
        .filter((id) => MATHJAX.test(id))
        .map((id) => `${file}: ${id}`),
    );
    expect(found).toEqual([]);
    // MathJax is in the build at all: the guard cannot pass for want of it.
    expect([...chunks.values()].some((chunk) => chunk.modules.some((id) => MATHJAX.test(id)))).toBe(
      true,
    );
  });
});
