/**
 * Caret registry: each view (Body, Source, Description) registers how to read and move its
 * caret so that "Restore position" (FR-008, `doc.caret`), the Recent Files caret and the
 * validation panel's "go to issue" work without the file flows knowing the editors.
 */

import type { Caret, ViewId } from '@/rpc/types';

export interface CaretProvider {
  /** Current caret of the view, or null when there is nothing to remember. */
  get(): Caret | null;
  /** Moves the view's selection to `caret`; false when the target does not exist. */
  set(caret: Caret): boolean;
}

export class CaretRegistry {
  private readonly providers = new Map<ViewId, CaretProvider>();

  register(view: ViewId, provider: CaretProvider): () => void {
    this.providers.set(view, provider);
    return () => {
      if (this.providers.get(view) === provider) this.providers.delete(view);
    };
  }

  has(view: ViewId): boolean {
    return this.providers.has(view);
  }

  /** Caret of `view` (null when the view is not mounted or has no selection). */
  get(view: ViewId): Caret | null {
    return this.providers.get(view)?.get() ?? null;
  }

  /** Moves the caret of `caret.view`; false when that view is not mounted or the target is gone. */
  set(caret: Caret): boolean {
    return this.providers.get(caret.view)?.set(caret) ?? false;
  }
}
