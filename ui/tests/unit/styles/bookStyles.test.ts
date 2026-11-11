/**
 * Feature 012 (T049, T056; D36-D39; FR-062; contracts/book-styles.md §2-§3): the book's stylesheets for
 * the Body view - the selector translation, the cascade layers, every standard property's treatment
 * and each limit, and the switch's effective state.
 */
import { describe, expect, it } from 'vitest';

import { PROPERTY_TREATMENTS } from '@/features/styles/bookStyleProperties';
import { bookStylesCss, LAYERS, treat, treatmentOf } from '@/features/styles/bookStyles';
import { bookStylesShown } from '@/features/styles/bookStylesSwitch';
import { standardProperties } from '@/features/styles/declarations';

const SCOPE = '.mfbe-book-styles .fb-editor';
const sheet = (content: string) => [{ type: 'text/css', content }];
const css = (content: string) => bookStylesCss(sheet(content)).css;

describe('the selectors (§2)', () => {
  it('are translated to the Body view, scoped, in the fb-book layer', () => {
    const out = css(
      'p { text-indent: 2em } .letter { color: #c00 } emphasis strong { font-weight: 900 } ' +
        'section > title p::first-letter { font-size: 2em }',
    );
    expect(out.startsWith(`${LAYERS}\n@layer fb-book {`)).toBe(true);
    expect(out).toContain(`${SCOPE} .fb-p { text-indent: 2em; }`);
    expect(out).toContain(
      `${SCOPE} :is(.fb-style[data-style="letter"], [data-style~="letter"]) { color: #c00; }`,
    );
    expect(out).toContain(`${SCOPE} .fb-emphasis .fb-strong { font-weight: 900; }`);
    expect(out).toContain(
      `${SCOPE} .fb-section > .fb-title .fb-p::first-letter { font-size: 2em; }`,
    );
  });

  it("take the book's * as every FB2 element, not the editor's own pieces", () => {
    const out = css('* { letter-spacing: 1px }');
    expect(out).toMatch(/:is\(\.fb-p, \.fb-section, [^)]*\.fb-body\) \{ letter-spacing: 1px; \}/);
    expect(out).not.toContain(`${SCOPE} * {`);
  });

  it('hold back what the view cannot draw: ids, attributes, ::selection, :hover, unknown elements', () => {
    const { css: out, heldBack } = bookStylesCss(
      sheet(
        '#chapter1 { color: red } p[lang] { color: red } p::selection { color: red } ' +
          'p:hover { color: red } description { color: red } p { color: blue }',
      ),
    );
    expect(out).toContain(`${SCOPE} .fb-p { color: blue; }`);
    expect(out.match(/color: red/g)).toBeNull();
    expect(heldBack).toEqual(
      expect.arrayContaining(['#chapter1', 'p[lang]', 'p::selection', 'p:hover', 'description']),
    );
  });

  it('keep @media with its rules, @font-face with data: sources only; drop @import and @keyframes', () => {
    const { css: out, heldBack } = bookStylesCss(
      sheet(
        '@import url(other.css); @media (min-width: 10px) { p { color: green } } ' +
          '@font-face { font-family: A; src: url(data:font/woff2;base64,AA==) } ' +
          '@font-face { font-family: B; src: url(https://example.com/b.woff2) } ' +
          '@keyframes spin { to { color: red } }',
      ),
    );
    expect(out).toContain(`@media (min-width:10px) { ${SCOPE} .fb-p { color: green; } }`);
    expect(out).toContain('font-family:A');
    expect(out).not.toContain('example.com');
    expect(heldBack).toEqual(expect.arrayContaining(['@import', '@font-face', '@keyframes']));
  });

  it('drop !important, which in a lower layer would win over the marks', () => {
    expect(css('p { color: red !important }')).toContain(`${SCOPE} .fb-p { color: red; }`);
  });
});

describe('the properties (§3, T056)', () => {
  it('cover exactly the standard properties the Styles view knows', () => {
    expect(Object.keys(PROPERTY_TREATMENTS).sort()).toEqual(standardProperties());
  });

  it('draw the look as written', () => {
    for (const name of [
      'padding',
      'border',
      'border-radius',
      'outline',
      'background',
      'background-color',
      'box-shadow',
      'font-family',
      'font-weight',
      'font-style',
      'font-variant',
      'font-stretch',
      'text-align',
      'line-height',
      'letter-spacing',
      'word-spacing',
      'text-decoration',
      'text-transform',
      'text-shadow',
      'font-variant-caps',
      'hyphens',
      'float',
      'clear',
      'columns',
      'writing-mode',
      'direction',
      'width',
      'min-width',
      'max-width',
      'min-height',
      'list-style',
      'content',
      'quotes',
      'counter-reset',
      'counter-increment',
      'overflow-wrap',
      'text-overflow',
    ]) {
      expect(treatmentOf(name), name).toBe('drawn');
    }
  });

  it('hold back what hides text, moves it away, clips it, takes editing away or moves by itself', () => {
    for (const name of [
      'transform',
      'translate',
      'rotate',
      'scale',
      'zoom',
      'height',
      'max-height',
      'block-size',
      'overflow',
      'overflow-y',
      'clip-path',
      'mask',
      'filter',
      'pointer-events',
      'user-select',
      'caret-color',
      'cursor',
      'animation',
      'animation-name',
      'transition',
      'transition-duration',
      'offset-path',
      'content-visibility',
      'touch-action',
      'scroll-margin-top',
      'all',
      'font-size-adjust',
      'white-space-collapse',
      'text-wrap-mode',
    ]) {
      expect(treatmentOf(name), name).toBe('held');
    }
    expect(treatmentOf('-webkit-user-modify')).toBe('held');
    expect(treatmentOf('-webkit-hyphens')).toBe('held');
  });

  it('draw the limited ones within their limits', () => {
    const cases: [string, string, string | null][] = [
      ['font-size', '2px', '6px'],
      ['font-size', '0', null],
      ['font-size', '1.2em', '1.2em'],
      ['font', '0/0 a', null],
      ['font', 'italic 3px serif', null],
      ['font', '700 12px Arial', '700 12px Arial'],
      ['font', 'bold 1.2em/1.4 Georgia', 'bold 1.2em/1.4 Georgia'],
      ['opacity', '0.1', null],
      ['opacity', '0.3', '0.3'],
      ['visibility', 'hidden', null],
      ['visibility', 'collapse', null],
      ['visibility', 'visible', 'visible'],
      ['color', 'transparent', null],
      ['color', '#123456', '#123456'],
      ['position', 'absolute', null],
      ['position', 'fixed', null],
      ['position', 'sticky', null],
      ['position', 'relative', 'relative'],
      ['top', '10em', '2em'],
      ['left', '-40px', '-2em'],
      ['top', '5px', '5px'],
      ['margin', '0 -10em 1em auto', '0 -2em 1em auto'],
      ['margin-left', '120px', '120px'],
      ['text-indent', '10em', '10em'],
      ['margin-inline-start', '-3em', '-2em'],
      ['text-indent', '-5em', '-2em'],
      ['text-indent', '2em', '2em'],
      ['display', 'none', null],
      ['display', 'contents', null],
      ['display', 'flex', null],
      ['display', 'block', 'block'],
      ['display', 'inline-block', 'inline-block'],
      ['white-space', 'nowrap', null],
      ['white-space', 'pre', null],
      ['white-space', 'normal', 'pre-wrap'],
      ['text-wrap', 'nowrap', null],
      ['text-wrap', 'balance', 'balance'],
      ['z-index', '10', '0'],
      ['z-index', '-1', '-1'],
    ];
    for (const [name, value, expected] of cases) {
      expect(treatmentOf(name), name).toBe('limited');
      expect(treat(name, value), `${name}: ${value}`).toBe(expected);
    }
  });

  it('hold back addresses other than data:, whatever the property', () => {
    expect(treat('background', 'url(https://example.com/a.png)')).toBeNull();
    expect(treat('background-image', 'url(images/a.png)')).toBeNull();
    expect(treat('list-style-image', 'url(file:///etc/a.png)')).toBeNull();
    expect(treat('background', 'url(data:image/png;base64,AA==)')).toBe(
      'url(data:image/png;base64,AA==)',
    );
  });
});

describe('the switch (D39)', () => {
  it('shows the styles with the setting on and Fast mode off', () => {
    expect(bookStylesShown({ fastMode: false, settings: { view: { showBookStyles: true } } })).toBe(
      true,
    );
    expect(bookStylesShown({ fastMode: true, settings: { view: { showBookStyles: true } } })).toBe(
      false,
    );
    expect(bookStylesShown({ fastMode: false, settings: { view: {} } })).toBe(false);
    expect(bookStylesShown({ fastMode: false, settings: null })).toBe(false);
  });
});
