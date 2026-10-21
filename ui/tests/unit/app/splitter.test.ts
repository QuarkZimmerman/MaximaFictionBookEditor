/**
 * Divider between the Document Tree pane and the view area (feature 004 US1, FR-001 and
 * FR-002; research R1.1): the clamp of the applied width and the pointer-captured drag of
 * `app/splitter.ts` driven with fake pointer events - capture on `pointerdown`, one animation
 * frame per burst of moves, exactly one commit when the drag ends.
 */

import {
  DIVIDER_W,
  PANE_MIN,
  RESIZING_CLASS,
  TREE_WIDTH_VARIABLE,
  VIEW_MIN,
  attachSplitterDrag,
  clampTreeWidth,
} from '@/app/splitter';

describe('clampTreeWidth', () => {
  it('keeps the pane at its minimum and leaves the view its own', () => {
    const max = 1000 - VIEW_MIN - DIVIDER_W;
    expect(clampTreeWidth(260, 1000)).toBe(260);
    expect(clampTreeWidth(PANE_MIN, 1000)).toBe(PANE_MIN);
    expect(clampTreeWidth(PANE_MIN - 1, 1000)).toBe(PANE_MIN);
    expect(clampTreeWidth(0, 1000)).toBe(PANE_MIN);
    expect(clampTreeWidth(-50, 1000)).toBe(PANE_MIN);
    expect(clampTreeWidth(max, 1000)).toBe(max);
    expect(clampTreeWidth(max + 1, 1000)).toBe(max);
    expect(clampTreeWidth(5000, 1000)).toBe(max);
  });

  it('answers whole pixels: the setting is an integer', () => {
    expect(clampTreeWidth(300.4, 1000)).toBe(300);
    expect(clampTreeWidth(300.6, 1000)).toBe(301);
    expect(clampTreeWidth(500, 1000.7)).toBe(500);
  });

  it('lets the pane minimum win in a main area too narrow for both minimums', () => {
    // The stylesheet shrinks the pane under its minimum while the view keeps its own (FR-002).
    expect(clampTreeWidth(500, 400)).toBe(PANE_MIN);
    expect(clampTreeWidth(100, PANE_MIN + DIVIDER_W + VIEW_MIN)).toBe(PANE_MIN);
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

/** A main area `mainWidth` px wide whose divider starts `startWidth` px from its left edge. */
function harness(startWidth = 260, mainWidth = 1000): Harness {
  const main = document.createElement('div');
  const divider = document.createElement('div');
  main.append(divider);
  document.body.append(main);
  Object.defineProperty(main, 'clientWidth', { value: mainWidth, configurable: true });
  main.getBoundingClientRect = () => rect(0, mainWidth);
  divider.getBoundingClientRect = () => rect(startWidth, DIVIDER_W);
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
  const detach = attachSplitterDrag(divider, main, onCommit);
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
    appliedWidth: () => main.style.getPropertyValue(TREE_WIDTH_VARIABLE),
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
});
