/**
 * Feature 011 (research DP-11; FR-054, FR-020g): a modal job - the Markdown export, Preview while it
 * prepares a book - shows its progress with *Cancel* over the whole window. Meanwhile the rest of
 * the interface is inert, keys reach only the overlay, and the window refuses to close
 * (`isModalJobRunning`, read by the close flow). Nothing of a job is kept after it ends.
 */

export interface ModalJob {
  /** What runs, in the interface language ("Exporting as Markdown…", "Rendering…"). */
  readonly title: string;
  readonly done: number;
  readonly total: number;
}

export interface ModalJobHandle {
  /** Reports progress; `total` 0 shows an indeterminate bar. */
  progress(done: number, total: number): void;
  /** Ends the job: the overlay goes and the interface takes input again. */
  end(): void;
}

type Listener = (job: ModalJob | null) => void;

let current: { job: ModalJob; cancel: () => void } | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  const job = current?.job ?? null;
  for (const listener of listeners) listener(job);
}

/** The running modal job, or null. */
export function currentModalJob(): ModalJob | null {
  return current?.job ?? null;
}

export function isModalJobRunning(): boolean {
  return current !== null;
}

export function onModalJob(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Starts a modal job; `onCancel` runs when the user presses *Cancel* (the job then ends itself
 * through its handle). Only one runs at a time: starting a second one throws.
 */
export function startModalJob(title: string, onCancel: () => void): ModalJobHandle {
  if (current) throw new Error('a modal job is already running');
  const entry = { job: { title, done: 0, total: 0 }, cancel: onCancel };
  current = entry;
  emit();
  return {
    progress(done, total) {
      if (current !== entry) return;
      entry.job = { title, done, total };
      emit();
    },
    end() {
      if (current !== entry) return;
      current = null;
      emit();
    },
  };
}

/** *Cancel* of the overlay. */
export function cancelModalJob(): void {
  current?.cancel();
}

const KEY_EVENTS = ['keydown', 'keypress', 'keyup'] as const;

/**
 * Makes `root` (the whole interface but the overlay) inert while a modal job runs; keys are
 * swallowed unless they reach `overlay`. Returns the function that removes the block.
 */
export function installModalJobBlock(
  root: HTMLElement,
  overlay: () => HTMLElement | null,
  win: Window = window,
): () => void {
  const swallow = (event: Event) => {
    const target = event.target as Node | null;
    const box = overlay();
    if (box && target && box.contains(target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const block = () => {
    root.setAttribute('inert', '');
    for (const type of KEY_EVENTS) win.addEventListener(type, swallow, true);
  };
  const release = () => {
    root.removeAttribute('inert');
    for (const type of KEY_EVENTS) win.removeEventListener(type, swallow, true);
  };
  if (current) block();
  const off = onModalJob((job) => (job ? block() : release()));
  return () => {
    off();
    if (root.hasAttribute('inert')) release();
  };
}
