/**
 * Shared accessible paged/tabbed autocomplete dropdown for Maxima Library Lookup Service v2 in
 * Description view (feature 021, FR-017..FR-023, contracts/lookup-v2.md §4).
 *
 * Prevents premature blur dismissal on mouse interaction (`onMouseDown={(e) => e.preventDefault()}`)
 * so clicking tabs, pagination buttons, suggestion items, or external site links registers cleanly
 * before focus leaves the input.
 */

import { useTranslation } from 'react-i18next';

import { tip } from '@/app/tooltips';
import { ExternalLink } from '@/dialogs/ExternalLink';
import type { RpcClient } from '@/rpc/client';

import './maximaLookup.css';

export interface MaximaLookupTabOption {
  id: string;
  label: string;
}

export type MaximaLookupRowHighlight = 'none' | 'authors' | 'makers' | 'linked' | 'nameMatch';

export interface MaximaLookupDropdownItem<T = unknown> {
  id: number;
  title: string;
  subtitle?: string;
  meta?: string;
  url: string;
  highlight?: MaximaLookupRowHighlight;
  data: T;
}

export interface MaximaLookupDropdownProps<T> {
  testIdPrefix: string;
  open: boolean;
  loading: boolean;
  /** Local empty-input prompt shown on `All` tab when narrowed tabs are available (0 network calls). */
  typeToSearchPrompt?: boolean;
  /** Advisory multi-match disambiguation header shown after blur `exists`. */
  disambiguationPrompt?: boolean;
  errorMessage?: string | null;
  items: readonly MaximaLookupDropdownItem<T>[];
  activeIndex: number;
  page: number;
  hasMore: boolean;
  tabs?: readonly MaximaLookupTabOption[];
  activeTabId?: string;
  rpc: RpcClient | null;
  onSelectTab?: (tabId: string) => void;
  onHighlightIndex: (index: number) => void;
  onPick: (item: MaximaLookupDropdownItem<T>) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onClose: () => void;
}

export function MaximaLookupDropdown<T>({
  testIdPrefix,
  open,
  loading,
  typeToSearchPrompt = false,
  disambiguationPrompt = false,
  errorMessage = null,
  items,
  activeIndex,
  page,
  hasMore,
  tabs,
  activeTabId,
  rpc,
  onSelectTab,
  onHighlightIndex,
  onPick,
  onPrevPage,
  onNextPage,
  onClose,
}: MaximaLookupDropdownProps<T>) {
  const { t } = useTranslation();

  if (!open) return null;

  const keepFocus = (event: React.MouseEvent) => {
    // Prevent input blur before clicks on tabs, items, pagination, or external links register.
    event.preventDefault();
  };

  return (
    <div
      className="mfbe-ml-dropdown"
      data-testid={`${testIdPrefix}-dropdown`}
      onMouseDown={keepFocus}
    >
      {tabs && tabs.length > 1 && (
        <div className="mfbe-ml-dropdown-tabs" role="tablist" data-testid={`${testIdPrefix}-tabs`}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <button
                {...tip(t('tip.settings.maximaLookup.tab', { tab: tab.label }))}
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={`mfbe-ml-tab${active ? ' is-active' : ''}`}
                data-testid={`${testIdPrefix}-tab-${tab.id}`}
                onClick={() => onSelectTab?.(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {disambiguationPrompt && (
        <div
          className="mfbe-ml-dropdown-notice is-advisory"
          data-testid={`${testIdPrefix}-disambiguation`}
        >
          {t('maximaLibrary.lookup.pickOnePrompt')}
        </div>
      )}

      {errorMessage ? (
        <div className="mfbe-ml-dropdown-status is-error" data-testid={`${testIdPrefix}-error`}>
          {errorMessage}
        </div>
      ) : loading ? (
        <div className="mfbe-ml-dropdown-status" data-testid={`${testIdPrefix}-loading`}>
          {t('maximaLibrary.lookup.searching')}
        </div>
      ) : typeToSearchPrompt ? (
        <div className="mfbe-ml-dropdown-status" data-testid={`${testIdPrefix}-type-prompt`}>
          {t('maximaLibrary.lookup.typeToSearch')}
        </div>
      ) : items.length === 0 ? (
        <div className="mfbe-ml-dropdown-status" data-testid={`${testIdPrefix}-empty`}>
          {t('maximaLibrary.lookup.noMatches')}
        </div>
      ) : (
        <ul className="mfbe-ml-dropdown-list" role="listbox" data-testid={`${testIdPrefix}-list`}>
          {items.map((item, idx) => {
            const isHighlighted = idx === activeIndex;
            const markClass =
              item.highlight && item.highlight !== 'none' ? ` is-mark-${item.highlight}` : '';
            return (
              <li
                {...tip(t('tip.settings.maximaLookup.pickItem'))}
                key={`${item.id}-${idx}`}
                role="option"
                aria-selected={isHighlighted}
                className={`mfbe-ml-item${isHighlighted ? ' is-active' : ''}${markClass}`}
                data-testid={`${testIdPrefix}-item-${item.id}`}
                data-highlight={item.highlight ?? 'none'}
                onMouseEnter={() => onHighlightIndex(idx)}
                onClick={() => onPick(item)}
              >
                <div className="mfbe-ml-item-main">
                  <span className="mfbe-ml-item-title">{item.title}</span>
                  <span className="mfbe-ml-item-id">[{item.id}]</span>
                  {item.meta && <span className="mfbe-ml-item-meta">{item.meta}</span>}
                  {item.subtitle && <div className="mfbe-ml-item-subtitle">{item.subtitle}</div>}
                </div>
                {item.url && (
                  <span
                    className="mfbe-ml-item-link"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={keepFocus}
                  >
                    <ExternalLink
                      url={item.url}
                      rpc={rpc}
                      testId={`${testIdPrefix}-item-link-${item.id}`}
                    >
                      {t('maximaLibrary.lookup.openOnSiteShort')}
                    </ExternalLink>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mfbe-ml-dropdown-footer">
        <div className="mfbe-ml-pager">
          <button
            {...tip(t('tip.settings.maximaLookup.prevPage'))}
            type="button"
            className="mfbe-ml-btn"
            disabled={loading || page <= 0}
            data-testid={`${testIdPrefix}-prev`}
            onClick={onPrevPage}
          >
            {t('maximaLibrary.lookup.prevPage')}
          </button>
          <span className="mfbe-ml-page-label" data-testid={`${testIdPrefix}-page`}>
            {t('maximaLibrary.lookup.pageLabel', { page: page + 1 })}
          </span>
          <button
            {...tip(t('tip.settings.maximaLookup.nextPage'))}
            type="button"
            className="mfbe-ml-btn"
            disabled={loading || !hasMore}
            data-testid={`${testIdPrefix}-next`}
            onClick={onNextPage}
          >
            {t('maximaLibrary.lookup.nextPage')}
          </button>
        </div>
        <button
          {...tip(t('tip.settings.maximaLookup.close'))}
          type="button"
          className="mfbe-ml-btn"
          data-testid={`${testIdPrefix}-close`}
          onClick={onClose}
        >
          {t('maximaLibrary.lookup.close')}
        </button>
      </div>
    </div>
  );
}
