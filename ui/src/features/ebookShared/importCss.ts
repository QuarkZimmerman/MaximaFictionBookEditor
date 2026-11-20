/**
 * Neutral shared CSS -> FB2 class planner used by EPUB and KF8/MOBI imports (feature 018 T013).
 */
import { generate, parse, type CssNode } from 'css-tree';

import { translateCss } from '@/features/markdown/cssTranslate';

export type Fb2Form = 'emphasis' | 'strong' | 'strikethrough' | 'sup' | 'sub' | 'code';

export interface ClassUse {
  used: ReadonlySet<string>;
  paragraphs: ReadonlyMap<string, number>;
}

export interface ClassPlan {
  forms: ReadonlyMap<string, readonly Fb2Form[]>;
  named: ReadonlySet<string>;
  paragraphClass?: string;
  stylesheet: string;
  dropped: string[];
}

interface Declaration {
  property: string;
  value: string;
  important: boolean;
}

const CLASS_NAME = /^[A-Za-z_][\w-]*$/;
const FB2_MARK = /^(fb2-|fb-continued$)/;
const MONOSPACE = /\b(monospace|courier|consolas|menlo|monaco|[\w-]*mono)\b/i;
const ZERO = /^(-?0(\.0+)?(px|em|rem|pt|%)?\s*)+$/;

function formOf(declaration: Declaration): Fb2Form | null {
  const value = declaration.value.toLowerCase();
  switch (declaration.property) {
    case 'font-style':
      return /^(italic|oblique)/.test(value) ? 'emphasis' : null;
    case 'font-weight':
      return /^(bold|bolder|[6-9]00)$/.test(value) ? 'strong' : null;
    case 'text-decoration':
    case 'text-decoration-line':
      return value.includes('line-through') ? 'strikethrough' : null;
    case 'vertical-align':
      return value === 'super' ? 'sup' : value === 'sub' ? 'sub' : null;
    case 'font-family':
      return MONOSPACE.test(value) ? 'code' : null;
    default:
      return null;
  }
}

function changesNothing(declaration: Declaration): boolean {
  const { property } = declaration;
  const value = declaration.value.toLowerCase().trim();
  if (property.startsWith('-')) return true;
  if (/^(margin|padding)(-(top|right|bottom|left))?$/.test(property)) return ZERO.test(value);
  switch (property) {
    case 'display':
      return /^(block|inline|inline-block|list-item)$/.test(value);
    case 'font-style':
    case 'font-weight':
    case 'font-variant':
    case 'line-height':
      return value === 'normal' || value === '400' || value === 'inherit';
    case 'font-family':
      return true;
    case 'font-size':
      return /^(1em|100%|medium|inherit|1rem)$/.test(value);
    case 'text-decoration':
    case 'text-decoration-line':
    case 'text-transform':
      return value === 'none';
    case 'vertical-align':
      return value === 'baseline';
    case 'text-indent':
      return ZERO.test(value);
    case 'text-align':
      return value === 'justify';
    case 'color':
      return value === 'inherit' || value === 'currentcolor';
    case 'widows':
    case 'orphans':
    case 'hyphens':
    case 'page-break-before':
    case 'page-break-after':
    case 'page-break-inside':
    case 'break-before':
    case 'break-after':
    case 'break-inside':
    case 'unicode-bidi':
      return true;
    default:
      return false;
  }
}

function declarationsOf(block: CssNode): Declaration[] {
  const out: Declaration[] = [];
  for (const node of (block.children?.toArray() ?? []) as CssNode[]) {
    if (node.type !== 'Declaration') continue;
    out.push({
      property: String(node.property).toLowerCase(),
      value: generate(node.value).trim(),
      important: node.important !== false && node.important !== undefined,
    });
  }
  return out;
}

function subjectOf(selector: CssNode): string | null {
  const parts = selector.children.toArray() as CssNode[];
  const classes = parts.filter((part) => part.type === 'ClassSelector');
  const types = parts.filter((part) => part.type === 'TypeSelector');
  if (parts.length !== classes.length + types.length || types.length > 1) return null;
  if (classes.length === 1) return `.${String(classes[0]!.name)}`;
  if (classes.length === 0 && types.length === 1 && String(types[0]!.name).toLowerCase() === 'p') {
    return 'p';
  }
  return null;
}

function written(declarations: readonly Declaration[]): string {
  return declarations
    .map((one) => `  ${one.property}: ${one.value}${one.important ? ' !important' : ''};`)
    .join('\n');
}

export function planClasses(sheets: readonly string[], use: ClassUse): ClassPlan {
  const dropped: string[] = [];
  const rules = new Map<string, Declaration[]>();
  for (const sheet of sheets) {
    let ast: CssNode;
    try {
      ast = parse(sheet);
    } catch {
      dropped.push(sheet.trim().slice(0, 40));
      continue;
    }
    for (const node of (ast.children?.toArray() ?? []) as CssNode[]) {
      if (node.type !== 'Rule' || node.prelude?.type !== 'SelectorList') continue;
      const declarations = declarationsOf(node.block);
      for (const selector of node.prelude.children.toArray() as CssNode[]) {
        const subject = subjectOf(selector);
        if (!subject) continue;
        if (subject !== 'p' && (!use.used.has(subject.slice(1)) || FB2_MARK.test(subject.slice(1))))
          continue;
        const list = rules.get(subject) ?? [];
        for (const declaration of declarations) {
          const at = list.findIndex((one) => one.property === declaration.property);
          if (at >= 0) list.splice(at, 1);
          list.push(declaration);
        }
        rules.set(subject, list);
      }
    }
  }

  const forms = new Map<string, Fb2Form[]>();
  const looks = new Map<string, Declaration[]>();
  for (const [subject, declarations] of rules) {
    const look: Declaration[] = [];
    const found: Fb2Form[] = [];
    for (const declaration of declarations) {
      if (/url\(/i.test(declaration.value)) {
        dropped.push(`${declaration.property}: ${declaration.value}`);
        continue;
      }
      const form = formOf(declaration);
      if (form) {
        if (!found.includes(form)) found.push(form);
      } else if (!changesNothing(declaration)) {
        look.push(declaration);
      }
    }
    if (subject === 'p') {
      looks.set('p', look);
      continue;
    }
    const name = subject.slice(1);
    if (!CLASS_NAME.test(name)) {
      if (look.length > 0) dropped.push(subject);
      continue;
    }
    if (found.length > 0) forms.set(name, found);
    if (look.length > 0) looks.set(name, look);
  }

  let paragraphClass: string | undefined;
  let most = 0;
  for (const [name, count] of use.paragraphs) {
    if (FB2_MARK.test(name)) continue;
    if (count > most) {
      most = count;
      paragraphClass = name;
    }
  }
  const pLook = [...(looks.get('p') ?? [])];
  if (paragraphClass) {
    for (const declaration of looks.get(paragraphClass) ?? []) {
      const at = pLook.findIndex((one) => one.property === declaration.property);
      if (at >= 0) pLook.splice(at, 1);
      pLook.push(declaration);
    }
  }
  const named = new Set<string>();
  const cssRules: string[] = [];
  if (pLook.length > 0) cssRules.push(`p {\n${written(pLook)}\n}`);
  for (const [name, look] of looks) {
    if (name === 'p' || name === paragraphClass) continue;
    named.add(name);
    cssRules.push(`.${name} {\n${written(look)}\n}`);
  }
  const translated =
    cssRules.length > 0 ? translateCss(cssRules.join('\n')) : { css: '', dropped: [] };
  dropped.push(...translated.dropped);
  for (const name of [...named]) {
    if (!translated.css.includes(`.${name} {`)) named.delete(name);
  }
  return {
    forms,
    named,
    paragraphClass,
    stylesheet: translated.css,
    dropped,
  };
}

export function namedStylesPlan(use: ClassUse): ClassPlan {
  return {
    forms: new Map(),
    named: new Set([...use.used].filter((name) => !FB2_MARK.test(name))),
    stylesheet: '',
    dropped: [],
  };
}
