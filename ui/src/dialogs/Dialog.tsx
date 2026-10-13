/**
 * Dialog framework components: `DialogHost` renders the modal stack of a `DialogService`
 * (DialogService.ts); `Dialog` is the frame with focus trap, Escape/Enter handling, Tab
 * cycling, `&` button accelerators and stable testids. No user-visible literals here.
 */

import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { parseAccelerator } from '@/i18n';

import { useDialogStack, type DialogService } from './DialogService';

import './dialogs.css';

/** Mounts every open dialog; only the top-most one is interactive (the others are `inert`). */
export function DialogHost({ service }: { service: DialogService }) {
  const stack = useDialogStack(service);
  if (stack.length === 0) return null;
  return (
    <div className="mfbe-dialog-layer" data-testid="dialog-layer">
      {stack.map((dialog, index) => (
        <div
          key={dialog.id}
          className="mfbe-dialog-backdrop"
          inert={index < stack.length - 1 ? true : undefined}
          data-testid={`dialog-backdrop-${index}`}
        >
          {dialog.render((result) => service.close(dialog.id, result))}
        </div>
      ))}
    </div>
  );
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
}: DialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const previouslyFocused = useRef<Element | null>(null);

  const defaultButton = buttons.find((b) => b.id === defaultButtonId) ?? buttons[0];
  const cancelButton = cancelButtonId ? buttons.find((b) => b.id === cancelButtonId) : undefined;

  // Initial focus, focus guard while open, focus restoration on close.
  useLayoutEffect(() => {
    previouslyFocused.current = document.activeElement;
    const root = rootRef.current;
    if (!root) return;
    let target: HTMLElement | null = null;
    if (initialFocus) target = root.querySelector<HTMLElement>(initialFocus);
    if (!target && defaultButton) {
      target = root.querySelector<HTMLElement>(`[data-button-id="${defaultButton.id}"]`);
    }
    if (!target) target = focusableElements(root)[0] ?? null;
    (target ?? root).focus();

    // Keep focus inside the top-most dialog (clicks outside land on the backdrop). Dialogs
    // covered by another one are `inert` and must not compete for the focus.
    const onFocusIn = (event: FocusEvent) => {
      if (!root.isConnected || root.closest('[inert]')) return;
      if (root.contains(event.target as Node)) return;
      const first = focusableElements(root)[0];
      (first ?? root).focus();
    };
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      const previous = previouslyFocused.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
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

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`mfbe-dialog${className ? ` ${className}` : ''}`}
      data-testid={testId}
      onKeyDown={onKeyDown}
    >
      <div className="mfbe-dialog-title" id={titleId} data-testid={`${testId}-title`}>
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
