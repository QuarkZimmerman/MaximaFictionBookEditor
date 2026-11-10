/**
 * Feature 012 (US3; D29, DP-15, FR-045; SC-009, SC-010): the interface's share of the import's
 * limits. The core refuses what is too large before anything is read (the file, its unpacked size,
 * its entries, a picture's pixels); here the nesting of the pages is flattened past a depth, a
 * picture the engine decodes is held to the same pixel limit, and the long work yields to the
 * interface often enough that the progress moves and Cancel takes effect within a second.
 */

/** Nesting deeper than this is flattened into paragraphs and listed (010 FR-096). */
export const MAX_NESTING = 64;

/** The core's limit too (epub_handlers.cpp kMaxPicturePixels). */
export const MAX_PICTURE_PIXELS = 100_000_000;

/** How long the work runs before it lets the interface draw and handle Cancel. */
const SLICE_MS = 50;

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

/** Cooperative yielding: `step()` between units of work, cheap when no time has passed. */
export class Yielder {
  private last = performance.now();

  constructor(
    private readonly cancelled: () => boolean = () => false,
    private readonly progress: () => void = () => undefined,
  ) {}

  async step(): Promise<void> {
    this.progress();
    if (this.cancelled()) throw new CancelledError();
    if (performance.now() - this.last < SLICE_MS) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    this.last = performance.now();
    if (this.cancelled()) throw new CancelledError();
  }
}
