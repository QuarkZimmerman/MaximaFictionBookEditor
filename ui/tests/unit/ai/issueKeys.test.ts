/**
 * Feature 005 T045 (ai-catalogue §6.10.5, §9.2 `issueKeys.test.ts`; data-model §0 "IssueKey",
 * §7.2-§7.3; review C3) - the content key `${code}|${element}|${message}` and the count
 * multisets: a pre-existing error that moved (another line, nodeId, path) is not new, a second
 * occurrence of the same kind is; warnings never count; the same functions serve a document
 * report (with nodeId / path) and a text report (line only, `xml.notWellFormed`); the FR-072
 * baseline of the last well-formed text.
 */

import type { ValidationIssue, ValidationReport } from '@/model/document';
import {
  errorForModel,
  issueKey,
  keyMessage,
  multiset,
  multisetSize,
  newErrors,
  schemaUnavailable,
  stripNamespace,
} from '@/ai/hook';

const NS = '{http://www.gribuser.ru/xml/fictionbook/2.0}';

function schemaError(
  element: string,
  message: string,
  where: Partial<Pick<ValidationIssue, 'line' | 'nodeId' | 'path'>> = {},
): ValidationIssue {
  return { severity: 'error', code: 'schema.invalid', params: { element, message }, ...where };
}

function report(issues: ValidationIssue[]): ValidationReport {
  return {
    issues,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    durationMs: 1,
  };
}

const TITLE_UNEXPECTED = "Element 'title': This element is not expected.";

describe('issueKey', () => {
  it('is the content key: code, element and message - never a position', () => {
    const a = schemaError('title', TITLE_UNEXPECTED, {
      line: 41,
      nodeId: 'n25205',
      path: 'body[1]/section[201]/title[1]',
    });
    const b = schemaError('title', TITLE_UNEXPECTED, {
      line: 44,
      nodeId: 'n9',
      path: 'body[1]/section[3]/title[1]',
    });
    expect(issueKey(a)).toBe(`schema.invalid|title|${TITLE_UNEXPECTED}`);
    expect(issueKey(a)).toBe(issueKey(b));
    // A text report's issue carries no element: the key keeps the empty slot.
    expect(
      issueKey({
        code: 'xml.notWellFormed',
        params: { message: 'Opening and ending tag mismatch' },
      }),
    ).toBe('xml.notWellFormed||Opening and ending tag mismatch');
    expect(issueKey({ code: 'genre.unknown', params: { code: 'sf_xyz' } })).toBe('genre.unknown||');
    expect(issueKey({ code: 'schema.unavailable', params: {} })).toBe('schema.unavailable||');
  });

  it("drops libxml2's position-dependent 'Expected is …' tail from the key, never from the message (US4 T060)", () => {
    // The fixture ai-preexisting.fb2: the misplaced title after the first block carries the
    // alternatives; once a paragraph is inserted before it the same error comes without them.
    const withTail = `${TITLE_UNEXPECTED} Expected is one of ( p, image, poem, subtitle, cite, empty-line, table ).`;
    expect(keyMessage(withTail)).toBe(TITLE_UNEXPECTED);
    expect(keyMessage(`${TITLE_UNEXPECTED} Expected is ( p ).`)).toBe(TITLE_UNEXPECTED);
    expect(keyMessage(TITLE_UNEXPECTED)).toBe(TITLE_UNEXPECTED);
    expect(
      keyMessage("Element 'section', attribute 'foo': The attribute 'foo' is not allowed."),
    ).toBe("Element 'section', attribute 'foo': The attribute 'foo' is not allowed.");
    const before = schemaError('title', withTail, {
      line: 65,
      path: 'body[1]/section[3]/title[2]',
    });
    const after = schemaError('title', TITLE_UNEXPECTED, {
      line: 66,
      path: 'body[1]/section[3]/title[2]',
    });
    expect(issueKey(before)).toBe(issueKey(after));
    expect(newErrors(multiset([before]), report([after]))).toEqual([]);
    // The message the model reads keeps the tail.
    expect(errorForModel(before).message).toBe(withTail);
  });
});

describe('multiset', () => {
  it('counts error issues by key and skips warnings', () => {
    const counts = multiset([
      schemaError('title', TITLE_UNEXPECTED, { line: 10 }),
      schemaError('title', TITLE_UNEXPECTED, { line: 90 }),
      schemaError('p', "Element 'p': Missing child element(s).", { line: 20 }),
      { severity: 'warning', code: 'link.dangling', params: { href: '#x' }, nodeId: 'n4' },
    ]);
    expect(counts.get(`schema.invalid|title|${TITLE_UNEXPECTED}`)).toBe(2);
    expect(counts.get("schema.invalid|p|Element 'p': Missing child element(s).")).toBe(1);
    expect(counts.size).toBe(2);
    expect(multisetSize(counts)).toBe(3);
    expect(multisetSize(multiset([]))).toBe(0);
  });
});

describe('newErrors', () => {
  const baseline = multiset([
    schemaError('title', TITLE_UNEXPECTED, {
      line: 41,
      nodeId: 'n25',
      path: 'body[1]/section[3]/title[1]',
    }),
  ]);

  it('a pre-existing error that merely moved is not new (another line, nodeId and path)', () => {
    const moved = report([
      schemaError('title', TITLE_UNEXPECTED, {
        line: 47,
        nodeId: 'n31',
        path: 'body[1]/section[4]/title[1]',
      }),
    ]);
    expect(newErrors(baseline, moved)).toEqual([]);
  });

  it('a second occurrence of the same kind is new: every issue of the key is reported in order', () => {
    const doubled = report([
      schemaError('title', TITLE_UNEXPECTED, {
        line: 12,
        nodeId: 'n7',
        path: 'body[1]/section[1]/title[1]',
      }),
      { severity: 'warning', code: 'link.dangling', params: { href: '#x' } },
      schemaError('title', TITLE_UNEXPECTED, {
        line: 47,
        nodeId: 'n31',
        path: 'body[1]/section[4]/title[1]',
      }),
    ]);
    expect(newErrors(baseline, doubled)).toEqual([
      {
        code: 'schema.invalid',
        element: 'title',
        path: 'body[1]/section[1]/title[1]',
        line: 12,
        message: TITLE_UNEXPECTED,
      },
      {
        code: 'schema.invalid',
        element: 'title',
        path: 'body[1]/section[4]/title[1]',
        line: 47,
        message: TITLE_UNEXPECTED,
      },
    ]);
  });

  it('a new kind is new; a fixed error is simply gone; warnings never count', () => {
    const other = report([
      schemaError('section', "Element 'section': Missing child element(s).", {
        line: 3,
        path: 'body[1]/section[2]',
      }),
      { severity: 'warning', code: 'image.unused', params: { id: 'img' } },
    ]);
    const errors = newErrors(baseline, other);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'schema.invalid', element: 'section', line: 3 });
    expect(newErrors(baseline, report([]))).toEqual([]);
    expect(
      newErrors(multiset([]), report([{ severity: 'warning', code: 'x', params: {} }])),
    ).toEqual([]);
  });

  it('serves a text report the same way (line only, xml.notWellFormed first - the FR-072 baseline)', () => {
    // The baseline of Source text mode is the last well-formed text's report (data-model §7.5).
    const lastWellFormed = multiset([
      schemaError('p', "Element 'p': Missing child element(s).", { line: 20 }),
    ]);
    const notWellFormed = report([
      {
        severity: 'error',
        code: 'xml.notWellFormed',
        params: { message: 'Opening and ending tag mismatch: p line 12 and section' },
        line: 12,
        column: 7,
      },
    ]);
    expect(newErrors(lastWellFormed, notWellFormed)).toEqual([
      {
        code: 'xml.notWellFormed',
        element: '',
        line: 12,
        message: 'Opening and ending tag mismatch: p line 12 and section',
      },
    ]);
    // The same kind as before at another line: pre-existing; a second one: new.
    expect(
      newErrors(
        lastWellFormed,
        report([schemaError('p', "Element 'p': Missing child element(s).", { line: 88 })]),
      ),
    ).toEqual([]);
    expect(
      newErrors(
        lastWellFormed,
        report([
          schemaError('p', "Element 'p': Missing child element(s).", { line: 20 }),
          schemaError('p', "Element 'p': Missing child element(s).", { line: 88 }),
        ]),
      ),
    ).toHaveLength(2);
  });
});

describe('errorForModel', () => {
  it('strips the FB2 namespace and composes a message for codes without one', () => {
    expect(
      stripNamespace(`Element '${NS}title': This element is not expected. Expected is ( ${NS}p ).`),
    ).toBe("Element 'title': This element is not expected. Expected is ( p ).");
    expect(
      errorForModel(
        schemaError('title', `Element '${NS}title': no`, {
          line: 5,
          path: 'body[1]/title[1]',
          nodeId: 'n2',
        }),
      ),
    ).toEqual({
      code: 'schema.invalid',
      element: 'title',
      path: 'body[1]/title[1]',
      line: 5,
      message: "Element 'title': no",
    });
    expect(
      errorForModel({
        severity: 'error',
        code: 'genre.unknown',
        params: { code: 'sf_xyz' },
        line: 9,
      }),
    ).toEqual({
      code: 'genre.unknown',
      element: '',
      line: 9,
      message: 'Unknown genre code "sf_xyz".',
    });
    expect(
      errorForModel({
        severity: 'error',
        code: 'schema.unavailable',
        params: { reason: 'no schema' },
      }),
    ).toEqual({
      code: 'schema.unavailable',
      element: '',
      message: 'no schema',
    });
    // No line, no path: the members are absent, not undefined.
    expect(Object.keys(errorForModel(schemaError('p', 'm')))).toEqual([
      'code',
      'element',
      'message',
    ]);
  });

  it('schemaUnavailable() spots the report the hook cannot work with', () => {
    expect(
      schemaUnavailable(report([{ severity: 'error', code: 'schema.unavailable', params: {} }])),
    ).toBe(true);
    expect(schemaUnavailable(report([schemaError('p', 'm')]))).toBe(false);
    expect(schemaUnavailable(report([]))).toBe(false);
  });
});
