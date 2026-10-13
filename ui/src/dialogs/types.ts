/**
 * Option/result types of the standard dialogs, kept free of React so that non-UI modules
 * (commands, features) can depend on them without importing components.
 */

import type { ReactNode } from 'react';

import type { MessageButtonId, MessageButtonSet } from '@/rpc/types';

export type { MessageButtonId, MessageButtonSet } from '@/rpc/types';

export type MessageIcon = 'none' | 'info' | 'warning' | 'error' | 'question';

export interface MessageBoxOptions {
  text: string;
  /** Defaults to the application name. */
  caption?: string;
  /** Defaults to `ok`. */
  buttons?: MessageButtonSet;
  icon?: MessageIcon;
  /** Button focused initially and triggered by Enter; defaults to the first button. */
  defaultButton?: MessageButtonId;
  /** Optional "Don't ask again" checkbox; its state is returned in `MessageBoxResult`. */
  dontAskAgain?: boolean;
  testId?: string;
}

export interface MessageBoxResult {
  button: MessageButtonId;
  dontAskAgain: boolean;
}

export type InputDialogButtons = 'okCancel' | 'yesNoCancel';

export interface InputDialogOptions {
  /** Prompt shown above the input ("Text:" by default, as in the original IDD_INPUTBOX). */
  prompt?: string;
  /** Defaults to "Input". */
  caption?: string;
  defaultValue?: string;
  /** `yesNoCancel` reproduces the original InputBox; `okCancel` is the plain variant. */
  buttons?: InputDialogButtons;
  placeholder?: string;
  /** Returns a validation message to block confirmation, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
  testId?: string;
}

export interface InputDialogResult {
  /** `cancel` when dismissed with Cancel, Escape or the close button. */
  button: 'ok' | 'yes' | 'no' | 'cancel';
  value: string;
}

/** The dialog capabilities commands and features rely on. Implemented by `DialogService`. */
export interface Dialogs {
  showMessage(options: MessageBoxOptions): Promise<MessageButtonId>;
  showMessageWithResult(options: MessageBoxOptions): Promise<MessageBoxResult>;
  showInput(options: InputDialogOptions): Promise<InputDialogResult>;
  /**
   * Opens any modal dialog component; `close(result)` resolves the promise. Used by feature
   * dialogs (Save changes?, Encoding chooser, ...) that have their own component.
   */
  openCustom<T>(render: (close: (result: T) => void) => ReactNode): Promise<T>;
}
