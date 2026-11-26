/**
 * Shared Maxima Library Lookup Service v2 person autocomplete and blur exact-match hook for
 * Authors, Translators (`PersonList`), and all 6 Other persons roles (`RoleList`) in Title info
 * (feature 021, FR-013..FR-017, contracts/lookup-v2.md §2 & §4).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  bindRowIdentity,
  deriveMaximaBindings,
  formatPersonDisplayName,
  identityInfoTypeForRole,
  unbindRowIdentities,
} from '@/features/description/maximaIdentities';
import type { MaximaPersonItem, MaximaPersonRole } from '@/rpc/types';

import type { FormInput } from './binding';
import { useDescriptionForm } from './formContext';
import type { MaximaLookupDropdownItem } from './MaximaLookupDropdown';
import { formatLookupErrorMessage } from './maximaLookupMessages';
import { getAtPath, setAtPath } from './model';

export const PERSON_LOOKUP_DEBOUNCE_MS = 1000;
export const PERSON_LOOKUP_PAGE_SIZE = 30;
export const PERSON_LOOKUP_MIN_CHARS = 2;

export interface PersonNameValues {
  lastName: string;
  firstName: string;
  middleName: string;
}

export interface UseMaximaPersonLookupOptions {
  /** Form row path, e.g. `titleInfo.authors.0`, `titleInfo.translators.0`, `roles.0`. */
  rowPath: string;
  /** Maxima Library person role; omit (`undefined`) to disable lookup for this list (e.g. `srcTitleInfo`, `documentInfo`). */
  role: MaximaPersonRole | undefined;
  /** Current row name values. */
  names: PersonNameValues;
}

export interface UseMaximaPersonLookupResult {
  active: boolean;
  confirmedLibraryId: number | null;
  confirmedUrl: string | null;
  dropdownOpen: boolean;
  loading: boolean;
  errorMessage: string | null;
  items: readonly MaximaLookupDropdownItem<MaximaPersonItem>[];
  activeIndex: number;
  page: number;
  hasMore: boolean;
  setActiveIndex: (index: number) => void;
  handleNameChange: (part: 'firstName' | 'middleName' | 'lastName', value: string) => void;
  handleSearchFieldFocus: () => void;
  handleSearchFieldClick: () => void;
  handleRowBlur: () => void;
  handleKeyDown: (event: React.KeyboardEvent<FormInput>) => void;
  handlePick: (item: MaximaLookupDropdownItem<MaximaPersonItem>) => void;
  handlePrevPage: () => void;
  handleNextPage: () => void;
  closeDropdown: () => void;
}

function meetsPersonThreshold(lastName: string, firstName: string): boolean {
  return (
    lastName.trim().length >= PERSON_LOOKUP_MIN_CHARS ||
    firstName.trim().length >= PERSON_LOOKUP_MIN_CHARS
  );
}

function formatPersonTitle(item: MaximaPersonItem): string {
  if (item.fullName && item.fullName.trim().length > 0) return item.fullName.trim();
  return formatPersonDisplayName({
    lastName: item.lastName,
    firstName: item.firstName,
    middleName: item.middleName,
  });
}

export function useMaximaPersonLookup({
  rowPath,
  role,
  names,
}: UseMaximaPersonLookupOptions): UseMaximaPersonLookupResult {
  const { t } = useTranslation();
  const { controller, readOnly, maximaLookup } = useDescriptionForm();

  const active = Boolean(role && maximaLookup?.enabled && maximaLookup.rpc);
  const rpc = maximaLookup?.rpc ?? null;
  const session = maximaLookup?.session ?? null;
  const domain = maximaLookup?.domain ?? '';
  const binding = active ? (maximaLookup?.bindings.byRowPath.get(rowPath) ?? null) : null;
  const confirmedLibraryId = binding?.libraryId ?? null;
  const confirmedUrl =
    active && confirmedLibraryId && session
      ? session.resolveEntityUrl(domain, 'person', confirmedLibraryId)
      : null;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<{ lastName: string; firstName: string }>({
    lastName: names.lastName,
    firstName: names.firstName,
  });

  const scopeKey = `${rowPath}:${role ?? ''}`;
  const [openScope, setOpenScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<MaximaLookupDropdownItem<MaximaPersonItem>[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const dropdownOpen = active && !readOnly && openScope === scopeKey;
  const searchFieldKey = `${rowPath}:search`;
  const existsFieldKey = `${rowPath}:exists`;

  const clearTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const closeDropdown = useCallback(() => {
    clearTimer();
    session?.invalidateField(searchFieldKey);
    setOpenScope(null);
    setLoading(false);
    setErrorMessage(null);
  }, [clearTimer, searchFieldKey, session]);

  // Cancel timers and invalidate in-flight RPCs on lock, disable, role change, or unmount.
  useEffect(() => {
    if (readOnly || !active) {
      clearTimer();
      session?.invalidateField(searchFieldKey);
      session?.invalidateField(existsFieldKey);
    }
  }, [active, clearTimer, existsFieldKey, readOnly, searchFieldKey, session]);

  useEffect(() => {
    return () => {
      clearTimer();
      session?.invalidateField(searchFieldKey);
      session?.invalidateField(existsFieldKey);
    };
  }, [clearTimer, existsFieldKey, scopeKey, searchFieldKey, session]);

  const executeSearch = useCallback(
    (lastName: string, firstName: string, targetPage: number) => {
      const run = (qLast: string, qFirst: string, pg: number) => {
        if (!active || !role || !rpc || !session || readOnly) return;
        const trimmedLast = qLast.trim();
        const trimmedFirst = qFirst.trim();
        if (!meetsPersonThreshold(trimmedLast, trimmedFirst)) {
          closeDropdown();
          return;
        }
        lastQueryRef.current = { lastName: trimmedLast, firstName: trimmedFirst };

        if (session.rateLimitRemainingMs() > 0) {
          const secs = Math.ceil(session.rateLimitRemainingMs() / 1000);
          setOpenScope(scopeKey);
          setLoading(false);
          setErrorMessage(formatLookupErrorMessage(t, 'rate_limited', secs));
          return;
        }

        const seq = session.nextRequestSeq(searchFieldKey);
        setOpenScope(scopeKey);
        setLoading(true);
        setErrorMessage(null);
        setPage(pg);

        void rpc
          .call('maximaLookup.search', {
            kind: 'person',
            role,
            lastName: trimmedLast,
            firstName: trimmedFirst,
            page: pg,
            pageSize: PERSON_LOOKUP_PAGE_SIZE,
          })
          .then((res) => {
            if (!session.isLatestRequest(searchFieldKey, seq)) return;
            setLoading(false);
            if (!res.ok) {
              if (res.code === 'disabled') {
                setOpenScope(null);
                return;
              }
              session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
              session.registerRetryAction(() => run(trimmedLast, trimmedFirst, pg));
              setErrorMessage(
                formatLookupErrorMessage(t, res.code, res.retryAfterSeconds, res.message),
              );
              setItems([]);
              setHasMore(false);
              return;
            }
            session.clearBanner();
            const raw = (res.items ?? []) as MaximaPersonItem[];
            const mapped: MaximaLookupDropdownItem<MaximaPersonItem>[] = raw.map((item) => ({
              id: item.id,
              title: formatPersonTitle(item),
              url: item.url ?? '',
              data: item,
            }));
            setItems(mapped);
            setHasMore(Boolean(res.hasMore));
            setActiveIndex(0);
          })
          .catch((err) => {
            if (!session.isLatestRequest(searchFieldKey, seq)) return;
            setLoading(false);
            const msg = err instanceof Error ? err.message : String(err);
            session.recordError('offline', msg);
            session.registerRetryAction(() => run(trimmedLast, trimmedFirst, pg));
            setErrorMessage(formatLookupErrorMessage(t, 'offline', undefined, msg));
            setItems([]);
            setHasMore(false);
          });
      };

      run(lastName, firstName, targetPage);
    },
    [active, closeDropdown, readOnly, role, rpc, scopeKey, searchFieldKey, session, t],
  );

  const runBlurExists = useCallback(
    (lastName: string, firstName: string, middleName: string) => {
      const run = (qLast: string, qFirst: string, qMiddle: string) => {
        if (!active || !role || !rpc || !session || readOnly) return;
        const trimmedLast = qLast.trim();
        const trimmedFirst = qFirst.trim();
        const trimmedMiddle = qMiddle.trim();
        if (!trimmedLast && !trimmedFirst && !trimmedMiddle) return;
        if (session.rateLimitRemainingMs() > 0) return;

        const currentForm = controller.currentForm;
        if (!currentForm) return;
        if (deriveMaximaBindings(currentForm).byRowPath.has(rowPath)) return;

        const seq = session.nextRequestSeq(existsFieldKey);
        void rpc
          .call('maximaLookup.exists', {
            kind: 'person',
            role,
            lastName: trimmedLast,
            firstName: trimmedFirst,
            middleName: trimmedMiddle,
          })
          .then((res) => {
            if (!session.isLatestRequest(existsFieldKey, seq)) return;
            if (!res.ok) {
              if (res.code === 'disabled') return;
              session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
              session.registerRetryAction(() => run(trimmedLast, trimmedFirst, trimmedMiddle));
              return;
            }
            session.clearBanner();
            if (res.kind !== 'person') return;
            const matchedIds = res.matchedIds ?? [];
            if (matchedIds.length !== 1) return;
            const matchedId = matchedIds[0]!;
            controller.update((current) => {
              const live = getAtPath(current, rowPath) as Partial<PersonNameValues> | undefined;
              if (!live) return current;
              if (
                (live.lastName ?? '').trim() !== trimmedLast ||
                (live.firstName ?? '').trim() !== trimmedFirst ||
                (live.middleName ?? '').trim() !== trimmedMiddle
              ) {
                return current;
              }
              const prevBindings = deriveMaximaBindings(current);
              const displayName = formatPersonDisplayName({
                lastName: trimmedLast,
                firstName: trimmedFirst,
                middleName: trimmedMiddle,
              });
              return bindRowIdentity(
                current,
                rowPath,
                identityInfoTypeForRole(role),
                matchedId,
                displayName,
                prevBindings,
              );
            });
          })
          .catch((err) => {
            if (!session.isLatestRequest(existsFieldKey, seq)) return;
            const msg = err instanceof Error ? err.message : String(err);
            session.recordError('offline', msg);
            session.registerRetryAction(() => run(trimmedLast, trimmedFirst, trimmedMiddle));
          });
      };

      run(lastName, firstName, middleName);
    },
    [active, controller, existsFieldKey, readOnly, role, rpc, rowPath, session],
  );

  const handleNameChange = useCallback(
    (part: 'firstName' | 'middleName' | 'lastName', value: string) => {
      const fieldKey = `${rowPath}.${part}`;
      if (!active) {
        controller.setField(fieldKey, value);
        return;
      }

      session?.invalidateField(existsFieldKey);
      controller.update(
        (current) => {
          const prevBindings = deriveMaximaBindings(current);
          const next = setAtPath(current, fieldKey, value);
          return unbindRowIdentities(next, [rowPath], prevBindings);
        },
        { coalesceKey: fieldKey },
      );

      if (part === 'middleName') return;

      const nextLast = part === 'lastName' ? value : names.lastName;
      const nextFirst = part === 'firstName' ? value : names.firstName;
      clearTimer();
      setPage(0);

      if (!meetsPersonThreshold(nextLast, nextFirst)) {
        closeDropdown();
        return;
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        executeSearch(nextLast, nextFirst, 0);
      }, PERSON_LOOKUP_DEBOUNCE_MS);
    },
    [
      active,
      clearTimer,
      closeDropdown,
      controller,
      executeSearch,
      existsFieldKey,
      names.firstName,
      names.lastName,
      rowPath,
      session,
    ],
  );

  const reopenIfEligible = useCallback(() => {
    if (!active || readOnly) return;
    if (!meetsPersonThreshold(names.lastName, names.firstName)) return;
    clearTimer();
    executeSearch(names.lastName, names.firstName, 0);
  }, [active, clearTimer, executeSearch, names.firstName, names.lastName, readOnly]);

  const handleSearchFieldFocus = useCallback(() => {
    if (dropdownOpen) return;
    reopenIfEligible();
  }, [dropdownOpen, reopenIfEligible]);

  const handleSearchFieldClick = useCallback(() => {
    if (dropdownOpen) return;
    reopenIfEligible();
  }, [dropdownOpen, reopenIfEligible]);

  const handleRowBlur = useCallback(() => {
    if (!active) return;
    closeDropdown();
    const live = controller.currentForm
      ? (getAtPath(controller.currentForm, rowPath) as Partial<PersonNameValues> | undefined)
      : undefined;
    runBlurExists(
      live?.lastName ?? names.lastName,
      live?.firstName ?? names.firstName,
      live?.middleName ?? names.middleName,
    );
  }, [
    active,
    closeDropdown,
    controller,
    names.firstName,
    names.lastName,
    names.middleName,
    rowPath,
    runBlurExists,
  ]);

  const handlePick = useCallback(
    (dropdownItem: MaximaLookupDropdownItem<MaximaPersonItem>) => {
      if (!active || !role) return;
      const picked = dropdownItem.data;
      closeDropdown();
      session?.invalidateField(existsFieldKey);
      session?.cacheEntityUrl('person', picked.id, picked.url);

      const nextLast = picked.lastName ?? '';
      const nextFirst = picked.firstName ?? '';
      const nextMiddle = picked.middleName ?? '';

      controller.update((current) => {
        const prevBindings = deriveMaximaBindings(current);
        let next = setAtPath(current, `${rowPath}.lastName`, nextLast);
        next = setAtPath(next, `${rowPath}.firstName`, nextFirst);
        next = setAtPath(next, `${rowPath}.middleName`, nextMiddle);
        const displayName = formatPersonDisplayName({
          lastName: nextLast,
          firstName: nextFirst,
          middleName: nextMiddle,
        });
        return bindRowIdentity(
          next,
          rowPath,
          identityInfoTypeForRole(role),
          picked.id,
          displayName,
          prevBindings,
        );
      });
    },
    [active, closeDropdown, controller, existsFieldKey, role, rowPath, session],
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
    const { lastName, firstName } = lastQueryRef.current;
    executeSearch(lastName, firstName, page - 1);
  }, [executeSearch, page]);

  const handleNextPage = useCallback(() => {
    if (!hasMore) return;
    const { lastName, firstName } = lastQueryRef.current;
    executeSearch(lastName, firstName, page + 1);
  }, [executeSearch, hasMore, page]);

  return {
    active,
    confirmedLibraryId,
    confirmedUrl,
    dropdownOpen,
    loading,
    errorMessage,
    items,
    activeIndex,
    page,
    hasMore,
    setActiveIndex,
    handleNameChange,
    handleSearchFieldFocus,
    handleSearchFieldClick,
    handleRowBlur,
    handleKeyDown,
    handlePick,
    handlePrevPage,
    handleNextPage,
    closeDropdown,
  };
}
