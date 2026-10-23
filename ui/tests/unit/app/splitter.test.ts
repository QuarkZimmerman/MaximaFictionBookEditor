/**
 * Divider between the Document Tree pane and the view area (feature 004 US1, FR-001 and
 * FR-002; research R1.1) and its mirror between the view area and the AI assistant panel
 * (feature 005 US3, FR-040; data-model §3.2): the clamps of the applied widths - each pane's
 * subtracting the other pane while it is shown, so that neither divider squeezes the far pane
 * under its minimum - and the pointer-captured drag of `app/splitter.ts` driven with fake
 * pointer events - capture on `pointerdown`, one animation frame per burst of moves, exactly
 * one commit when the drag ends.
 */

import {
  AI_PANEL_WIDTH_VARIABLE,
  DIVIDER_W,
  PANE_MIN,
  PANEL_MAX,
  PANEL_MIN,
  RESIZING_CLASS,
  TREE_WIDTH_VARIABLE,
  VIEW_MIN,
  attachSplitterDrag,
  clampPanelWidth,
  clampTreeWidth,
} from '@/app/splitter';

describe('clampTreeWidth', () => {
  it('keeps the pane at its minimum and leaves the view its own (no AI panel)', () => {
    const max = 1000 - VIEW_MIN - DIVIDER_W;
    expect(clampTreeWidth(260, 1000, 0, false)).toBe(260);
    expect(clampTreeWidth(PANE_MIN, 1000, 0, false)).toBe(PANE_MIN);
    expect(clampTreeWidth(PANE_MIN - 1, 1000, 0, false)).toBe(PANE_MIN);
    expect(clampTreeWidth(0, 1000, 0, false)).toBe(PANE_MIN);
    expect(clampTreeWidth(-50, 1000, 0, false)).toBe(PANE_MIN);
    expect(clampTreeWidth(max, 1000, 0, false)).toBe(max);
    expect(clampTreeWidth(max + 1, 1000, 0, false)).toBe(max);
    expect(clampTreeWidth(5000, 1000, 0, false)).toBe(max);
  });

  it('subtracts the AI panel and its divider while the panel is shown (feature 005)', () => {
    // The mirror of clampPanelWidth: the pane stops where the panel keeps its applied width and
    // the view its minimum, so a drag of the tree divider never squeezes the panel under 280.
    const withPanel = 1000 - (360 + DIVIDER_W) - DIVIDER_W - VIEW_MIN;
    expect(clampTreeWidth(5000, 1000, 360, true)).toBe(withPanel);
    expect(clampTreeWidth(withPanel, 1000, 360, true)).toBe(withPanel);
    expect(clampTreeWidth(withPanel + 1, 1000, 360, true)).toBe(withPanel);
    expect(clampTreeWidth(260, 1000, 360, true)).toBe(260);
    expect(clampTreeWidth(PANE_MIN - 1, 1000, 360, true)).toBe(PANE_MIN);
    // The panel at its minimum leaves the pane the most it can have beside a shown panel.
    expect(clampTreeWidth(5000, 1000, PANEL_MIN, true)).toBe(
      1000 - (PANEL_MIN + DIVIDER_W) - DIVIDER_W - VIEW_MIN,
    );
    // The panel's width does not count while the panel is hidden.
    expect(clampTreeWidth(5000, 1000, 360, false)).toBe(1000 - VIEW_MIN - DIVIDER_W);
    expect(clampTreeWidth(5000, 1000, 800, false)).toBe(1000 - VIEW_MIN - DIVIDER_W);
    // Too narrow for the minimums together: the pane minimum wins, the stylesheet shrinks.
    expect(clampTreeWidth(400, 700, 360, true)).toBe(PANE_MIN);
    expect(
      clampTreeWidth(300, PANE_MIN + PANEL_MIN + 2 * DIVIDER_W + VIEW_MIN - 1, PANEL_MIN, true),
    ).toBe(PANE_MIN);
  });

  it('mirrors clampPanelWidth: neither pane can take the other under its minimum', () => {
    // A 1000 px main area with the tree at 260 and the panel at 360: each clamp leaves the
    // other pane exactly what it has when the view is at its minimum.
    const treeMax = clampTreeWidth(5000, 1000, 360, true);
    const panelMax = clampPanelWidth(5000, 1000, 260, true);
    expect(treeMax + DIVIDER_W + VIEW_MIN + DIVIDER_W + 360).toBe(1000);
    expect(260 + DIVIDER_W + VIEW_MIN + DIVIDER_W + panelMax).toBe(1000);
    // At the other pane's minimum the two maxima are the complements of each other.
    expect(clampTreeWidth(5000, 1000, PANEL_MIN, true) + PANEL_MIN).toBe(
      clampPanelWidth(5000, 1000, PANE_MIN, true) + PANE_MIN,
    );
  });

  it('answers whole pixels: the setting is an integer', () => {
    expect(clampTreeWidth(300.4, 1000, 0, false)).toBe(300);
    expect(clampTreeWidth(300.6, 1000, 0, false)).toBe(301);
    expect(clampTreeWidth(500, 1000.7, 0, false)).toBe(500);
    expect(clampTreeWidth(300.4, 1000, 360, true)).toBe(300);
  });

  it('lets the pane minimum win in a main area too narrow for both minimums', () => {
    // The stylesheet shrinks the pane under its minimum while the view keeps its own (FR-002).
    expect(clampTreeWidth(500, 400, 0, false)).toBe(PANE_MIN);
    expect(clampTreeWidth(100, PANE_MIN + DIVIDER_W + VIEW_MIN, 0, false)).toBe(PANE_MIN);
  });
});

describe('clampPanelWidth (feature 005 data-model §3.2)', () => {
  it('keeps the AI panel between 280 and 800 px and leaves the view its minimum', () => {
    expect(PANEL_MIN).toBe(280);
    expect(PANEL_MAX).toBe(800);
    // No tree pane: the panel may take everything but its divider and the view's minimum.
    const max = 1400 - DIVIDER_W - VIEW_MIN;
    expect(clampPanelWidth(360, 1400, 260, false)).toBe(360);
    expect(clampPanelWidth(PANEL_MIN, 1400, 260, false)).toBe(PANEL_MIN);
    expect(clampPanelWidth(PANEL_MIN - 1, 1400, 260, false)).toBe(PANEL_MIN);
    expect(clampPanelWidth(0, 1400, 260, false)).toBe(PANEL_MIN);
    expect(clampPanelWidth(-10, 1400, 260, false)).toBe(PANEL_MIN);
    expect(clampPanelWidth(PANEL_MAX, 1400, 260, false)).toBe(PANEL_MAX);
    expect(clampPanelWidth(PANEL_MAX + 1, 1400, 260, false)).toBe(PANEL_MAX);
    expect(clampPanelWidth(5000, 1400, 260, false)).toBe(PANEL_MAX);
    expect(max).toBeGreaterThan(PANEL_MAX); // on this main area the cap is PANEL_MAX
    // A narrower main area: the view's minimum caps the panel below PANEL_MAX.
    expect(clampPanelWidth(5000, 1000, 260, false)).toBe(1000 - DIVIDER_W - VIEW_MIN);
  });

  it('subtracts the tree pane and its divider while the tree is shown', () => {
    const withTree = 1000 - (260 + DIVIDER_W) - DIVIDER_W - VIEW_MIN;
    expect(clampPanelWidth(5000, 1000, 260, true)).toBe(withTree);
    expect(clampPanelWidth(withTree, 1000, 260, true)).toBe(withTree);
    expect(clampPanelWidth(withTree + 1, 1000, 260, true)).toBe(withTree);
    expect(clampPanelWidth(300, 1000, 260, true)).toBe(300);
    // The tree width does not count while the tree is hidden.
    expect(clampPanelWidth(5000, 1000, 600, false)).toBe(1000 - DIVIDER_W - VIEW_MIN);
    // Too narrow for the minimums together: the panel minimum wins, the stylesheet shrinks.
    expect(clampPanelWidth(400, 700, 260, true)).toBe(PANEL_MIN);
  });

  it('answers whole pixels and never rewrites the stored value', () => {
    expect(clampPanelWidth(360.4, 1400, 260, false)).toBe(360);
    expect(clampPanelWidth(360.6, 1400, 260, false)).toBe(361);
    const stored = 5000;
    clampPanelWidth(stored, 1000, 260, true);
    expect(stored).toBe(5000); // a pure function: the caller's value is untouched
  });
});

function rect(left: number, width: number): DOMRect {
  return {
    left,
    width,
    right: left + width,
    x: left,
    y: 0,
    top: 0,
    bottom: 100,
    height: 100,
    toJSON: () => ({}),
  } as DOMRect;
}

function pointer(type: string, init: PointerEventInit): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: type === 'pointerdown' || type === 'pointerup' ? 0 : -1,
    ...init,
  });
}

interface Harness {
  main: HTMLDivElement;
  divider: HTMLDivElement;
  root: HTMLElement;
  onCommit: ReturnType<typeof vi.fn>;
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
  frames: FrameRequestCallback[];
  /** Runs the animation frames requested so far (none pending afterwards). */
  flushFrames(): void;
  appliedWidth(): string;
  detach(): void;
}

interface HarnessOptions {
  side?: 'left' | 'right';
  /** The tree pane the right-hand divider's clamp subtracts (260 px, shown, by default). */
  treeWidth?: number;
  treeVisible?: boolean;
  /**
   * The AI panel the left-hand divider's clamp subtracts; without it the drag runs with its
   * default clamp (no panel), as before feature 005.
   */
  panelWidth?: number;
  panelVisible?: boolean;
}

/**
 * A main area `mainWidth` px wide whose divider starts `startWidth` px from its left edge (the
 * tree pane before it) or, for `side: 'right'`, leaves `startWidth` px between its right edge
 * and the main area's right edge (the AI panel after it).
 */
function harness(startWidth = 260, mainWidth = 1000, options: HarnessOptions = {}): Harness {
  const side = options.side ?? 'left';
  const main = document.createElement('div');
  const divider = document.createElement('div');
  main.append(divider);
  document.body.append(main);
  Object.defineProperty(main, 'clientWidth', { value: mainWidth, configurable: true });
  main.getBoundingClientRect = () => rect(0, mainWidth);
  divider.getBoundingClientRect = () =>
    side === 'left'
      ? rect(startWidth, DIVIDER_W)
      : rect(mainWidth - startWidth - DIVIDER_W, DIVIDER_W);
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((id: number) => captured.add(id));
  const releasePointerCapture = vi.fn((id: number) => captured.delete(id));
  Object.assign(divider, {
    setPointerCapture,
    releasePointerCapture,
    hasPointerCapture: (id: number) => captured.has(id),
  });
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => {
    frames[handle - 1] = () => {};
  });
  const onCommit = vi.fn();
  const variable = side === 'left' ? TREE_WIDTH_VARIABLE : AI_PANEL_WIDTH_VARIABLE;
  const { panelWidth = 360, panelVisible } = options;
  const detach =
    side === 'left'
      ? attachSplitterDrag(
          divider,
          main,
          onCommit,
          panelVisible === undefined
            ? {}
            : {
                clamp: (width, available) =>
                  clampTreeWidth(width, available, panelWidth, panelVisible),
              },
        )
      : attachSplitterDrag(divider, main, onCommit, {
          side: 'right',
          variable,
          clamp: (width, available) =>
            clampPanelWidth(
              width,
              available,
              options.treeWidth ?? 260,
              options.treeVisible ?? true,
            ),
        });
  return {
    main,
    divider,
    root: document.documentElement,
    onCommit,
    setPointerCapture,
    releasePointerCapture,
    frames,
    flushFrames() {
      for (const callback of frames.splice(0)) callback(performance.now());
    },
    appliedWidth: () => main.style.getPropertyValue(variable),
    detach,
  };
}

describe('attachSplitterDrag', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.documentElement.classList.remove(RESIZING_CLASS);
  });

  it('captures the pointer on pointerdown, marks the root and lays out once per frame', () => {
    const h = harness();
    const down = pointer('pointerdown', { clientX: 263 });
    h.divider.dispatchEvent(down);
    expect(h.setPointerCapture).toHaveBeenCalledWith(1);
    expect(down.defaultPrevented).toBe(true); // the focus stays where it was
    expect(h.root.classList.contains(RESIZING_CLASS)).toBe(true);

    // A burst of moves: one animation frame, the latest position wins.
    for (const clientX of [280, 300, 323]) {
      h.divider.dispatchEvent(pointer('pointermove', { clientX }));
    }
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(h.appliedWidth()).toBe(''); // nothing written before the frame
    h.flushFrames();
    expect(h.appliedWidth()).toBe('320px'); // 260 + (323 - 263)
    expect(h.onCommit).not.toHaveBeenCalled(); // no React state per move

    // The next burst schedules the next frame.
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 343 }));
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);
    h.flushFrames();
    expect(h.appliedWidth()).toBe('340px');
  });

  it('commits exactly once on pointerup; the implicit lostpointercapture adds nothing', () => {
    const h = harness();
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 300 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 363 }));
    // The frame of the last burst is still pending: the release applies the final width itself.
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 363 }));
    expect(h.appliedWidth()).toBe('360px');
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledWith(360);
    expect(h.root.classList.contains(RESIZING_CLASS)).toBe(false);
    expect(h.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    h.flushFrames();
    expect(h.appliedWidth()).toBe('360px'); // the cancelled frame changes nothing

    h.divider.dispatchEvent(pointer('lostpointercapture', { clientX: 363 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 500 }));
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.appliedWidth()).toBe('360px');
  });

  it('pointercancel ends the drag with one commit and a later pointerup is ignored', () => {
    const h = harness();
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 213 }));
    h.divider.dispatchEvent(pointer('pointercancel', { clientX: 213 }));
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledWith(210);
    expect(h.root.classList.contains(RESIZING_CLASS)).toBe(false);
    h.divider.dispatchEvent(pointer('lostpointercapture', { clientX: 213 }));
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 213 }));
    expect(h.onCommit).toHaveBeenCalledTimes(1);
  });

  it('lostpointercapture alone ends the drag without a second commit afterwards', () => {
    const h = harness();
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 293 }));
    h.divider.dispatchEvent(pointer('lostpointercapture', { clientX: 293 }));
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledWith(290);
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 293 }));
    h.divider.dispatchEvent(pointer('pointercancel', { clientX: 293 }));
    expect(h.onCommit).toHaveBeenCalledTimes(1);
  });

  it('clamps the width to the pane and view minimums while dragging', () => {
    const h = harness(260, 1000);
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: -400 }));
    h.flushFrames();
    expect(h.appliedWidth()).toBe(`${PANE_MIN}px`);
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 2000 }));
    h.flushFrames();
    expect(h.appliedWidth()).toBe(`${1000 - VIEW_MIN - DIVIDER_W}px`);
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 2000 }));
    expect(h.onCommit).toHaveBeenCalledWith(1000 - VIEW_MIN - DIVIDER_W);
  });

  it('stops at what a shown AI panel and the view leave; the hidden panel does not count (feature 005)', () => {
    // A 1000 px main area with the panel shown at 360 px: far right stops the pane where the
    // panel keeps its 360 px and the view its 320 - the panel is never squeezed under 280.
    const treeMax = 1000 - (360 + DIVIDER_W) - DIVIDER_W - VIEW_MIN;
    const h = harness(260, 1000, { panelWidth: 360, panelVisible: true });
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 2000 }));
    h.flushFrames();
    expect(h.appliedWidth()).toBe(`${treeMax}px`);
    expect(treeMax + DIVIDER_W + VIEW_MIN + DIVIDER_W + 360).toBe(1000);
    h.divider.dispatchEvent(pointer('pointermove', { clientX: -400 })); // the pane minimum as ever
    h.flushFrames();
    expect(h.appliedWidth()).toBe(`${PANE_MIN}px`);
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 2000 }));
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 2000 }));
    expect(h.onCommit).toHaveBeenCalledTimes(1);
    expect(h.onCommit).toHaveBeenCalledWith(treeMax);
    expect(h.main.style.getPropertyValue(AI_PANEL_WIDTH_VARIABLE)).toBe(''); // the panel's variable untouched
    h.detach();

    // The same panel width hidden: the pane may take everything but the view's minimum.
    const hidden = harness(260, 1000, { panelWidth: 360, panelVisible: false });
    hidden.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    hidden.divider.dispatchEvent(pointer('pointermove', { clientX: 2000 }));
    hidden.divider.dispatchEvent(pointer('pointerup', { clientX: 2000 }));
    expect(hidden.onCommit).toHaveBeenCalledWith(1000 - VIEW_MIN - DIVIDER_W);
  });

  it('ignores a secondary button, another pointer and a click without a move', () => {
    const h = harness();
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263, button: 2 }));
    expect(h.setPointerCapture).not.toHaveBeenCalled();
    expect(h.root.classList.contains(RESIZING_CLASS)).toBe(false);
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 400 }));
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    // A second pointer (another mouse button pressed, a touch) neither moves nor ends the drag.
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 400, pointerId: 2 }));
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 400, pointerId: 2 }));
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(h.onCommit).not.toHaveBeenCalled();
    // Released where it was pressed: the stored width is not rewritten by the rendered one.
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 263 }));
    expect(h.onCommit).not.toHaveBeenCalled();
    expect(h.root.classList.contains(RESIZING_CLASS)).toBe(false);
  });

  it('detaches: no drag starts afterwards and a running one is dropped', () => {
    const h = harness();
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    h.divider.dispatchEvent(pointer('pointermove', { clientX: 300 }));
    h.detach();
    expect(h.root.classList.contains(RESIZING_CLASS)).toBe(false);
    h.flushFrames();
    expect(h.appliedWidth()).toBe('');
    h.divider.dispatchEvent(pointer('pointerup', { clientX: 300 }));
    expect(h.onCommit).not.toHaveBeenCalled();
    h.divider.dispatchEvent(pointer('pointerdown', { clientX: 263 }));
    expect(h.setPointerCapture).toHaveBeenCalledTimes(1);
  });

  describe('right-hand side: the AI assistant panel (feature 005 data-model §3.2)', () => {
    it('mirrors the formulas: the start width is measured from the right edge, a move left widens', () => {
      // A 1400 px main area, the panel 360 px wide: its divider spans 1034..1040.
      const h = harness(360, 1400, { side: 'right', treeWidth: 260, treeVisible: true });
      h.divider.dispatchEvent(pointer('pointerdown', { clientX: 1037 }));
      expect(h.setPointerCapture).toHaveBeenCalledWith(1);
      expect(h.root.classList.contains(RESIZING_CLASS)).toBe(true);
      h.divider.dispatchEvent(pointer('pointermove', { clientX: 1000 }));
      h.divider.dispatchEvent(pointer('pointermove', { clientX: 977 }));
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
      h.flushFrames();
      expect(h.appliedWidth()).toBe('420px'); // 360 + (1037 - 977)
      expect(h.main.style.getPropertyValue(TREE_WIDTH_VARIABLE)).toBe(''); // the tree's variable untouched
      h.divider.dispatchEvent(pointer('pointermove', { clientX: 1097 }));
      h.divider.dispatchEvent(pointer('pointerup', { clientX: 1097 }));
      expect(h.appliedWidth()).toBe('300px'); // a move to the right narrows the panel
      expect(h.onCommit).toHaveBeenCalledTimes(1);
      expect(h.onCommit).toHaveBeenCalledWith(300);
      expect(h.root.classList.contains(RESIZING_CLASS)).toBe(false);
    });

    it('clamps to 280..800 and to what the tree pane and the view leave while dragging', () => {
      const h = harness(360, 1400, { side: 'right', treeWidth: 260, treeVisible: true });
      h.divider.dispatchEvent(pointer('pointerdown', { clientX: 1037 }));
      h.divider.dispatchEvent(pointer('pointermove', { clientX: 1390 })); // far right
      h.flushFrames();
      expect(h.appliedWidth()).toBe(`${PANEL_MIN}px`);
      h.divider.dispatchEvent(pointer('pointermove', { clientX: -500 })); // far left
      h.flushFrames();
      // 1400 - (260 + 6) - 6 - 320 = 808 > 800: the cap is PANEL_MAX.
      expect(h.appliedWidth()).toBe(`${PANEL_MAX}px`);
      h.divider.dispatchEvent(pointer('pointerup', { clientX: -500 }));
      expect(h.onCommit).toHaveBeenCalledWith(PANEL_MAX);
      h.detach();

      // A narrower main area: the tree pane and the view's minimum cap the panel below 800.
      const narrow = harness(360, 1000, { side: 'right', treeWidth: 260, treeVisible: true });
      narrow.divider.dispatchEvent(pointer('pointerdown', { clientX: 637 }));
      narrow.divider.dispatchEvent(pointer('pointermove', { clientX: -500 }));
      narrow.flushFrames();
      expect(narrow.appliedWidth()).toBe(`${1000 - (260 + DIVIDER_W) - DIVIDER_W - VIEW_MIN}px`);
      narrow.divider.dispatchEvent(pointer('pointerup', { clientX: -500 }));
      expect(narrow.onCommit).toHaveBeenCalledWith(1000 - (260 + DIVIDER_W) - DIVIDER_W - VIEW_MIN);
    });

    it('a click without a move commits nothing: the stored width is never rewritten', () => {
      const h = harness(360, 1400, { side: 'right' });
      h.divider.dispatchEvent(pointer('pointerdown', { clientX: 1037 }));
      h.divider.dispatchEvent(pointer('pointerup', { clientX: 1037 }));
      expect(h.onCommit).not.toHaveBeenCalled();
      expect(h.appliedWidth()).toBe('');
    });
  });
});
