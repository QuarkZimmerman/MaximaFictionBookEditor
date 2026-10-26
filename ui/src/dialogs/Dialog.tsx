/**
 * Dialog framework components: `DialogHost` renders the dialog stack of a `DialogService`
 * (DialogService.ts); `Dialog` is the frame with focus trap, Escape/Enter handling, Tab
 * cycling, `&` button accelerators and stable testids. Every dialog moves by its title bar
 * (mouse, pen and touch through Pointer Events; feature 005 FR-107) and keeps the place while
 * it is open, inside the window. A `modeless` dialog (the original's Find and Replace) has no
 * backdrop and no focus trap and opens where the last modeless dialog was closed. No
 * user-visible literals here.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { parseAccelerator } from '@/i18n';

import { useDialogStack, type DialogService } from './DialogService';

import './dialogs.css';

/**
 * Mounts every open dialog. Modal dialogs cover the window with a backdrop and only the
 * top-most one is interactive (the others are `inert`); modeless dialogs float above the
 * document and below the menus (a modal dialog's backdrop and focus guard cover them).
 */
export function DialogHost({ service }: { service: DialogService }) {
  const stack = useDialogStack(service);
  if (stack.length === 0) return null;
  const modeless = stack.filter((dialog) => dialog.modeless);
  const modal = stack.filter((dialog) => !dialog.modeless);
  return (
    <>
      {modeless.length > 0 ? (
        <div className="mfbe-dialog-floating-layer" data-testid="dialog-floating-layer">
          {modeless.map((dialog) => (
            <Fragment key={dialog.id}>
              {dialog.render((result) => service.close(dialog.id, result))}
            </Fragment>
          ))}
        </div>
      ) : null}
      {modal.length > 0 ? (
        <div className="mfbe-dialog-layer" data-testid="dialog-layer">
          {modal.map((dialog, index) => (
            <div
              key={dialog.id}
              className="mfbe-dialog-backdrop"
              inert={index < modal.length - 1 ? true : undefined}
              data-testid={`dialog-backdrop-${index}`}
            >
              {dialog.render((result) => service.close(dialog.id, result))}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* Placement                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Where the last modeless dialog was closed: the next one opens there for the rest of the
 * session (the original kept one place for all its modeless dialogs).
 */
let modelessPlace: { left: number; top: number } | null = null;

/**
 * The viewport position nearest to `left`/`top` at which a dialog of `width` x `height` is
 * inside the window; a dialog bigger than the window keeps its title bar at the window's
 * top-left corner, so it stays reachable.
 */
function clampToWindow(
  left: number,
  top: number,
  width: number,
  height: number,
): { left: number; top: number } {
  return {
    left: Math.round(Math.max(0, Math.min(left, window.innerWidth - width))),
    top: Math.round(Math.max(0, Math.min(top, window.innerHeight - height))),
  };
}

/**
 * Puts a dialog at the viewport position `left`/`top`, kept inside the window. A modeless
 * dialog is placed absolutely in the floating layer; a modal one is centred by its backdrop
 * and shifted from there by a relative offset (so a resize of the window re-centres it and
 * the layout of its content is untouched). Both are inline styles on the dialog's root, which
 * go with the root when the dialog closes: a dialog opens at its default place again.
 */
function placeAt(root: HTMLElement, modeless: boolean, left: number, top: number): void {
  const box = root.getBoundingClientRect();
  const target = clampToWindow(left, top, box.width, box.height);
  if (modeless) {
    root.style.left = `${target.left}px`;
    root.style.top = `${target.top}px`;
    return;
  }
  // `box` includes the current offset: the centred place is the box without it.
  const dx = parseFloat(root.style.left) || 0;
  const dy = parseFloat(root.style.top) || 0;
  root.style.left = `${target.left - (box.left - dx)}px`;
  root.style.top = `${target.top - (box.top - dy)}px`;
}

/** Moves a modeless dialog to `left`/`top`, kept inside the window. */
function moveModeless(root: HTMLElement, left: number, top: number): void {
  placeAt(root, true, left, top);
}

/** First placement: the remembered place, or centred in the window like a modal dialog. */
function placeModeless(root: HTMLElement): void {
  const { width, height } = root.getBoundingClientRect();
  if (modelessPlace) {
    moveModeless(root, modelessPlace.left, modelessPlace.top);
  } else {
    moveModeless(root, (window.innerWidth - width) / 2, (window.innerHeight - height) / 2);
  }
}

/** Elements inside the title bar that take the pointer for themselves (the close box). */
const TITLE_CONTROLS = 'button, a, input, select, textarea';

/* ------------------------------------------------------------------------ */
/* Dialog frame                                                             */
/* ------------------------------------------------------------------------ */

export interface DialogButton {
  id: string;
  /** Label, may contain an `&` accelerator marker. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** The button's tooltip, e.g. why it is disabled (feature 006 US8, the mark's popover; I17). */
  title?: string;
}

export interface DialogProps {
  title: string;
  children?: ReactNode;
  buttons: DialogButton[];
  /**
   * Button triggered by Enter (and focused initially unless `initialFocus` says otherwise);
   * the first button when absent, **none** when `null` (Enter then does nothing - the AI
   * script proposal with warnings, feature 005 FR-084).
   */
  defaultButtonId?: string | null;
  /** Button triggered by Escape and the close box; when absent Escape is ignored. */
  cancelButtonId?: string;
  /** CSS selector of the element to focus initially (e.g. the text input). */
  initialFocus?: string;
  testId?: string;
  className?: string;
  /** Optional element placed left of the content (message-box icon). */
  icon?: ReactNode;
  /** Label of the close box (localised by the caller). */
  closeLabel?: string;
  /** The window stays usable: no focus trap, no backdrop (open it modeless too). */
  modeless?: boolean;
  /**
   * Modeless only: opens at this viewport position (kept inside the window) instead of the
   * remembered place, and does not become the remembered place when it closes - a dialog
   * anchored at the selection (the AI assistant's popup, feature 005 FR-030).
   */
  position?: { left: number; top: number };
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
]
  .map((selector) => `${selector}:not([tabindex="-1"]):not([hidden])`)
  .join(', ');

/**
 * Keyboard-reachable controls of `root` in DOM order: the FOCUSABLE candidates that are
 * actually rendered (not inside a hidden tab panel or a `display: none` block), so Tab
 * wrap-around and the initial focus never land on an element `focus()` would ignore (T153).
 */
function focusableElements(root: HTMLElement): HTMLElement[] {
  // Without layout (jsdom) no element has client rects: fall back to the `hidden` check only.
  const laidOut = root.getClientRects().length > 0;
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.closest('[hidden]') === null && (!laidOut || element.getClientRects().length > 0),
  );
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset'].includes(target.type);
  }
  return target.isContentEditable;
}

export function Dialog({
  title,
  children,
  buttons,
  defaultButtonId,
  cancelButtonId,
  initialFocus,
  testId = 'dialog',
  className,
  icon,
  closeLabel,
  modeless = false,
  position,
}: DialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previouslyFocused = useRef<Element | null>(null);

  const defaultButton =
    defaultButtonId === null
      ? undefined
      : (buttons.find((b) => b.id === defaultButtonId) ?? buttons[0]);
  const cancelButton = cancelButtonId ? buttons.find((b) => b.id === cancelButtonId) : undefined;

  // Initial focus (and place), focus guard while modal, focus restoration on close.
  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement;
    const root = rootRef.current;
    if (!root) return;
    if (modeless) {
      if (position) moveModeless(root, position.left, position.top);
      else placeModeless(root);
    }
    let target: HTMLElement | null = null;
    if (initialFocus) target = root.querySelector<HTMLElement>(initialFocus);
    if (!target && defaultButton) {
      target = root.querySelector<HTMLElement>(`[data-button-id="${defaultButton.id}"]`);
    }
    if (!target) target = focusableElements(root)[0] ?? null;
    (target ?? root).focus();

    // Keep focus inside the top-most modal dialog (clicks outside land on the backdrop).
    // Dialogs covered by another one are `inert` and must not compete for the focus.
    const onFocusIn = (event: FocusEvent) => {
      if (!root.isConnected || root.closest('[inert]')) return;
      if (root.contains(event.target as Node)) return;
      const first = focusableElements(root)[0];
      (first ?? root).focus();
    };
    if (!modeless) document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      const active = document.activeElement;
      if (modeless && !position) {
        const box = root.getBoundingClientRect();
        modelessPlace = { left: box.left, top: box.top };
      }
      // A modeless dialog gives the focus back only when it has it: the user may be working
      // in the document.
      const hadFocus = !active || active === document.body || root.contains(active);
      const previous = previouslyFocused.current;
      if ((!modeless || hadFocus) && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
    // Only on mount: the dialog content does not change its focus target afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root) return;

      if (event.key === 'Escape') {
        if (cancelButton && !cancelButton.disabled) {
          event.preventDefault();
          event.stopPropagation();
          cancelButton.onClick();
        }
        return;
      }

      if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const target = event.target as HTMLElement;
        if (target instanceof HTMLTextAreaElement) return; // newline
        if (target instanceof HTMLButtonElement) return; // the button's own click
        if (defaultButton && !defaultButton.disabled) {
          event.preventDefault();
          event.stopPropagation();
          defaultButton.onClick();
        }
        return;
      }

      if (event.key === 'Tab') {
        const focusable = focusableElements(root);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === root)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
        event.stopPropagation();
        return;
      }

      // Button accelerators: Alt+letter anywhere, bare letter outside text fields.
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
        if (!event.altKey && isEditable(event.target)) return;
        const pressed = event.key.toLowerCase();
        const match = buttons.find((b) => !b.disabled && parseAccelerator(b.label).key === pressed);
        if (match) {
          event.preventDefault();
          event.stopPropagation();
          match.onClick();
        }
      }
    },
    [buttons, cancelButton, defaultButton],
  );

  // The dialog is dragged by its title bar with the primary button or a touch (the close box
  // and any other control in the bar excepted): the title captures the pointer, so the drag
  // goes on outside the bar and ends with the pointer wherever it is released. The place is
  // the root's inline style, kept for as long as the dialog is open. The keyboard is not
  // involved: Escape, Enter, Tab and the accelerators work as before.
  const onTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!root || event.button !== 0) return;
      if ((event.target as HTMLElement).closest(TITLE_CONTROLS)) return;
      event.preventDefault();
      const start = root.getBoundingClientRect();
      const offsetX = event.clientX - start.left;
      const offsetY = event.clientY - start.top;
      const title = event.currentTarget;
      const { pointerId } = event;
      title.setPointerCapture(pointerId);
      const onMove = (move: PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        placeAt(root, modeless, move.clientX - offsetX, move.clientY - offsetY);
      };
      const onEnd = (end: PointerEvent) => {
        if (end.pointerId !== pointerId) return;
        title.removeEventListener('pointermove', onMove);
        title.removeEventListener('pointerup', onEnd);
        title.removeEventListener('pointercancel', onEnd);
      };
      title.addEventListener('pointermove', onMove);
      title.addEventListener('pointerup', onEnd);
      title.addEventListener('pointercancel', onEnd);
    },
    [modeless],
  );

  // A smaller window must not leave a moved dialog outside: its place is clamped again on
  // every resize of the window (a modal dialog's default place follows the centre of the
  // window by itself) and, once moved, when the dialog itself grows (a longer message, another
  // Settings page).
  useEffect(() => {
    const reclamp = () => {
      const root = rootRef.current;
      if (!root) return;
      const box = root.getBoundingClientRect();
      placeAt(root, modeless, box.left, box.top);
    };
    window.addEventListener('resize', reclamp);
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', reclamp);
    }
    const observer = new ResizeObserver(() => {
      if (root.style.left || root.style.top) reclamp();
    });
    observer.observe(root);
    return () => {
      window.removeEventListener('resize', reclamp);
      observer.disconnect();
    };
  }, [modeless]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal={modeless ? 'false' : 'true'}
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`mfbe-dialog${modeless ? ' mfbe-dialog-modeless' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onKeyDown={onKeyDown}
    >
      <div
        className="mfbe-dialog-title"
        id={titleId}
        data-testid={`${testId}-title`}
        onPointerDown={onTitlePointerDown}
      >
        <span className="mfbe-dialog-title-text">{title}</span>
        {cancelButton ? (
          <button
            type="button"
            className="mfbe-dialog-close"
            aria-label={closeLabel ?? parseAccelerator(cancelButton.label).text}
            data-testid={`${testId}-close`}
            tabIndex={-1}
            onClick={cancelButton.onClick}
          >
            <span aria-hidden="true">{'\u00D7'}</span>
          </button>
        ) : null}
      </div>
      <div className="mfbe-dialog-body">
        {icon ? <div className="mfbe-dialog-icon">{icon}</div> : null}
        <div className="mfbe-dialog-content">{children}</div>
      </div>
      <div className="mfbe-dialog-buttons">
        {buttons.map((button) => (
          <AcceleratorButton
            key={button.id}
            button={button}
            isDefault={button.id === defaultButton?.id}
            testId={`${testId}-button-${button.id}`}
          />
        ))}
      </div>
    </div>
  );
}

function AcceleratorButton({
  button,
  isDefault,
  testId,
}: {
  button: DialogButton;
  isDefault: boolean;
  testId: string;
}) {
  const { text, index } = parseAccelerator(button.label);
  return (
    <button
      type="button"
      className={`mfbe-button${isDefault ? ' mfbe-button-default' : ''}`}
      data-button-id={button.id}
      data-testid={testId}
      disabled={button.disabled}
      title={button.title}
      onClick={button.onClick}
    >
      {index >= 0 ? (
        <>
          {text.slice(0, index)}
          <u>{text[index]}</u>
          {text.slice(index + 1)}
        </>
      ) : (
        text
      )}
    </button>
  );
}
