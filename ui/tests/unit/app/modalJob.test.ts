// Feature 011 (research DP-11; FR-054, FR-020g): the modal job frame of the export and Preview.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelModalJob,
  currentModalJob,
  installModalJobBlock,
  isModalJobRunning,
  onModalJob,
  startModalJob,
} from '@/app/modalJob';

describe('modal job', () => {
  let handle: ReturnType<typeof startModalJob> | null = null;
  afterEach(() => {
    handle?.end();
    handle = null;
  });

  it('runs one job at a time, reports its progress and ends', () => {
    const seen: (string | null)[] = [];
    const off = onModalJob((job) =>
      seen.push(job ? `${job.title} ${job.done}/${job.total}` : null),
    );
    handle = startModalJob('Exporting', () => {});
    expect(isModalJobRunning()).toBe(true);
    expect(() => startModalJob('Second', () => {})).toThrow();
    handle.progress(3, 10);
    expect(currentModalJob()).toEqual({ title: 'Exporting', done: 3, total: 10 });
    handle.end();
    handle = null;
    expect(isModalJobRunning()).toBe(false);
    expect(seen).toEqual(['Exporting 0/0', 'Exporting 3/10', null]);
    off();
  });

  it('Cancel calls the job back; a stale handle changes nothing', () => {
    const onCancel = vi.fn();
    const first = startModalJob('A', onCancel);
    cancelModalJob();
    expect(onCancel).toHaveBeenCalledTimes(1);
    first.end();
    handle = startModalJob('B', () => {});
    first.progress(5, 5);
    first.end();
    expect(currentModalJob()?.title).toBe('B');
  });

  it('makes the interface inert and lets only the overlay take keys while a job runs', () => {
    const root = document.createElement('div');
    const overlay = document.createElement('div');
    const button = document.createElement('button');
    overlay.append(button);
    document.body.append(root, overlay);
    const remove = installModalJobBlock(root, () => overlay);
    handle = startModalJob('Rendering', () => {});
    expect(root.hasAttribute('inert')).toBe(true);
    const outside = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    root.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(true);
    const inside = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(inside);
    expect(inside.defaultPrevented).toBe(false);
    handle.end();
    handle = null;
    expect(root.hasAttribute('inert')).toBe(false);
    remove();
    root.remove();
    overlay.remove();
  });
});
