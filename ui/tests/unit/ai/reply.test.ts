/**
 * Feature 005 T043 (ai-catalogue §5.1 "Deciding what a text-only reply is", §5.2 wording rule,
 * §9.2 `reply.test.ts`; data-model §4.2, §4.7; review C5, C7) - the decision table row by row:
 * `NO CHANGE` in its forms, row b only after a **change** tool, a cut-off reply, a reply equal
 * to the selection, block / source replies with and without elements, inline replies as XML or
 * plain text; fence stripping; the `askedBack` / `answered` wording rule; the undo label.
 */

import type { SelectionSnapshot } from '@/ai/context';
import {
  decideTextReply,
  isNoChange,
  isQuestion,
  stripFence,
  undoLabel,
  UNDO_LABEL_LENGTH,
} from '@/ai/reply';

function snapshot(
  form: SelectionSnapshot['form'],
  xml: string,
  text: string,
): Pick<SelectionSnapshot, 'form' | 'xml' | 'text'> {
  return { form, xml, text };
}

const INLINE = snapshot('inline', 'Он <emphasis>вышел</emphasis> на улицу.', 'Он вышел на улицу.');
const BLOCKS = snapshot('blocks', '<p>One.</p>\n<p>Two.</p>', 'One.\nTwo.');
const SOURCE = snapshot('xml', '<p>One.</p>', '<p>One.</p>');
const noTools = { changeToolCalled: false };
const afterChange = { changeToolCalled: true };

describe('stripFence', () => {
  it('removes a leading ```xml / ```fb2 fence and a trailing fence, and the surrounding whitespace', () => {
    expect(stripFence('```xml\n<p>a</p>\n```')).toBe('<p>a</p>');
    expect(stripFence('```fb2\n<p>a</p>\n<p>b</p>\n```\n')).toBe('<p>a</p>\n<p>b</p>');
    expect(stripFence('\n```\n<p>a</p>\n```')).toBe('<p>a</p>');
    expect(stripFence('```\r\n<p>a</p>\r\n```')).toBe('<p>a</p>');
    // One fence alone is stripped too; text without a fence is only trimmed.
    expect(stripFence('```xml\n<p>a</p>')).toBe('<p>a</p>');
    expect(stripFence('<p>a</p>\n```')).toBe('<p>a</p>');
    expect(stripFence('  <p>a</p>  ')).toBe('<p>a</p>');
    // Fences inside the text are content.
    expect(stripFence('<p>use ```code``` here</p>')).toBe('<p>use ```code``` here</p>');
  });
});

describe('isNoChange / isQuestion', () => {
  it('reads NO CHANGE in its forms: any case, a trailing colon or period, blank lines before it', () => {
    for (const text of [
      'NO CHANGE',
      'no change',
      'No Change:',
      'NO CHANGE.',
      '\n\n  NO CHANGE \nWhat do you mean?',
    ]) {
      expect(isNoChange(text), text).toBe(true);
    }
    for (const text of [
      'NO CHANGES',
      'NOCHANGE',
      'There is no change needed.',
      'NO CHANGE needed',
      '',
    ]) {
      expect(isNoChange(text), text).toBe(false);
    }
  });

  it('the §5.2 wording rule: the last non-blank line ends with a question mark', () => {
    expect(isQuestion('Which of the two epigraphs?')).toBe(true);
    expect(isQuestion('Two options.\nWhich one do you mean?\n\n')).toBe(true);
    expect(isQuestion('Is it this one?"')).toBe(true);
    expect(isQuestion('Это он?»')).toBe(true);
    expect(isQuestion('Which one? I changed the first.')).toBe(false);
    expect(isQuestion('I changed the title of chapter 3.')).toBe(false);
    expect(isQuestion('')).toBe(false);
  });
});

describe('undoLabel', () => {
  it('collapses the instruction to one line and cuts it to 60 characters with an ellipsis', () => {
    expect(undoLabel('Fix typos')).toBe('Fix typos');
    expect(undoLabel('  Fix\n\ntypos   and\tpunctuation ')).toBe('Fix typos and punctuation');
    const long =
      'Make every chapter title title case and move the epigraph of chapter three above its title';
    const label = undoLabel(long);
    expect(Array.from(label)).toHaveLength(UNDO_LABEL_LENGTH);
    expect(label.endsWith('…')).toBe(true);
    expect(label).toBe('Make every chapter title title case and move the epigraph o…');
    expect(undoLabel('a'.repeat(60))).toBe('a'.repeat(60));
    expect(undoLabel('a'.repeat(61))).toBe(`${'a'.repeat(59)}…`);
    // Cut on code points, not UTF-16 units.
    expect(Array.from(undoLabel('😀'.repeat(70)))).toHaveLength(60);
  });
});

describe('decideTextReply - the §5.1 table', () => {
  it('a. NO CHANGE: a message of the rest, read as a question by wording', () => {
    expect(decideTextReply({ text: 'NO CHANGE\nThe word means "sea".' }, INLINE, noTools)).toEqual({
      kind: 'message',
      reason: 'noChange',
      text: 'The word means "sea".',
      question: false,
      cutOff: false,
    });
    expect(
      decideTextReply({ text: '\nno change:\nWhich of the two?\n' }, BLOCKS, noTools),
    ).toMatchObject({
      kind: 'message',
      reason: 'noChange',
      text: 'Which of the two?',
      question: true,
    });
    // Row a comes first: even after a change tool or when cut off.
    expect(
      decideTextReply({ text: 'NO CHANGE.\nx', finishReason: 'length' }, BLOCKS, afterChange),
    ).toMatchObject({
      reason: 'noChange',
      cutOff: false,
    });
    expect(decideTextReply({ text: 'NO CHANGE' }, INLINE, noTools)).toMatchObject({
      kind: 'message',
      text: '',
    });
  });

  it('b. after a change tool a text reply is a message (C7); read tools alone do not count - the table continues', () => {
    expect(decideTextReply({ text: '<p>Changed.</p>' }, BLOCKS, afterChange)).toEqual({
      kind: 'message',
      reason: 'afterChangeTool',
      text: '<p>Changed.</p>',
      question: false,
      cutOff: false,
    });
    expect(
      decideTextReply(
        { text: 'Done - I replaced both paragraphs. Anything else?' },
        BLOCKS,
        afterChange,
      ),
    ).toMatchObject({
      reason: 'afterChangeTool',
      question: true,
    });
    // `changeToolCalled: false` after get_outline / read_part / set_selection: still the replacement.
    expect(decideTextReply({ text: '<p>Changed.</p>' }, BLOCKS, noTools)).toEqual({
      kind: 'replacement',
      form: 'blocks',
      xml: '<p>Changed.</p>',
    });
  });

  it('c. finish_reason length: a message marked cut off, never applied', () => {
    expect(
      decideTextReply({ text: '<p>One.</p>\n<p>Tw', finishReason: 'length' }, BLOCKS, noTools),
    ).toEqual({
      kind: 'message',
      reason: 'cutOff',
      text: '<p>One.</p>\n<p>Tw',
      question: false,
      cutOff: true,
    });
    expect(
      decideTextReply({ text: 'Он вышел на', finishReason: 'length' }, INLINE, noTools),
    ).toMatchObject({ cutOff: true });
    expect(
      decideTextReply({ text: '<p>One.</p>', finishReason: 'stop' }, BLOCKS, noTools).kind,
    ).toBe('replacement');
  });

  it('d. the reply equals the selection (FB2 form or plain text, fence and whitespace aside): nothing to change', () => {
    expect(decideTextReply({ text: INLINE.xml }, INLINE, noTools)).toEqual({ kind: 'noChange' });
    expect(decideTextReply({ text: `  ${INLINE.text}\n` }, INLINE, noTools)).toEqual({
      kind: 'noChange',
    });
    expect(
      decideTextReply({ text: '```xml\n<p>One.</p>\n<p>Two.</p>\n```' }, BLOCKS, noTools),
    ).toEqual({ kind: 'noChange' });
    expect(decideTextReply({ text: '<p>One.</p>\r\n<p>Two.</p>' }, BLOCKS, noTools)).toEqual({
      kind: 'noChange',
    });
    expect(decideTextReply({ text: SOURCE.xml }, SOURCE, noTools)).toEqual({ kind: 'noChange' });
    // A change of one character is a replacement.
    expect(decideTextReply({ text: '<p>One!</p>\n<p>Two.</p>' }, BLOCKS, noTools).kind).toBe(
      'replacement',
    );
  });

  it('e / g. blocks and source: a reply with elements is the replacement for the hook (which parses, rejects and counts)', () => {
    expect(
      decideTextReply(
        { text: '```fb2\n<p>Один.</p>\n<empty-line/>\n<p>Два.</p>\n```' },
        BLOCKS,
        noTools,
      ),
    ).toEqual({
      kind: 'replacement',
      form: 'blocks',
      xml: '<p>Один.</p>\n<empty-line/>\n<p>Два.</p>',
    });
    // Malformed or misplaced elements still go to the hook: row g is its rejection and strike.
    expect(decideTextReply({ text: '<p>Один.<p>' }, BLOCKS, noTools)).toMatchObject({
      kind: 'replacement',
      xml: '<p>Один.<p>',
    });
    expect(decideTextReply({ text: '<section><p>x</p></section>' }, BLOCKS, noTools)).toMatchObject(
      { kind: 'replacement' },
    );
    expect(decideTextReply({ text: '<p>Fixed.</p>' }, SOURCE, noTools)).toEqual({
      kind: 'replacement',
      form: 'xml',
      xml: '<p>Fixed.</p>',
    });
  });

  it('f. blocks and source: a reply without any `<` is a prose message (answer or question)', () => {
    expect(
      decideTextReply({ text: 'These paragraphs describe the storm at sea.' }, BLOCKS, noTools),
    ).toEqual({
      kind: 'message',
      reason: 'prose',
      text: 'These paragraphs describe the storm at sea.',
      question: false,
      cutOff: false,
    });
    expect(
      decideTextReply({ text: 'Do you want both paragraphs merged?' }, BLOCKS, noTools),
    ).toMatchObject({
      reason: 'prose',
      question: true,
    });
    expect(decideTextReply({ text: 'Nothing to fix here.' }, SOURCE, noTools)).toMatchObject({
      kind: 'message',
      reason: 'prose',
    });
  });

  it('h. inline: a reply with `<` + letter is XML for the hook, with the text as the row-i fallback', () => {
    expect(
      decideTextReply({ text: 'Он <emphasis>вышел</emphasis> на улицу!' }, INLINE, noTools),
    ).toEqual({
      kind: 'replacement',
      form: 'inline',
      xml: 'Он <emphasis>вышел</emphasis> на улицу!',
      text: 'Он <emphasis>вышел</emphasis> на улицу!',
    });
    expect(
      decideTextReply(
        { text: '```xml\nСм. <a l:href="#n1" type="note">1</a>.\n```' },
        INLINE,
        noTools,
      ),
    ).toMatchObject({
      form: 'inline',
      xml: 'См. <a l:href="#n1" type="note">1</a>.',
    });
  });

  it('i. inline: anything else is the replacement as plain text (US2 sc. 3: dropped inline elements are applied as returned)', () => {
    expect(decideTextReply({ text: 'Он вышел на улицу!' }, INLINE, noTools)).toEqual({
      kind: 'replacement',
      form: 'inline',
      xml: null,
      text: 'Он вышел на улицу!',
    });
    // `<` not followed by a letter is text (a comparison, a stray bracket); the fence goes.
    expect(decideTextReply({ text: '```\na < b и b > c\n```' }, INLINE, noTools)).toEqual({
      kind: 'replacement',
      form: 'inline',
      xml: null,
      text: 'a < b и b > c',
    });
    // A prose answer to an inline selection is a replacement too (the user asked for one; NO CHANGE is the way out).
    expect(decideTextReply({ text: 'The word means "sea".' }, INLINE, noTools)).toMatchObject({
      kind: 'replacement',
      xml: null,
    });
  });

  it('tolerates a null / missing content', () => {
    expect(decideTextReply({ text: '' }, BLOCKS, noTools)).toMatchObject({
      kind: 'message',
      reason: 'prose',
      text: '',
    });
    expect(decideTextReply({ text: '', finishReason: 'length' }, INLINE, noTools)).toMatchObject({
      reason: 'cutOff',
    });
  });
});
