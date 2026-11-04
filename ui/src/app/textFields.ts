/**
 * Text fields - inputs that take text, text areas and editable rich text - and the edit actions
 * the right-click menus run on them (feature 002 FR-064).
 */

/** Input types that hold no editable text. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** The text field `target` belongs to, or null. */
export function textFieldOf(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) return NON_TEXT_INPUTS.has(target.type) ? null : target;
  if (target instanceof HTMLElement && target.isContentEditable) {
    return target.closest<HTMLElement>('[contenteditable="true"], [contenteditable=""]');
  }
  return null;
}

function isFormField(field: HTMLElement): field is HTMLInputElement | HTMLTextAreaElement {
  return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
}

/** True when part of the field's text is selected. */
export function hasSelectedText(field: HTMLElement): boolean {
  if (isFormField(field)) return (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0);
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && field.contains(selection.anchorNode);
}

/** True when the field's text can be changed. */
export function isWritable(field: HTMLElement): boolean {
  if (isFormField(field)) return !field.readOnly && !field.disabled;
  return field.isContentEditable;
}

/** Cuts or copies the field's selection through the field's own clipboard handling. */
export function cutOrCopy(field: HTMLElement, cut: boolean): void {
  field.focus();
  document.execCommand(cut ? 'cut' : 'copy');
}

/** The text field that had the focus last (followed by `followTextFieldFocus`). */
let lastField: WeakRef<HTMLElement> | null = null;

/**
 * Follows the focus into text fields, so that the Edit menu and the toolbar act on the field the
 * focus left for them, as the original's did. Returns the function that stops it.
 */
export function followTextFieldFocus(doc: Document = document): () => void {
  const onFocusIn = (event: FocusEvent) => {
    const field = textFieldOf(event.target);
    if (field) lastField = new WeakRef(field);
  };
  doc.addEventListener('focusin', onFocusIn);
  return () => doc.removeEventListener('focusin', onFocusIn);
}

/** The text field that had the focus last, while it is still in the page. */
export function lastFocusedTextField(): HTMLElement | null {
  const field = lastField?.deref() ?? null;
  return field?.isConnected ? field : null;
}

/** The clipboard's text; null when the clipboard cannot be read. */
export async function clipboardText(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

/**
 * Inserts `text` at the field's selection as Paste does with the clipboard's text: typed into
 * a form field; a paste of plain text for rich text, so its editor splits paragraphs as on
 * Ctrl+V (also Paste as plain text, feature 009).
 */
export function insertTextIntoField(field: HTMLElement, text: string): void {
  field.focus();
  if (isFormField(field)) {
    document.execCommand('insertText', false, text);
  } else {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    field.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }
}

/** Pastes the clipboard's text at the field's selection. */
export async function pasteIntoField(field: HTMLElement): Promise<void> {
  field.focus();
  const text = await clipboardText();
  if (text === null) {
    document.execCommand('paste');
  } else {
    insertTextIntoField(field, text);
  }
}
