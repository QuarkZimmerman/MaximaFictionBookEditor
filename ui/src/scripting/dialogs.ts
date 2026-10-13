/**
 * Imperative entry points of the script dialogs (non-React modules call these): open the
 * form, the message box with script-defined buttons and the host's "still running" prompt on
 * the application's modal dialog stack and get the result as a Promise.
 */

import { createElement } from 'react';

import type { Dialogs } from '@/dialogs/types';

import {
  ScriptFormDialog,
  ScriptMessageDialog,
  ScriptRunningPrompt,
  type RunningPromptProps,
  type ScriptMessageOptions,
} from './forms';
import type { FormSpec, FormValues } from './types';

/** Opens the form; resolves with the values or null when cancelled. */
export function showScriptForm(dialogs: Dialogs, spec: FormSpec): Promise<FormValues | null> {
  return dialogs.openCustom<FormValues | null>((close) =>
    createElement(ScriptFormDialog, { spec, onClose: close }),
  );
}

/** Opens the message box; resolves with the id of the pressed button. */
export function showScriptMessage(
  dialogs: Dialogs,
  options: ScriptMessageOptions,
): Promise<string> {
  return dialogs.openCustom<string>((close) =>
    createElement(ScriptMessageDialog, { options, onClose: close }),
  );
}

export function showRunningPrompt(
  dialogs: Dialogs,
  props: Omit<RunningPromptProps, 'onClose'>,
): Promise<'wait' | 'cancel' | 'ended'> {
  return dialogs.openCustom<'wait' | 'cancel' | 'ended'>((close) =>
    createElement(ScriptRunningPrompt, { ...props, onClose: close }),
  );
}
