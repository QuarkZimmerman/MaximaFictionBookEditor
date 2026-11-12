/**
 * Feature 013 (SC-001, FR-002, FR-004; contracts/internal.md §1): every formula of features 011 and
 * 012's tests keeps the outcome MathJax 3 gave it - a picture, or a refusal - and its drawing keeps
 * the size recorded with the installed MathJax. With `UPDATE_FORMULA_BASELINE=1` the sizes and the
 * MathJax version are written instead, never the outcomes; an ordinary run never writes.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formulaSvg,
  MATHJAX_VERSION,
  type FormulaInput,
} from '@/features/markdown/diagrams/formula';

interface Entry {
  id: string;
  input: FormulaInput;
  source: string;
  display: boolean;
  outcome: 'picture' | 'refused';
  width?: string;
  height?: string;
}

const FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/formula-baseline.json',
);
const UPDATE = process.env.UPDATE_FORMULA_BASELINE === '1';
const baseline = JSON.parse(readFileSync(FILE, 'utf8')) as { mathjax: string; formulas: Entry[] };

/** The drawing's width and height as MathJax writes them (`12.345ex`). */
function sizeOf(svg: string): { width: string | null; height: string | null } {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  return { width: root.getAttribute('width'), height: root.getAttribute('height') };
}

describe('the formula baseline (feature 013, SC-001)', () => {
  afterAll(() => {
    if (!UPDATE) return;
    baseline.mathjax = MATHJAX_VERSION;
    writeFileSync(FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  });

  it('was recorded with the installed MathJax', () => {
    if (UPDATE) return;
    expect(baseline.mathjax, 'the MathJax version that recorded the sizes').toBe(MATHJAX_VERSION);
  });

  it.each(baseline.formulas.map((entry) => [entry.id, entry] as const))(
    '%s keeps its outcome and its size',
    async (id, entry) => {
      const svg = await formulaSvg(entry.input, entry.source, entry.display).catch(() => null);
      expect(svg === null ? 'refused' : 'picture', `${id}: the outcome`).toBe(entry.outcome);
      if (svg === null) return;
      const size = sizeOf(svg);
      if (UPDATE) {
        entry.width = size.width ?? undefined;
        entry.height = size.height ?? undefined;
        return;
      }
      expect(size, `${id}: the size`).toEqual({ width: entry.width, height: entry.height });
    },
  );
});
