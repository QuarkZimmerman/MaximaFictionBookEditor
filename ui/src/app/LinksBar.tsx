/**
 * Links bar (T062, FR-023): ID / Href / Section ID / Image title / Alt text of the current
 * element, bound two-way to the Body selection as in the original editor's links toolbar:
 *  - ID edits the innermost element that can carry an `id` (paragraph, section, poem, cite...);
 *  - Href edits the link at the caret or the selected image's reference (a target without `#`
 *    or a scheme gets `http://`);
 *  - Section ID edits the enclosing section; Image title the selected block image;
 *  - Alt text edits the `alt` of the selected picture, inline or block, in a table cell or
 *    anywhere else; an empty value removes it (feature 006, FR-029; an addition beyond the
 *    original's bar).
 * Fields are disabled when the selection offers no such element and while a script runs; the
 * bar works in the Body view only. Changes apply on Enter / blur, each one undo step.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { setNodeAttr } from '@/editor/commands/table';
import { registerBarFocus, type BarField } from '@/features/editing/barFocus';
import { setHrefAtSelection } from '@/features/footnotes';
import { normalizeHref } from '@/features/linkTargets';
import { isRunLocked, useAppState } from '@/model/store';
import { useBodySelectionContext } from '@/views/body/useBodySelection';

import { useAppServices } from './services';

export interface BarTextFieldProps {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  width?: number;
  focusKey?: BarField;
  onCommit: (value: string) => void;
}

/** Text field that applies its value on Enter or blur and re-syncs when the selection moves. */
export function BarTextField({
  id,
  label,
  value,
  disabled,
  width = 120,
  focusKey,
  onCommit,
}: BarTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!focusKey) return;
    return registerBarFocus(focusKey, () => {
      const input = inputRef.current;
      if (!input || input.disabled) return false;
      input.focus();
      input.select();
      return true;
    });
  }, [focusKey]);

  const commit = () => {
    // Enter commits and then blurs the field, Escape restores it and blurs it: the blur that
    // follows must not commit (again) - a second commit of a picture's Href was a second undo
    // step (feature 006, FR-029: each change is one undo step).
    if (!editing.current) return;
    editing.current = false;
    if (draft !== value) onCommit(draft);
  };

  return (
    <label className="mfbe-bar-field" htmlFor={`${id}-input`}>
      <span className="mfbe-bar-label">{label}</span>
      <input
        ref={inputRef}
        id={`${id}-input`}
        className="mfbe-bar-input"
        type="text"
        style={{ width }}
        value={disabled ? '' : draft}
        disabled={disabled}
        spellCheck={false}
        data-testid={id}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            editing.current = false;
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function LinksBar() {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const activeView = useAppState((s) => s.activeView, store);
  const runLocked = useAppState(isRunLocked, store);
  const { controller, context } = useBodySelectionContext();
  const bodyActive = activeView === 'body' && !runLocked && !!controller && !!context;

  const attr = (node: { attrs: Record<string, unknown> } | null | undefined, name: string) =>
    node && typeof node.attrs[name] === 'string' ? (node.attrs[name] as string) : '';

  const setAttr = (pos: number | undefined, name: string, value: string) => {
    if (!controller || pos === undefined) return;
    controller.execute(setNodeAttr(pos, name, value.trim()));
  };

  return (
    <div
      className="mfbe-toolbar mfbe-bar mfbe-linksbar"
      role="toolbar"
      aria-label={t('toolbar.links')}
      data-testid="linksbar"
    >
      <BarTextField
        id="links-bar-id"
        label={t('linksBar.id')}
        value={attr(context?.idElement?.node, 'id')}
        disabled={!bodyActive || !context?.idElement}
        focusKey="id"
        onCommit={(value) => setAttr(context?.idElement?.pos, 'id', value)}
      />
      <BarTextField
        id="links-bar-href"
        label={t('linksBar.href')}
        value={context?.link?.href ?? ''}
        disabled={!bodyActive || !context?.link}
        width={200}
        focusKey="href"
        onCommit={(value) => {
          if (controller) setHrefAtSelection(controller, normalizeHref(value));
        }}
      />
      <BarTextField
        id="links-bar-section-id"
        label={t('linksBar.sectionId')}
        value={attr(context?.section?.node, 'id')}
        disabled={!bodyActive || !context?.section}
        onCommit={(value) => setAttr(context?.section?.pos, 'id', value)}
      />
      <BarTextField
        id="links-bar-image-title"
        label={t('linksBar.imageTitle')}
        value={attr(context?.image?.node, 'title')}
        disabled={!bodyActive || !context?.image || context.image.node.type.name !== 'image'}
        width={200}
        onCommit={(value) => setAttr(context?.image?.pos, 'title', value)}
      />
      <BarTextField
        id="links-bar-alt"
        label={t('linksBar.alt')}
        value={attr(context?.image?.node, 'alt')}
        disabled={!bodyActive || !context?.image}
        width={200}
        onCommit={(value) => setAttr(context?.image?.pos, 'alt', value)}
      />
    </div>
  );
}
