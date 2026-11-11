/**
 * Feature 012 (T057; D41; SC-018; contracts/book-styles.md §4): the named-style tooltip - a span, an
 * element, styles inside styles, a table and a cell, an element with an id holding styled text, a
 * style no stylesheet defines, in English, Russian and Ukrainian.
 */
import { createInstance } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  namedStyleTip,
  namedStyleTipsPlugin,
  type Translate,
} from '@/editor/plugins/namedStyleTips';
import { initI18n } from '@/i18n';

const DEFINED = new Set(['sign', 'letter', 'grid', 'cell']);
const translators: Record<string, Translate> = {};

beforeAll(async () => {
  for (const language of ['en', 'ru', 'uk'] as const) {
    const i18n = await initI18n({ instance: createInstance(), react: false, language });
    translators[language] = (key, vars) => i18n.t(key, vars);
  }
});

/** The editor's markup from HTML, and the element marked `data-hover`. */
function editor(html: string): { root: HTMLElement; hovered: Element } {
  const root = document.createElement('div');
  root.className = 'fb-editor';
  root.innerHTML = html;
  return { root, hovered: root.querySelector('[data-hover]') ?? root };
}

function tip(html: string, language = 'en', defined: ReadonlySet<string> = DEFINED): string {
  const { root, hovered } = editor(html);
  return namedStyleTip(hovered, root, defined, translators[language]!);
}

describe('the named-style tooltip (D41)', () => {
  it('names the style of a span and of an element', () => {
    expect(
      tip('<p class="fb-p">a <span class="fb-style" data-style="letter" data-hover>b</span></p>'),
    ).toBe('Named style: letter');
    expect(tip('<p class="fb-p" data-style="sign" data-hover>text</p>')).toBe('Named style: sign');
  });

  it('names every style in effect, the outermost first', () => {
    expect(
      tip(
        '<p class="fb-p" data-style="sign"><span class="fb-style" data-style="letter"><span class="fb-emphasis" data-hover>x</span></span></p>',
      ),
    ).toBe('Named styles: sign, letter');
  });

  it('names the styles of a table and of a cell', () => {
    const table = (cell: string) =>
      `<table class="fb-table" data-style="grid"><tbody><tr class="fb-tr">${cell}</tr></tbody></table>`;
    expect(tip(table('<td class="fb-td" data-hover>c</td>'))).toBe('Named style: grid');
    expect(tip(table('<td class="fb-td" data-style="cell" data-hover>c</td>'))).toBe(
      'Named styles: grid, cell',
    );
  });

  it("keeps the element's id on a line of its own, also over styled text inside it", () => {
    expect(
      tip(
        '<p class="fb-p" data-id="chapter-2">a <span class="fb-style" data-style="letter" data-hover>b</span></p>',
      ),
    ).toBe('Named style: letter\n#chapter-2');
    expect(tip('<p class="fb-p" data-id="chapter-2" data-hover>a</p>')).toBe('#chapter-2');
  });

  it('says that a style no stylesheet defines is not in the stylesheets', () => {
    expect(
      tip('<p class="fb-p"><span class="fb-style" data-style="ghost" data-hover>g</span></p>'),
    ).toBe('Named style: ghost (not in the stylesheets)');
    expect(
      tip(
        '<p class="fb-p" data-style="ghost"><span class="fb-style" data-style="letter" data-hover>g</span></p>',
      ),
    ).toBe('Named styles: ghost (not in the stylesheets), letter');
  });

  it('is empty where there is nothing to name', () => {
    expect(tip('<p class="fb-p" data-hover>plain</p>')).toBe('');
  });

  it("speaks the interface's language, the names as written", () => {
    const nested =
      '<p class="fb-p" data-style="sign"><span class="fb-style" data-style="Буква" data-hover>x</span></p>';
    expect(tip(nested, 'ru', new Set(['sign']))).toBe(
      'Именованные стили: sign, Буква (нет в таблицах стилей)',
    );
    expect(tip(nested, 'uk', new Set(['sign']))).toBe(
      'Іменовані стилі: sign, Буква (немає в таблицях стилів)',
    );
    expect(tip('<p class="fb-p" data-style="sign" data-hover>x</p>', 'ru')).toBe(
      'Именованный стиль: sign',
    );
    expect(tip('<p class="fb-p" data-style="sign" data-hover>x</p>', 'uk')).toBe(
      'Іменований стиль: sign',
    );
  });

  it("is kept on the editor's root while the pointer moves, and goes when it leaves", () => {
    const { root, hovered } = editor(
      '<p class="fb-p" data-style="sign"><span class="fb-style" data-style="letter" data-hover>x</span> y</p>',
    );
    const plugin = namedStyleTipsPlugin(
      () => translators.en!,
      () => DEFINED,
    );
    const handlers = plugin.props.handleDOMEvents!;
    const view = { dom: root } as never;
    const over = (target: Element) => {
      const event = new MouseEvent('mouseover', { bubbles: true });
      Object.defineProperty(event, 'target', { value: target });
      handlers.mouseover!.call(plugin, view, event);
    };
    over(hovered);
    expect(root.getAttribute('title')).toBe('Named styles: sign, letter');
    over(root.querySelector('p')!);
    expect(root.getAttribute('title')).toBe('Named style: sign');
    handlers.mouseleave!.call(plugin, view, new MouseEvent('mouseleave'));
    expect(root.hasAttribute('title')).toBe(false);
  });
});
