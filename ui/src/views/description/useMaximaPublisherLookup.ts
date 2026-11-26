/**
 * Maxima Library Lookup Service v2 hook for `publishInfo.publisher` (400 ms debounce, min 2 chars,
 * `bookCount`, session-retained ephemeral `libraryId` driving Publisher Series, blur `exists`
 * 1-match auto-confirm & strictly advisory multi-match disambiguation that never blocks Save)
 * (feature 021, FR-019, FR-024, FR-026, contracts/lookup-v2.md §2 & §4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RowConfirmationStatus } from '@/features/lookup/descriptionLookupSession';
import type { MaximaPublisherItem } from '@/rpc/types';

import type { FormInput } from './binding';
import { useDescriptionForm } from './formContext';
import type { MaximaLookupDropdownItem } from './MaximaLookupDropdown';
import { formatLookupErrorMessage } from './maximaLookupMessages';
import { getAtPath, setAtPath } from './model';

export const PUBLISHER_LOOKUP_DEBOUNCE_MS = 400;
export const PUBLISHER_LOOKUP_MIN_CHARS = 2;
export const PUBLISHER_LOOKUP_PAGE_SIZE = 30;

const PUBLISHER_FIELD_KEY = 'publishInfo.publisher';
const SEARCH_KEY = 'publishInfo.publisher:search';
const EXISTS_KEY = 'publishInfo.publisher:exists';

export interface UseMaximaPublisherLookupResult {
  active: boolean;
  status: RowConfirmationStatus;
  confirmedLibraryId: number | null;
  confirmedUrl: string | null;
  dropdownOpen: boolean;
  loading: boolean;
  disambiguationPrompt: boolean;
  errorMessage: string | null;
  items: readonly MaximaLookupDropdownItem<MaximaPublisherItem>[];
  activeIndex: number;
  page: number;
  hasMore: boolean;
  setActiveIndex: (index: number) => void;
  handleChange: (value: string) => void;
  handleFocus: () => void;
  handleClick: () => void;
  handleBlur: () => void;
  handleKeyDown: (event: React.KeyboardEvent<FormInput>) => void;
  handlePick: (item: MaximaLookupDropdownItem<MaximaPublisherItem>) => void;
  handlePrevPage: () => void;
  handleNextPage: () => void;
  closeDropdown: () => void;
}

export function useMaximaPublisherLookup(): UseMaximaPublisherLookupResult {
  const { t } = useTranslation();
  const { controller, form, readOnly, maximaLookup } = useDescriptionForm();

  const active = Boolean(maximaLookup?.enabled && maximaLookup.rpc);
  const rpc = maximaLookup?.rpc ?? null;
  const session = maximaLookup?.session ?? null;
  const publisherName = form.publishInfo?.publisher ?? '';

  const ephemeral =
    active && maximaLookup?.snapshot.publisher?.matchedName === publisherName.trim()
      ? maximaLookup.snapshot.publisher
      : null;
  const status: RowConfirmationStatus = ephemeral?.status ?? 'unconfirmed';
  const confirmedLibraryId = ephemeral?.libraryId ?? null;
  const confirmedUrl = ephemeral?.url ?? null;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>(publisherName);

  const [openRequested, setOpenRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [disambiguationPrompt, setDisambiguationPrompt] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<MaximaLookupDropdownItem<MaximaPublisherItem>[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const dropdownOpen = active && !readOnly && openRequested;

  const clearTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const closeDropdown = useCallback(() => {
    clearTimer();
    session?.invalidateField(SEARCH_KEY);
    setOpenRequested(false);
    setLoading(false);
    setDisambiguationPrompt(false);
    setErrorMessage(null);
  }, [clearTimer, session]);

  useEffect(() => {
    if (readOnly || !active) {
      clearTimer();
      session?.invalidateField(SEARCH_KEY);
      session?.invalidateField(EXISTS_KEY);
    }
  }, [active, clearTimer, readOnly, session]);

  useEffect(() => {
    return () => {
      clearTimer();
      session?.invalidateField(SEARCH_KEY);
      session?.invalidateField(EXISTS_KEY);
    };
  }, [clearTimer, session]);

  const mapItems = useCallback(
    (raw: readonly MaximaPublisherItem[]): MaximaLookupDropdownItem<MaximaPublisherItem>[] =>
      raw.map((item) => ({
        id: item.id,
        title: item.name,
        meta: t('maximaLibrary.lookup.booksCount', { count: item.bookCount }),
        url: item.url ?? '',
        data: item,
      })),
    [t],
  );

  const executeSearch = useCallback(
    (query: string, targetPage: number) => {
      const run = (q: string, pg: number) => {
        if (!active || !rpc || !session || readOnly) return;
        const trimmed = q.trim();
        if (trimmed.length < PUBLISHER_LOOKUP_MIN_CHARS) {
          closeDropdown();
          return;
        }
        lastQueryRef.current = trimmed;
        setDisambiguationPrompt(false);

        if (session.rateLimitRemainingMs() > 0) {
          const secs = Math.ceil(session.rateLimitRemainingMs() / 1000);
          setOpenRequested(true);
          setLoading(false);
          setErrorMessage(formatLookupErrorMessage(t, 'rate_limited', secs));
          return;
        }

        const seq = session.nextRequestSeq(SEARCH_KEY);
        setOpenRequested(true);
        setLoading(true);
        setErrorMessage(null);
        setPage(pg);

        void rpc
          .call('maximaLookup.search', {
            kind: 'publisher',
            publisherName: trimmed,
            page: pg,
            pageSize: PUBLISHER_LOOKUP_PAGE_SIZE,
          })
          .then((res) => {
            if (!session.isLatestRequest(SEARCH_KEY, seq)) return;
            setLoading(false);
            if (!res.ok) {
              if (res.code === 'disabled') {
                setOpenRequested(false);
                return;
              }
              session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
              session.registerRetryAction(() => run(trimmed, pg));
              setErrorMessage(
                formatLookupErrorMessage(t, res.code, res.retryAfterSeconds, res.message),
              );
              setItems([]);
              setHasMore(false);
              return;
            }
            session.clearBanner();
            setItems(mapItems((res.items ?? []) as MaximaPublisherItem[]));
            setHasMore(Boolean(res.hasMore));
            setActiveIndex(0);
          })
          .catch((err) => {
            if (!session.isLatestRequest(SEARCH_KEY, seq)) return;
            setLoading(false);
            const msg = err instanceof Error ? err.message : String(err);
            session.recordError('offline', msg);
            session.registerRetryAction(() => run(trimmed, pg));
            setErrorMessage(formatLookupErrorMessage(t, 'offline', undefined, msg));
            setItems([]);
            setHasMore(false);
          });
      };

      run(query, targetPage);
    },
    [active, closeDropdown, mapItems, readOnly, rpc, session, t],
  );

  const runBlurExists = useCallback(
    (name: string) => {
      const run = (qName: string) => {
        if (!active || !rpc || !session || readOnly) return;
        const trimmed = qName.trim();
        if (!trimmed) return;
        if (session.rateLimitRemainingMs() > 0) return;

        const existing = session.getPublisherForName(trimmed);
        if (existing?.status === 'confirmed') return;

        const seq = session.nextRequestSeq(EXISTS_KEY);
        void rpc
          .call('maximaLookup.exists', {
            kind: 'publisher',
            publisherName: trimmed,
          })
          .then((res) => {
            if (!session.isLatestRequest(EXISTS_KEY, seq)) return;
            if (!res.ok) {
              if (res.code === 'disabled') return;
              session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
              session.registerRetryAction(() => run(trimmed));
              return;
            }
            session.clearBanner();
            if (res.kind !== 'publisher') return;
            const liveName = controller.currentForm
              ? String(getAtPath(controller.currentForm, PUBLISHER_FIELD_KEY) ?? '').trim()
              : '';
            if (liveName !== trimmed) return;

            const matched = res.items ?? [];
            if (matched.length === 1) {
              const single = matched[0]!;
              session.setPublisherState({
                status: 'confirmed',
                libraryId: single.id,
                url: single.url ?? null,
                matchedName: trimmed,
              });
            } else if (matched.length > 1) {
              // Advisory disambiguation only: never blocks Save or further editing (FR-019, FR-024).
              session.setPublisherState({
                status: 'unresolved',
                libraryId: null,
                url: null,
                matchedName: trimmed,
              });
              setItems(mapItems(matched));
              setActiveIndex(0);
              setPage(0);
              setHasMore(false);
              setDisambiguationPrompt(true);
              setErrorMessage(null);
              setLoading(false);
              setOpenRequested(true);
            } else {
              session.setPublisherState(null);
            }
          })
          .catch((err) => {
            if (!session.isLatestRequest(EXISTS_KEY, seq)) return;
            const msg = err instanceof Error ? err.message : String(err);
            session.recordError('offline', msg);
            session.registerRetryAction(() => run(trimmed));
          });
      };

      run(name);
    },
    [active, controller, mapItems, readOnly, rpc, session],
  );

  const handleChange = useCallback(
    (value: string) => {
      controller.setField(PUBLISHER_FIELD_KEY, value);
      if (!active) return;

      session?.invalidateField(EXISTS_KEY);
      session?.setPublisherState(null);
      clearTimer();
      setPage(0);
      setDisambiguationPrompt(false);

      if (value.trim().length < PUBLISHER_LOOKUP_MIN_CHARS) {
        closeDropdown();
        return;
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        executeSearch(value, 0);
      }, PUBLISHER_LOOKUP_DEBOUNCE_MS);
    },
    [active, clearTimer, closeDropdown, controller, executeSearch, session],
  );

  const openOnFocusOrClick = useCallback(() => {
    if (!active || readOnly || dropdownOpen) return;
    if (publisherName.trim().length < PUBLISHER_LOOKUP_MIN_CHARS) return;
    clearTimer();
    executeSearch(publisherName, 0);
  }, [active, clearTimer, dropdownOpen, executeSearch, publisherName, readOnly]);

  const handleBlur = useCallback(() => {
    if (!active) return;
    closeDropdown();
    const liveName = controller.currentForm
      ? String(getAtPath(controller.currentForm, PUBLISHER_FIELD_KEY) ?? '')
      : publisherName;
    runBlurExists(liveName);
  }, [active, closeDropdown, controller, publisherName, runBlurExists]);

  const handlePick = useCallback(
    (dropdownItem: MaximaLookupDropdownItem<MaximaPublisherItem>) => {
      if (!active) return;
      const picked = dropdownItem.data;
      closeDropdown();
      session?.invalidateField(EXISTS_KEY);
      controller.update((current) => setAtPath(current, PUBLISHER_FIELD_KEY, picked.name));
      session?.setPublisherState({
        status: 'confirmed',
        libraryId: picked.id,
        url: picked.url ?? null,
        matchedName: picked.name.trim(),
      });
    },
    [active, closeDropdown, controller, session],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<FormInput>) => {
      if (!active || !dropdownOpen) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((current) =>
          items.length === 0 ? 0 : (current - 1 + items.length) % items.length,
        );
      } else if (event.key === 'Enter') {
        const item = items[activeIndex];
        if (item) {
          event.preventDefault();
          handlePick(item);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeDropdown();
      }
    },
    [active, activeIndex, closeDropdown, dropdownOpen, handlePick, items],
  );

  const handlePrevPage = useCallback(() => {
    if (page <= 0) return;
    executeSearch(lastQueryRef.current, page - 1);
  }, [executeSearch, page]);

  const handleNextPage = useCallback(() => {
    if (!hasMore) return;
    executeSearch(lastQueryRef.current, page + 1);
  }, [executeSearch, hasMore, page]);

  return {
    active,
    status,
    confirmedLibraryId,
    confirmedUrl,
    dropdownOpen,
    loading,
    disambiguationPrompt,
    errorMessage,
    items,
    activeIndex,
    page,
    hasMore,
    setActiveIndex,
    handleChange,
    handleFocus: openOnFocusOrClick,
    handleClick: openOnFocusOrClick,
    handleBlur,
    handleKeyDown,
    handlePick,
    handlePrevPage,
    handleNextPage,
    closeDropdown,
  };
}
