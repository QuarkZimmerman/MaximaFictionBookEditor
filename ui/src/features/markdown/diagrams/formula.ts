/**
 * Feature 011 (D50, DP-25): draws a TeX formula as the picture file the book gets, with MathJax's
 * SVG output - the font's glyphs are paths inside the drawing (`fontCache: 'none'`) - and its lite
 * adaptor, which needs no page. Feature 012 (D24) adds MathJax's MathML input for an EPUB's
 * formulas, with the same output. Feature 013: MathJax 4 (`@mathjax/src`) with its default font,
 * whose glyph data comes in parts, each a lazy chunk of the bundle (never fetched from a network).
 * Loaded only when an imported file has formulas.
 */
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';
import { MathML } from '@mathjax/src/js/input/mathml.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { SVG } from '@mathjax/src/js/output/svg.js';

import { FORMULA_KEYWORD, MATHML_KEYWORD } from './files';
import { MAX_HEIGHT, MAX_WIDTH, rasterise, type DrawnDiagram } from './raster';
import { TEX_PACKAGES } from './texPackages';

/**
 * Pixels per ex at twice the size of reading text (an ex is about half an em; a reader's text is
 * about 16 px), so thin strokes stay sharp when a reader scales the picture down to its line.
 */
const PIXELS_PER_EX = 16;

/**
 * Feature 013 (research R1): the parts of MathJax 4's default font. MathJax asks for one by the name
 * `@mathjax/mathjax-newcm-font/js/svg/dynamic/<part>.js` when a formula needs its glyphs; importing
 * the part registers them, and the drawing is retried (`handleRetriesFor`).
 */
const FONT_PARTS = import.meta.glob(
  '/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/*.js',
);
const FONT_PART_NAME = '@mathjax/mathjax-newcm-font/js/svg/dynamic/';

mathjax.asyncLoad = (name: string) => {
  const load = name.startsWith(FONT_PART_NAME)
    ? FONT_PARTS[
        `/node_modules/@mathjax/mathjax-newcm-font/mjs/svg/dynamic/${name.slice(FONT_PART_NAME.length)}`
      ]
    : undefined;
  return load ? load() : Promise.reject(new Error(`no bundled MathJax part '${name}'`));
};

/**
 * The SVG output's options: the glyphs inside the drawing (`fontCache: 'none'`), and no line breaks
 * in an in-line formula - MathJax 4 breaks one at its operators by default, drawing each line as an
 * SVG of its own, but a formula becomes one picture (feature 013).
 */
const SVG_OPTIONS = { fontCache: 'none', linebreaks: { inline: false } };

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const page = mathjax.document('', {
  InputJax: new TeX({ packages: TEX_PACKAGES }),
  OutputJax: new SVG(SVG_OPTIONS),
});

// Feature 012 (D24): MathML formulas of an EPUB, through MathJax's MathML input - the same output.
const mathmlPage = mathjax.document('', {
  InputJax: new MathML(),
  OutputJax: new SVG(SVG_OPTIONS),
});

/** The MathJax version that draws the formulas (the formula baseline records with it, feature 013). */
export const MATHJAX_VERSION: string = mathjax.version;

const exOf = (value: string | null) => Number.parseFloat((value ?? '').replace(/ex$/, '')) || 0;

/** A formula's notation: TeX (the Markdown import) or MathML (the EPUB import). */
export type FormulaInput = 'tex' | 'mathml';

/** The width and height of MathJax's drawing, in ex. */
function svgSize(svg: string): { width: number; height: number } {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  return { width: exOf(root.getAttribute('width')), height: exOf(root.getAttribute('height')) };
}

/**
 * Feature 013 (SC-001): the SVG MathJax draws for a formula (a block formula when `display`) - the
 * step `drawFormula` and `drawMathML` share before rasterising, and the one the formula baseline
 * measures. Rejects as the drawing does: with MathJax's reason, or for an empty formula.
 */
export async function formulaSvg(
  input: FormulaInput,
  source: string,
  display: boolean,
): Promise<string> {
  const doc = input === 'tex' ? page : mathmlPage;
  const node = await mathjax.handleRetriesFor(() => doc.convert(source, { display }));
  const svg = adaptor.innerHTML(node);
  const error = /data-mjx-error="([^"]*)"/.exec(svg) ?? (svg.includes('merror') ? ['', ''] : null);
  if (error) throw new Error(error[1] || 'not a valid formula');
  const { width, height } = svgSize(svg);
  if (width <= 0 || height <= 0) throw new Error('an empty formula');
  return svg;
}

/** Draws `tex` (a block formula when `display`); rejects with TeX's reason when it is not valid. */
export async function drawFormula(tex: string, display: boolean): Promise<DrawnDiagram> {
  return drawn(await formulaSvg('tex', tex, display), tex, FORMULA_KEYWORD);
}

/**
 * Feature 012 (D24): draws a MathML `<math>` element's markup (a block formula when `display`);
 * rejects when MathJax cannot read it.
 */
export async function drawMathML(mathml: string, display: boolean): Promise<DrawnDiagram> {
  return drawn(await formulaSvg('mathml', mathml, display), mathml, MATHML_KEYWORD);
}

/** Rasterises a drawing `formulaSvg` accepted. */
async function drawn(svg: string, source: string, keyword: string): Promise<DrawnDiagram> {
  const size = svgSize(svg);
  const width = size.width * PIXELS_PER_EX;
  const height = size.height * PIXELS_PER_EX;
  const factor = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  return rasterise(
    svg,
    Math.max(1, Math.round(width * factor)),
    Math.max(1, Math.round(height * factor)),
    source,
    keyword,
  );
}
