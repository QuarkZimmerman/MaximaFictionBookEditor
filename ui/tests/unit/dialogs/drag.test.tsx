/**
 * Movable dialogs (feature 005, FR-107, T102): every dialog - modal or modeless - is dragged
 * by its title bar with Pointer Events, keeps the place while it is open, stays inside the
 * window (also when the window shrinks) and opens at its default place again the next time.
 * jsdom has no layout: the dialog's box is simulated from its inline `left`/`top` (a modal
 * dialog is centred by its backdrop and shifted by a relative offset, a modeless one is placed
 * absolutely), and pointer capture is stubbed.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';

import { Dialog, DialogHost, DialogService, createDialogs } from '@/dialogs';
import { initI18n } from '@/i18n';

/** The window of the simulated layout. */
const WINDOW = { width: 1000, height: 700 };

/** The dialog's size and, for a modal dialog, the place its backdrop centres it at. */
const BOX = { width: 400, height: 300 };
const CENTRED = {
  left: (WINDOW.width - BOX.width) / 2, // 300
  top: (WINDOW.height - BOX.height) / 2, // 200
};

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

const realGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  // jsdom 30 dispatches PointerEvents but implements no pointer capture.
  const proto = Element.prototype as Element & {
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    hasPointerCapture?: (id: number) => boolean;
  };
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.hasPointerCapture ??= () => false;

  // The simulated layout: a dialog root's box follows its inline styles.
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.classList.contains('mfbe-dialog')) {
      const left = parseFloat(this.style.left) || 0;
      const top = parseFloat(this.style.top) || 0;
      if (this.classList.contains('mfbe-dialog-modeless')) {
        return rect(left, top, BOX.width, BOX.height);
      }
      return rect(CENTRED.left + left, CENTRED.top + top, BOX.width, BOX.height);
    }
    if (this.classList.contains('mfbe-dialog-title')) {
      const root = this.parentElement!.getBoundingClientRect();
      return rect(root.left, root.top, root.width, 32);
    }
    return realGetBoundingClientRect.call(this);
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realGetBoundingClientRect;
});

beforeEach(() => {
  window.innerWidth = WINDOW.width;
  window.innerHeight = WINDOW.height;
});

async function setup() {
  const instance = createInstance();
  await initI18n({ instance, language: 'en' });
  const service = new DialogService();
  const dialogs = createDialogs(service);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  );
  render(<DialogHost service={service} />, { wrapper });
  return { service, dialogs, user: userEvent.setup() };
}

/** Opens a dialog from outside React and flushes the resulting render. */
async function open<T>(fn: () => Promise<T>): Promise<{ result: Promise<T> }> {
  let result!: Promise<T>;
  await act(async () => {
    result = fn();
  });
  return { result };
}

/** A modal message box with a close box; returns its root, title and the pending result. */
async function openMessage(dialogs: ReturnType<typeof createDialogs>, testId = 'box') {
  const { result } = await open(() =>
    dialogs.showMessage({ text: 'Where am I?', buttons: 'okCancel', testId }),
  );
  const root = screen.getByTestId(testId);
  const title = screen.getByTestId(`${testId}-title`);
  return { root, title, result };
}

/** The point 40 px into the title bar's grip, where every drag here starts. */
function grip(root: HTMLElement): { x: number; y: number } {
  const box = root.getBoundingClientRect();
  return { x: box.left + 40, y: box.top + 16 };
}

const POINTER = { pointerId: 7, pointerType: 'mouse', isPrimary: true };

/** Presses the primary button on the title at its grip. */
function pressTitle(root: HTMLElement, title: HTMLElement, extra: Record<string, unknown> = {}) {
  const at = grip(root);
  fireEvent.pointerDown(title, { ...POINTER, button: 0, clientX: at.x, clientY: at.y, ...extra });
  return at;
}

/** Moves the captured pointer to `x`/`y` (the drag goes on wherever the pointer is). */
function moveTo(title: HTMLElement, x: number, y: number) {
  fireEvent.pointerMove(title, { ...POINTER, clientX: x, clientY: y });
}

function release(title: HTMLElement, x: number, y: number) {
  fireEvent.pointerUp(title, { ...POINTER, button: 0, clientX: x, clientY: y });
}

/** Drags the dialog by its title bar by `dx`/`dy` in one movement and releases. */
function drag(root: HTMLElement, title: HTMLElement, dx: number, dy: number) {
  const from = pressTitle(root, title);
  moveTo(title, from.x + dx, from.y + dy);
  release(title, from.x + dx, from.y + dy);
}

const place = (root: HTMLElement) => {
  const box = root.getBoundingClientRect();
  return { left: box.left, top: box.top };
};

describe('movable dialogs (feature 005, FR-107)', () => {
  it('a modal dialog follows the pointer that drags its title bar and keeps the place after the release', async () => {
    const { dialogs } = await setup();
    const { root, title } = await openMessage(dialogs);
    expect(place(root)).toEqual(CENTRED);

    const from = pressTitle(root, title);
    moveTo(title, from.x + 150, from.y + 80);
    expect(root.style.left).toBe('150px');
    expect(root.style.top).toBe('80px');
    expect(place(root)).toEqual({ left: CENTRED.left + 150, top: CENTRED.top + 80 });

    // The pointer wanders back a little before the release: the dialog follows.
    moveTo(title, from.x + 120, from.y + 50);
    expect(place(root)).toEqual({ left: CENTRED.left + 120, top: CENTRED.top + 50 });
    release(title, from.x + 120, from.y + 50);

    // Released: later movements of the pointer leave the dialog where it is.
    moveTo(title, from.x + 500, from.y + 500);
    expect(place(root)).toEqual({ left: CENTRED.left + 120, top: CENTRED.top + 50 });
    expect(root).toBeInTheDocument();
  });

  it('a drag that leaves the window is clamped: the whole dialog stays inside', async () => {
    const { dialogs } = await setup();
    const { root, title } = await openMessage(dialogs);

    drag(root, title, 5000, 5000);
    expect(place(root)).toEqual({
      left: WINDOW.width - BOX.width,
      top: WINDOW.height - BOX.height,
    });

    drag(root, title, -5000, -5000);
    expect(place(root)).toEqual({ left: 0, top: 0 });

    // Partly over the right edge: only the overshoot is taken back.
    drag(root, title, WINDOW.width - BOX.width + 25, 10);
    expect(place(root)).toEqual({ left: WINDOW.width - BOX.width, top: 10 });
  });

  it('no drag starts from the close box, from a secondary button or from a pointer the drag does not belong to', async () => {
    const { dialogs } = await setup();
    const { root, title } = await openMessage(dialogs);
    const close = screen.getByTestId('box-close');

    // The close box is a control of its own.
    const at = grip(root);
    fireEvent.pointerDown(close, { ...POINTER, button: 0, clientX: at.x, clientY: at.y });
    moveTo(title, at.x + 100, at.y + 100);
    release(title, at.x + 100, at.y + 100);
    expect(place(root)).toEqual(CENTRED);
    expect(root.style.left).toBe('');
    expect(root).toBeInTheDocument(); // not closed by the press either

    // The right (secondary) button does not move the dialog.
    pressTitle(root, title, { button: 2 });
    moveTo(title, at.x + 100, at.y + 100);
    fireEvent.pointerUp(title, { ...POINTER, button: 2, clientX: at.x + 100, clientY: at.y + 100 });
    expect(place(root)).toEqual(CENTRED);

    // A second pointer (another finger) moving during the drag does not steer it.
    const from = pressTitle(root, title);
    fireEvent.pointerMove(title, {
      pointerId: 8,
      pointerType: 'touch',
      clientX: from.x + 300,
      clientY: from.y + 300,
    });
    expect(place(root)).toEqual(CENTRED);
    moveTo(title, from.x + 30, from.y + 20);
    expect(place(root)).toEqual({ left: CENTRED.left + 30, top: CENTRED.top + 20 });
    release(title, from.x + 30, from.y + 20);
  });

  it('a touch drags the dialog too (pointer type touch, primary)', async () => {
    const { dialogs } = await setup();
    const { root, title } = await openMessage(dialogs);
    const at = grip(root);
    const touch = { pointerId: 12, pointerType: 'touch', isPrimary: true, button: 0 };
    fireEvent.pointerDown(title, { ...touch, clientX: at.x, clientY: at.y });
    fireEvent.pointerMove(title, { ...touch, clientX: at.x - 60, clientY: at.y + 40 });
    expect(place(root)).toEqual({ left: CENTRED.left - 60, top: CENTRED.top + 40 });
    fireEvent.pointerCancel(title, { ...touch, clientX: at.x - 60, clientY: at.y + 40 });
    // Cancelled by the system (a gesture took over): the dialog stays where it got to.
    fireEvent.pointerMove(title, { ...touch, clientX: at.x - 200, clientY: at.y + 200 });
    expect(place(root)).toEqual({ left: CENTRED.left - 60, top: CENTRED.top + 40 });
  });

  it('the keyboard works as before while the dialog is moved: Escape closes it, Tab stays inside', async () => {
    const { dialogs, user } = await setup();
    const { root, title, result } = await openMessage(dialogs);
    drag(root, title, 100, 100);
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root).toHaveAttribute('aria-modal', 'true');
    expect(title).toHaveAttribute('data-testid', 'box-title');
    expect(root).toHaveAttribute('aria-labelledby', title.id);

    expect(screen.getByTestId('box-button-ok')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('box-button-cancel')).toHaveFocus();
    await user.tab();
    expect(screen.getByTestId('box-button-ok')).toHaveFocus();
    await user.keyboard('{Escape}');
    await expect(result).resolves.toBe('cancel');
  });

  it('a smaller window brings a moved dialog back inside', async () => {
    const { dialogs } = await setup();
    const { root, title } = await openMessage(dialogs);
    drag(root, title, 5000, 5000);
    expect(place(root)).toEqual({
      left: WINDOW.width - BOX.width,
      top: WINDOW.height - BOX.height,
    });

    window.innerWidth = 800;
    window.innerHeight = 560;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(place(root)).toEqual({ left: 800 - BOX.width, top: 560 - BOX.height });

    // A dialog that is inside already stays where it is.
    window.innerWidth = 1200;
    window.innerHeight = 900;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(place(root)).toEqual({ left: 800 - BOX.width, top: 560 - BOX.height });
  });

  it('the moved place is not remembered: the dialog opens at its default place again', async () => {
    const { dialogs, user } = await setup();
    const first = await openMessage(dialogs);
    drag(first.root, first.title, 120, -80);
    expect(place(first.root)).toEqual({ left: CENTRED.left + 120, top: CENTRED.top - 80 });
    await user.click(screen.getByTestId('box-button-ok'));
    await expect(first.result).resolves.toBe('ok');

    const second = await openMessage(dialogs);
    expect(second.root.style.left).toBe('');
    expect(second.root.style.top).toBe('');
    expect(place(second.root)).toEqual(CENTRED);
  });

  it('only the top-most of stacked modal dialogs moves; the one below is inert', async () => {
    const { dialogs } = await setup();
    const lower = await openMessage(dialogs, 'lower');
    const upper = await openMessage(dialogs, 'upper');
    expect(screen.getByTestId('dialog-backdrop-0')).toHaveAttribute('inert');
    drag(upper.root, upper.title, 50, 60);
    expect(place(upper.root)).toEqual({ left: CENTRED.left + 50, top: CENTRED.top + 60 });
    expect(lower.root.style.left).toBe('');
  });

  describe('modeless dialogs (Find, Replace)', () => {
    function Floating({ close }: { close: () => void }) {
      return (
        <Dialog
          title="Find"
          buttons={[{ id: 'cancel', label: 'Cancel', onClick: close }]}
          cancelButtonId="cancel"
          testId="floating"
          modeless
        >
          <input data-testid="floating-input" />
        </Dialog>
      );
    }

    it('are dragged to an absolute place, clamped, and the next one opens where the last was closed', async () => {
      const { dialogs, user } = await setup();
      const { result } = await open(() =>
        dialogs.openCustom<void>((close) => <Floating close={() => close()} />, {
          modeless: true,
        }),
      );
      const root = screen.getByTestId('floating');
      const title = screen.getByTestId('floating-title');
      // Opens centred like a modal dialog (no place remembered yet in this module).
      expect(place(root)).toEqual(CENTRED);

      drag(root, title, 100, 50);
      expect(root.style.left).toBe(`${CENTRED.left + 100}px`);
      expect(root.style.top).toBe(`${CENTRED.top + 50}px`);

      drag(root, title, 5000, -5000);
      expect(place(root)).toEqual({ left: WINDOW.width - BOX.width, top: 0 });

      // A smaller window keeps it inside.
      window.innerWidth = 700;
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
      expect(place(root)).toEqual({ left: 700 - BOX.width, top: 0 });

      await user.click(screen.getByTestId('floating-button-cancel'));
      await result;

      // The remembered place of the modeless dialogs is where this one was closed.
      window.innerWidth = WINDOW.width;
      await open(() =>
        dialogs.openCustom<void>((close) => <Floating close={() => close()} />, {
          modeless: true,
        }),
      );
      expect(place(screen.getByTestId('floating'))).toEqual({ left: 700 - BOX.width, top: 0 });
    });
  });
});
