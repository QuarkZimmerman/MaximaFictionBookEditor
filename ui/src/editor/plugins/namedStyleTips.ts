/**
 * Feature 012 (US5; D41; FR-070; contracts/book-styles.md §4): one tooltip for the text under the
 * pointer in the Body view.
 * - Every named style in effect there, the outermost first: a styled table, cell or paragraph, then the
 *   styled spans from the outer ones in - "Named style: letter", "Named styles: sign, letter".
 * - A style no stylesheet of the book defines says so after its name.
 * - The id of the nearest element that has one, on a line of its own, also over styled text inside it.
 * - The words in the interface language, the names as written; the same with the book's styles shown
 *   or not.
 *
 * The elements carry `data-style` and `data-id` but no titles of their own: an inner title would hide
 * the outer element's style and id. The one title goes on the editor's root, because ProseMirror leaves
 * attribute changes there alone, while a change on an element inside its content makes it read that
 * element again.
 */

import { Plugin } from 'prosemirror-state';

export type Translate = (key: string, vars?: Record<string, string>) => string;

/** The tooltip for `target` inside the editor's root `root`; '' when there is nothing to name. */
export function namedStyleTip(
  target: Element | null,
  root: Element,
  defined: ReadonlySet<string>,
  t: Translate,
): string {
  const styles: string[] = [];
  let id: string | null = null;
  for (let element = target; element && element !== root; element = element.parentElement) {
    // Walking outwards: an outer element's names go in front of the inner ones'.
    styles.unshift(...(element.getAttribute('data-style') ?? '').split(/\s+/).filter(Boolean));
    id ??= element.getAttribute('data-id') || null;
  }
  const lines: string[] = [];
  if (styles.length > 0) {
    const names = styles.map((name) =>
      defined.has(name) ? name : `${name} ${t('namedStyleTip.undefined')}`,
    );
    lines.push(
      names.length === 1
        ? t('namedStyleTip.one', { name: names[0]! })
        : t('namedStyleTip.many', { names: names.join(', ') }),
    );
  }
  if (id) lines.push(`#${id}`);
  return lines.join('\n');
}

/** Keeps the editor root's title on what the pointer rests on. */
export function namedStyleTipsPlugin(
  getTranslate: () => Translate,
  getStyleNames: () => ReadonlySet<string>,
): Plugin {
  const show = (dom: HTMLElement, tip: string): void => {
    if (!tip) dom.removeAttribute('title');
    else if (dom.getAttribute('title') !== tip) dom.setAttribute('title', tip);
  };
  return new Plugin({
    props: {
      handleDOMEvents: {
        mouseover(view, event) {
          const target = event.target instanceof Element ? event.target : null;
          show(
            view.dom,
            target && view.dom.contains(target)
              ? namedStyleTip(target, view.dom, getStyleNames(), getTranslate())
              : '',
          );
          return false;
        },
        mouseleave(view) {
          show(view.dom, '');
          return false;
        },
      },
    },
  });
}
