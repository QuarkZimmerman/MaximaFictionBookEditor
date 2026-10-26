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
  /**
   * The targets' values differ (the Table bar's block-wide fields, feature 006 US7): the field is
   * empty and carries `data-mixed="true"`; Enter on the still-empty field commits `''`, which
   * removes the attribute from every target, while a blur without typing commits nothing.
   */
  mixed?: boolean;
  /** The id of a `<datalist>` of suggestions: the input's `list`. */
  list?: string;
  /** The input's `title` (feature 006 US8 sets it on the disabled span fields). */
  title?: string;
  /**
   * Applies the value; `false` when nothing was applied, after which the field shows `value`.
   * A promise answers later (a question first, feature 006 US8's span fields): when it resolves
   * `false` the field shows the current `value` again, unless it is being edited anew.
   */
  onCommit: (value: string) => boolean | void | Promise<boolean | void>;
}

/**
 * Text field that applies its value on Enter or blur and re-syncs when the selection moves.
 * One commit per edit: Enter commits and then blurs the field, Escape restores it and blurs it,
 * and the blur that follows commits nothing more.
 */
export function BarTextField({
  id,
  label,
  value,
  disabled,
  width = 120,
  focusKey,
  mixed = false,
  list,
  title,
  onCommit,
}: BarTextFieldProps) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const editing = useRef(false);
  // The value the field shows when an answered commit applied nothing.
  const latest = useRef(value);

  useEffect(() => {
    latest.current = value;
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

  const commit = (enter: boolean) => {
    // Enter commits and then blurs the field, Escape restores it and blurs it: the blur that
    // follows must not commit (again) - a second commit of a picture's Href was a second undo
    // step (feature 006, FR-029: each change is one undo step), and a refusal would show its
    // message twice (US7).
    if (!editing.current) return;
    editing.current = false;
    if (draft === value && !(enter && mixed)) return;
    const result = onCommit(draft);
    if (result === false) setDraft(value);
    else if (result instanceof Promise) {
      void result.then((applied) => {
        if (applied === false && !editing.current) setDraft(latest.current);
      });
    }
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
        list={list}
        title={title}
        data-testid={id}
        data-mixed={mixed && !disabled ? 'true' : undefined}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(true);
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
