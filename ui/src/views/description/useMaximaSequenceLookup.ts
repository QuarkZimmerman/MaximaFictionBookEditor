/**
 * Maxima Library Lookup Service v2 hook for Author Series (`titleInfo.sequences`, 3 tabs, 1000 ms,
 * `mlseriesid` identity persistence) and Publisher Series (`publishInfo.sequences`, 2 tabs,
 * 400 ms, ephemeral session confirmation & advisory disambiguation) in `SequenceList`
 * (feature 021, FR-018, FR-020, FR-021, FR-024..FR-028, contracts/lookup-v2.md §2 & §4).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  bindRowIdentity,
  deriveMaximaBindings,
  MAXIMA_SERIES_IDENTITY_INFO_TYPE,
  unbindRowIdentities,
  type MaximaDescriptionBindings,
} from '@/features/description/maximaIdentities';
import type { RowConfirmationStatus } from '@/features/lookup/descriptionLookupSession';
import type {
  MaximaAuthorSeriesItem,
  MaximaPersonNameFragment,
  MaximaPublisherSeriesItem,
} from '@/rpc/types';

import type { FormInput } from './binding';
import { useDescriptionForm } from './formContext';
import type {
  MaximaLookupDropdownItem,
  MaximaLookupRowHighlight,
  MaximaLookupTabOption,
} from './MaximaLookupDropdown';
import { formatLookupErrorMessage } from './maximaLookupMessages';
import { getAtPath, setAtPath, type DescriptionForm } from './model';

export type SequenceLookupMode = 'authorSeries' | 'publisherSeries';

export const AUTHOR_SERIES_DEBOUNCE_MS = 1000;
export const PUBLISHER_SERIES_DEBOUNCE_MS = 400;
export const SERIES_LOOKUP_PAGE_SIZE = 30;

export interface AuthorSeriesPersonContext {
  authorIds: number[];
  authorNames: MaximaPersonNameFragment[];
  makerIds: number[];
  makerNames: MaximaPersonNameFragment[];
  authorsCount: number;
  otherMakersCount: number;
}

/**
 * Extracts confirmed IDs and unconfirmed names for Authors and Makers (`translator`, `illustrator`,
 * `editor`, `compiler`, `designer`, `commentator` — explicitly excluding `aboutTheAuthor`, matching
 * Maxima Library's `author-series-suggestions.js`).
 */
export function collectAuthorSeriesPersons(
  form: DescriptionForm,
  bindings: MaximaDescriptionBindings,
): AuthorSeriesPersonContext {
  const authorIds: number[] = [];
  const authorNames: MaximaPersonNameFragment[] = [];
  const makerIds: number[] = [];
  const makerNames: MaximaPersonNameFragment[] = [];
  const seenIds = new Set<number>();
  let authorsCount = 0;
  let otherMakersCount = 0;

  const authors = form.titleInfo.authors ?? [];
  for (let i = 0; i < authors.length; i += 1) {
    const p = authors[i]!;
    const lastName = (p.lastName ?? '').trim();
    const firstName = (p.firstName ?? '').trim();
    const middleName = (p.middleName ?? '').trim();
    if (!lastName && !firstName) continue;
    authorsCount += 1;
    const binding = bindings.byRowPath.get(`titleInfo.authors.${i}`);
    if (binding && binding.libraryId > 0) {
      if (!seenIds.has(binding.libraryId)) {
        seenIds.add(binding.libraryId);
        authorIds.push(binding.libraryId);
        makerIds.push(binding.libraryId);
      }
    } else {
      const frag = { lastName, firstName, middleName };
      authorNames.push(frag);
      makerNames.push(frag);
    }
  }

  const translators = form.titleInfo.translators ?? [];
  for (let i = 0; i < translators.length; i += 1) {
    const p = translators[i]!;
    const lastName = (p.lastName ?? '').trim();
    const firstName = (p.firstName ?? '').trim();
    const middleName = (p.middleName ?? '').trim();
    if (!lastName && !firstName) continue;
    otherMakersCount += 1;
    const binding = bindings.byRowPath.get(`titleInfo.translators.${i}`);
    if (binding && binding.libraryId > 0) {
      if (!seenIds.has(binding.libraryId)) {
        seenIds.add(binding.libraryId);
        makerIds.push(binding.libraryId);
      }
    } else {
      makerNames.push({ lastName, firstName, middleName });
    }
  }

  const roles = form.roles ?? [];
  for (let i = 0; i < roles.length; i += 1) {
    const entry = roles[i]!;
    if (entry.role === 'aboutTheAuthor') continue;
    const lastName = (entry.lastName ?? '').trim();
    const firstName = (entry.firstName ?? '').trim();
    const middleName = (entry.middleName ?? '').trim();
    if (!lastName && !firstName) continue;
    otherMakersCount += 1;
    const binding = bindings.byRowPath.get(`roles.${i}`);
    if (binding && binding.libraryId > 0) {
      if (!seenIds.has(binding.libraryId)) {
        seenIds.add(binding.libraryId);
        makerIds.push(binding.libraryId);
      }
    } else {
      makerNames.push({ lastName, firstName, middleName });
    }
  }

  return { authorIds, authorNames, makerIds, makerNames, authorsCount, otherMakersCount };
}

export interface UseMaximaSequenceLookupOptions {
  rowPath: string;
  mode: SequenceLookupMode | undefined;
  seriesName: string;
  /** Row path of the parent `<sequence>` when nested under an Author Series row. */
  parentRowPath?: string;
  /** Callback invoked right after picking a series so caller can focus the volume number input. */
  onAfterPick?: () => void;
}

type AnySeriesItem = MaximaAuthorSeriesItem | MaximaPublisherSeriesItem;

export interface UseMaximaSequenceLookupResult {
  active: boolean;
  status: RowConfirmationStatus;
  confirmedLibraryId: number | null;
  confirmedUrl: string | null;
  dropdownOpen: boolean;
  loading: boolean;
  typeToSearchPrompt: boolean;
  disambiguationPrompt: boolean;
  errorMessage: string | null;
  tabs: readonly MaximaLookupTabOption[];
  activeTabId: string;
  items: readonly MaximaLookupDropdownItem<AnySeriesItem>[];
  activeIndex: number;
  page: number;
  hasMore: boolean;
  setActiveIndex: (index: number) => void;
  handleNameChange: (value: string) => void;
  handleFocus: () => void;
  handleClick: () => void;
  handleBlur: () => void;
  handleKeyDown: (event: React.KeyboardEvent<FormInput>) => void;
  handleSelectTab: (tabId: string) => void;
  handlePick: (item: MaximaLookupDropdownItem<AnySeriesItem>) => void;
  handlePrevPage: () => void;
  handleNextPage: () => void;
  closeDropdown: () => void;
}

export function useMaximaSequenceLookup({
  rowPath,
  mode,
  seriesName,
  parentRowPath,
  onAfterPick,
}: UseMaximaSequenceLookupOptions): UseMaximaSequenceLookupResult {
  const { t } = useTranslation();
  const { controller, form, readOnly, maximaLookup } = useDescriptionForm();

  const active = Boolean(mode && maximaLookup?.enabled && maximaLookup.rpc);
  const rpc = maximaLookup?.rpc ?? null;
  const session = maximaLookup?.session ?? null;
  const domain = maximaLookup?.domain ?? '';
  const bindings = maximaLookup?.bindings;

  const parentSeriesId =
    mode === 'authorSeries' && parentRowPath && bindings
      ? (bindings.byRowPath.get(parentRowPath)?.libraryId ?? undefined)
      : undefined;

  const authorContext = useMemo(() => {
    if (!active || mode !== 'authorSeries' || !bindings) {
      return {
        authorIds: [] as number[],
        authorNames: [] as MaximaPersonNameFragment[],
        makerIds: [] as number[],
        makerNames: [] as MaximaPersonNameFragment[],
        authorsCount: 0,
        otherMakersCount: 0,
      };
    }
    return collectAuthorSeriesPersons(form, bindings);
  }, [active, bindings, form, mode]);

  const snapshotPublisher = maximaLookup?.snapshot.publisher ?? null;
  const publisherContext = useMemo(() => {
    if (!active || mode !== 'publisherSeries') {
      return {
        hasPublisher: false,
        publisherIds: [] as number[],
        publisherNames: [] as string[],
      };
    }
    const pubName = (form.publishInfo?.publisher ?? '').trim();
    const pubState =
      snapshotPublisher && snapshotPublisher.matchedName === pubName ? snapshotPublisher : null;
    if (!pubName || pubState?.status === 'unresolved') {
      return {
        hasPublisher: false,
        publisherIds: [] as number[],
        publisherNames: [] as string[],
      };
    }
    return {
      hasPublisher: true,
      publisherIds: pubState?.libraryId ? [pubState.libraryId] : [],
      publisherNames: [pubName],
    };
  }, [active, form.publishInfo?.publisher, mode, snapshotPublisher]);

  const tabs = useMemo<MaximaLookupTabOption[]>(() => {
    if (!active) return [];
    if (mode === 'authorSeries') {
      const list: MaximaLookupTabOption[] = [
        { id: 'all', label: t('maximaLibrary.lookup.tabs.all') },
      ];
      if (authorContext.authorsCount > 0) {
        list.push({ id: 'authors', label: t('maximaLibrary.lookup.tabs.authors') });
      }
      if (authorContext.otherMakersCount > 0 || authorContext.authorsCount >= 2) {
        list.push({ id: 'makers', label: t('maximaLibrary.lookup.tabs.makers') });
      }
      return list;
    }
    if (mode === 'publisherSeries') {
      const list: MaximaLookupTabOption[] = [
        { id: 'all', label: t('maximaLibrary.lookup.tabs.all') },
      ];
      if (publisherContext.hasPublisher) {
        list.push({ id: 'publisher', label: t('maximaLibrary.lookup.tabs.byPublisher') });
      }
      return list;
    }
    return [];
  }, [
    active,
    authorContext.authorsCount,
    authorContext.otherMakersCount,
    mode,
    publisherContext.hasPublisher,
    t,
  ]);

  // Confirmation status & URL
  let status: RowConfirmationStatus = 'unconfirmed';
  let confirmedLibraryId: number | null = null;
  let confirmedUrl: string | null = null;
  if (active && mode === 'authorSeries' && bindings && session) {
    const b = bindings.byRowPath.get(rowPath);
    if (b) {
      status = 'confirmed';
      confirmedLibraryId = b.libraryId;
      confirmedUrl = session.resolveEntityUrl(domain, 'authorSeries', b.libraryId);
    }
  } else if (active && mode === 'publisherSeries') {
    const pubSeriesMap = maximaLookup?.snapshot.publisherSeries;
    const entry = pubSeriesMap?.get(rowPath);
    if (entry && entry.matchedName === seriesName.trim()) {
      status = entry.status;
      confirmedLibraryId = entry.libraryId;
      confirmedUrl = entry.url;
    }
  }

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>(seriesName);
  const activeTabRef = useRef<string>('all');

  const [openRequested, setOpenRequested] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string>('all');
  const [loading, setLoading] = useState(false);
  const [typeToSearchPrompt, setTypeToSearchPrompt] = useState(false);
  const [disambiguationPrompt, setDisambiguationPrompt] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [items, setItems] = useState<MaximaLookupDropdownItem<AnySeriesItem>[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const dropdownOpen = active && !readOnly && openRequested;
  const effectiveActiveTabId = dropdownOpen ? activeTabId : 'all';
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
    activeTabRef.current = 'all';
    setActiveTabId('all');
    setOpenRequested(false);
    setLoading(false);
    setTypeToSearchPrompt(false);
    setDisambiguationPrompt(false);
    setErrorMessage(null);
  }, [clearTimer, searchFieldKey, session]);

  useEffect(() => {
    if (readOnly || !active) {
      clearTimer();
      session?.invalidateField(searchFieldKey);
      session?.invalidateField(existsFieldKey);
      activeTabRef.current = 'all';
    }
  }, [active, clearTimer, existsFieldKey, readOnly, searchFieldKey, session]);

  useEffect(() => {
    return () => {
      clearTimer();
      session?.invalidateField(searchFieldKey);
      session?.invalidateField(existsFieldKey);
    };
  }, [clearTimer, existsFieldKey, searchFieldKey, session]);

  const mapAuthorSeriesItems = useCallback(
    (raw: readonly MaximaAuthorSeriesItem[]): MaximaLookupDropdownItem<AnySeriesItem>[] =>
      raw.map((item) => {
        const highlight: MaximaLookupRowHighlight = item.authors
          ? 'authors'
          : item.makers
            ? 'makers'
            : 'none';
        return {
          id: item.id,
          title: item.name,
          subtitle: item.parent?.name
            ? t('maximaLibrary.lookup.subseriesIn', { parent: item.parent.name })
            : undefined,
          url: item.url ?? '',
          highlight,
          data: item,
        };
      }),
    [t],
  );

  const mapPublisherSeriesItems = useCallback(
    (raw: readonly MaximaPublisherSeriesItem[]): MaximaLookupDropdownItem<AnySeriesItem>[] =>
      raw.map((item) => {
        const highlight: MaximaLookupRowHighlight = item.linked
          ? 'linked'
          : item.nameMatch
            ? 'nameMatch'
            : 'none';
        const linkedNames = (item.publishers ?? []).map((p) => p.name).filter(Boolean);
        let subtitle: string | undefined;
        if (linkedNames.length > 0) {
          subtitle = t('maximaLibrary.lookup.linkedTo', { names: linkedNames.join(' | ') });
        } else if (item.text && item.text.trim().length > 0) {
          subtitle = item.text.trim();
        }
        return {
          id: item.id,
          title: item.name,
          subtitle,
          url: item.url ?? '',
          highlight,
          data: item,
        };
      }),
    [t],
  );

  const executeSearch = useCallback(
    (query: string, tabId: string, targetPage: number) => {
      const run = (q: string, tab: string, pg: number) => {
        if (!active || !mode || !rpc || !session || readOnly) return;
        const trimmed = q.trim();
        lastQueryRef.current = trimmed;
        const effectiveTab = tabs.some((tb) => tb.id === tab) ? tab : 'all';
        activeTabRef.current = effectiveTab;
        setActiveTabId(effectiveTab);
        setDisambiguationPrompt(false);

        // Empty query on 'all': show local "Type to search..." prompt with zero network calls when
        // narrowed tabs exist; close otherwise.
        if (trimmed.length === 0 && effectiveTab === 'all') {
          session.invalidateField(searchFieldKey);
          if (tabs.length > 1) {
            setOpenRequested(true);
            setLoading(false);
            setTypeToSearchPrompt(true);
            setErrorMessage(null);
            setItems([]);
            setPage(0);
            setHasMore(false);
          } else {
            closeDropdown();
          }
          return;
        }

        if (session.rateLimitRemainingMs() > 0) {
          const secs = Math.ceil(session.rateLimitRemainingMs() / 1000);
          setOpenRequested(true);
          setLoading(false);
          setTypeToSearchPrompt(false);
          setErrorMessage(formatLookupErrorMessage(t, 'rate_limited', secs));
          return;
        }

        const seq = session.nextRequestSeq(searchFieldKey);
        setOpenRequested(true);
        setLoading(true);
        setTypeToSearchPrompt(false);
        setErrorMessage(null);
        setPage(pg);

        const rpcParams =
          mode === 'authorSeries'
            ? {
                kind: 'authorSeries' as const,
                seriesName: trimmed,
                narrow: effectiveTab as 'all' | 'authors' | 'makers',
                ...(parentSeriesId ? { excludedSeriesId: parentSeriesId } : {}),
                ...(authorContext.authorIds.length > 0
                  ? { authorIds: authorContext.authorIds }
                  : {}),
                ...(authorContext.authorNames.length > 0
                  ? { authorNames: authorContext.authorNames }
                  : {}),
                ...(authorContext.makerIds.length > 0 ? { makerIds: authorContext.makerIds } : {}),
                ...(authorContext.makerNames.length > 0
                  ? { makerNames: authorContext.makerNames }
                  : {}),
                page: pg,
                pageSize: SERIES_LOOKUP_PAGE_SIZE,
              }
            : {
                kind: 'publisherSeries' as const,
                seriesName: trimmed,
                ...(publisherContext.publisherIds.length > 0
                  ? { publisherIds: publisherContext.publisherIds }
                  : {}),
                ...(publisherContext.publisherNames.length > 0
                  ? { publisherNames: publisherContext.publisherNames }
                  : {}),
                restrict: effectiveTab === 'publisher',
                page: pg,
                pageSize: SERIES_LOOKUP_PAGE_SIZE,
              };

        void rpc
          .call('maximaLookup.search', rpcParams)
          .then((res) => {
            if (!session.isLatestRequest(searchFieldKey, seq)) return;
            setLoading(false);
            if (!res.ok) {
              if (res.code === 'disabled') {
                setOpenRequested(false);
                return;
              }
              session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
              session.registerRetryAction(() => run(trimmed, effectiveTab, pg));
              setErrorMessage(
                formatLookupErrorMessage(t, res.code, res.retryAfterSeconds, res.message),
              );
              setItems([]);
              setHasMore(false);
              return;
            }
            session.clearBanner();
            const mapped =
              mode === 'authorSeries'
                ? mapAuthorSeriesItems((res.items ?? []) as MaximaAuthorSeriesItem[])
                : mapPublisherSeriesItems((res.items ?? []) as MaximaPublisherSeriesItem[]);
            setItems(mapped);
            setHasMore(Boolean(res.hasMore));
            setActiveIndex(0);
          })
          .catch((err) => {
            if (!session.isLatestRequest(searchFieldKey, seq)) return;
            setLoading(false);
            const msg = err instanceof Error ? err.message : String(err);
            session.recordError('offline', msg);
            session.registerRetryAction(() => run(trimmed, effectiveTab, pg));
            setErrorMessage(formatLookupErrorMessage(t, 'offline', undefined, msg));
            setItems([]);
            setHasMore(false);
          });
      };

      run(query, tabId, targetPage);
    },
    [
      active,
      authorContext.authorIds,
      authorContext.authorNames,
      authorContext.makerIds,
      authorContext.makerNames,
      closeDropdown,
      mapAuthorSeriesItems,
      mapPublisherSeriesItems,
      mode,
      parentSeriesId,
      publisherContext.publisherIds,
      publisherContext.publisherNames,
      readOnly,
      rpc,
      searchFieldKey,
      session,
      t,
      tabs,
    ],
  );

  const runBlurExists = useCallback(
    (name: string) => {
      const run = (qName: string) => {
        if (!active || !mode || !rpc || !session || readOnly) return;
        const trimmed = qName.trim();
        if (!trimmed) return;
        if (session.rateLimitRemainingMs() > 0) return;

        if (mode === 'authorSeries') {
          const currentForm = controller.currentForm;
          if (!currentForm || deriveMaximaBindings(currentForm).byRowPath.has(rowPath)) return;
          const seq = session.nextRequestSeq(existsFieldKey);
          void rpc
            .call('maximaLookup.exists', {
              kind: 'authorSeries',
              seriesName: trimmed,
              ...(parentSeriesId ? { parentSeriesId } : {}),
            })
            .then((res) => {
              if (!session.isLatestRequest(existsFieldKey, seq)) return;
              if (!res.ok) {
                if (res.code === 'disabled') return;
                session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
                session.registerRetryAction(() => run(trimmed));
                return;
              }
              session.clearBanner();
              if (res.kind !== 'authorSeries' || res.matchedIds.length !== 1) return;
              const matchedId = res.matchedIds[0]!;
              controller.update((current) => {
                const liveName = String(getAtPath(current, `${rowPath}.name`) ?? '').trim();
                if (liveName !== trimmed) return current;
                const prevBindings = deriveMaximaBindings(current);
                return bindRowIdentity(
                  current,
                  rowPath,
                  MAXIMA_SERIES_IDENTITY_INFO_TYPE,
                  matchedId,
                  trimmed,
                  prevBindings,
                );
              });
            })
            .catch((err) => {
              if (!session.isLatestRequest(existsFieldKey, seq)) return;
              const msg = err instanceof Error ? err.message : String(err);
              session.recordError('offline', msg);
              session.registerRetryAction(() => run(trimmed));
            });
          return;
        }

        // Publisher Series blur exact-match (publisher-prioritized confirmation & advisory disambiguation)
        const existing = session.getPublisherSeriesForName(rowPath, trimmed);
        if (existing?.status === 'confirmed') return;
        const seq = session.nextRequestSeq(existsFieldKey);
        void rpc
          .call('maximaLookup.exists', {
            kind: 'publisherSeries',
            seriesName: trimmed,
            ...(publisherContext.publisherIds.length > 0
              ? { publisherIds: publisherContext.publisherIds }
              : {}),
            ...(publisherContext.publisherNames.length > 0
              ? { publisherNames: publisherContext.publisherNames }
              : {}),
          })
          .then((res) => {
            if (!session.isLatestRequest(existsFieldKey, seq)) return;
            if (!res.ok) {
              if (res.code === 'disabled') return;
              session.recordError(res.code ?? 'http', res.message ?? '', res.retryAfterSeconds);
              session.registerRetryAction(() => run(trimmed));
              return;
            }
            session.clearBanner();
            if (res.kind !== 'publisherSeries') return;
            const liveName = controller.currentForm
              ? String(getAtPath(controller.currentForm, `${rowPath}.name`) ?? '').trim()
              : '';
            if (liveName !== trimmed) return;

            const allItems = res.items ?? [];
            const linkedItems = allItems.filter((it) => it.linked);
            if (linkedItems.length === 1) {
              const match = linkedItems[0]!;
              session.setPublisherSeriesState(rowPath, {
                status: 'confirmed',
                libraryId: match.id,
                url: match.url ?? null,
                matchedName: trimmed,
              });
            } else if (linkedItems.length > 1) {
              session.setPublisherSeriesState(rowPath, {
                status: 'unresolved',
                libraryId: null,
                url: null,
                matchedName: trimmed,
              });
              setItems(mapPublisherSeriesItems(linkedItems));
              setActiveIndex(0);
              setPage(0);
              setHasMore(false);
              setTypeToSearchPrompt(false);
              setDisambiguationPrompt(true);
              setErrorMessage(null);
              setLoading(false);
              setOpenRequested(true);
            } else if (allItems.length === 1) {
              const match = allItems[0]!;
              session.setPublisherSeriesState(rowPath, {
                status: 'confirmed',
                libraryId: match.id,
                url: match.url ?? null,
                matchedName: trimmed,
              });
            } else if (allItems.length > 1) {
              session.setPublisherSeriesState(rowPath, {
                status: 'unresolved',
                libraryId: null,
                url: null,
                matchedName: trimmed,
              });
              setItems(mapPublisherSeriesItems(allItems));
              setActiveIndex(0);
              setPage(0);
              setHasMore(false);
              setTypeToSearchPrompt(false);
              setDisambiguationPrompt(true);
              setErrorMessage(null);
              setLoading(false);
              setOpenRequested(true);
            } else {
              session.setPublisherSeriesState(rowPath, null);
            }
          })
          .catch((err) => {
            if (!session.isLatestRequest(existsFieldKey, seq)) return;
            const msg = err instanceof Error ? err.message : String(err);
            session.recordError('offline', msg);
            session.registerRetryAction(() => run(trimmed));
          });
      };

      run(name);
    },
    [
      active,
      controller,
      existsFieldKey,
      mapPublisherSeriesItems,
      mode,
      parentSeriesId,
      publisherContext.publisherIds,
      publisherContext.publisherNames,
      readOnly,
      rpc,
      rowPath,
      session,
    ],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      const nameFieldKey = `${rowPath}.name`;
      if (!active || !mode) {
        controller.setField(nameFieldKey, value);
        return;
      }

      session?.invalidateField(existsFieldKey);
      if (mode === 'authorSeries') {
        controller.update(
          (current) => {
            const prevBindings = deriveMaximaBindings(current);
            const next = setAtPath(current, nameFieldKey, value);
            return unbindRowIdentities(next, [rowPath], prevBindings);
          },
          { coalesceKey: nameFieldKey },
        );
      } else {
        controller.setField(nameFieldKey, value);
        session?.setPublisherSeriesState(rowPath, null);
      }

      clearTimer();
      setPage(0);
      setDisambiguationPrompt(false);

      const trimmed = value.trim();
      const tabNow = activeTabRef.current;
      if (trimmed.length === 0 && tabNow === 'all') {
        if (tabs.length > 1) {
          session?.invalidateField(searchFieldKey);
          setOpenRequested(true);
          setLoading(false);
          setTypeToSearchPrompt(true);
          setErrorMessage(null);
          setItems([]);
          setHasMore(false);
        } else {
          closeDropdown();
        }
        return;
      }

      const delay =
        mode === 'authorSeries' ? AUTHOR_SERIES_DEBOUNCE_MS : PUBLISHER_SERIES_DEBOUNCE_MS;
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        executeSearch(value, activeTabRef.current, 0);
      }, delay);
    },
    [
      active,
      clearTimer,
      closeDropdown,
      controller,
      executeSearch,
      existsFieldKey,
      mode,
      rowPath,
      searchFieldKey,
      session,
      tabs.length,
    ],
  );

  const openOnFocusOrClick = useCallback(() => {
    if (!active || readOnly) return;
    if (dropdownOpen) return;
    clearTimer();
    const trimmed = seriesName.trim();
    if (trimmed.length === 0) {
      if (tabs.length > 1) {
        activeTabRef.current = 'all';
        setActiveTabId('all');
        setOpenRequested(true);
        setLoading(false);
        setTypeToSearchPrompt(true);
        setDisambiguationPrompt(false);
        setErrorMessage(null);
        setItems([]);
        setPage(0);
        setHasMore(false);
      }
      return;
    }
    executeSearch(trimmed, 'all', 0);
  }, [active, clearTimer, dropdownOpen, executeSearch, readOnly, seriesName, tabs.length]);

  const handleBlur = useCallback(() => {
    if (!active) return;
    closeDropdown();
    const liveName = controller.currentForm
      ? String(getAtPath(controller.currentForm, `${rowPath}.name`) ?? '')
      : seriesName;
    runBlurExists(liveName);
  }, [active, closeDropdown, controller, rowPath, runBlurExists, seriesName]);

  const handleSelectTab = useCallback(
    (tabId: string) => {
      if (!active || readOnly) return;
      clearTimer();
      const liveName = controller.currentForm
        ? String(getAtPath(controller.currentForm, `${rowPath}.name`) ?? '')
        : seriesName;
      executeSearch(liveName, tabId, 0);
    },
    [active, clearTimer, controller, executeSearch, readOnly, rowPath, seriesName],
  );

  const handlePick = useCallback(
    (dropdownItem: MaximaLookupDropdownItem<AnySeriesItem>) => {
      if (!active || !mode) return;
      const picked = dropdownItem.data;
      closeDropdown();
      session?.invalidateField(existsFieldKey);

      if (mode === 'authorSeries') {
        session?.cacheEntityUrl('authorSeries', picked.id, picked.url);
        controller.update((current) => {
          const prevBindings = deriveMaximaBindings(current);
          const next = setAtPath(current, `${rowPath}.name`, picked.name);
          return bindRowIdentity(
            next,
            rowPath,
            MAXIMA_SERIES_IDENTITY_INFO_TYPE,
            picked.id,
            picked.name,
            prevBindings,
          );
        });
      } else {
        controller.update((current) => setAtPath(current, `${rowPath}.name`, picked.name));
        session?.setPublisherSeriesState(rowPath, {
          status: 'confirmed',
          libraryId: picked.id,
          url: picked.url ?? null,
          matchedName: picked.name.trim(),
        });
      }

      // Site parity (FR-018, FR-020): move focus to the volume/sequence number box after pick.
      onAfterPick?.();
    },
    [active, closeDropdown, controller, existsFieldKey, mode, onAfterPick, rowPath, session],
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
    executeSearch(lastQueryRef.current, activeTabRef.current, page - 1);
  }, [executeSearch, page]);

  const handleNextPage = useCallback(() => {
    if (!hasMore) return;
    executeSearch(lastQueryRef.current, activeTabRef.current, page + 1);
  }, [executeSearch, hasMore, page]);

  return {
    active,
    status,
    confirmedLibraryId,
    confirmedUrl,
    dropdownOpen,
    loading,
    typeToSearchPrompt,
    disambiguationPrompt,
    errorMessage,
    tabs,
    activeTabId: effectiveActiveTabId,
    items,
    activeIndex,
    page,
    hasMore,
    setActiveIndex,
    handleNameChange,
    handleFocus: openOnFocusOrClick,
    handleClick: openOnFocusOrClick,
    handleBlur,
    handleKeyDown,
    handleSelectTab,
    handlePick,
    handlePrevPage,
    handleNextPage,
    closeDropdown,
  };
}
