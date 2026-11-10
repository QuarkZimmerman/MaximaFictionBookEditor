/**
 * Feature 011 (D50, FR-075b): TeX formulas in Markdown by GitHub's rules. `$…$` in a line - no space
 * after the opening `$`, none before the closing one, no digit after it, so "$5 or $10" stays text;
 * `\$` stays a dollar (markdown-it's escape rule runs first) - and `$$…$$` as a block, on one line or
 * over several. The tokens are `math_inline` and `math_block`, their `content` the TeX.
 */
import type MarkdownIt from 'markdown-it';

type Md = InstanceType<typeof MarkdownIt>;
type InlineRule = Parameters<Md['inline']['ruler']['push']>[1];
type BlockRule = Parameters<Md['block']['ruler']['push']>[1];

const DOLLAR = 0x24;
const isSpace = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;

const mathInline: InlineRule = (state, silent) => {
  const start = state.pos;
  const src = state.src;
  if (src.charCodeAt(start) !== DOLLAR) return false;
  // $$…$$ inside a line is one formula of that line.
  if (src.charCodeAt(start + 1) === DOLLAR) {
    const close = src.indexOf('$$', start + 2);
    if (close < 0 || close >= state.posMax || !src.slice(start + 2, close).trim()) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = src.slice(start + 2, close).trim();
      token.markup = '$$';
    }
    state.pos = close + 2;
    return true;
  }
  const first = src.charCodeAt(start + 1);
  if (Number.isNaN(first) || isSpace(first)) return false;
  let end = start + 1;
  for (;;) {
    end = src.indexOf('$', end);
    if (end < 0 || end >= state.posMax) return false;
    let backslashes = 0;
    for (let i = end - 1; i > start && src[i] === '\\'; i -= 1) backslashes += 1;
    if (backslashes % 2 === 0) break;
    end += 1;
  }
  if (isSpace(src.charCodeAt(end - 1)) || isDigit(src.charCodeAt(end + 1))) return false;
  if (!silent) {
    const token = state.push('math_inline', 'math', 0);
    token.content = src.slice(start + 1, end);
    token.markup = '$';
  }
  state.pos = end + 1;
  return true;
};

const mathBlock: BlockRule = (state, startLine, endLine, silent) => {
  if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
  const lineText = (line: number) =>
    state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!);
  const first = lineText(startLine);
  if (!first.startsWith('$$')) return false;
  const lines: string[] = [];
  let last = startLine;
  const rest = first.slice(2);
  if (rest.trimEnd().endsWith('$$') && rest.trim().length >= 2) {
    lines.push(rest.trimEnd().slice(0, -2));
  } else {
    lines.push(rest);
    let found = false;
    for (let line = startLine + 1; line < endLine; line += 1) {
      const text = lineText(line);
      if (text.trimEnd().endsWith('$$')) {
        lines.push(text.trimEnd().slice(0, -2));
        last = line;
        found = true;
        break;
      }
      lines.push(text);
    }
    if (!found) return false;
  }
  const content = lines.join('\n').trim();
  if (!content) return false;
  if (silent) return true;
  state.line = last + 1;
  const token = state.push('math_block', 'math', 0);
  token.block = true;
  token.content = content;
  token.markup = '$$';
  token.map = [startLine, state.line];
  return true;
};

export const mathRule = (md: Md): void => {
  md.inline.ruler.after('escape', 'math_inline', mathInline);
  md.block.ruler.before('fence', 'math_block', mathBlock, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
};
