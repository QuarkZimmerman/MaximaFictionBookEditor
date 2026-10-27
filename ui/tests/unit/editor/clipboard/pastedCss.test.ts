/**
 * The project's own CSS reader for pasted HTML (feature 006, T140; FR-059; data-model §8.5 steps
 * 2 and 6; research R5 item 4, R5 probe P8 and "Alternatives considered: CSS"):
 * `parseDeclarations`, `readPastedCss`, `effectiveDeclarations`, `isHidden`, `mapAlign` and
 * `mapVAlign`. Every value is read from text, never from CSSOM or `getComputedStyle` - jsdom gives
 * parsed documents no stylesheets and drops `-webkit-center` where Chromium keeps it - so these
 * results are the same in jsdom as in Chromium.
 */

import {
  effectiveDeclarations,
  isHidden,
  mapAlign,
  mapVAlign,
  parseDeclarations,
  readPastedCss,
  type CssRule,
} from '@/editor/clipboard/pastedCss';

function parse(html: string): Document {
  return new window.DOMParser().parseFromString(html, 'text/html');
}

function entries(map: Map<string, string>): [string, string][] {
  return [...map.entries()];
}

describe('parseDeclarations', () => {
  it('reads the declarations of a style text: names lower-cased, the last one winning, !important dropped', () => {
    expect(
      entries(
        parseDeclarations(
          'Font-Weight: 700; font-style:italic ; FONT-WEIGHT: 400 !important;color : red',
        ),
      ),
    ).toEqual([
      ['font-weight', '400'],
      ['font-style', 'italic'],
      ['color', 'red'],
    ]);
  });

  it('keeps semicolons and colons inside quotes and parentheses; skips empty and broken declarations', () => {
    const map = parseDeclarations(
      ' font-family:"A;B: C",sans-serif ;background:url(data:image/png;base64,AAAA); ;width:;:x;mso-list:Ignore',
    );
    expect(entries(map)).toEqual([
      ['font-family', '"A;B: C",sans-serif'],
      ['background', 'url(data:image/png;base64,AAAA)'],
      ['mso-list', 'Ignore'],
    ]);
    expect(parseDeclarations('').size).toBe(0);
    expect(parseDeclarations('   ').size).toBe(0);
  });

  it('keeps values as given, a vendor prefix and the case of the value included', () => {
    expect(parseDeclarations('text-align:-webkit-center').get('text-align')).toBe('-webkit-center');
    expect(parseDeclarations('TEXT-ALIGN: CENTER').get('text-align')).toBe('CENTER');
  });
});

describe('readPastedCss', () => {
  it('reads every <style> in document order without comments and Office’s wrappers, at-rules dropped with their blocks, one rule per selector, unparsable selectors ignored', () => {
    const doc = parse(`<html><head><style>
<!--
 /* Font Definitions */
 @font-face
	{font-family:"Cambria Math";
	panose-1:2 4 5 3 5 4 6 3 2 4;}
p.MsoNormal, li.MsoNormal
	{margin:0cm; font-size:11.0pt;}
@page WordSection1
	{size:595.3pt 841.9pt;}
@list l0:level1
	{mso-level-text:\\F0B7;}
@media print { td { color: red } }
td
	{font-weight:400;
	text-align:general;}
p..bad {color: blue}
.xl65 {font-weight:700; text-align:center}
-->
</style></head><body><p>x</p><style>comment { display:none; }</style></body></html>`);
    const rules = readPastedCss(doc);
    expect(rules.map((rule) => rule.selector)).toEqual([
      'p.MsoNormal',
      'li.MsoNormal',
      'td',
      '.xl65',
      'comment',
    ]);
    expect(entries(rules[0]!.declarations)).toEqual([
      ['margin', '0cm'],
      ['font-size', '11.0pt'],
    ]);
    expect(entries(rules[2]!.declarations)).toEqual([
      ['font-weight', '400'],
      ['text-align', 'general'],
    ]);
    expect(entries(rules[4]!.declarations)).toEqual([['display', 'none']]);
  });

  it('gives no rule for a document without <style>, or with an empty one', () => {
    expect(readPastedCss(parse('<p>x</p>'))).toEqual([]);
    expect(readPastedCss(parse('<style></style><p>x</p>'))).toEqual([]);
    expect(readPastedCss(parse('<style><!-- --></style><p>x</p>'))).toEqual([]);
  });
});

describe('effectiveDeclarations', () => {
  it('applies the matching rules in stylesheet order, then the style attribute (Excel: td, then .xl65)', () => {
    const doc = parse(`<style><!--td {font-weight:400; text-align:general; vertical-align:bottom}
.xl65 {font-weight:700; text-align:center}--></style>
<table><tr><td class="xl65" style="height:15pt">Region</td><td>North</td></tr></table>`);
    const rules = readPastedCss(doc);
    const [region, north] = [...doc.querySelectorAll('td')];
    expect(entries(effectiveDeclarations(region!, rules))).toEqual([
      ['font-weight', '700'],
      ['text-align', 'center'],
      ['vertical-align', 'bottom'],
      ['height', '15pt'],
    ]);
    expect(entries(effectiveDeclarations(north!, rules))).toEqual([
      ['font-weight', '400'],
      ['text-align', 'general'],
      ['vertical-align', 'bottom'],
    ]);
  });

  it('the style attribute wins over a rule; a selector that throws is ignored; no specificity', () => {
    const doc = parse('<p id="x" class="c" style="color: green">t</p>');
    const element = doc.querySelector('p')!;
    const rules: CssRule[] = [
      { selector: '#x', declarations: new Map([['color', 'red']]) },
      { selector: 'p..broken', declarations: new Map([['color', 'blue']]) },
      { selector: '.c', declarations: new Map([['font-weight', 'bold']]) },
      { selector: 'p', declarations: new Map([['font-weight', 'normal']]) },
    ];
    expect(entries(effectiveDeclarations(element, rules))).toEqual([
      ['color', 'green'],
      ['font-weight', 'normal'],
    ]);
  });

  it('reads the values from text, never from CSSOM: -webkit-center stays in jsdom', () => {
    const doc = parse('<table><tr><td style="text-align:-webkit-center">x</td></tr></table>');
    const cell = doc.querySelector('td')!;
    expect(effectiveDeclarations(cell, []).get('text-align')).toBe('-webkit-center');
  });
});

describe('isHidden', () => {
  it('display: none and visibility: hidden hide; anything else does not', () => {
    expect(isHidden(parseDeclarations('display:none'))).toBe(true);
    expect(isHidden(parseDeclarations('DISPLAY: None'))).toBe(true);
    expect(isHidden(parseDeclarations('visibility:hidden'))).toBe(true);
    expect(isHidden(parseDeclarations('display:block; visibility:visible'))).toBe(false);
    expect(isHidden(parseDeclarations('mso-hide:all'))).toBe(false);
    expect(isHidden(new Map())).toBe(false);
  });
});

describe('mapAlign and mapVAlign (data-model §8.5 step 6)', () => {
  it('maps left, center and right, also with a -webkit- or -moz- prefix; anything else gives null', () => {
    const cases: [string | null | undefined, string | null][] = [
      ['left', 'left'],
      ['center', 'center'],
      ['right', 'right'],
      ['CENTER', 'center'],
      [' right ', 'right'],
      ['-webkit-center', 'center'],
      ['-moz-center', 'center'],
      ['-webkit-left', 'left'],
      ['-moz-right', 'right'],
      ['justify', null],
      ['start', null],
      ['end', null],
      ['baseline', null],
      ['general', null],
      ['-webkit-auto', null],
      ['', null],
      [null, null],
      [undefined, null],
    ];
    for (const [value, mapped] of cases) expect(mapAlign(value), String(value)).toBe(mapped);
  });

  it('maps top and text-top, middle and center, bottom and text-bottom; anything else gives null', () => {
    const cases: [string | null | undefined, string | null][] = [
      ['top', 'top'],
      ['text-top', 'top'],
      ['middle', 'middle'],
      ['center', 'middle'],
      ['bottom', 'bottom'],
      ['text-bottom', 'bottom'],
      ['BOTTOM', 'bottom'],
      ['baseline', null],
      ['sub', null],
      ['super', null],
      ['10px', null],
      ['', null],
      [null, null],
    ];
    for (const [value, mapped] of cases) expect(mapVAlign(value), String(value)).toBe(mapped);
  });
});
