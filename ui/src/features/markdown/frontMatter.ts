/**
 * Feature 010, US8 (spec D30, research DP-2): the front matter of a Markdown file - a YAML block
 * between `---` lines at the very top. The reader is small and strict on purpose: it knows the
 * forms the description's keys take (`key: value`, quoted values, `[a, b]` and `- item` lists,
 * `|` and `>` blocks) and nothing else - no anchors, no tags, no nested block maps. Keys are lower-cased;
 * a line it does not understand is skipped; values are text.
 */

export type FrontMatterValue = string | string[];

/** A value of YAML's flow form: text, a number, a list or a map (feature 011, D29). */
export type FlowValue = string | number | FlowValue[] | { [key: string]: FlowValue };

export interface FrontMatter {
  /** The block's keys, lower-case, with their values (empty when there is no block). */
  values: Map<string, FrontMatterValue>;
  /**
   * Feature 011 (US7, D29): the keys written in YAML's flow form (`{ a: "x" }`, `[{ … }]`), read
   * whole - the nested maps and lists of the editor's own export (contracts/markdown-export.md §1).
   */
  structured: Map<string, FlowValue>;
  /** The Markdown after the block (the whole text when there is none). */
  body: string;
}

const OPENING = /^---[ \t]*$/;
const CLOSING = /^(---|\.\.\.)[ \t]*$/;

function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).replace(/''/g, "'");
  }
  // A comment after the value: "title: Book # draft".
  return text.replace(/\s+#.*$/, '').trim();
}

/** `[a, "b, c", d]` -> ['a', 'b, c', 'd']. */
function inlineList(value: string): string[] {
  const inner = value.trim().slice(1, -1);
  const items: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      items.push(unquote(current));
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) items.push(unquote(current));
  return items.filter((item) => item !== '');
}

/**
 * A value written in YAML's flow form - maps, lists, double- and single-quoted strings, numbers and
 * plain words - or undefined when the text is not one (feature 011, D29).
 */
export function parseFlow(text: string): FlowValue | undefined {
  let i = 0;
  const skip = () => {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
  };
  const scalar = (key: boolean): FlowValue => {
    skip();
    const quote = text[i];
    if (quote === '"') {
      i += 1;
      let out = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          const next = text[i + 1] ?? '';
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
        } else {
          out += text[i];
          i += 1;
        }
      }
      if (text[i] !== '"') throw new Error('unterminated string');
      i += 1;
      return out;
    }
    if (quote === "'") {
      i += 1;
      let out = '';
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          break;
        }
        out += text[i];
        i += 1;
      }
      if (text[i] !== "'") throw new Error('unterminated string');
      i += 1;
      return out;
    }
    const start = i;
    const stop = key ? /[:,}\]]/ : /[,}\]]/;
    while (i < text.length && !stop.test(text[i]!)) i += 1;
    const raw = text.slice(start, i).trim();
    return !key && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
  };
  const value = (): FlowValue => {
    skip();
    if (text[i] === '{') {
      i += 1;
      const out: { [key: string]: FlowValue } = {};
      skip();
      if (text[i] === '}') {
        i += 1;
        return out;
      }
      for (;;) {
        const key = String(scalar(true));
        skip();
        if (text[i] !== ':') throw new Error('a key without its value');
        i += 1;
        out[key] = value();
        skip();
        if (text[i] === ',') i += 1;
        else if (text[i] === '}') {
          i += 1;
          return out;
        } else throw new Error('an unterminated map');
      }
    }
    if (text[i] === '[') {
      i += 1;
      const out: FlowValue[] = [];
      skip();
      if (text[i] === ']') {
        i += 1;
        return out;
      }
      for (;;) {
        out.push(value());
        skip();
        if (text[i] === ',') i += 1;
        else if (text[i] === ']') {
          i += 1;
          return out;
        } else throw new Error('an unterminated list');
      }
    }
    return scalar(false);
  };
  try {
    const result = value();
    skip();
    return i === text.length ? result : undefined;
  } catch {
    return undefined;
  }
}

export function readFrontMatter(text: string): FrontMatter {
  const source = text.replace(/^\uFEFF/, '');
  const lines = source.split(/\r\n|\n|\r/);
  const values = new Map<string, FrontMatterValue>();
  const structured = new Map<string, FlowValue>();
  if (lines.length === 0 || !OPENING.test(lines[0]!)) return { values, structured, body: source };
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (CLOSING.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  if (end < 0) return { values, structured, body: source };
  let i = 1;
  while (i < end) {
    const line = lines[i]!;
    i += 1;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^([A-Za-z_][\w-]*)[ \t]*:(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const rest = match[2]!.trim();
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      // A block scalar: the indented lines that follow.
      const block: string[] = [];
      while (i < end && (/^[ \t]+/.test(lines[i]!) || !lines[i]!.trim())) {
        block.push(lines[i]!.trim());
        i += 1;
      }
      const joined = rest.startsWith('|')
        ? block.join('\n')
        : block
            .join('\n')
            .replace(/([^\n])\n(?=[^\n])/g, '$1 ')
            .trim();
      values.set(key, joined.trim());
      continue;
    }
    if (rest === '') {
      // A list of "- item" lines.
      const items: string[] = [];
      while (i < end && /^[ \t]*-[ \t]+/.test(lines[i]!)) {
        items.push(unquote(lines[i]!.replace(/^[ \t]*-[ \t]+/, '')));
        i += 1;
      }
      if (items.length > 0)
        values.set(
          key,
          items.filter((item) => item !== ''),
        );
      continue;
    }
    if (rest.startsWith('{') || rest.startsWith('[')) {
      const flow = parseFlow(rest);
      if (flow !== undefined) structured.set(key, flow);
    }
    values.set(key, rest.startsWith('[') && rest.endsWith(']') ? inlineList(rest) : unquote(rest));
  }
  return { values, structured, body: lines.slice(end + 1).join('\n') };
}

/** The first value of the first key present, as text ('' when none). */
export function frontText(values: Map<string, FrontMatterValue>, ...keys: string[]): string {
  for (const key of keys) {
    const value = values.get(key);
    if (value === undefined) continue;
    const text = Array.isArray(value) ? value.join(', ') : value;
    if (text.trim()) return text.trim();
  }
  return '';
}

/** The values of the first key present, as a list (a text with commas is split). */
export function frontList(values: Map<string, FrontMatterValue>, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = values.get(key);
    if (value === undefined) continue;
    const list = Array.isArray(value) ? value : value.split(/\s*[,;]\s*/);
    const items = list.map((item) => item.trim()).filter(Boolean);
    if (items.length > 0) return items;
  }
  return [];
}
