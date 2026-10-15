/**
 * Imperative entry points of the script dialogs (non-React modules call these): open the
 * form, the message box with script-defined buttons and the input prompt on the application's
 * modal dialog stack and get the result as a Promise. With `runEnd` a dialog still open when
 * its run ends closes itself (with the result of Cancel).
 */

import { createElement } from 'react';

import type { Dialogs, InputDialogOptions, InputDialogResult } from '@/dialogs/types';

import {
  ScriptFormDialog,
  ScriptMessageDialog,
  ScriptPromptDialog,
  type ScriptMessageOptions,
} from './forms';
import type { FormSpec, FormValues, RunEnd } from './types';

/** Opens the form; resolves with the values or null when cancelled. */
export function showScriptForm(
  dialogs: Dialogs,
  spec: FormSpec,
  runEnd?: RunEnd,
): Promise<FormValues | null> {
  return dialogs.openCustom<FormValues | null>((close) =>
    createElement(ScriptFormDialog, { spec, onClose: close, runEnd }),
  );
}

/** Opens the message box; resolves with the id of the pressed button. */
export function showScriptMessage(
  dialogs: Dialogs,
  options: ScriptMessageOptions,
  runEnd?: RunEnd,
): Promise<string> {
  return dialogs.openCustom<string>((close) =>
    createElement(ScriptMessageDialog, { options, onClose: close, runEnd }),
  );
}

/** Opens the input prompt; resolves with the button and the entered value. */
export function showScriptPrompt(
  dialogs: Dialogs,
  options: InputDialogOptions,
  runEnd?: RunEnd,
): Promise<InputDialogResult> {
  return dialogs.openCustom<InputDialogResult>((close) =>
    createElement(ScriptPromptDialog, { options, onClose: close, runEnd }),
  );
}
