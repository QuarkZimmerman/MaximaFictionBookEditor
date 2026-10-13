/** Button sets of the message box and their Escape/close-box behaviour. */

import type { MessageButtonId, MessageButtonSet } from './types';

export interface ButtonSetSpec {
  buttons: MessageButtonId[];
  /** Button for Escape / close box; undefined = Escape ignored (as in the Windows message box). */
  cancel?: MessageButtonId;
}

export const BUTTON_SETS: Record<MessageButtonSet, ButtonSetSpec> = {
  ok: { buttons: ['ok'], cancel: 'ok' },
  okCancel: { buttons: ['ok', 'cancel'], cancel: 'cancel' },
  yesNo: { buttons: ['yes', 'no'] },
  yesNoCancel: { buttons: ['yes', 'no', 'cancel'], cancel: 'cancel' },
  abortRetryIgnore: { buttons: ['abort', 'retry', 'ignore'] },
  close: { buttons: ['close'], cancel: 'close' },
};
