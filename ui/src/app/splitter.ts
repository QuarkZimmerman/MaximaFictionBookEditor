/**
 * Divider between the Document Tree pane and the view area (feature 004 US1, FR-001 to FR-004;
 * research R1.1). The pane width is the session setting `session.treeWidth` - `AppState.treeWidth`,
 * default 260 px, the fixed width of release 0.0.3 - and the layout reads it from the CSS
 * variable `--mfbe-tree-width` on `.mfbe-main` (`app/layout.css`: the pane's `flex-basis`).
 *
 *  - `clampTreeWidth` is the width the layout applies for a stored width in a main area of a
 *    given width: never under the pane's minimum, never leaving the view less than its own.
 *    It is applied at render time and during the drag and never rewrites the stored value, so
 *    a width set on a larger screen comes back when the window grows (FR-002). A window too
 *    narrow for both minimums together is the stylesheet's business: the pane may shrink
 *    (`flex: 0 1 ...`) while the view keeps its `min-width`.
 *  - `attachSplitterDrag` runs the drag: the pointer is captured on `pointerdown`, every
 *    `pointermove` keeps the latest position and one animation frame per burst writes the
 *    clamped width to the layout variable - no React state per move, one layout pass per
 *    frame - the document root carries `mfbe-resizing` meanwhile (the resize cursor everywhere,
 *    no text selection) and the width is committed once when the drag ends (`pointerup`,
 *    `pointercancel` or `lostpointercapture`). Resizing is not a document change: there is no
 *    lock check, the divider works while a script runs (FR-004). Mouse operation only; a
 *    keyboard-operable divider is a candidate future feature (spec, Clarifications).
 */

/** Minimum width of the Document Tree pane: its toolbar (five 28 px buttons) fits. */
export const PANE_MIN = 160;
/** Minimum width of the view area: the view switcher fits in every interface language. */
export const VIEW_MIN = 320;
/** Width of the divider itself (`app/layout.css`, `.mfbe-splitter`). */
export const DIVIDER_W = 6;
/** The layout variable the pane's `flex-basis` reads (`:root` holds the 260 px fallback). */
export const TREE_WIDTH_VARIABLE = '--mfbe-tree-width';
/** Class of the document root while a drag goes on. */
export const RESIZING_CLASS = 'mfbe-resizing';

/**
 * The width the layout applies for the stored `width` in a main area `mainWidth` px wide:
 * `clamp(PANE_MIN, width, mainWidth - VIEW_MIN - DIVIDER_W)`, whole pixels (the setting is an
 * integer). When the main area cannot hold both minimums the pane minimum wins here and the
 * stylesheet shrinks the pane under it.
 */
export function clampTreeWidth(width: number, mainWidth: number): number {
  const max = mainWidth - VIEW_MIN - DIVIDER_W;
  return Math.round(Math.max(PANE_MIN, Math.min(width, max)));
}

interface Drag {
  pointerId: number;
  /** Pointer position and pane width when the button went down. */
  startX: number;
  startWidth: number;
  /** The latest pointer position; applied by the next animation frame. */
  latestX: number;
  /** Handle of the pending animation frame, 0 when none is scheduled. */
  frame: number;
  /** A `pointermove` happened: a plain click commits nothing. */
  moved: boolean;
}

/**
 * Makes `divider` drag the width of the pane before it inside `main` (the `.mfbe-main` flex
 * row). `onCommit` receives the clamped width once when the drag ends. Returns the function
 * that detaches the listeners (a running drag is dropped without a commit).
 */
export function attachSplitterDrag(
  divider: HTMLElement,
  main: HTMLElement,
  onCommit: (width: number) => void,
): () => void {
  const root = divider.ownerDocument.documentElement;
  const view = divider.ownerDocument.defaultView ?? window;
  let drag: Drag | null = null;

  const widthAt = (state: Drag, clientX: number): number =>
    clampTreeWidth(state.startWidth + (clientX - state.startX), main.clientWidth);
  const apply = (width: number): void => {
    main.style.setProperty(TREE_WIDTH_VARIABLE, `${width}px`);
  };
  const stop = (): Drag | null => {
    const state = drag;
    if (!state) return null;
    drag = null;
    if (state.frame) view.cancelAnimationFrame(state.frame);
    root.classList.remove(RESIZING_CLASS);
    if (
      typeof divider.hasPointerCapture === 'function' &&
      divider.hasPointerCapture(state.pointerId)
    ) {
      divider.releasePointerCapture(state.pointerId);
    }
    return state;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (drag || event.button !== 0) return;
    // The focus stays where it is (the editor keeps its caret) and no text selection starts.
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: divider.getBoundingClientRect().left - main.getBoundingClientRect().left,
      latestX: event.clientX,
      frame: 0,
      moved: false,
    };
    try {
      divider.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer (the timing journey) cannot be captured; its events reach the
      // divider directly.
    }
    root.classList.add(RESIZING_CLASS);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const state = drag;
    if (!state || event.pointerId !== state.pointerId) return;
    state.latestX = event.clientX;
    state.moved = true;
    if (state.frame === 0) {
      state.frame = view.requestAnimationFrame(() => {
        if (drag !== state) return;
        state.frame = 0;
        apply(widthAt(state, state.latestX));
      });
    }
  };

  const onPointerEnd = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const state = stop();
    if (!state || !state.moved) return;
    const width = widthAt(state, state.latestX);
    apply(width);
    onCommit(width);
  };

  divider.addEventListener('pointerdown', onPointerDown);
  divider.addEventListener('pointermove', onPointerMove);
  divider.addEventListener('pointerup', onPointerEnd);
  divider.addEventListener('pointercancel', onPointerEnd);
  divider.addEventListener('lostpointercapture', onPointerEnd);
  return () => {
    divider.removeEventListener('pointerdown', onPointerDown);
    divider.removeEventListener('pointermove', onPointerMove);
    divider.removeEventListener('pointerup', onPointerEnd);
    divider.removeEventListener('pointercancel', onPointerEnd);
    divider.removeEventListener('lostpointercapture', onPointerEnd);
    stop();
  };
}
