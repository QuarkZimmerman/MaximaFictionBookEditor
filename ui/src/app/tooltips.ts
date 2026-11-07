/**
 * Feature 010, US4 (spec D11-D14, FR-040-FR-045): a control's tooltip. The same text is the
 * control's accessible description; spread it on the control and, where there is one, on its
 * label, so that resting the pointer on either shows it - greyed controls included. Buttons whose
 * label says everything (OK, Cancel, Close, Yes, No, Apply) and the fields of dialogs that scripts
 * build carry `data-no-tooltip` instead (D14).
 */

export interface TooltipProps {
  title?: string;
  'aria-description'?: string;
}

/** `{ title, aria-description }` for `text`; nothing for an empty text. */
export function tip(text: string | null | undefined): TooltipProps {
  return text ? { title: text, 'aria-description': text } : {};
}

/** A tooltip and, for a greyed control, when it becomes available (D11). */
export function tipWhen(text: string, disabled: boolean, whenAvailable?: string): TooltipProps {
  return tip(disabled && whenAvailable ? `${text} ${whenAvailable}` : text);
}
