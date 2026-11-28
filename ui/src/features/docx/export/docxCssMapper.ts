/**
 * Feature 023 (T017; FR-010, data-model.md §3 & §5): translates FB2 `<stylesheet type="text/css">`
 * rules into OOXML `word/styles.xml` paragraph/character style definitions (`MfbePStyle_*` /
 * `MfbeCStyle_*`) and reports non-CSS stylesheets or unsupported CSS rules in the export summary.
 */
import { generate, parse, walk, type CssNode } from 'css-tree';

import type { Stylesheet } from '@/model/document';

import { escapeXmlAttr, type DocxSummaryItem } from '../shared/docxRoundtripTypes';
import { ptToHalfPoints } from '../shared/docxUnits';

export interface DocxStyleProperties {
  align?: 'left' | 'right' | 'center' | 'both';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  smallCaps?: boolean;
  caps?: boolean;
  colorHex?: string;
  bgHex?: string;
  fontSizeHalfPt?: number;
  fontFamily?: string;
  firstLineIndentTwips?: number;
  leftIndentTwips?: number;
  rightIndentTwips?: number;
  spaceBeforeTwips?: number;
  spaceAfterTwips?: number;
}

export interface DocxMappedCss {
  /** Additional `<w:style>` XML fragments to append into `word/styles.xml`. */
  wordStylesXml: string[];
  /** Word style ID -> original FB2 `<style name="...">` or class name (for round-trip). */
  cssStyleMap: Record<string, string>;
  /** Paragraph style ID lookup by FB2 `style` attribute name. */
  paragraphStyleFor: (fb2StyleName: string) => string | undefined;
  /** Character style ID lookup by FB2 `<style name="...">` name. */
  characterStyleFor: (fb2StyleName: string) => string | undefined;
  /** Style overrides targeted at built-in FB2 element types (e.g. `p`, `cite`, `epigraph`). */
  typeOverrides: ReadonlyMap<string, DocxStyleProperties>;
}

const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  navy: '000080',
  maroon: '800000',
  purple: '800080',
  teal: '008080',
  olive: '808000',
  gray: '808080',
  grey: '808080',
  silver: 'C0C0C0',
  darkred: '8B0000',
  darkgreen: '006400',
  darkblue: '00008B',
  darkgray: 'A9A9A9',
  darkgrey: 'A9A9A9',
  lightgray: 'D3D3D3',
  lightgrey: 'D3D3D3',
  yellow: 'FFFF00',
  orange: 'FFA500',
  brown: 'A52A2A',
  gold: 'FFD700',
  crimson: 'DC143C',
  indigo: '4B0082',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  pink: 'FFC0CB',
  beige: 'F5F5DC',
  ivory: 'FFFFF0',
};

const GENERIC_FONTS: Readonly<Record<string, string>> = {
  serif: 'Georgia',
  'sans-serif': 'Arial',
  monospace: 'Courier New',
  cursive: 'Georgia',
  fantasy: 'Georgia',
};

const SUPPORTED_FB2_TYPES = new Set([
  'p',
  'subtitle',
  'epigraph',
  'cite',
  'poem',
  'v',
  'text-author',
  'date',
  'strong',
  'emphasis',
  'strikethrough',
  'code',
]);

function parseCssColorHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === 'transparent' || v === 'inherit' || v === 'initial') return null;
  if (v in NAMED_COLORS) return NAMED_COLORS[v]!;
  const hex3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (hex3) {
    return `${hex3[1]}${hex3[1]}${hex3[2]}${hex3[2]}${hex3[3]}${hex3[3]}`.toUpperCase();
  }
  const hex6 = /^#([0-9a-f]{6})$/.exec(v);
  if (hex6) return hex6[1]!.toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/.exec(v);
  if (rgb) {
    const toHex = (s: string) =>
      Math.max(0, Math.min(255, parseInt(s, 10)))
        .toString(16)
        .padStart(2, '0');
    return `${toHex(rgb[1]!)}${toHex(rgb[2]!)}${toHex(rgb[3]!)}`.toUpperCase();
  }
  return null;
}

function parseLengthToPt(raw: string, basePt: number): number | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*(pt|px|em|rem|mm|cm|in|%)?$/i.exec(raw.trim());
  if (!m) return null;
  const num = parseFloat(m[1]!);
  if (!Number.isFinite(num)) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  switch (unit) {
    case 'pt':
      return num;
    case 'px':
      return num * 0.75;
    case 'em':
    case 'rem':
      return num * basePt;
    case 'mm':
      return (num / 25.4) * 72;
    case 'cm':
      return (num / 2.54) * 72;
    case 'in':
      return num * 72;
    case '%':
      return (num / 100) * basePt;
    default:
      return null;
  }
}

function parseFontFamilyName(raw: string): string | null {
  const first = raw
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, ''))
    .find((part) => part.length > 0);
  if (!first) return null;
  const lower = first.toLowerCase();
  if (lower in GENERIC_FONTS) return GENERIC_FONTS[lower]!;
  const clean = Array.from(first)
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, 80);
  return clean.length > 0 ? clean : null;
}

function applyDeclaration(
  prop: string,
  val: string,
  basePt: number,
  target: DocxStyleProperties,
): boolean {
  const p = prop.trim().toLowerCase();
  const v = val.trim();
  const vl = v.toLowerCase();
  if (/url\s*\(/i.test(v)) return false;

  switch (p) {
    case 'text-align':
      if (vl === 'left' || vl === 'start') {
        target.align = 'left';
        return true;
      }
      if (vl === 'right' || vl === 'end') {
        target.align = 'right';
        return true;
      }
      if (vl === 'center') {
        target.align = 'center';
        return true;
      }
      if (vl === 'justify') {
        target.align = 'both';
        return true;
      }
      return false;

    case 'font-weight':
      if (vl === 'bold' || vl === 'bolder') {
        target.bold = true;
        return true;
      }
      if (vl === 'normal' || vl === 'lighter') {
        target.bold = false;
        return true;
      }
      if (/^\d+$/.test(vl)) {
        target.bold = parseInt(vl, 10) >= 600;
        return true;
      }
      return false;

    case 'font-style':
      if (vl === 'italic' || vl === 'oblique') {
        target.italic = true;
        return true;
      }
      if (vl === 'normal') {
        target.italic = false;
        return true;
      }
      return false;

    case 'text-decoration':
    case 'text-decoration-line': {
      let matched = false;
      if (vl.includes('underline')) {
        target.underline = true;
        matched = true;
      }
      if (vl.includes('line-through')) {
        target.strike = true;
        matched = true;
      }
      if (vl === 'none') {
        target.underline = false;
        target.strike = false;
        matched = true;
      }
      return matched;
    }

    case 'font-variant':
      if (vl === 'small-caps') {
        target.smallCaps = true;
        return true;
      }
      if (vl === 'normal') {
        target.smallCaps = false;
        return true;
      }
      return false;

    case 'text-transform':
      if (vl === 'uppercase') {
        target.caps = true;
        return true;
      }
      if (vl === 'none') {
        target.caps = false;
        return true;
      }
      return false;

    case 'color': {
      const hex = parseCssColorHex(v);
      if (!hex) return false;
      target.colorHex = hex;
      return true;
    }

    case 'background-color':
    case 'background': {
      const hex = parseCssColorHex(v);
      if (!hex) return false;
      target.bgHex = hex;
      return true;
    }

    case 'font-size': {
      const pt = parseLengthToPt(v, basePt);
      if (pt === null || pt <= 0 || pt > 144) return false;
      target.fontSizeHalfPt = Math.max(8, ptToHalfPoints(pt));
      return true;
    }

    case 'font-family': {
      const fam = parseFontFamilyName(v);
      if (!fam) return false;
      target.fontFamily = fam;
      return true;
    }

    case 'text-indent': {
      const pt = parseLengthToPt(v, basePt);
      if (pt === null || pt < 0 || pt > 200) return false;
      target.firstLineIndentTwips = Math.round(pt * 20);
      return true;
    }

    case 'margin-left':
    case 'padding-left': {
      const pt = parseLengthToPt(v, basePt);
      if (pt === null || pt < 0 || pt > 300) return false;
      target.leftIndentTwips = Math.round(pt * 20);
      return true;
    }

    case 'margin-right':
    case 'padding-right': {
      const pt = parseLengthToPt(v, basePt);
      if (pt === null || pt < 0 || pt > 300) return false;
      target.rightIndentTwips = Math.round(pt * 20);
      return true;
    }

    case 'margin-top': {
      const pt = parseLengthToPt(v, basePt);
      if (pt === null || pt < 0 || pt > 200) return false;
      target.spaceBeforeTwips = Math.round(pt * 20);
      return true;
    }

    case 'margin-bottom': {
      const pt = parseLengthToPt(v, basePt);
      if (pt === null || pt < 0 || pt > 200) return false;
      target.spaceAfterTwips = Math.round(pt * 20);
      return true;
    }

    default:
      return false;
  }
}

export function buildParagraphPropsXml(props: DocxStyleProperties): string {
  const parts: string[] = [];
  if (props.spaceBeforeTwips !== undefined || props.spaceAfterTwips !== undefined) {
    const attrs: string[] = [];
    if (props.spaceBeforeTwips !== undefined) attrs.push(`w:before="${props.spaceBeforeTwips}"`);
    if (props.spaceAfterTwips !== undefined) attrs.push(`w:after="${props.spaceAfterTwips}"`);
    parts.push(`<w:spacing ${attrs.join(' ')}/>`);
  }
  if (
    props.leftIndentTwips !== undefined ||
    props.rightIndentTwips !== undefined ||
    props.firstLineIndentTwips !== undefined
  ) {
    const attrs: string[] = [];
    if (props.leftIndentTwips !== undefined) attrs.push(`w:left="${props.leftIndentTwips}"`);
    if (props.rightIndentTwips !== undefined) attrs.push(`w:right="${props.rightIndentTwips}"`);
    if (props.firstLineIndentTwips !== undefined) {
      attrs.push(`w:firstLine="${props.firstLineIndentTwips}"`);
    }
    parts.push(`<w:ind ${attrs.join(' ')}/>`);
  }
  if (props.align) {
    parts.push(`<w:jc w:val="${props.align}"/>`);
  }
  if (props.bgHex) {
    parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${props.bgHex}"/>`);
  }
  return parts.join('');
}

export function buildRunPropsXml(props: DocxStyleProperties, includeShading = true): string {
  const parts: string[] = [];
  if (props.fontFamily) {
    const f = escapeXmlAttr(props.fontFamily);
    parts.push(`<w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:cs="${f}"/>`);
  }
  if (props.bold !== undefined) {
    parts.push(props.bold ? '<w:b/>' : '<w:b w:val="0"/>');
  }
  if (props.italic !== undefined) {
    parts.push(props.italic ? '<w:i/>' : '<w:i w:val="0"/>');
  }
  if (props.caps) parts.push('<w:caps/>');
  if (props.smallCaps) parts.push('<w:smallCaps/>');
  if (props.strike !== undefined) {
    parts.push(props.strike ? '<w:strike/>' : '<w:strike w:val="0"/>');
  }
  if (props.colorHex) {
    parts.push(`<w:color w:val="${props.colorHex}"/>`);
  }
  if (props.fontSizeHalfPt !== undefined) {
    parts.push(`<w:sz w:val="${props.fontSizeHalfPt}"/><w:szCs w:val="${props.fontSizeHalfPt}"/>`);
  }
  if (props.underline !== undefined) {
    parts.push(props.underline ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>');
  }
  if (includeShading && props.bgHex) {
    parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${props.bgHex}"/>`);
  }
  return parts.join('');
}

interface ParsedSelectorTarget {
  kind: 'class' | 'type';
  name: string;
}

function classifySelector(selectorText: string): ParsedSelectorTarget | null {
  const s = selectorText.trim();
  // Match `.myStyle`, `p.myStyle`, `style.myStyle`, or `style[name="myStyle"]` / `[name="myStyle"]`
  const classMatch = /^(?:[a-zA-Z_-]+)?\.([A-Za-z0-9_-]+)$/.exec(s);
  if (classMatch) {
    return { kind: 'class', name: classMatch[1]! };
  }
  const attrMatch = /^(?:style)?\[name=["']?([A-Za-z0-9_-]+)["']?\]$/i.exec(s);
  if (attrMatch) {
    return { kind: 'class', name: attrMatch[1]! };
  }
  const typeMatch = /^([a-zA-Z-]+)$/.exec(s);
  if (typeMatch && SUPPORTED_FB2_TYPES.has(typeMatch[1]!.toLowerCase())) {
    return { kind: 'type', name: typeMatch[1]!.toLowerCase() };
  }
  return null;
}

/**
 * Translates FB2 `<stylesheet>` blocks into Word style entries and collects summary notes for
 * non-CSS stylesheets and unsupported CSS rules or declarations.
 */
export function mapFb2CssToWordStyles(
  stylesheets: readonly Stylesheet[],
  basePt: number,
  summary: DocxSummaryItem[],
): DocxMappedCss {
  const classStyles = new Map<string, DocxStyleProperties>();
  const typeOverrides = new Map<string, DocxStyleProperties>();

  for (const sheet of stylesheets) {
    const type = (sheet.type || 'text/css').trim().toLowerCase();
    if (type !== 'text/css') {
      summary.push({ kind: 'nonCssStylesheet', detail: type });
      continue;
    }
    if (!sheet.content.trim()) continue;

    let syntaxError = false;
    const ast = parse(sheet.content, {
      parseValue: false,
      onParseError: () => {
        syntaxError = true;
      },
    });
    if (syntaxError) {
      summary.push({ kind: 'unsupportedCssRule', detail: 'CSS syntax error' });
    }

    walk(ast, {
      enter: (node: CssNode) => {
        if (node.type === 'Atrule') {
          summary.push({ kind: 'unsupportedCssRule', detail: `@${String(node.name)}` });
          return;
        }
        if (node.type !== 'Rule') return;
        const prelude = node.prelude ? generate(node.prelude) : '';
        const selectors = prelude
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        const targets: ParsedSelectorTarget[] = [];
        for (const sel of selectors) {
          const parsed = classifySelector(sel);
          if (parsed) targets.push(parsed);
          else summary.push({ kind: 'unsupportedCssRule', detail: sel });
        }
        if (targets.length === 0) return;

        const block = node.block;
        if (!block || block.type !== 'Block') return;
        const declProps: DocxStyleProperties = {};
        let appliedAny = false;
        block.children.forEach((child: CssNode) => {
          if (child.type !== 'Declaration') return;
          const prop = String(child.property);
          const rawVal = child.value ? generate(child.value) : '';
          if (applyDeclaration(prop, rawVal, basePt, declProps)) {
            appliedAny = true;
          } else {
            summary.push({ kind: 'unsupportedCssRule', detail: prop });
          }
        });
        if (!appliedAny) return;

        for (const t of targets) {
          const store = t.kind === 'class' ? classStyles : typeOverrides;
          const prev = store.get(t.name) ?? {};
          store.set(t.name, { ...prev, ...declProps });
        }
      },
    });
  }

  const wordStylesXml: string[] = [];
  const cssStyleMap: Record<string, string> = {};
  const pStyleByName = new Map<string, string>();
  const cStyleByName = new Map<string, string>();

  let idx = 0;
  for (const [fb2Name, props] of classStyles) {
    idx++;
    const pId = `MfbeStyle_${idx}`;
    const cId = `MfbeCharStyle_${idx}`;
    const label = escapeXmlAttr(`FB2 ${fb2Name}`);
    const pPr = buildParagraphPropsXml(props);
    const rPrP = buildRunPropsXml(props, false);
    const rPrC = buildRunPropsXml(props, true);

    wordStylesXml.push(
      `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${pId}">` +
        `<w:name w:val="${label}"/>` +
        `<w:basedOn w:val="Normal"/>` +
        (pPr ? `<w:pPr>${pPr}</w:pPr>` : '') +
        (rPrP ? `<w:rPr>${rPrP}</w:rPr>` : '') +
        `</w:style>`,
    );
    wordStylesXml.push(
      `<w:style w:type="character" w:customStyle="1" w:styleId="${cId}">` +
        `<w:name w:val="${label} Char"/>` +
        (rPrC ? `<w:rPr>${rPrC}</w:rPr>` : '') +
        `</w:style>`,
    );

    pStyleByName.set(fb2Name, pId);
    cStyleByName.set(fb2Name, cId);
    cssStyleMap[pId] = fb2Name;
    cssStyleMap[cId] = fb2Name;
  }

  return {
    wordStylesXml,
    cssStyleMap,
    paragraphStyleFor: (name) => pStyleByName.get(name),
    characterStyleFor: (name) => cStyleByName.get(name),
    typeOverrides,
  };
}
