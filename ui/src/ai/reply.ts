/**
 * What a text-only reply of the model is (feature 005 T043; ai-catalogue §5.1 "Deciding what a
 * text-only reply is", §5.2 wording rule; data-model §4.2, §4.7; review C5, C7): in a selection
 * request the model is asked to reply with the replacement alone, so a reply without a tool
 * call is the replacement - unless the table below says otherwise, row by row and in order:
 *
 * | a | first non-blank line `NO CHANGE`                      | a message (the rest)          |
 * | b | a **change** tool was called earlier in the request   | a message (C7: read tools and |
 * |   |                                                       | set_selection do not count)   |
 * | c | `finish_reason` is `length`                           | a message marked cut off      |
 * | d | equals the selection's FB2 form or plain text         | nothing to change             |
 * | e-g | blocks / source: with elements → the replacement    | no `<` → a prose message      |
 * | h-i | inline: `<` + letter → xml, else plain text         | → the hook either way         |
 *
 * Rows e/g and h/i are told apart by the parse the hook performs: a `blocks` reply that holds
 * elements goes to the hook as XML, which rejects it (and counts a strike) when it fails to
 * parse; an `inline` reply that looks like XML goes as XML with its plain text as the row-i
 * fallback when it does not parse as inline content.
 *
 * Also here: fence stripping (ai-catalogue §3.8 - models wrap XML in ```xml fences despite
 * instructions), the `askedBack` / `answered` wording rule (§5.2: the last non-blank line ends
 * with a question mark) and the undo label of a request (data-model §4.7: the instruction
 * collapsed to one line and cut to 60 characters with an ellipsis).
 */

import type { SelectionSnapshot } from './context';

/** The reply as the loop hands it over: the text and the service's `finish_reason`. */
export interface TextReply {
  text: string;
  finishReason?: string | null;
}

/** What happened earlier in the request that the table looks at. */
export interface ReplyState {
  /** A change tool of ai-catalogue §3.5 was called (and executed) earlier in this request. */
  changeToolCalled: boolean;
}

/** Why a reply became a message (row a, b, c or f). */
export type MessageReason = 'noChange' | 'afterChangeTool' | 'cutOff' | 'prose';

export type TextReplyDecision =
  /** A message to the user; nothing is applied. `question` = the §5.2 wording rule. */
  | { kind: 'message'; reason: MessageReason; text: string; question: boolean; cutOff: boolean }
  /** Row d: the reply equals the selection - "nothing to change", no change, `modified` untouched. */
  | { kind: 'noChange' }
  /**
   * Rows h / i: an inline replacement. `xml` is set when the reply looks like inline XML (row
   * h: `<` followed by a letter) - the hook parses it as inline content and falls back to
   * `text` when it does not parse; null → plain text (row i).
   */
  | { kind: 'replacement'; form: 'inline'; xml: string | null; text: string }
  /** Rows e / g: block elements (or Source XML text) for the hook, which parses and validates. */
  | { kind: 'replacement'; form: 'blocks' | 'xml'; xml: string };

/** The length the undo label of a request is cut to (data-model §4.7). */
export const UNDO_LABEL_LENGTH = 60;

const NO_CHANGE_LINE = /^\s*no change\s*[:.]?\s*$/i;
const OPENING_FENCE = /^```[A-Za-z0-9_+-]*[ \t]*(?:\r?\n|$)/;
const CLOSING_FENCE = /(?:\r?\n)?[ \t]*```[ \t]*$/;

/**
 * Removes a leading ```xml / ```fb2 fence and a trailing fence, each when present, and the
 * surrounding whitespace (ai-catalogue §3.8: tolerated, never required).
 */
export function stripFence(text: string): string {
  let out = text.trim();
  const opening = OPENING_FENCE.exec(out);
  if (opening) out = out.slice(opening[0].length);
  const closing = CLOSING_FENCE.exec(out);
  if (closing) out = out.slice(0, closing.index);
  return out.trim();
}

/** The reply's first non-blank line and everything after it. */
function splitFirstLine(text: string): { first: string; rest: string } | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trim() === '') continue;
    return {
      first: lines[i]!,
      rest: lines
        .slice(i + 1)
        .join('\n')
        .trim(),
    };
  }
  return null;
}

/** Row a: the reply begins with `NO CHANGE` (case-insensitive, optional trailing colon or period). */
export function isNoChange(text: string): boolean {
  const split = splitFirstLine(text);
  return split !== null && NO_CHANGE_LINE.test(split.first);
}

/**
 * The §5.2 wording rule: a text is read as a question - end state `askedBack` rather than
 * `answered` - when its last non-blank line ends with a question mark.
 */
export function isQuestion(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    return /[?？]["'”’)»]*$/.test(line);
  }
  return false;
}

/** The undo label of a request: the instruction on one line, at most 60 characters, `…` when cut. */
export function undoLabel(instruction: string): string {
  const oneLine = instruction.replace(/\s+/g, ' ').trim();
  const chars = Array.from(oneLine);
  if (chars.length <= UNDO_LABEL_LENGTH) return oneLine;
  return `${chars
    .slice(0, UNDO_LABEL_LENGTH - 1)
    .join('')
    .trimEnd()}…`;
}

function normalise(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/** Row h's test: the reply holds what looks like an element start. */
function looksLikeXml(text: string): boolean {
  return /<[A-Za-z]/.test(text);
}

function message(
  reason: MessageReason,
  text: string,
  cutOff = false,
): Extract<TextReplyDecision, { kind: 'message' }> {
  return { kind: 'message', reason, text, question: isQuestion(text), cutOff };
}

/**
 * The decision table of ai-catalogue §5.1 for a text-only reply (no tool call) of a selection
 * request, rows a to i in order (see the module comment).
 */
export function decideTextReply(
  reply: TextReply,
  snapshot: Pick<SelectionSnapshot, 'form' | 'xml' | 'text'>,
  state: ReplyState,
): TextReplyDecision {
  const raw = reply.text ?? '';
  // a. NO CHANGE: the rest is the message.
  const split = splitFirstLine(raw);
  if (split && NO_CHANGE_LINE.test(split.first)) return message('noChange', split.rest);
  // b. The model took the tool route: its changes were made through change tools (C7).
  if (state.changeToolCalled) return message('afterChangeTool', raw.trim());
  // c. Cut off: never applied.
  if (reply.finishReason === 'length') return message('cutOff', raw.trim(), true);
  // d. The selection as it was: nothing to change.
  const stripped = stripFence(raw);
  const body = normalise(stripped);
  if (body === normalise(snapshot.xml) || body === normalise(snapshot.text)) {
    return { kind: 'noChange' };
  }
  if (snapshot.form === 'inline') {
    // h / i: XML when it looks like it (the hook falls back to the text), else plain text.
    return {
      kind: 'replacement',
      form: 'inline',
      xml: looksLikeXml(stripped) ? stripped : null,
      text: stripped,
    };
  }
  // e-g: block elements (or Source XML text) go to the hook; a reply without any `<` is prose.
  if (!stripped.includes('<')) return message('prose', raw.trim());
  return { kind: 'replacement', form: snapshot.form, xml: stripped };
}
