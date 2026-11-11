/**
 * Feature 012 (T051, guard G17; D36, FR-065): with View > Show Book Styles off, the Body view draws a
 * book exactly as release 0.0.9 did - the same elements, the same classes and the same computed
 * styles, pseudo-elements included, in the light and the dark theme. The editor's own look moving
 * into the cascade layer `fb-look` (T055) must not change one value.
 *
 * The snapshot is release 0.0.9's: taken once from the v0.0.9 interface, served by today's core -
 *   MFBE_UI_DIST=<v0.0.9 worktree>/ui/dist MFBE_WRITE_BODY_SNAPSHOT=1 npx playwright test us4-book-styles-off
 * Values that follow the layout (the text's wrapping, the box's size) are left out: they depend on the
 * fonts of the machine, not on the stylesheets.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import { expect, fixtureBook, test, waitForBook } from './fixtures/core';

const SNAPSHOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/body-view-0.0.9.json',
);
const LAYOUT = [
  'width',
  'height',
  'inline-size',
  'block-size',
  'transform-origin',
  'perspective-origin',
];

interface BodySnapshot {
  /** Each distinct set of computed values once; the elements refer to them by index. */
  styles: Record<string, string>[];
  elements: { path: string; className: string; style: number; before?: number; after?: number }[];
}

/* The e2e tsconfig has no DOM lib: the browser-side probe is a string snippet (as theme.spec.ts). */
const BODY_SNAPSHOT = `((layout) => {
  const styles = [];
  const known = new Map();
  const indexOf = (computed) => {
    const style = {};
    for (let i = 0; i < computed.length; i++) {
      const name = computed.item(i);
      if (!layout.includes(name)) style[name] = computed.getPropertyValue(name);
    }
    const key = JSON.stringify(style);
    let index = known.get(key);
    if (index === undefined) {
      index = styles.length;
      styles.push(style);
      known.set(key, index);
    }
    return index;
  };
  const elements = [];
  const walk = (element, at) => {
    const entry = {
      path: at,
      className: [...element.classList].sort().join(' '),
      style: indexOf(getComputedStyle(element)),
    };
    for (const pseudo of ['before', 'after']) {
      const computed = getComputedStyle(element, '::' + pseudo);
      if (computed.content && computed.content !== 'none') entry[pseudo] = indexOf(computed);
    }
    elements.push(entry);
    Array.from(element.children).forEach((child, n) => walk(child, at + '/' + child.localName + '[' + n + ']'));
  };
  walk(document.querySelector('[data-testid="body-view"]'), 'body-view');
  return { styles, elements };
})`;

async function bodySnapshot(page: Page): Promise<BodySnapshot> {
  return page.evaluate<BodySnapshot>(`(${BODY_SNAPSHOT})(${JSON.stringify(LAYOUT)})`);
}

/** As stored: each style as its difference from the first one (the container's), 10 times smaller. */
interface StoredSnapshot {
  base: Record<string, string>;
  styles: Record<string, string>[];
  elements: BodySnapshot['elements'];
}

function stored(snapshot: BodySnapshot): StoredSnapshot {
  const base = snapshot.styles[0]!;
  const styles = snapshot.styles.map((style) =>
    Object.fromEntries(Object.entries(style).filter(([name, value]) => base[name] !== value)),
  );
  return { base, styles, elements: snapshot.elements };
}

function expanded(snapshot: StoredSnapshot): BodySnapshot {
  return {
    styles: snapshot.styles.map((style) => ({ ...snapshot.base, ...style })),
    elements: snapshot.elements,
  };
}

/** The differences between two snapshots, in words: at most the first 20. */
function differences(expected: BodySnapshot, actual: BodySnapshot): string[] {
  const out: string[] = [];
  if (expected.elements.length !== actual.elements.length) {
    out.push(`elements: ${expected.elements.length} in 0.0.9, ${actual.elements.length} now`);
  }
  const count = Math.min(expected.elements.length, actual.elements.length);
  for (let i = 0; i < count && out.length < 20; i++) {
    const was = expected.elements[i]!;
    const is = actual.elements[i]!;
    if (was.path !== is.path) out.push(`${was.path}: now ${is.path}`);
    if (was.className !== is.className)
      out.push(`${was.path}: class "${was.className}" now "${is.className}"`);
    for (const part of ['style', 'before', 'after'] as const) {
      const a = was[part] === undefined ? undefined : expected.styles[was[part]!];
      const b = is[part] === undefined ? undefined : actual.styles[is[part]!];
      if (!a || !b) {
        if (a !== b) out.push(`${was.path} ${part}: ${a ? 'gone' : 'new'}`);
        continue;
      }
      for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[name] !== b[name] && out.length < 20) {
          out.push(
            `${was.path}${part === 'style' ? '' : `::${part}`} ${name}: ${a[name]} now ${b[name]}`,
          );
        }
      }
    }
  }
  return out;
}

// The view settings these journeys change (spelling, the language, the book's styles) go back to their
// defaults after each test: a worker's core keeps its settings from one test to the next.
test.afterEach(async ({ core }) => {
  if (core.hasCore) await core.rpc('settings.set', { patch: { view: null } }).catch(() => {});
});

test.describe('G17 (feature 012) - Show Book Styles off draws as 0.0.9 did', () => {
  test('the reference book, light and dark: elements, classes and computed styles', async ({
    core,
    page,
  }) => {
    test.skip(!core.hasCore, 'needs mfbe-core (MFBE_CORE_BIN)');
    // The spelling marks come and go with the checker's timing: not part of the look compared.
    await core.rpc('settings.set', { patch: { view: { spellEnabled: false, theme: 'light' } } });
    await core.openApp(page);
    const book = fixtureBook('reference-all-elements.fb2');
    await core.enqueueDialog('dialog.openFile', { paths: [book] });
    await page.getByTestId('menu-file').click();
    await page.getByTestId('menu-file-open').click();
    await waitForBook(page, book);
    await expect(page.getByTestId('body-editor')).toBeVisible();
    await page.evaluate('document.fonts.ready.then(() => undefined)');
    const taken: Record<string, BodySnapshot> = {};
    for (const theme of ['light', 'dark'] as const) {
      await core.rpc('settings.set', { patch: { view: { theme } } });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      taken[theme] = await bodySnapshot(page);
    }
    if (process.env.MFBE_WRITE_BODY_SNAPSHOT === '1') {
      writeFileSync(
        SNAPSHOT,
        `${JSON.stringify({ light: stored(taken.light!), dark: stored(taken.dark!) })}\n`,
      );
      return;
    }
    expect(existsSync(SNAPSHOT), 'the 0.0.9 snapshot').toBe(true);
    const expected = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Record<string, StoredSnapshot>;
    for (const theme of ['light', 'dark'] as const) {
      expect(differences(expanded(expected[theme]!), taken[theme]!), theme).toEqual([]);
    }
  });
});
