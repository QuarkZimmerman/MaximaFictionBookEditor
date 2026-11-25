/**
 * Per-document ephemeral session store for Maxima Library Lookup Service v2 in Description view
 * (feature 021, data-model.md §5, contracts/lookup-v2.md §1).
 *
 * Holds non-persisted state that must never touch the FB2 XML document:
 * - live Publisher confirmation / unresolved state, `libraryId`, and `url` (driving Publisher Series),
 * - Publisher Series confirmation / unresolved state and `url`,
 * - cached canonical entity URLs from `search` picks + deterministic zero-network fallback URLs
 *   for persons/author-series confirmed via blur `exists` or restored from `ml*id` on FB2 reopen,
 * - per-field monotonic request sequence guards to discard stale out-of-order responses,
 * - client-side `Retry-After` rate-limit cooldown clock,
 * - non-intrusive error / auth / rate-limit status banner.
 */

export type RowConfirmationStatus = 'unconfirmed' | 'confirmed' | 'unresolved';

export interface EphemeralPublisherState {
  status: RowConfirmationStatus;
  /** Live Maxima Library publisher ID used for Publisher Series `publisherIds` context. */
  libraryId: number | null;
  url: string | null;
  /** Trimmed publisher name this state corresponds to; mismatch invalidates to unconfirmed. */
  matchedName: string;
}

export interface EphemeralPublisherSeriesState {
  status: RowConfirmationStatus;
  libraryId: number | null;
  url: string | null;
  /** Trimmed series name this state corresponds to; mismatch invalidates to unconfirmed. */
  matchedName: string;
}

export interface LookupBannerState {
  code: string;
  message: string;
  retryAfterUntilMs?: number;
}

export interface DescriptionLookupSessionState {
  docId: string | null;
  /** Cached canonical site URLs from v2 search/pick answers, keyed by `<entityType>:<id>`. */
  entityUrls: ReadonlyMap<string, string>;
  publisher: EphemeralPublisherState | null;
  /** Keyed by sequence path under `publishInfo.sequences` (e.g. `publishInfo.sequences.0`). */
  publisherSeries: ReadonlyMap<string, EphemeralPublisherSeriesState>;
  /** Non-intrusive banner shown on lookup error / auth failure / rate-limit cooldown. */
  banner: LookupBannerState | null;
}

export type FallbackEntityKind = 'person' | 'authorSeries' | 'publisher' | 'publisherSeries';

function stripTrailingSlashes(domain: string): string {
  return domain.trim().replace(/\/+$/, '');
}

/**
 * Builds the zero-network canonical site URL matching Maxima Library's `RouteLinksGenerator.php`
 * whenever a confirmed row has no `search`-returned `url` cached in `entityUrls` (e.g. blur
 * `exists` for persons/author-series or reopened FB2 files with `ml*id`).
 */
export function buildFallbackEntityUrl(
  domain: string,
  kind: FallbackEntityKind,
  libraryId: number,
): string | null {
  const base = stripTrailingSlashes(domain);
  if (!base || !Number.isSafeInteger(libraryId) || libraryId <= 0) return null;
  switch (kind) {
    case 'person':
      return `${base}/index.php?option=com_maxlib&view=maxlibbookslist&layout=author&id=${libraryId}`;
    case 'authorSeries':
      return `${base}/index.php?option=com_maxlib&view=maxlibseries&id=${libraryId}`;
    case 'publisher':
      return `${base}/index.php?option=com_maxlib&view=maxlibpublisher&id=${libraryId}`;
    case 'publisherSeries':
      return `${base}/index.php?option=com_maxlib&view=maxlibpublisherseries&id=${libraryId}`;
  }
}

export function entityUrlKey(kind: FallbackEntityKind, libraryId: number): string {
  return `${kind}:${libraryId}`;
}

export class DescriptionLookupSession {
  private docId_: string | null = null;
  private entityUrls_ = new Map<string, string>();
  private publisher_: EphemeralPublisherState | null = null;
  private publisherSeries_ = new Map<string, EphemeralPublisherSeriesState>();
  private banner_: LookupBannerState | null = null;
  private rateLimitUntilMs_ = 0;
  private fieldSeq_ = new Map<string, number>();
  private listeners_ = new Set<() => void>();
  private snapshot_: DescriptionLookupSessionState;

  constructor() {
    this.snapshot_ = this.makeSnapshot();
  }

  subscribe(listener: () => void): () => void {
    this.listeners_.add(listener);
    return () => {
      this.listeners_.delete(listener);
    };
  }

  getSnapshot(): DescriptionLookupSessionState {
    return this.snapshot_;
  }

  reset(docId: string | null): void {
    this.docId_ = docId;
    this.entityUrls_ = new Map();
    this.publisher_ = null;
    this.publisherSeries_ = new Map();
    this.banner_ = null;
    this.fieldSeq_.clear();
    this.emit();
  }

  /** Allocates the next monotonic sequence number for `fieldKey` (invalidating older in-flight calls). */
  nextRequestSeq(fieldKey: string): number {
    const next = (this.fieldSeq_.get(fieldKey) ?? 0) + 1;
    this.fieldSeq_.set(fieldKey, next);
    return next;
  }

  /** Invalidates any currently in-flight lookup for `fieldKey` (e.g. on blur/tab switch/close). */
  invalidateField(fieldKey: string): void {
    this.nextRequestSeq(fieldKey);
  }

  isLatestRequest(fieldKey: string, seq: number): boolean {
    return this.fieldSeq_.get(fieldKey) === seq;
  }

  cacheEntityUrl(
    kind: FallbackEntityKind,
    libraryId: number,
    url: string | null | undefined,
  ): void {
    if (!url || !url.trim() || !Number.isSafeInteger(libraryId) || libraryId <= 0) return;
    const key = entityUrlKey(kind, libraryId);
    if (this.entityUrls_.get(key) === url.trim()) return;
    this.entityUrls_ = new Map(this.entityUrls_);
    this.entityUrls_.set(key, url.trim());
    this.emit();
  }

  resolveEntityUrl(
    domain: string,
    kind: FallbackEntityKind,
    libraryId: number | null | undefined,
  ): string | null {
    if (!libraryId || libraryId <= 0) return null;
    const cached = this.entityUrls_.get(entityUrlKey(kind, libraryId));
    if (cached) return cached;
    return buildFallbackEntityUrl(domain, kind, libraryId);
  }

  setPublisherState(state: EphemeralPublisherState | null): void {
    this.publisher_ = state;
    if (state?.libraryId && state.url) {
      this.entityUrls_ = new Map(this.entityUrls_);
      this.entityUrls_.set(entityUrlKey('publisher', state.libraryId), state.url);
    }
    this.emit();
  }

  /** Returns active Publisher state only if it still matches the current trimmed input text. */
  getPublisherForName(currentName: string): EphemeralPublisherState | null {
    if (!this.publisher_) return null;
    return this.publisher_.matchedName === currentName.trim() ? this.publisher_ : null;
  }

  setPublisherSeriesState(rowPath: string, state: EphemeralPublisherSeriesState | null): void {
    const next = new Map(this.publisherSeries_);
    if (state === null) {
      next.delete(rowPath);
    } else {
      next.set(rowPath, state);
      if (state.libraryId && state.url) {
        this.entityUrls_ = new Map(this.entityUrls_);
        this.entityUrls_.set(entityUrlKey('publisherSeries', state.libraryId), state.url);
      }
    }
    this.publisherSeries_ = next;
    this.emit();
  }

  getPublisherSeriesForName(
    rowPath: string,
    currentName: string,
  ): EphemeralPublisherSeriesState | null {
    const entry = this.publisherSeries_.get(rowPath);
    if (!entry) return null;
    return entry.matchedName === currentName.trim() ? entry : null;
  }

  clearPublisherSeriesAll(): void {
    if (this.publisherSeries_.size === 0) return;
    this.publisherSeries_ = new Map();
    this.emit();
  }

  /** Remaining milliseconds in active 429 cooldown window (0 when expired). */
  rateLimitRemainingMs(nowMs: number = Date.now()): number {
    return Math.max(0, this.rateLimitUntilMs_ - nowMs);
  }

  recordError(
    code: string,
    message: string,
    retryAfterSeconds?: number,
    nowMs: number = Date.now(),
  ): void {
    if (code === 'disabled' || code === 'cancelled') return;
    let retryAfterUntilMs: number | undefined;
    if (code === 'rate_limited' && retryAfterSeconds && retryAfterSeconds > 0) {
      retryAfterUntilMs = nowMs + retryAfterSeconds * 1000;
      if (retryAfterUntilMs > this.rateLimitUntilMs_) {
        this.rateLimitUntilMs_ = retryAfterUntilMs;
      }
    }
    this.banner_ = { code, message, ...(retryAfterUntilMs ? { retryAfterUntilMs } : {}) };
    this.emit();
  }

  clearBanner(): void {
    if (this.banner_ === null) return;
    this.banner_ = null;
    this.emit();
  }

  private makeSnapshot(): DescriptionLookupSessionState {
    return {
      docId: this.docId_,
      entityUrls: this.entityUrls_,
      publisher: this.publisher_,
      publisherSeries: this.publisherSeries_,
      banner: this.banner_,
    };
  }

  private emit(): void {
    this.snapshot_ = this.makeSnapshot();
    for (const listener of [...this.listeners_]) {
      listener();
    }
  }
}
