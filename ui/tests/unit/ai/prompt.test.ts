/**
 * Feature 005 T043 (ai-catalogue §2, §5.1, §5.2 item 3, §9.2 `prompt.test.ts`; data-model
 * §4.2, §8.4; review C6, C13, C14; FR-031, FR-033, FR-052) - the working context from a fixture
 * document (counts, `book` = the title only, outline entries with paths and whole titles, the
 * selection kinds with a partial first / last block and its `openStart` / `openEnd`,
 * `caret.paragraph` only for a popup request without selection), the system prompt's marker
 * lines (`Working context`, the data boundary, `Rules for changes:`, the Source rules only in
 * the Source view), the key sentences of rule 1's change-tools continuation (FR-106: the active
 * view decides what "the book's title" means; the other place is named, never changed unasked),
 * the `{{sliceNote}}` lines, the caret-context message and the history line.
 */

import { NodeSelection } from 'prosemirror-state';

import {
  appliedLine,
  assertChatRequestPrivate,
  buildWorkingContext,
  caretBlock,
  caretContextMessage,
  CHANGE_TOOLS_RULE,
  contextSelection,
  DATA_BOUNDARY_LINE,
  forbiddenRequestMembers,
  languageName,
  outlineOf,
  preExistingNote,
  selectionEditMessage,
  selectionSnapshot,
  SLICE_NOTE_END,
  SLICE_NOTE_START,
  systemPrompt,
  type SelectionSnapshot,
  type WorkingContextInput,
} from '@/ai/context';
import { createAppServices } from '@/app/services';
import type { ModelNodeJson } from '@/editor/fromModel';
import { findNodeById } from '@/editor/schema';
import type { BodyNode, Document, SectionNode } from '@/model/document';
import { actions, createAppStore } from '@/model/store';
import { setBodySelection } from '@/scripting/api-impl';
import { getBodyController } from '@/views/body/bodyEditor';

import { fakeDocument, fakeRpc } from '../features/testUtils';
import { paragraph, section, title } from './sessionUtils';

/** The fixture: two sections (the second nested), marks, a footnote link, an image, a notes body. */
function book(): Document {
  const base = fakeDocument();
  const rich = {
    type: 'p',
    attrs: { nodeId: 'p2' },
    content: [
      { type: 'text', text: 'Он ' },
      { type: 'text', text: 'вышел', marks: [{ type: 'emphasis' }] },
      { type: 'text', text: ' на улицу' },
      { type: 'text', text: '1', marks: [{ type: 'link', attrs: { href: '#n_1', type: 'note' } }] },
      { type: 'text', text: '.' },
    ],
  } as SectionNode['content'][number];
  const body: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b1' },
    content: [
      title('t0', 'The Book'),
      section('s1', [
        title('t1', 'CHAPTER ONE'),
        paragraph('p1', 'First paragraph here.'),
        rich,
        paragraph('p3', 'Third paragraph.'),
        {
          type: 'image',
          attrs: { nodeId: 'img1', href: '#pic.jpg', alt: 'A picture' },
        } as SectionNode['content'][number],
      ]),
      section('s2', [
        title('t2', 'CHAPTER TWO'),
        section('s2a', [title('t2a', 'Part A'), paragraph('p4', 'Fourth.')]),
        section('s2b', [paragraph('p5', 'Fifth.')]),
      ]),
    ] as BodyNode['content'],
  };
  const notes: BodyNode = {
    type: 'body',
    attrs: { nodeId: 'b2', name: 'notes' },
    content: [
      section('n1', [title('nt1', 'Notes'), paragraph('np1', 'A note.')]),
    ] as BodyNode['content'],
  };
  return {
    ...base,
    bodies: [body, notes],
    binaries: [
      {
        id: 'pic.jpg',
        contentType: 'image/jpeg',
        size: 10,
        decodable: true,
        willConvert: false,
        referenceCount: 1,
      },
      {
        id: 'other.png',
        contentType: 'image/png',
        size: 10,
        decodable: true,
        willConvert: false,
        referenceCount: 0,
      },
    ],
  };
}

function input(overrides: Partial<WorkingContextInput> = {}): WorkingContextInput {
  return {
    document: book(),
    version: '0.0.5',
    activeView: 'body',
    uiLanguage: 'uk',
    modified: false,
    selection: null,
    caret: {
      id: 'p1',
      path: 'body[1]/section[1]/p[1]',
      node: { type: 'p' },
      text: 'First paragraph here.',
    },
    request: { kind: 'general', source: 'panel' },
    preExistingErrors: 0,
    ...overrides,
  };
}

function blocksSnapshot(overrides: Partial<SelectionSnapshot> = {}): SelectionSnapshot {
  return {
    form: 'blocks',
    anchor: { nodeId: 'p1', offset: 0 },
    head: { nodeId: 'p2', offset: 5 },
    range: null,
    openStart: false,
    openEnd: false,
    nodeIds: ['p1', 'p2'],
    parent: { nodeId: 's1', element: 'section' },
    xml: '<p>First paragraph here.</p>\n<p>Он <emphasis>вышел</emphasis></p>',
    text: 'First paragraph here.\nОн вышел',
    characters: 29,
    paragraphs: 2,
    blocks: 2,
    hasInlineElements: true,
    from: { id: 'p1', path: 'body[1]/section[1]/p[1]' },
    to: { id: 'p2', path: 'body[1]/section[1]/p[2]' },
    pm: { from: 10, to: 40, depth: 2 },
    ...overrides,
  };
}

describe('outlineOf', () => {
  it('walks the bodies once: nested entries with ids, paths, whole titles and subtree totals', () => {
    const outline = outlineOf(book());
    expect(outline).toHaveLength(2);
    const [body, notes] = outline;
    expect(body).toMatchObject({
      id: 'b1',
      path: 'body[1]',
      type: 'body',
      title: 'The Book',
      images: 1,
    });
    expect(body!.name).toBeUndefined();
    expect(body!.children.map((c) => c.path)).toEqual(['body[1]/section[1]', 'body[1]/section[2]']);
    expect(body!.children[0]).toMatchObject({
      id: 's1',
      type: 'section',
      title: 'CHAPTER ONE',
      paragraphs: 4,
      images: 1,
      children: [],
    });
    expect(body!.children[0]!.characters).toBe(
      'CHAPTER ONE'.length +
        'First paragraph here.'.length +
        'Он вышел на улицу1.'.length +
        'Third paragraph.'.length,
    );
    expect(body!.children[1]!.children.map((c) => [c.id, c.path, c.title])).toEqual([
      ['s2a', 'body[1]/section[2]/section[1]', 'Part A'],
      ['s2b', 'body[1]/section[2]/section[2]', ''],
    ]);
    // The body's totals include every section; the paragraphs of titles count as paragraphs.
    expect(body!.paragraphs).toBe(1 + 4 + 1 + 2 + 1);
    expect(notes).toMatchObject({
      id: 'b2',
      path: 'body[2]',
      type: 'body',
      name: 'notes',
      title: '',
      characters: 'Notes'.length + 'A note.'.length,
    });
    expect(notes!.children[0]).toMatchObject({
      id: 'n1',
      path: 'body[2]/section[1]',
      title: 'Notes',
      paragraphs: 2,
    });
  });
});

describe('buildWorkingContext', () => {
  it('renders the §2.1 fields: version, view, languages, the title alone, counts, modified, outline, request, errors, scripts', () => {
    const context = buildWorkingContext(input({ modified: true, preExistingErrors: 2 }));
    expect(context.catalogueVersion).toBe(1);
    expect(context.editor).toEqual({ name: 'Maxima Fiction Book Editor', version: '0.0.5' });
    expect(context.activeView).toBe('body');
    expect(context.uiLanguage).toBe('uk');
    expect(context.uiLanguageName).toBe('Ukrainian');
    expect(context.documentLanguage).toBe('en');
    // C14: the title alone - no authors, no genres anywhere in the context.
    expect(context.book).toEqual({ title: 'Alpha' });
    const json = JSON.stringify(context);
    expect(json).not.toContain('Petrov');
    expect(json).not.toContain('"sf"');
    expect(json).not.toContain('authors');
    expect(json).not.toContain('genres');
    expect(json).not.toContain('/books/alpha.fb2');
    expect(context.counts).toEqual({
      characters: expect.any(Number),
      words: expect.any(Number),
      paragraphs: 11,
      sections: 5,
      images: 1,
      notes: 1,
      binaries: 2,
    });
    expect(context.modified).toBe(true);
    expect(context.sourceWellFormed).toBeUndefined();
    expect(context.selection).toEqual({
      kind: 'none',
      characters: 0,
      paragraphs: 0,
      hasInlineElements: false,
    });
    expect(context.caret).toEqual({ id: 'p1', path: 'body[1]/section[1]/p[1]' });
    expect(context.outline).toEqual(outlineOf(book()));
    expect(context.request).toEqual({ kind: 'general', source: 'panel' });
    expect(context.preExistingErrors).toBe(2);
    expect(context.scriptsAvailable).toBe(true);
    // An empty document language stays an empty string.
    const doc = book();
    doc.description.titleInfo.lang = '';
    expect(buildWorkingContext(input({ document: doc })).documentLanguage).toBe('');
  });

  it('carries the caret paragraph only for a popup request without a selection (FR-033)', () => {
    const popupGeneral = buildWorkingContext(
      input({ request: { kind: 'general', source: 'popup' } }),
    );
    expect(popupGeneral.caret).toEqual({
      id: 'p1',
      path: 'body[1]/section[1]/p[1]',
      paragraph: 'First paragraph here.',
    });
    const panelGeneral = buildWorkingContext(
      input({ request: { kind: 'general', source: 'panel' } }),
    );
    expect(panelGeneral.caret?.paragraph).toBeUndefined();
    const popupSelection = buildWorkingContext(
      input({ request: { kind: 'selection', source: 'popup' }, selection: blocksSnapshot() }),
    );
    expect(popupSelection.caret?.paragraph).toBeUndefined();
    expect(buildWorkingContext(input({ caret: null })).caret).toBeNull();
    // A caret given without its text (a bare block reference) has no paragraph to offer.
    expect(
      buildWorkingContext(
        input({
          request: { kind: 'general', source: 'popup' },
          caret: { id: 'p1', path: 'body[1]/section[1]/p[1]' },
        }),
      ).caret,
    ).toEqual({ id: 'p1', path: 'body[1]/section[1]/p[1]' });
  });

  it('describes the selection: kind, counts, from / to, open ends for blocks only, source for the text path', () => {
    const closed = buildWorkingContext(
      input({ request: { kind: 'selection', source: 'popup' }, selection: blocksSnapshot() }),
    );
    expect(closed.selection).toEqual({
      kind: 'blocks',
      characters: 29,
      paragraphs: 2,
      hasInlineElements: true,
      from: { id: 'p1', path: 'body[1]/section[1]/p[1]' },
      to: { id: 'p2', path: 'body[1]/section[1]/p[2]' },
      openStart: false,
      openEnd: false,
    });
    const open = contextSelection(blocksSnapshot({ openStart: true, openEnd: true }));
    expect(open).toMatchObject({ openStart: true, openEnd: true });
    const inline = contextSelection(
      blocksSnapshot({
        form: 'inline',
        nodeIds: ['p2'],
        paragraphs: 1,
        blocks: 1,
        from: { id: 'p2', path: 'x' },
        to: { id: 'p2', path: 'x' },
      }),
    );
    expect(inline).toEqual({
      kind: 'inline',
      characters: 29,
      paragraphs: 1,
      hasInlineElements: true,
      from: { id: 'p2', path: 'x' },
      to: { id: 'p2', path: 'x' },
    });
    expect('openStart' in inline).toBe(false);
    const source = contextSelection(
      blocksSnapshot({
        form: 'xml',
        nodeIds: [],
        parent: null,
        from: null,
        to: null,
        hasInlineElements: false,
      }),
    );
    expect(source).toEqual({
      kind: 'source',
      characters: 29,
      paragraphs: 2,
      hasInlineElements: false,
    });
    expect(contextSelection(null)).toEqual({
      kind: 'none',
      characters: 0,
      paragraphs: 0,
      hasInlineElements: false,
    });
  });

  it('the Source and Description views: sourceWellFormed, scriptsAvailable false (C8), parts of a split request', () => {
    const source = buildWorkingContext(input({ activeView: 'source' }));
    expect(source.sourceWellFormed).toBe(true);
    expect(source.scriptsAvailable).toBe(false);
    const textMode = buildWorkingContext(input({ activeView: 'source', sourceWellFormed: false }));
    expect(textMode.sourceWellFormed).toBe(false);
    expect(textMode.scriptsAvailable).toBe(false);
    const description = buildWorkingContext(input({ activeView: 'description' }));
    expect(description.sourceWellFormed).toBeUndefined();
    expect(description.scriptsAvailable).toBe(false);
    const parts = buildWorkingContext(
      input({
        request: { kind: 'selection', source: 'popup', parts: { index: 2, count: 3 } },
        selection: blocksSnapshot(),
      }),
    );
    expect(parts.request).toEqual({
      kind: 'selection',
      source: 'popup',
      parts: { index: 2, count: 3 },
    });
    // A split request passes its cut outline.
    const cut = buildWorkingContext(input({ outline: [] }));
    expect(cut.outline).toEqual([]);
  });

  it('names the interface language in English', () => {
    expect(languageName('en')).toBe('English');
    expect(languageName('ru')).toBe('Russian');
    expect(languageName('uk')).toBe('Ukrainian');
    expect(languageName('en-US')).toBe('English');
    expect(languageName('de')).toBe('German');
    expect(languageName('zz')).toBe('zz');
  });
});

describe('the serialised ChatRequest and its privacy guard (ai-service-protocol §9; US7 T080, T082)', () => {
  it('the system message carries the book title and language only - no docId, file path, authors, genres or key', () => {
    const document = book();
    const prompt = systemPrompt(buildWorkingContext(input({ document })));
    const body = {
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Fix' },
      ],
    };
    const serialised = JSON.stringify(body);
    expect(prompt).toContain('"book": {\n    "title": "Alpha"\n  }');
    for (const forbidden of [
      'docId',
      document.docId,
      document.path,
      '"authors"',
      '"genres"',
      'Petrov',
      'sk-',
    ]) {
      expect(serialised, forbidden).not.toContain(forbidden);
    }
    expect(forbiddenRequestMembers(body)).toEqual([]);
    expect(() => assertChatRequestPrivate(body)).not.toThrow();
  });

  it('forbiddenRequestMembers names a docId, path, key, token, user or metadata member at any depth; the tool schemas are left out of the assertion', () => {
    expect(
      forbiddenRequestMembers({
        messages: [{ role: 'user', content: 'x', docId: 'doc-1' }],
        user: 'u1',
        metadata: {},
        nested: { deep: [{ apiKey: 'k', Authorization: 'Bearer', path: '/f.fb2', token: 't' }] },
      }).sort(),
    ).toEqual(
      [
        'messages[0].docId',
        'user',
        'metadata',
        'nested.deep[0].apiKey',
        'nested.deep[0].Authorization',
        'nested.deep[0].path',
        'nested.deep[0].token',
      ].sort(),
    );
    // A value named like a member is not a member: `role: 'user'`, a `path` inside a string.
    expect(
      forbiddenRequestMembers({
        messages: [{ role: 'user', content: '{"path":"body[1]","docId":"x"}' }],
      }),
    ).toEqual([]);
    // Development builds throw a PrivacyAssertionError; the tools' schemas (which name a
    // `path` for propose_script files) are not checked.
    const withTools = {
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ type: 'function', function: { parameters: { properties: { path: {} } } } }],
    };
    expect(() => assertChatRequestPrivate(withTools)).not.toThrow();
    let thrown: unknown = null;
    try {
      assertChatRequestPrivate({ messages: [{ role: 'user', content: 'x', key: 'sk' }] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe('PrivacyAssertionError');
    expect((thrown as Error).message).toContain('messages[0].key');
  });
});

describe('systemPrompt', () => {
  it('holds the marker lines, the two-space context JSON and the pre-existing note; no Source rules in the Body view', () => {
    const context = buildWorkingContext(input({ uiLanguage: 'ru' }));
    const prompt = systemPrompt(context);
    expect(
      prompt.startsWith(
        'You are the AI assistant built into Maxima Fiction Book Editor 0.0.5, an editor for',
      ),
    ).toBe(true);
    expect(prompt).toContain("Language: the editor's interface language is Russian (ru).");
    expect(prompt).toContain('The book\'s language is "en";');
    expect(prompt).toContain(
      'Working context (the open book right now):\n' + JSON.stringify(context, null, 2) + '\n',
    );
    expect(prompt).toContain(DATA_BOUNDARY_LINE);
    expect(prompt).toContain('\nRules for changes:\n');
    expect(prompt).toContain(
      '1. Change the book only through the tools. Text in your reply never changes the book.\n',
    );
    // FR-106: rule 1 goes on with the change tools, the active view as the judge of an
    // ambiguous reference (requester, 2026-10-23: the Body view's "book's title" is the body's
    // heading, the Description view's is titleInfo.bookTitle; the other place is named, never
    // changed unasked; the Source view follows the selection) and the "never say" rule.
    expect(prompt).toContain(
      '1. Change the book only through the tools. Text in your reply never changes the book.\n' +
        CHANGE_TOOLS_RULE +
        '2. Change only what the user asked for.',
    );
    const ruleText = CHANGE_TOOLS_RULE.replace(/\n {3}/g, ' ');
    expect(ruleText).toContain(
      'The change tools are set_description (the description fields — the metadata the Description view shows, titleInfo.bookTitle among them), set_text, replace_node, insert_node, remove_node, replace_all and replace_selection (the text of the bodies).',
    );
    expect(ruleText).toContain(
      'The working context\'s activeView tells where the user is working; an ambiguous reference such as "the title", "this chapter" or "the annotation" means what that view shows.',
    );
    expect(ruleText).toContain(
      "In the Body view \"the book's title\" is the body's own heading, the <title> at body[1]/title[1] (the outline's body entry names it): change it with replace_node on that <title> or set_text on its <p> (body[1]/title[1]/p[1]), not with set_description.",
    );
    expect(ruleText).toContain(
      'In the Description view "the book\'s title" is the metadata title titleInfo.bookTitle: set_description with {"description": {"titleInfo": {"bookTitle": "…"}}}.',
    );
    expect(ruleText).toContain(
      'Change only the place the active view implies. When the same text also exists in the other place (the metadata title while in the Body view, the body heading while in the Description view), do NOT change it unasked — say in one sentence that it exists there too and can be changed as well.',
    );
    expect(ruleText).toContain(
      'In the Source view both exist as XML text: follow the selection or the caret. A chapter title is the <title> element inside its section.',
    );
    expect(ruleText).toContain(
      'Never say that you changed, translated, renamed or corrected something unless the change tool that did it answered without an "error" object; when you called no change tool, say that nothing was changed.',
    );
    // The former wording - both titles changed together - is gone.
    expect(ruleText).not.toContain('both stay in step');
    expect(ruleText).not.toContain('change that <title> too');
    // Every continuation line of the rule is indented under "1." and stays within 100 columns.
    for (const line of CHANGE_TOOLS_RULE.split('\n').filter((l) => l !== '')) {
      expect(line.startsWith('   ')).toBe(true);
      expect(line.length).toBeLessThanOrEqual(100);
    }
    // The same rule in every view: the view's name is read from the context, not from the text.
    expect(systemPrompt(buildWorkingContext(input({ activeView: 'description' })))).toContain(
      CHANGE_TOOLS_RULE,
    );
    expect(systemPrompt(buildWorkingContext(input({ activeView: 'source' })))).toContain(
      CHANGE_TOOLS_RULE,
    );
    expect(prompt).toContain(
      '7. The document has no validation errors at the start of this request.\n',
    );
    expect(prompt).not.toContain('8. Source view');
    expect(prompt).not.toContain('NOT well-formed');
    expect(
      prompt.endsWith(
        'When you are done, say in one or two sentences what you changed, or that you changed nothing.',
      ),
    ).toBe(true);
    // Never localised: the same English text for every interface language.
    const uk = systemPrompt(buildWorkingContext(input({ uiLanguage: 'uk' })));
    expect(uk).toContain('interface language is Ukrainian (uk)');
    expect(uk.split('Rules for changes:')[1]).toBe(prompt.split('Rules for changes:')[1]);
  });

  it("a selection request adds the selection note to rule 1; pre-existing errors are declared not the model's doing", () => {
    const prompt = systemPrompt(
      buildWorkingContext(
        input({
          request: { kind: 'selection', source: 'popup' },
          selection: blocksSnapshot(),
          preExistingErrors: 3,
        }),
      ),
    );
    expect(prompt).toContain(
      'Text in your reply never changes the book, except that in this selection request a reply that consists of the replacement alone is\napplied to the selection — see the user message.\n',
    );
    expect(prompt).toContain(
      '7. The document already had 3 validation error(s) before this request; they are not your doing and do not block changes that add no new error.',
    );
    expect(preExistingNote(0)).toBe(
      'The document has no validation errors at the start of this request.',
    );
    expect(preExistingNote(1)).toContain('already had 1 validation error(s)');
  });

  it('the Source view adds rule 8, and rule 9 only when the text is not well-formed', () => {
    const wellFormed = systemPrompt(buildWorkingContext(input({ activeView: 'source' })));
    expect(wellFormed).toContain(
      '\n8. Source view: the user is looking at the XML text of the book.',
    );
    expect(wellFormed).toContain('run_script is\n   unavailable here');
    expect(wellFormed).not.toContain('9. The document text is currently NOT well-formed XML.');
    expect(wellFormed.endsWith('what you changed, or that you changed nothing.')).toBe(true);
    const textMode = systemPrompt(
      buildWorkingContext(input({ activeView: 'source', sourceWellFormed: false })),
    );
    expect(textMode).toContain('8. Source view');
    expect(textMode).toContain(
      '9. The document text is currently NOT well-formed XML. Only the selected text can be changed in',
    );
    expect(textMode.indexOf('8. Source view')).toBeLessThan(
      textMode.indexOf('9. The document text'),
    );
    expect(textMode.indexOf('9. The document text')).toBeLessThan(
      textMode.indexOf('When you are done'),
    );
    expect(systemPrompt(buildWorkingContext(input({ activeView: 'description' })))).not.toContain(
      '8. Source view',
    );
  });
});

describe('selectionEditMessage', () => {
  it('lays out the §5.1 user message: instruction, kind text, counts, the fb2 fence, reply form, NO CHANGE rule', () => {
    const message = selectionEditMessage('Fix typos', blocksSnapshot());
    expect(
      message.startsWith(
        'Instruction: Fix typos\n\nSelected content (2 whole block(s); 29 characters, 2 paragraph(s)), in FictionBook form:\n```fb2\n',
      ),
    ).toBe(true);
    expect(message).toContain(
      '```fb2\n<p>First paragraph here.</p>\n<p>Он <emphasis>вышел</emphasis></p>\n```\n',
    );
    expect(message).toContain(
      'Reply with the replacement only — as FB2 block elements (<p>…</p>, <subtitle>, <poem>, <cite>, <empty-line/>, …), one or several, which replace the selected content — and nothing else: no explanation, no code fence, no quotation marks.',
    );
    expect(message).toContain('use the tools (read_part, get_outline, find)');
    expect(
      message.endsWith(
        'begin your reply with the line\nNO CHANGE\nand write your answer or question below it.',
      ),
    ).toBe(true);
    expect(message).not.toContain(SLICE_NOTE_START);
    expect(message).not.toContain(SLICE_NOTE_END);
    expect(message).not.toContain('This is part');
  });

  it('marks open ends with the slice note lines (C6) and says "block(s)" instead of "whole block(s)"', () => {
    const openEnd = selectionEditMessage('x', blocksSnapshot({ openEnd: true }));
    expect(openEnd).toContain('Selected content (2 block(s); 29 characters');
    expect(openEnd).not.toContain(SLICE_NOTE_START);
    expect(openEnd).toContain(`\`\`\`\n${SLICE_NOTE_END}\nReply with the replacement only`);
    const both = selectionEditMessage('x', blocksSnapshot({ openStart: true, openEnd: true }));
    expect(both).toContain(`\`\`\`\n${SLICE_NOTE_START}\n${SLICE_NOTE_END}\nReply with`);
    expect(SLICE_NOTE_START).toContain('The first block is selected from the caret');
    expect(SLICE_NOTE_END).toContain('The last block is selected to the caret');
  });

  it('names the inline kinds and reply forms, and the Source text kind', () => {
    const plain = selectionEditMessage(
      'x',
      blocksSnapshot({ form: 'inline', hasInlineElements: false, paragraphs: 1, blocks: 1 }),
    );
    expect(plain).toContain(
      'Selected content (plain text inside one paragraph; 29 characters, 1 paragraph(s))',
    );
    expect(plain).toContain('Reply with the replacement only — as plain text — and nothing else');
    const rich = selectionEditMessage(
      'x',
      blocksSnapshot({ form: 'inline', hasInlineElements: true, paragraphs: 1, blocks: 1 }),
    );
    expect(rich).toContain('(text with inline elements inside one paragraph; ');
    expect(rich).toContain(
      '— as FB2 inline content (text with elements such as <emphasis>…</emphasis>, <strong>, <a l:href="…">) —',
    );
    const source = selectionEditMessage('x', blocksSnapshot({ form: 'xml' }));
    expect(source).toContain('(XML text of the Source view; ');
    expect(source).toContain('— as XML text that fits exactly in the place of the selected text —');
    expect(source).not.toContain(SLICE_NOTE_END);
  });

  it("adds the part note of a split selection with the previous replacement's tail (§6.12)", () => {
    const first = selectionEditMessage('x', blocksSnapshot(), { index: 1, count: 3 });
    expect(first).toContain(
      '```\nThis is part 1 of 3 of the selection; more follows in the next message. Reply with the replacement of this part only.\nReply with the replacement only',
    );
    const second = selectionEditMessage('x', blocksSnapshot({ openEnd: true }), {
      index: 2,
      count: 3,
      previousTail: '<p>End of part one.</p>',
    });
    expect(second).toContain(
      `${SLICE_NOTE_END}\nThis is part 2 of 3 of the selection; more follows in the next message. Reply with the replacement of this part only. The part before it now ends with:\n\`\`\`fb2\n<p>End of part one.</p>\n\`\`\`\nReply with the replacement only`,
    );
    const last = selectionEditMessage('x', blocksSnapshot(), {
      index: 3,
      count: 3,
      previousTail: '<p>Two.</p>',
    });
    expect(last).toContain(
      'This is part 3 of 3 of the selection; it is the last part of the selection.',
    );
  });
});

describe('caretContextMessage / appliedLine', () => {
  it('the general user message of a popup request without selection: the instruction, then the paragraph in a fence', () => {
    expect(
      caretContextMessage('What does this word mean?', {
        id: 'n42',
        path: 'body[1]/section[2]/p[3]',
        xml: '<p>Он вышел.</p>',
      }),
    ).toBe(
      'What does this word mean?\n\nContext — the paragraph at the caret (body[1]/section[2]/p[3], nodeId n42):\n```fb2\n<p>Он вышел.</p>\n```',
    );
  });

  it('the history line names the change tools applied in a turn, or [No change]', () => {
    expect(appliedLine({})).toBe('[No change]');
    expect(appliedLine({ replace_node: 0 })).toBe('[No change]');
    expect(appliedLine({ replace_node: 2, insert_node: 1 })).toBe(
      '[Changes applied in this turn: replace_node ×2, insert_node ×1]',
    );
    expect(appliedLine(new Map([['set_text', 1]]))).toBe(
      '[Changes applied in this turn: set_text ×1]',
    );
  });
});

describe('selectionSnapshot (Body view)', () => {
  function editor() {
    const store = createAppStore();
    const rpc = fakeRpc({});
    createAppServices({ store, rpc: rpc.client, platform: 'linux' });
    actions.setConnection(store, 'connected');
    actions.setDocument(store, book());
    const controller = getBodyController(store);
    const sent: ModelNodeJson[][] = [];
    const toXml = (nodes: ModelNodeJson[]) => {
      sent.push(nodes);
      return Promise.resolve(
        nodes.map((n) => (n.type === 'text' ? n.text : `<${n.type}/>`)).join(''),
      );
    };
    const snapshot = () =>
      selectionSnapshot(controller.editorState!, controller.currentWindow, toXml);
    const select = (
      anchor: { nodeId: string; offset: number },
      head: { nodeId: string; offset: number },
    ) => setBodySelection(controller, anchor, head);
    return { store, controller, sent, toXml, snapshot, select };
  }

  it('a caret is no selection', async () => {
    const e = editor();
    e.select({ nodeId: 'p1', offset: 3 }, { nodeId: 'p1', offset: 3 });
    expect(await e.snapshot()).toBeNull();
    expect(e.sent).toEqual([]);
  });

  it('inline: anchor and head in one text container - the selected inline content alone, marks and links kept', async () => {
    const e = editor();
    e.select({ nodeId: 'p2', offset: 3 }, { nodeId: 'p2', offset: 18 }); // "вышел на улицу1"
    const s = (await e.snapshot())!;
    expect(s.form).toBe('inline');
    expect(s.anchor).toEqual({ nodeId: 'p2', offset: 3 });
    expect(s.head).toEqual({ nodeId: 'p2', offset: 18 });
    expect(s.nodeIds).toEqual(['p2']);
    expect(s.parent).toEqual({ nodeId: 'p2', element: 'p' });
    expect(s.openStart).toBe(false);
    expect(s.openEnd).toBe(false);
    expect(s.text).toBe('вышел на улицу1');
    expect(s.characters).toBe(15);
    expect(s.paragraphs).toBe(1);
    expect(s.blocks).toBe(1);
    expect(s.hasInlineElements).toBe(true);
    expect(s.from).toEqual({ id: 'p2', path: 'body[1]/section[1]/p[2]' });
    expect(s.to).toEqual(s.from);
    expect(s.pm).toMatchObject({ depth: 3 });
    // The nodes handed to doc.fragmentToXml: the inline content between the ends, no container.
    expect(e.sent[0]).toEqual([
      { type: 'text', text: 'вышел', marks: [{ type: 'emphasis' }] },
      { type: 'text', text: ' на улицу' },
      { type: 'text', text: '1', marks: [{ type: 'link', attrs: { href: '#n_1', type: 'note' } }] },
    ]);
    // Plain text inside one paragraph: no inline elements.
    e.select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p1', offset: 5 });
    const plain = (await e.snapshot())!;
    expect(plain).toMatchObject({
      form: 'inline',
      text: 'First',
      hasInlineElements: false,
      characters: 5,
    });
  });

  it('blocks, both ends closed: whole paragraphs from start to end', async () => {
    const e = editor();
    e.select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p2', offset: 19 }); // the whole of p1 and p2
    const s = (await e.snapshot())!;
    expect(s.form).toBe('blocks');
    expect(s.openStart).toBe(false);
    expect(s.openEnd).toBe(false);
    expect(s.nodeIds).toEqual(['p1', 'p2']);
    expect(s.parent).toEqual({ nodeId: 's1', element: 'section' });
    expect(s.from).toEqual({ id: 'p1', path: 'body[1]/section[1]/p[1]' });
    expect(s.to).toEqual({ id: 'p2', path: 'body[1]/section[1]/p[2]' });
    expect(s.paragraphs).toBe(2);
    expect(s.blocks).toBe(2);
    expect(s.text).toBe('First paragraph here.\nОн вышел на улицу1.');
    expect(s.characters).toBe('First paragraph here.'.length + 'Он вышел на улицу1.'.length);
    expect(s.hasInlineElements).toBe(true);
    expect(s.pm).toMatchObject({ depth: 2 });
    expect(e.sent[0]!.map((n) => n.type)).toEqual(['p', 'p']);
    expect(e.sent[0]![0]!.attrs?.nodeId).toBe('p1');
    expect((e.sent[0]![1]!.content ?? []).map((c) => c.text).join('')).toBe('Он вышел на улицу1.');
  });

  it('blocks with a partial last block (1.5 paragraphs): openEnd, the slice holding only the selected part, nothing widened (C6)', async () => {
    const e = editor();
    e.select({ nodeId: 'p1', offset: 0 }, { nodeId: 'p2', offset: 8 }); // p1 whole + "Он вышел"
    const s = (await e.snapshot())!;
    expect(s.form).toBe('blocks');
    expect(s.openStart).toBe(false);
    expect(s.openEnd).toBe(true);
    expect(s.nodeIds).toEqual(['p1', 'p2']);
    expect(s.to).toEqual({ id: 'p2', path: 'body[1]/section[1]/p[2]' });
    expect(s.text).toBe('First paragraph here.\nОн вышел');
    expect(s.characters).toBe('First paragraph here.'.length + 'Он вышел'.length);
    // The last element is a complete <p> holding only the selected part.
    const last = e.sent[0]![1]!;
    expect(last.type).toBe('p');
    expect(last.content).toEqual([
      { type: 'text', text: 'Он ' },
      { type: 'text', text: 'вышел', marks: [{ type: 'emphasis' }] },
    ]);
  });

  it('blocks with a partial first block: openStart; a backwards selection reads the same', async () => {
    const e = editor();
    e.select({ nodeId: 'p3', offset: 16 }, { nodeId: 'p2', offset: 3 }); // head before anchor; p3 whole
    const s = (await e.snapshot())!;
    expect(s.form).toBe('blocks');
    expect(s.openStart).toBe(true);
    expect(s.openEnd).toBe(false);
    expect(s.nodeIds).toEqual(['p2', 'p3']);
    expect(s.anchor).toEqual({ nodeId: 'p2', offset: 3 });
    expect(s.head).toEqual({ nodeId: 'p3', offset: 16 });
    expect(s.from).toEqual({ id: 'p2', path: 'body[1]/section[1]/p[2]' });
    expect(s.to).toEqual({ id: 'p3', path: 'body[1]/section[1]/p[3]' });
    expect(s.paragraphs).toBe(2);
    expect(s.text).toBe('вышел на улицу1.\nThird paragraph.');
    expect((e.sent[0]![0]!.content ?? [])[0]).toEqual({
      type: 'text',
      text: 'вышел',
      marks: [{ type: 'emphasis' }],
    });
  });

  it('blocks across sections: the shared parent is the body, the touched sections are the units', async () => {
    const e = editor();
    e.select({ nodeId: 'p3', offset: 0 }, { nodeId: 'p4', offset: 7 }); // s1/p3 .. s2/s2a/p4 (whole)
    const s = (await e.snapshot())!;
    expect(s.form).toBe('blocks');
    expect(s.parent).toEqual({ nodeId: 'b1', element: 'body' });
    expect(s.nodeIds).toEqual(['s1', 's2']);
    expect(s.blocks).toBe(2);
    expect(s.paragraphs).toBe(4); // p3, title p of s2, title p of s2a, p4
    // Section 1 is cut (its title, p1 and p2 are not selected): open start; section 2 is cut too
    // (its section s2b is not selected): open end.
    expect(s.openStart).toBe(true);
    expect(s.openEnd).toBe(true);
    expect(s.from).toEqual({ id: 's1', path: 'body[1]/section[1]' });
    expect(s.to).toEqual({ id: 's2', path: 'body[1]/section[2]' });
    expect(e.sent[0]!.map((n) => n.type)).toEqual(['section', 'section']);
    expect(e.sent[0]![0]!.content!.map((c) => c.attrs?.nodeId)).toEqual(['p3', 'img1']);
  });

  it('a node selection (an image) is blocks with one block and closed ends', async () => {
    const e = editor();
    const state = e.controller.editorState!;
    const found = findNodeById(state.doc, 'img1')!;
    e.controller.apply(state.tr.setSelection(NodeSelection.create(state.doc, found.pos)));
    const s = (await e.snapshot())!;
    expect(s).toMatchObject({
      form: 'blocks',
      openStart: false,
      openEnd: false,
      nodeIds: ['img1'],
      parent: { nodeId: 's1', element: 'section' },
      blocks: 1,
      characters: 0,
      hasInlineElements: false,
      from: { id: 'img1', path: 'body[1]/section[1]/image[1]' },
    });
    expect(e.sent[0]).toEqual([
      { type: 'image', attrs: { nodeId: 'img1', href: '#pic.jpg', alt: 'A picture' } },
    ]);
  });

  it('caretBlock() names the block at the caret with its path and plain text', async () => {
    const e = editor();
    e.select({ nodeId: 'p2', offset: 4 }, { nodeId: 'p2', offset: 4 });
    const caret = caretBlock(e.controller.editorState!, e.controller.currentWindow)!;
    expect(caret).toMatchObject({
      id: 'p2',
      path: 'body[1]/section[1]/p[2]',
      text: 'Он вышел на улицу1.',
    });
    expect(caret.node.type).toBe('p');
    const state = e.controller.editorState!;
    const found = findNodeById(state.doc, 'img1')!;
    e.controller.apply(state.tr.setSelection(NodeSelection.create(state.doc, found.pos)));
    expect(caretBlock(e.controller.editorState!, e.controller.currentWindow)).toMatchObject({
      id: 'img1',
      path: 'body[1]/section[1]/image[1]',
      text: '',
    });
  });
});
