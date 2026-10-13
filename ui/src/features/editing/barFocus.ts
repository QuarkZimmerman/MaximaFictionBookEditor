/**
 * Focus targets of the navigation hotkeys (`nav.selectId` -> Links bar ID field,
 * `nav.selectHref` -> Href field, `nav.selectTableId` -> Table bar ID field, `nav.selectText`
 * -> back to the editor): the bars register their fields here when mounted.
 */

export type BarField = 'id' | 'href' | 'tableId' | 'text';

const targets = new Map<BarField, () => boolean>();

/** Registers how to focus `field`; returns the unregister function. */
export function registerBarFocus(field: BarField, focus: () => boolean): () => void {
  targets.set(field, focus);
  return () => {
    if (targets.get(field) === focus) targets.delete(field);
  };
}

export function canFocusBarField(field: BarField): boolean {
  return targets.has(field);
}

export function focusBarField(field: BarField): boolean {
  return targets.get(field)?.() ?? false;
}
