/**
 * The Source controller's table state (feature 006, T055; I23; FR-061; FR-045; C28;
 * data-model §6.3, §7.3 "Live state"; research R4.3, R4.6, R4.7): `subscribeContext` notifies
 * once per verdict change, 100 ms after the last selection, text or tree change, and not while
 * typing keeps the verdict; `tablePoint()` is memoised on its key; the idle parse task turns
 * `analysing` into a verdict in slices of at most 25 ms while the view is mounted and stops
 * with `unmount`; `pointAt` judges the offset under the pointer, or the selection's end for a
 * click inside a non-empty selection, which it keeps, and answers `loading` while unmounted;
 * `insertTable` refuses while the editor is locked or the verdict is not `ok`.
 */

import { ensureSyntaxTree } from '@codemirror/language';

import { actions, createAppStore } from '@/model/store';
import { UndoCoordinator } from '@/model/undo';
import { SourceEditorController } from '@/views/source/sourceEditor';
import { sourceSession } from '@/views/source/sourceSession';

import { fakeRunLock } from '../features/testUtils';

// The idle task's slices are observed through the calls it makes (the real function runs).
vi.mock('@codemirror/language', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codemirror/language')>();
  return { ...actual, ensureSyntaxTree: vi.fn(actual.ensureSyntaxTree) };
});

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const TWO_BY_TWO = { rows: 2, columns: 2, headerRow: false, headerColumn: false };

function book(paragraphs: string[]): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<FictionBook xmlns="${FB2_NS}">`,
    '\t<body>',
    '\t\t<section>',
    '\t\t\t<title>',
    '\t\t\t\t<p>Title</p>',
    '\t\t\t</title>',
    ...paragraphs.map((text) => `\t\t\t<p>${text}</p>`),
    '\t\t</section>',
    '\t</body>',
    '</FictionBook>',
    '',
  ].join('\n');
}

const BOOK = book(['First', 'Second', 'Third']);

function offsetOf(text: string, needle: string): number {
  const at = text.indexOf(needle);
  if (at < 0) throw new Error(`"${needle}" not in the text`);
  return at;
}

const after = (text: string, needle: string) => offsetOf(text, needle) + needle.length;

const OK_1 = after(BOOK, '<p>First</p>');
const OK_2 = after(BOOK, '<p>Second</p>');
const IN_TEXT = offsetOf(BOOK, 'Second') + 2;

beforeAll(() => {
  // jsdom has no layout: CodeMirror's measuring needs these to exist.
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }),
  });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  });
});

const hosts: HTMLElement[] = [];
const controllers: SourceEditorController[] = [];

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  for (const host of hosts.splice(0)) host.remove();
  vi.useRealTimers();
  vi.mocked(ensureSyntaxTree).mockClear();
});

/** A controller with `text` loaded (headless unless `mounted`), the status `ready`. */
async function loaded(text: string, mounted = false) {
  const store = createAppStore();
  const undo = new UndoCoordinator();
  const controller = new SourceEditorController({ store, undo });
  controllers.push(controller);
  if (mounted) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    hosts.push(host);
    controller.mount(host);
  }
  const session = sourceSession(store);
  session.docId = 'doc-1';
  session.text = text;
  session.baseline = text;
  await controller.load({ store, rpc: null } as never);
  expect(controller.getSnapshot().status).toBe('ready');
  return { store, undo, controller };
}

function select(controller: SourceEditorController, anchor: number, head = anchor) {
  controller.target.dispatch({ selection: { anchor, head } });
}

function type(controller: SourceEditorController, text: string) {
  const at = controller.state.selection.main.head;
  controller.target.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: 'input.type',
  });
}

describe('subscribeContext', () => {
  it('notifies once per verdict change, 100 ms after the last change, never while typing keeps the verdict', async () => {
    vi.useFakeTimers();
    const { controller } = await loaded(BOOK);
    select(controller, 0); // outsideRoot
    vi.advanceTimersByTime(500);
    const listener = vi.fn();
    const off = controller.subscribeContext(listener);

    select(controller, OK_1);
    vi.advanceTimersByTime(99);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);

    // Another allowed point: the same verdict, no notification.
    select(controller, OK_2);
    vi.advanceTimersByTime(300);
    expect(listener).toHaveBeenCalledTimes(1);

    // Into text, then typing there: one notification 100 ms after the last keystroke.
    select(controller, IN_TEXT);
    vi.advanceTimersByTime(50);
    type(controller, 'a');
    vi.advanceTimersByTime(50);
    type(controller, 'b');
    vi.advanceTimersByTime(99);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(2);
    for (const letter of 'cdefg') {
      type(controller, letter);
      vi.advanceTimersByTime(120);
    }
    expect(listener).toHaveBeenCalledTimes(2);
    expect(controller.tablePoint().code).toBe('inText');

    // Back between elements.
    select(controller, after(controller.text, '<p>First</p>'));
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(3);

    // An unsubscribed listener hears nothing more.
    off();
    select(controller, 0);
    vi.advanceTimersByTime(300);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('follows the core’s parse error and the load status', async () => {
    vi.useFakeTimers();
    const { store, controller } = await loaded(BOOK);
    select(controller, OK_1);
    const listener = vi.fn();
    controller.subscribeContext(listener);
    actions.setSourceParseError(store, { line: 3, column: 1, message: 'broken' });
    expect(controller.tablePoint()).toEqual({ code: 'notWellFormed', line: 3 });
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(1);
    controller.reset();
    expect(controller.tablePoint()).toEqual({ code: 'loading' });
    vi.advanceTimersByTime(100);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('tablePoint', () => {
  it('is memoised for an unchanged key and recomputed when the key changes', async () => {
    const { store, controller } = await loaded(BOOK);
    select(controller, OK_1);
    const first = controller.tablePoint();
    expect(first.code).toBe('ok');
    expect(controller.tablePoint()).toBe(first);
    // A transaction that changes neither the text nor the selection's end keeps the memo.
    controller.setDark(true);
    expect(controller.tablePoint()).toBe(first);
    select(controller, OK_1 - 4, OK_1);
    expect(controller.tablePoint()).toBe(first);
    // The selection's end, the text, the parse error and the status are the key.
    select(controller, OK_2);
    const second = controller.tablePoint();
    expect(second).not.toBe(first);
    expect(second.code).toBe('ok');
    select(controller, IN_TEXT);
    expect(controller.tablePoint().code).toBe('inText');
    select(controller, OK_1);
    type(controller, ' ');
    expect(controller.tablePoint().code).toBe('ok');
    actions.setSourceParseError(store, { line: 2, column: 4, message: 'broken' });
    expect(controller.tablePoint()).toEqual({ code: 'notWellFormed', line: 2 });
    actions.setSourceParseError(store, null);
    expect(controller.tablePoint().code).toBe('ok');
  });

  it('is cleared of the core’s parse error by the next edit', async () => {
    const { store, controller } = await loaded(BOOK);
    select(controller, OK_1);
    actions.setSourceParseError(store, { line: 2, column: 4, message: 'broken' });
    expect(controller.tablePoint().code).toBe('notWellFormed');
    type(controller, ' ');
    expect(store.getState().sourceParseError).toBeNull();
    expect(controller.tablePoint().code).toBe('ok');
  });
});

describe('the idle parse task', () => {
  /** A section long enough that neither creating the state nor one slice parses all of it. */
  const LONG = book(Array.from({ length: 20_000 }, (_, i) => `Paragraph number ${i} of the book`));
  /** These tests parse a long text more than once: a time-out of their own. */
  const LONG_TEST_MS = 30_000;
  const POINT = after(LONG, '<p>Paragraph number 1 of the book</p>');

  /** The task's slices: ensureSyntaxTree calls for the whole text with a time budget. */
  const slices = (length: number) =>
    vi
      .mocked(ensureSyntaxTree)
      .mock.calls.filter(([, upto, timeout]) => upto === length && (timeout ?? 50) > 0);

  it(
    'turns analysing into a verdict in slices of at most 25 ms while mounted',
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      const { controller } = await loaded(LONG, true);
      select(controller, POINT);
      expect(controller.tablePoint()).toEqual({ code: 'analysing' });
      const listener = vi.fn();
      controller.subscribeContext(listener);
      vi.mocked(ensureSyntaxTree).mockClear();

      for (let i = 0; i < 2_000 && controller.tablePoint().code === 'analysing'; i += 1) {
        vi.advanceTimersByTime(10);
      }
      expect(controller.tablePoint().code).toBe('ok');
      const made = slices(LONG.length);
      expect(made.length).toBeGreaterThanOrEqual(2);
      for (const [, , timeout] of made) expect(timeout).toBeLessThanOrEqual(25);
      vi.advanceTimersByTime(100);
      expect(listener).toHaveBeenCalledTimes(1);
    },
    LONG_TEST_MS,
  );

  it(
    'stops with unmount',
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      const { controller } = await loaded(LONG, true);
      select(controller, POINT);
      vi.mocked(ensureSyntaxTree).mockClear();
      controller.unmount();
      vi.advanceTimersByTime(5_000);
      expect(slices(LONG.length)).toHaveLength(0);
      expect(controller.tablePoint()).toEqual({ code: 'loading' });
    },
    LONG_TEST_MS,
  );

  it(
    'runs headless never, and again 150 ms after a change while mounted',
    async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      const headless = await loaded(LONG);
      vi.mocked(ensureSyntaxTree).mockClear();
      vi.advanceTimersByTime(5_000);
      expect(slices(LONG.length)).toHaveLength(0);
      headless.controller.destroy();

      const { controller } = await loaded(LONG, true);
      // Fake timers give a 0 ms timer made during a tick 1 ms: advance until the slices are done.
      const settle = () => {
        for (let i = 0; i < 2_000 && controller.tablePoint().code === 'analysing'; i += 1) {
          vi.advanceTimersByTime(10);
        }
      };
      settle();
      expect(controller.tablePoint().code).not.toBe('analysing');
      // A change of the whole text, which the transaction's own 20 ms of parsing cannot finish:
      // the task starts again 150 ms after it.
      const replaced = LONG.replace(/Paragraph number/g, 'Paragraph Number');
      controller.target.dispatch({
        changes: { from: 0, to: controller.state.doc.length, insert: replaced },
      });
      vi.mocked(ensureSyntaxTree).mockClear();
      expect(controller.tablePoint().code).toBe('analysing');
      vi.advanceTimersByTime(149);
      expect(slices(replaced.length)).toHaveLength(0);
      settle();
      expect(slices(replaced.length).length).toBeGreaterThan(0);
      expect(controller.tablePoint().code).not.toBe('analysing');
    },
    LONG_TEST_MS,
  );
});

describe('pointAt', () => {
  it('judges the offset under the pointer and moves nothing', async () => {
    const { controller } = await loaded(BOOK, true);
    select(controller, 0);
    const view = controller.editorView!;
    const posAtCoords = vi.spyOn(view, 'posAtCoords');
    posAtCoords.mockReturnValue(IN_TEXT);
    expect(controller.pointAt({ x: 10, y: 20 })).toEqual({
      verdict: { code: 'inText' },
      moveTo: IN_TEXT,
    });
    posAtCoords.mockReturnValue(OK_1);
    const point = controller.pointAt({ x: 10, y: 40 });
    expect(point.verdict.code).toBe('ok');
    expect(point.moveTo).toBe(OK_1);
    expect(posAtCoords).toHaveBeenLastCalledWith({ x: 10, y: 40 }, false);
    expect(controller.state.selection.main.head).toBe(0);
  });

  it('judges the selection’s end for a click inside a non-empty selection, which it keeps', async () => {
    const { controller } = await loaded(BOOK, true);
    const start = offsetOf(BOOK, '\t\t\t<p>First');
    select(controller, start, OK_1);
    vi.spyOn(controller.editorView!, 'posAtCoords').mockReturnValue(offsetOf(BOOK, 'First'));
    const point = controller.pointAt({ x: 1, y: 1 });
    expect(point.moveTo).toBeNull();
    expect(point.verdict).toEqual(controller.tablePoint());
    expect(point.verdict.code).toBe('ok');
    expect(controller.state.selection.main).toMatchObject({ anchor: start, head: OK_1 });
  });

  it('answers loading while unmounted', async () => {
    const { controller } = await loaded(BOOK, true);
    controller.unmount();
    expect(controller.pointAt({ x: 1, y: 1 })).toEqual({
      verdict: { code: 'loading' },
      moveTo: null,
    });
  });
});

describe('insertTable', () => {
  it('refuses while the editor is locked and for any verdict but ok', async () => {
    const { store, controller } = await loaded(BOOK);
    select(controller, OK_1);
    actions.setRunLock(store, fakeRunLock());
    expect(controller.insertTable(TWO_BY_TWO)).toBe(false);
    expect(controller.text).toBe(BOOK);
    actions.setRunLock(store, fakeRunLock('ai'));
    expect(controller.insertTable(TWO_BY_TWO)).toBe(false);
    actions.setRunLock(store, null);
    select(controller, IN_TEXT);
    expect(controller.insertTable(TWO_BY_TWO)).toBe(false);
    select(controller, after(BOOK, '<title>'));
    expect(controller.insertTable(TWO_BY_TWO)).toBe(false);
    expect(controller.text).toBe(BOOK);
    select(controller, OK_1);
    expect(controller.insertTable(TWO_BY_TWO)).toBe(true);
    expect(controller.text).toContain(
      '<p>First</p>\n\t\t\t<table>\n\t\t\t\t<tr>\n\t\t\t\t\t<td></td>',
    );
  });

  it('focuses the mounted editor after inserting', async () => {
    const { controller } = await loaded(BOOK, true);
    select(controller, OK_1);
    const focus = vi.spyOn(controller.editorView!, 'focus');
    expect(controller.insertTable(TWO_BY_TWO)).toBe(true);
    expect(focus).toHaveBeenCalled();
  });
});
