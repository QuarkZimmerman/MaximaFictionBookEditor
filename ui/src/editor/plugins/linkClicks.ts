/**
 * Ctrl+click on links in the Body view (feature 009, User Story 3; FR-034, FR-035, research
 * DP-12): a click with the platform's modifier (Ctrl; Cmd on macOS) on a link - its text or a
 * picture inside it - follows it: `onFollow` gets the address and the clicked position. A plain
 * click places the caret as before. While the modifier is held, the editor carries
 * `mfbe-mod-held`, which gives links the hand pointer.
 */

import { Plugin } from 'prosemirror-state';

export interface LinkClicksOptions {
  /** macOS: Cmd is the modifier; elsewhere Ctrl. */
  isMac: boolean;
  onFollow: (href: string, pos: number) => void;
}

export function linkClicksPlugin(options: LinkClicksOptions): Plugin {
  const held = (event: MouseEvent | KeyboardEvent) =>
    options.isMac ? event.metaKey : event.ctrlKey;
  return new Plugin({
    props: {
      handleClick(view, pos, event) {
        if (!held(event) || event.button !== 0) return false;
        const link = (event.target as Element | null)?.closest?.('a.fb-link') ?? null;
        if (!link || !view.dom.contains(link)) return false;
        const href = link.getAttribute('href') ?? '';
        if (!href) return false;
        event.preventDefault();
        options.onFollow(href, pos);
        return true;
      },
    },
    view(view) {
      const toggle = (event: KeyboardEvent) => {
        view.dom.classList.toggle('mfbe-mod-held', held(event));
      };
      const release = () => view.dom.classList.remove('mfbe-mod-held');
      window.addEventListener('keydown', toggle, true);
      window.addEventListener('keyup', toggle, true);
      window.addEventListener('blur', release);
      return {
        destroy() {
          window.removeEventListener('keydown', toggle, true);
          window.removeEventListener('keyup', toggle, true);
          window.removeEventListener('blur', release);
        },
      };
    },
  });
}
