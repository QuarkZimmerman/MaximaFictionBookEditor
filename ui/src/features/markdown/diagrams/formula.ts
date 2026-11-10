/**
 * Feature 011 (D50, DP-25): draws a TeX formula as the picture file the book gets, with MathJax 3's
 * SVG output - the TeX fonts are paths inside the drawing (`fontCache: 'none'`), so nothing is
 * fetched - and its lite adaptor, which needs no page. Feature 012 (D24) adds MathJax's MathML input
 * for an EPUB's formulas, with the same output. Loaded only when an imported file has formulas.
 */
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { MathML } from 'mathjax-full/js/input/mathml.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

import { FORMULA_KEYWORD, MATHML_KEYWORD } from './files';
import { MAX_HEIGHT, MAX_WIDTH, rasterise, type DrawnDiagram } from './raster';

/**
 * Pixels per ex at twice the size of reading text (an ex is about half an em; a reader's text is
 * about 16 px), so thin strokes stay sharp when a reader scales the picture down to its line.
 */
const PIXELS_PER_EX = 16;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const page = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages }),
  OutputJax: new SVG({ fontCache: 'none' }),
});

// Feature 012 (D24): MathML formulas of an EPUB, through MathJax's MathML input - the same output.
const mathmlPage = mathjax.document('', {
  InputJax: new MathML(),
  OutputJax: new SVG({ fontCache: 'none' }),
});

const exOf = (value: string | null) => Number.parseFloat((value ?? '').replace(/ex$/, '')) || 0;

/** Draws `tex` (a block formula when `display`); rejects with TeX's reason when it is not valid. */
export async function drawFormula(tex: string, display: boolean): Promise<DrawnDiagram> {
  return drawn(adaptor.innerHTML(page.convert(tex, { display })), tex, FORMULA_KEYWORD);
}

/**
 * Feature 012 (D24): draws a MathML `<math>` element's markup (a block formula when `display`);
 * rejects when MathJax cannot read it.
 */
export async function drawMathML(mathml: string, display: boolean): Promise<DrawnDiagram> {
  return drawn(adaptor.innerHTML(mathmlPage.convert(mathml, { display })), mathml, MATHML_KEYWORD);
}

async function drawn(svg: string, source: string, keyword: string): Promise<DrawnDiagram> {
  const error = /data-mjx-error="([^"]*)"/.exec(svg) ?? (svg.includes('merror') ? ['', ''] : null);
  if (error) throw new Error(error[1] || 'not a valid formula');
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const width = exOf(root.getAttribute('width')) * PIXELS_PER_EX;
  const height = exOf(root.getAttribute('height')) * PIXELS_PER_EX;
  if (width <= 0 || height <= 0) throw new Error('an empty formula');
  const factor = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return rasterise(
    svg,
    Math.max(1, Math.round(width * factor)),
    Math.max(1, Math.round(height * factor)),
    source,
    keyword,
  );
}
