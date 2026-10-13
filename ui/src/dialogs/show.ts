/**
 * Imperative entry points: open the standard dialogs on a `DialogService` from non-React code
 * (commands, features) and get the result as a Promise.
 */

import { createElement } from 'react';

import type { DialogService } from './DialogService';
import { EncodingDialog } from './EncodingDialog';
import { InputDialog } from './InputDialog';
import { MessageBox } from './MessageBox';
import { SaveChangesPrompt, type SaveChangesAnswer } from './SaveChangesPrompt';
import type {
  Dialogs,
  InputDialogOptions,
  InputDialogResult,
  MessageBoxOptions,
  MessageBoxResult,
  MessageButtonId,
} from './types';

/** Opens a message box; resolves with the pressed button and the "Don't ask again" state. */
export function showMessageWithResult(
  service: DialogService,
  options: MessageBoxOptions,
): Promise<MessageBoxResult> {
  return service.open<MessageBoxResult>((close) =>
    createElement(MessageBox, { options, onClose: close }),
  );
}

/** Opens a message box; resolves with the id of the pressed button. */
export async function showMessage(
  service: DialogService,
  options: MessageBoxOptions,
): Promise<MessageButtonId> {
  const result = await showMessageWithResult(service, options);
  return result.button;
}

/** Opens the input dialog; resolves with the button and the entered value. */
export function showInput(
  service: DialogService,
  options: InputDialogOptions,
): Promise<InputDialogResult> {
  return service.open<InputDialogResult>((close) =>
    createElement(InputDialog, { options, onClose: close }),
  );
}

/** "Save changes to <name>?" with Yes / No / Cancel (SaveChangesPrompt.tsx). */
export function showSaveChangesPrompt(dialogs: Dialogs, name: string): Promise<SaveChangesAnswer> {
  return dialogs.openCustom<SaveChangesAnswer>((close) =>
    createElement(SaveChangesPrompt, { name, onClose: close }),
  );
}

/** Encoding chooser of Save As (EncodingDialog.tsx); resolves with the encoding or null. */
export function showEncodingDialog(
  dialogs: Dialogs,
  options: { defaultEncoding: string; path?: string },
): Promise<string | null> {
  return dialogs.openCustom<string | null>((close) =>
    createElement(EncodingDialog, { ...options, onClose: close }),
  );
}

/** Binds the standard dialogs to a service (`Dialogs` is what commands depend on). */
export function createDialogs(service: DialogService): Dialogs & { service: DialogService } {
  return {
    service,
    showMessage: (options) => showMessage(service, options),
    showMessageWithResult: (options) => showMessageWithResult(service, options),
    showInput: (options) => showInput(service, options),
    openCustom: (render) => service.open(render),
  };
}
