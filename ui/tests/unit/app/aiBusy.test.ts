/**
 * Feature 008, T062 (FR-080 to FR-085, research R12): the assistant's busy pointer - when it
 * shows, its frames, the still frame under reduced motion and the theme's palette.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AI_CURSOR_FRAME_MS,
  AI_CURSOR_FRAMES,
  aiCursorValue,
  isAiBusy,
  useAiBusyPointer,
} from '@/app/aiBusy';

function element(): { current: HTMLDivElement } {
  return { current: document.createElement('div') };
}

function reducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matches && query.includes('reduce'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete document.documentElement.dataset.theme;
});

describe('the assistant busy pointer', () => {
  it('shows while an assistant request computes, not for scripts or while a dialog waits', () => {
    expect(isAiBusy('ai', false)).toBe(true);
    expect(isAiBusy('ai', true)).toBe(false);
    expect(isAiBusy('script', false)).toBe(false);
    expect(isAiBusy(null, false)).toBe(false);
  });

  it('has twelve frames, one turn in about 1.5 s, and a still frame', () => {
    expect(AI_CURSOR_FRAMES).toBe(12);
    expect(AI_CURSOR_FRAMES * AI_CURSOR_FRAME_MS).toBe(1500);
    expect(aiCursorValue(0, false)).toBe('url("./cursors/ai-busy-light-01.svg") 2 2, progress');
    expect(aiCursorValue(11, true)).toContain('ai-busy-dark-12.svg');
    expect(aiCursorValue(12, false)).toContain('ai-busy-light-01.svg');
    expect(aiCursorValue(null, false)).toContain('ai-busy-light-static.svg');
  });

  it('turns the frames while active and removes the property afterwards', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const ref = element();
    const { rerender } = renderHook(({ active }) => useAiBusyPointer(ref, active), {
      initialProps: { active: true },
    });
    const value = () => ref.current.style.getPropertyValue('--mfbe-ai-cursor');
    expect(value()).toContain('-01.svg');
    vi.advanceTimersByTime(AI_CURSOR_FRAME_MS);
    expect(value()).toContain('-02.svg');
    rerender({ active: false });
    expect(value()).toBe('');
  });

  it('keeps the still frame under reduced motion, in the dark palette on the dark theme', () => {
    vi.useFakeTimers();
    reducedMotion(true);
    document.documentElement.dataset.theme = 'dark';
    const ref = element();
    renderHook(() => useAiBusyPointer(ref, true));
    const value = () => ref.current.style.getPropertyValue('--mfbe-ai-cursor');
    expect(value()).toContain('ai-busy-dark-static.svg');
    vi.advanceTimersByTime(AI_CURSOR_FRAME_MS * 3);
    expect(value()).toContain('ai-busy-dark-static.svg');
  });
});
