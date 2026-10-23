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

/*
 * A text that claims a change (FR-106). The rc.1 smoke test: the assistant answered "the
 * title has been translated" while no change tool had run, and the answer was read as done.
 * A text-only end with no accepted change is a claim when one of its sentences says, in the
 * past tense and without a negation, a modal or a condition, that something of the book was
 * changed - English, Russian and Ukrainian wordings (the model answers in the interface or the
 * user's language, §2.3). A heuristic: a missed claim leaves the "answered — the book was not
 * changed" line alone; a false positive adds a true note (nothing was changed).
 */

/** English: a perfect / passive / simple-past form of a change verb. */
const CLAIM_EN =
  /\b(?:(?:has|have|had|is|are|was|were)\s+(?:been\s+|now\s+|already\s+|successfully\s+)?|(?:i|i've|we|we've)\s+(?:have\s+|'ve\s+)?(?:now\s+|already\s+|successfully\s+|just\s+)?)(?:changed|translated|renamed|replaced|updated|corrected|fixed|inserted|removed|deleted|added|rewritten|edited|applied|modified|adjusted|converted|moved|reworded|rephrased|capitalised|capitalized|shortened|expanded)\b/i;
/** English: a done-line ("Done.", "Done: the title is now …") or "X is now Y". */
const CLAIM_EN_DONE =
  /^\s*done\b[.!:]|\b(?:title|text|paragraph|section|heading|name|description|annotation|book)\b[^.?!\n]{0,40}\b(?:is|are)\s+now\b/i;
/** Russian: a short passive participle or a past-tense verb of change, or "готово" / "теперь называется". */
const CLAIM_RU =
  /(?:^|[^а-яё])(?:измен[её]н[аоы]?|перевед[её]н[аоы]?|переименован[аоы]?|замен[её]н[аоы]?|обновл[её]н[аоы]?|исправлен[аоы]?|добавлен[аоы]?|удал[её]н[аоы]?|вставлен[аоы]?|применен[аоы]?|применён[аоы]?|отредактирован[аоы]?|переписан[аоы]?|изменил[аи]?|перев[её]л[аи]?|переименовал[аи]?|заменил[аи]?|обновил[аи]?|исправил[аи]?|добавил[аи]?|удалил[аи]?|вставил[аи]?|установил[аи]?|применил[аи]?|отредактировал[аи]?|переписал[аи]?|готово|сделано|выполнено)(?=$|[^а-яё])|(?:^|[^а-яё])теперь[^.?!]{0,40}?(?:называется|звучит|выглядит|гласит)/i;
/** Ukrainian: the same forms. */
const CLAIM_UK =
  /(?:^|[^а-яіїєґ'’])(?:змінен[оаі]?|перекладен[оаі]?|перейменован[оаі]?|замінен[оаі]?|оновлен[оаі]?|виправлен[оаі]?|додан[оаі]?|видален[оаі]?|вставлен[оаі]?|застосован[оаі]?|відредагован[оаі]?|переписан[оаі]?|змінив|змінила|переклав|переклала|перейменував|перейменувала|замінив|замінила|оновив|оновила|виправив|виправила|додав|додала|видалив|видалила|вставив|вставила|встановив|встановила|застосував|застосувала|відредагував|відредагувала|переписав|переписала|готово|зроблено|виконано)(?=$|[^а-яіїєґ'’])|(?:^|[^а-яіїєґ])тепер[^.?!]{0,40}?(?:називається|звучить|виглядає)/i;
/** A negation, a modal, a condition or an offer in the same sentence: no claim. */
const NOT_A_CLAIM =
  /\b(?:not|no|nothing|none|never|without|unable|cannot|can't|couldn't|wouldn't|didn't|doesn't|don't|haven't|hasn't|wasn't|weren't|isn't|aren't|unchanged|untouched|can|could|will|would|shall|should|may|might|if|whether|unless|want|need|ready|about to|going to)\b|n't\b|(?:^|[^а-яёіїєґ])(?:не|нет|ні|ничего|нічого|без|нельзя|невозможно|неможливо|могу|можу|может|може|можно|можна|хотите|хочете|нужно|потрібно|треба|стоит|варто|если|якщо|будет|буде|буду|сделаю|зроблю|изменю|зміню|переведу|перекладу|ли|чи)(?=$|[^а-яёіїєґ])/i;

/** The sentences of a text (the parts between sentence-ending punctuation and line breaks). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\r?\n+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/** The clauses of a sentence: split at commas, semicolons and spaced dashes (a negation in one clause does not cancel a claim in another). */
function clauses(sentence: string): string[] {
  return sentence
    .split(/\s*[,;]\s*|\s+[—–-]\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * True when `text` claims, in words, that the book was changed (FR-106) - see the note above;
 * a question is never a claim.
 */
export function claimsChange(text: string): boolean {
  for (const sentence of sentences(text)) {
    if (/[?？]["'”’)»]*$/.test(sentence)) continue;
    for (const clause of clauses(sentence)) {
      const claims =
        CLAIM_EN.test(clause) ||
        CLAIM_EN_DONE.test(clause) ||
        CLAIM_RU.test(clause) ||
        CLAIM_UK.test(clause);
      if (claims && !NOT_A_CLAIM.test(clause)) return true;
    }
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
