/**
 * Feature 003 T027 - the transient notice of the work area (FR-014): shown by
 * `showTransientNotice()`, a `role="status"` live region that hides by itself after its time
 * to live (6 s by default), closes on a click, never takes the focus, and is replaced by the
 * next notice.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { AppProvider } from '@/app/AppContext';
import { createAppServices } from '@/app/services';
import { TransientNotice } from '@/app/TransientNotice';
import {
  DEFAULT_NOTICE_TTL_MS,
  showTransientNotice,
  transientNotices,
} from '@/app/transientNotices';
import { createAppStore } from '@/model/store';

function setup() {
  const store = createAppStore();
  const services = createAppServices({ store, platform: 'linux' });
  render(
    <AppProvider services={services}>
      <input data-testid="field" defaultValue="caret here" />
      <TransientNotice />
    </AppProvider>,
  );
  return { store };
}

describe('TransientNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the text as a status live region and hides by itself after 6 s', () => {
    const { store } = setup();
    expect(screen.queryByTestId('transient-notice')).not.toBeInTheDocument();

    act(() => {
      showTransientNotice(store, { text: 'Script "Long run" finished in 8 s' });
    });
    const notice = screen.getByTestId('transient-notice');
    expect(notice).toHaveTextContent('Script "Long run" finished in 8 s');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveAttribute('data-kind', 'info');
    expect(transientNotices(store).get()).toMatchObject({ ttlMs: DEFAULT_NOTICE_TTL_MS });

    // Still there just before the time to live runs out, gone right after it.
    act(() => {
      vi.advanceTimersByTime(DEFAULT_NOTICE_TTL_MS - 50);
    });
    expect(screen.getByTestId('transient-notice')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId('transient-notice')).not.toBeInTheDocument();
    expect(transientNotices(store).get()).toBeNull();
  });

  it('is dismissed by a click without taking the focus', () => {
    const { store } = setup();
    const field = screen.getByTestId('field');
    field.focus();
    expect(document.activeElement).toBe(field);

    act(() => {
      showTransientNotice(store, { text: 'Done', ttlMs: 10_000 });
    });
    const notice = screen.getByTestId('transient-notice');
    // Nothing in the notice can be focused: no tabindex, no button.
    expect(notice).not.toHaveAttribute('tabindex');
    expect(notice.querySelector('button, [tabindex], a, input')).toBeNull();
    expect(document.activeElement).toBe(field);

    // The mouse-down is prevented, so even a browser would not move the focus; the click closes.
    const mouseDown = fireEvent.mouseDown(notice);
    expect(mouseDown).toBe(false);
    fireEvent.click(notice);
    expect(screen.queryByTestId('transient-notice')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(field);
    // Its timer is gone with it: nothing happens later.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.queryByTestId('transient-notice')).not.toBeInTheDocument();
  });

  it('replaces the current notice with the next one and restarts the clock', () => {
    const { store } = setup();
    act(() => {
      showTransientNotice(store, { text: 'First', ttlMs: 1_000 });
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    act(() => {
      showTransientNotice(store, { text: 'Second', ttlMs: 1_000 });
    });
    expect(screen.getByTestId('transient-notice')).toHaveTextContent('Second');
    // The first notice's timer must not take the second one down.
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByTestId('transient-notice')).toHaveTextContent('Second');
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(screen.queryByTestId('transient-notice')).not.toBeInTheDocument();
    // Dismissing a notice that is no longer shown is a no-op.
    act(() => {
      transientNotices(store).dismiss(1);
    });
    expect(transientNotices(store).get()).toBeNull();
  });
});
