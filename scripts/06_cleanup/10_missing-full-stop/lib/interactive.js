// Shared engine of the interactive clean-up scripts (Фамилия И. О., Слипшиеся слова,
// 10.000.000.000, Дефис - Тире, Точка.). Starting at the paragraph with the caret, every text
// block is rendered in the legacy inline-HTML notation and each pattern is applied in a loop:
// the matched place is highlighted in the Body view and the user is asked (Yes = use the text
// of the input box, No = leave as it is, Cancel = stop the script). Handled places are
// replaced by placeholders so the same pattern cannot match them again; the placeholders are
// expanded when the paragraph is written back. Decisions can be remembered per match text.
import { blockIndexOfSelection, collectTextBlocks, htmlToPlainText, parseInline, serializeInline } from './legacy-html.js';

const PLACEHOLDER = /\uE000(\d+)\uE001/g;

function placeholder(index) {
  return `\uE000${index}\uE001`;
}

function expand(text, table, field) {
  return text.replace(PLACEHOLDER, (all, index) => (table[Number(index)] ? table[Number(index)][field] : all));
}

/**
 * options:
 *   patterns: [{ re, pieces(s) -> { display, suggestion, prefix, suffix, rejectPrefix?, rejectSuffix?, rejectValue?, memoryKey? },
 *               prompt(pieces, state) -> string, enabled?(state), noMemory?: boolean,
 *               autoDecide?(pieces, state) -> text | null (reject) | undefined (ask) }]
 *   rememberRejected / rememberAccepted: boolean (decision memory keyed by memoryKey ?? display)
 *   countAccepted(pieces, answer) -> boolean  (default: answer !== '')
 *   onReject?(pieces, state)                   (user said No, or a remembered rejection)
 *   onBeforePattern?(s, pattern, state) -> s   (automatic replacements, e.g. dictionaries)
 *   onParagraphDone?(s, state) -> s             (final automatic replacements)
 *   confirmContinue?: { every: number, text: string }  (periodic "continue?" question)
 * Returns the state (count, rejected, accepted, exited).
 */
export async function runInteractive(ctx, options) {
  const state = {
    count: 0,
    rejected: new Set(options.initialRejected ?? []),
    accepted: new Map(),
    exited: false,
    handled: 0,
    extra: options.extra ?? {},
  };
  const snapshot = await mfbe.doc.get();
  const blocks = collectTextBlocks(snapshot, { skipTypes: options.skipTypes ?? [] });
  const selection = await mfbe.selection.get();
  const startIndex = blockIndexOfSelection(blocks, selection);

  for (let b = startIndex; b < blocks.length; b += 1) {
    const block = blocks[b];
    const extras = [];
    const original = serializeInline(block.node.content, extras);
    let s = original;
    const table = []; // placeholder index -> { value, original }
    let shownParagraph = false;
    let changedByUser = false;

    for (const pattern of options.patterns) {
      if (pattern.enabled && !pattern.enabled(state)) continue;
      if (options.onBeforePattern) s = options.onBeforePattern(s, pattern, state, table);
      let guard = 0;
      while (s.search(pattern.re) !== -1 && guard < 500) {
        guard += 1;
        const pieces = pattern.pieces(s);
        const key = pieces.memoryKey ?? pieces.display;
        const rejectPrefix = pieces.rejectPrefix ?? pieces.prefix;
        const rejectSuffix = pieces.rejectSuffix ?? pieces.suffix;
        const rejectValue = pieces.rejectValue ?? pieces.display;
        const index = table.length;
        if (options.rememberRejected && !pattern.noMemory && state.rejected.has(key)) {
          table.push({ value: rejectValue, original: rejectValue });
          s = rejectPrefix + placeholder(index) + rejectSuffix;
          options.onReject?.(pieces, state);
          continue;
        }
        if (options.rememberAccepted && state.accepted.has(key)) {
          table.push({ value: state.accepted.get(key), original: pieces.display });
          s = pieces.prefix + placeholder(index) + pieces.suffix;
          state.count += 1;
          continue;
        }
        if (pattern.autoDecide) {
          const auto = pattern.autoDecide(pieces, state);
          if (auto !== undefined) {
            table.push({ value: auto === null ? rejectValue : auto, original: pieces.display });
            s = auto === null ? rejectPrefix + placeholder(index) + rejectSuffix : pieces.prefix + placeholder(index) + pieces.suffix;
            continue;
          }
        }
        // Highlight the place in the Body view: offsets are computed on the original text.
        if (!shownParagraph) shownParagraph = true;
        const from = htmlToPlainText(expand(pieces.prefix, table, 'original')).length;
        const length = htmlToPlainText(pieces.display).length;
        try {
          await mfbe.selection.set({ nodeId: block.ref.nodeId, offset: from }, { nodeId: block.ref.nodeId, offset: from + length });
          await mfbe.selection.scrollIntoView();
        } catch {
          // highlighting is best effort
        }
        const answer = await mfbe.ui.prompt(pattern.prompt(pieces, state), {
          caption: options.caption,
          defaultValue: pieces.suggestion,
          yesNoCancel: true,
        });
        if (answer === null) {
          // Cancel: like the legacy `return "exit"` - the current paragraph is left untouched.
          state.exited = true;
          return state;
        }
        state.handled += 1;
        if (answer !== '') {
          table.push({ value: answer, original: pieces.display });
          s = pieces.prefix + placeholder(index) + pieces.suffix;
          if (options.rememberAccepted) state.accepted.set(key, answer);
          if ((options.countAccepted ?? (() => true))(pieces, answer)) state.count += 1;
          changedByUser = true;
        } else {
          table.push({ value: rejectValue, original: rejectValue });
          s = rejectPrefix + placeholder(index) + rejectSuffix;
          if (options.rememberRejected && !pattern.noMemory) state.rejected.add(key);
          options.onReject?.(pieces, state);
        }
        if (options.confirmContinue && state.handled % options.confirmContinue.every === 0) {
          if ((await MsgBox(options.confirmContinue.text, options.caption, 4 + 32)) !== 6) {
            state.exited = true;
            return state;
          }
        }
      }
    }
    if (options.onParagraphDone) s = options.onParagraphDone(s, state, table);
    s = expand(s, table, 'value');
    if (s !== original) {
      await mfbe.doc.replaceNode(block.ref, { type: block.node.type, attrs: { ...block.node.attrs }, content: parseInline(s, extras) });
    }
    if (!changedByUser && b % 20 === 0) await mfbe.ui.progress(b - startIndex, blocks.length - startIndex);
    if (ctx.cancelled) return state;
  }
  return state;
}

/** `s.replace(re, template)` - the legacy way of extracting a piece of the match. */
export function piece(s, re, template) {
  return s.replace(re, template);
}
