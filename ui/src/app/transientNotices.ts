/**
 * Transient notices (feature 003, FR-014): a short text shown in the work area for a few
 * seconds - "Script ... finished in 8 s" after a long run - that goes away by itself, can be
 * dismissed with a click and never takes the focus. One notice at a time per application store;
 * a new one replaces the current one. The component `TransientNotice.tsx` renders it; this
 * module keeps the state so that non-React code (the script host) can show a notice.
 */

import type { AppStore } from '@/model/store';

export type TransientNoticeKind = 'info';

export interface TransientNotice {
  text: string;
  kind: TransientNoticeKind;
  /** Time after which the notice hides by itself. */
  ttlMs: number;
}

/** The notice as shown: `id` tells one notice from the next with the same text. */
export interface ShownTransientNotice extends TransientNotice {
  id: number;
}

export const DEFAULT_NOTICE_TTL_MS = 6_000;

export class TransientNoticeStore {
  private current: ShownTransientNotice | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextId = 1;
  private readonly listeners = new Set<() => void>();

  /** Shows `notice` (replacing the current one) and arms its auto-hide timer. */
  show(notice: Partial<TransientNotice> & { text: string }): ShownTransientNotice {
    this.clearTimer();
    const shown: ShownTransientNotice = {
      id: this.nextId++,
      text: notice.text,
      kind: notice.kind ?? 'info',
      ttlMs: notice.ttlMs ?? DEFAULT_NOTICE_TTL_MS,
    };
    this.current = shown;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dismiss(shown.id);
    }, shown.ttlMs);
    this.emit();
    return shown;
  }

  /** Hides the current notice (or only the notice `id`, when given and still shown). */
  dismiss(id?: number): void {
    if (!this.current || (id !== undefined && this.current.id !== id)) return;
    this.clearTimer();
    this.current = null;
    this.emit();
  }

  /** `useSyncExternalStore` snapshot: the notice shown, or null. */
  get = (): ShownTransientNotice | null => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

const stores = new WeakMap<AppStore, TransientNoticeStore>();

/** The notice store of an application store (created on first use). */
export function transientNotices(store: AppStore): TransientNoticeStore {
  let notices = stores.get(store);
  if (!notices) {
    notices = new TransientNoticeStore();
    stores.set(store, notices);
  }
  return notices;
}

/** Shows a notice in the work area of the application `store` belongs to. */
export function showTransientNotice(
  store: AppStore,
  notice: Partial<TransientNotice> & { text: string },
): ShownTransientNotice {
  return transientNotices(store).show(notice);
}
