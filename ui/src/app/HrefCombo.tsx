/**
 * The Links bar's «Ссылка» (Href) box with its drop-down list (feature 008, FR-040 to FR-044,
 * research R9): at a link the book's jump destinations, at a picture the book's images, both in
 * book order. The button, Alt+Down or F4 open the full list even when the field holds a value;
 * typing narrows an open list (case-insensitive); Enter or a click applies the choice as typing
 * it does - one commit, one undo step -, Escape closes the list, then restores the field.
 * The native `<datalist>` was rejected: Chromium filters it by the field's current value.
 */

import { useEffect, useRef, useState } from 'react';

import { registerBarFocus } from '@/features/editing/barFocus';
import type { ListTarget } from '@/features/linkTargets';
import { tip } from './tooltips';

export interface HrefComboProps {
  label: string;
  /** Feature 010 (US4, D11): what the field is, and when a greyed one becomes available. */
  tooltip?: string;
  whenAvailable?: string;
  /** Feature 010 (US4): the tooltip of the button that opens the list. */
  listTooltip?: string;
  value: string;
  disabled: boolean;
  width?: number;
  /** The entries, computed when the list opens (FR-042). */
  options: () => ListTarget[];
  onCommit: (value: string) => void;
  /**
   * Feature 009 (the requester at the smoke test of 0.0.7-rc.6): at a picture, a click on the
   * field opens the list, each entry shows its thumbnail and offers the picture view.
   */
  openOnClick?: boolean;
  preview?: (href: string) => string | null;
  /** Feature 010 (D10): an extra class for a picture entry's thumbnail (the background switch). */
  previewClass?: (href: string) => string;
  onEnlarge?: (href: string) => void;
  enlargeLabel?: string;
}

export function HrefCombo({
  label,
  tooltip,
  whenAvailable,
  listTooltip,
  value,
  disabled,
  width = 200,
  options,
  onCommit,
  openOnClick = false,
  preview,
  onEnlarge,
  enlargeLabel,
  previewClass,
}: HrefComboProps) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ListTarget[]>([]);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const editing = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);

  useEffect(
    () =>
      registerBarFocus('href', () => {
        const input = inputRef.current;
        if (!input || input.disabled) return false;
        input.focus();
        input.select();
        return true;
      }),
    [],
  );

  // A field that becomes unavailable (the caret left the link) shows no list.
  const listOpen = open && !disabled;
  const shown = filter
    ? items.filter((item) => item.label.toLowerCase().includes(filter.toLowerCase()))
    : items;

  useEffect(() => {
    if (!listOpen) return;
    const entry = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (typeof entry?.scrollIntoView === 'function') entry.scrollIntoView({ block: 'nearest' });
  }, [active, listOpen]);

  const openList = () => {
    setItems(options());
    setFilter('');
    setActive(0);
    setOpen(true);
  };

  const apply = (next: string) => {
    editing.current = false;
    setOpen(false);
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  const help = tip(disabled && whenAvailable ? `${tooltip} ${whenAvailable}` : tooltip);
  return (
    <label className="mfbe-bar-field" htmlFor="links-bar-href-input" {...help}>
      <span className="mfbe-bar-label">{label}</span>
      <span className="mfbe-hrefcombo" style={{ width }}>
        <input
          ref={inputRef}
          id="links-bar-href-input"
          className="mfbe-bar-input mfbe-hrefcombo-input"
          {...help}
          type="text"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls="links-bar-href-list"
          aria-autocomplete="list"
          value={disabled ? '' : draft}
          disabled={disabled}
          spellCheck={false}
          data-testid="links-bar-href"
          onFocus={() => {
            editing.current = true;
          }}
          onClick={() => {
            if (openOnClick && !open && !disabled) openList();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (open) {
              setFilter(event.target.value);
              setActive(0);
            }
          }}
          onBlur={(event) => {
            if (listRef.current?.contains(event.relatedTarget as Node | null)) return;
            setOpen(false);
            if (!editing.current) return;
            editing.current = false;
            if (draft !== value) onCommit(draft);
          }}
          onKeyDown={(event) => {
            if ((event.key === 'ArrowDown' && event.altKey) || event.key === 'F4') {
              event.preventDefault();
              if (open) setOpen(false);
              else openList();
              return;
            }
            if (open && event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0)));
              return;
            }
            if (open && event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const chosen = open ? shown[active] : undefined;
              apply(chosen ? chosen.href : draft);
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              if (open) {
                setOpen(false);
                return;
              }
              editing.current = false;
              setDraft(value);
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          className="mfbe-hrefcombo-toggle"
          tabIndex={-1}
          disabled={disabled}
          aria-label={label}
          {...tip(listTooltip)}
          data-testid="links-bar-href-toggle"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) {
              setOpen(false);
              return;
            }
            editing.current = true;
            inputRef.current?.focus();
            openList();
          }}
        >
          <span className="mfbe-hrefcombo-arrow" aria-hidden="true" />
        </button>
        {listOpen ? (
          <ul
            ref={listRef}
            id="links-bar-href-list"
            role="listbox"
            className="mfbe-hrefcombo-list"
            data-testid="links-bar-href-list"
          >
            {shown.map((item, index) => (
              <li
                key={item.href}
                role="option"
                title={item.href}
                aria-selected={index === active}
                data-index={index}
                data-testid={`links-bar-href-option-${index}`}
                className={index === active ? 'is-active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => {
                  apply(item.href);
                  inputRef.current?.blur();
                }}
              >
                {preview ? (
                  <PreviewThumb
                    url={preview(item.href)}
                    className={previewClass?.(item.href) ?? ''}
                  />
                ) : null}
                <span className="mfbe-hrefcombo-label">{item.label}</span>
                {onEnlarge && preview?.(item.href) ? (
                  <button
                    type="button"
                    className="mfbe-hrefcombo-enlarge"
                    tabIndex={-1}
                    aria-label={enlargeLabel}
                    title={enlargeLabel}
                    data-testid={`links-bar-href-enlarge-${index}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpen(false);
                      onEnlarge(item.href);
                    }}
                  >
                    <span className="mfbe-hrefcombo-enlarge-glyph" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </span>
    </label>
  );
}

/** A picture entry's thumbnail; an empty box for an entry without a picture to show. */
function PreviewThumb({ url, className = '' }: { url: string | null; className?: string }) {
  return url ? (
    <img className={`mfbe-hrefcombo-thumb${className}`} src={url} alt="" draggable={false} />
  ) : (
    <span className="mfbe-hrefcombo-thumb" aria-hidden="true" />
  );
}
