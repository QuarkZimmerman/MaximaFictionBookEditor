/**
 * Dialog framework components: `DialogHost` renders the dialog stack of a `DialogService`
 * (DialogService.ts); `Dialog` is the frame with focus trap, Escape/Enter handling, Tab
 * cycling, `&` button accelerators and stable testids. A `modeless` dialog (the original's
 * Find and Replace) has no backdrop and no focus trap, moves by its title and opens where the
 * last modeless dialog was closed. No user-visible literals here.
 */

import {
  Fragment,
  useCallback,
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
/* Modeless placement                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Where the last modeless dialog was closed: the next one opens there for the rest of the
 * session (the original kept one place for all its modeless dialogs).
 */
let modelessPlace: { left: number; top: number } | null = null;

/** Moves a modeless dialog to `left`/`top`, kept inside the window. */
function moveModeless(root: HTMLElement, left: number, top: number): void {
  const { width, height } = root.getBoundingClientRect();
  const x = Math.max(0, Math.min(left, window.innerWidth - width));
  const y = Math.max(0, Math.min(top, window.innerHeight - height));
  root.style.left = `${Math.round(x)}px`;
  root.style.top = `${Math.round(y)}px`;
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

/* ------------------------------------------------------------------------ */
/* Dialog frame                                                             */
/* ------------------------------------------------------------------------ */

export interface DialogButton {
  id: string;
  /** Label, may contain an `&` accelerator marker. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface DialogProps {
  title: string;
  children?: ReactNode;
  buttons: DialogButton[];
  /** Button triggered by Enter (and focused initially unless `initialFocus` says otherwise). */
  defaultButtonId?: string;
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
  /** The window stays usable: no focus trap, moved by its title (open it modeless too). */
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

  const defaultButton = buttons.find((b) => b.id === defaultButtonId) ?? buttons[0];
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

  // A modeless dialog is dragged by its title (the close box excepted).
  const onTitlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      if (!modeless || !root || event.button !== 0) return;
      if ((event.target as HTMLElement).closest('.mfbe-dialog-close')) return;
      event.preventDefault();
      const start = root.getBoundingClientRect();
      const offsetX = event.clientX - start.left;
      const offsetY = event.clientY - start.top;
      const title = event.currentTarget;
      title.setPointerCapture(event.pointerId);
      const onMove = (move: PointerEvent) => {
        moveModeless(root, move.clientX - offsetX, move.clientY - offsetY);
      };
      const onEnd = () => {
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
        onPointerDown={modeless ? onTitlePointerDown : undefined}
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
