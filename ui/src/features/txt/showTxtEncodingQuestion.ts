/** Feature 017 (D26): opens the TXT import's encoding question (TxtEncodingQuestion.tsx). */
import { createElement } from 'react';

import type { Dialogs } from '@/dialogs/types';

import { TxtEncodingQuestion, type TxtEncodingQuestionProps } from './TxtEncodingQuestion';

/** Resolves with the encoding chosen, or null for *Cancel*. */
export function showTxtEncodingQuestion(
  dialogs: Dialogs,
  options: Omit<TxtEncodingQuestionProps, 'onClose'>,
): Promise<string | null> {
  return dialogs.openCustom<string | null>((close) =>
    createElement(TxtEncodingQuestion, { ...options, onClose: close }),
  );
}
