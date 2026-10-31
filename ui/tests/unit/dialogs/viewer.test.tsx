/**
 * Feature 007 (T101, data-model §5, DP-5): the modal kind `viewer` of the dialog service - a
 * full-window layer with a backdrop and no 640 px cap, for the picture view. It is modal like
 * every dialog: menus and hotkeys stay blocked (`isModalOpen`), focus stays inside it, the
 * layers under it are `inert`, Escape closes it and the focus returns where it was.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import { DialogHost, DialogService, ViewerFrame } from '@/dialogs';

function host(service: DialogService) {
  return render(
    <>
      <button type="button" data-testid="outside">
        outside
      </button>
      <DialogHost service={service} />
    </>,
  );
}

describe('the viewer kind of dialog', () => {
  it('is modal: the service blocks menus and hotkeys while it is open', () => {
    const service = new DialogService();
    void service.open(() => <div />, { kind: 'viewer' });
    expect(service.stack[0]?.kind).toBe('viewer');
    expect(service.isModalOpen).toBe(true);
    void service.open(() => <div />);
    expect(service.stack[1]?.kind).toBe('dialog');
  });

  it('covers the whole window with its own backdrop; the layers under it are inert', () => {
    const service = new DialogService();
    host(service);
    act(() => {
      void service.open(() => <div data-testid="first">first</div>);
      void service.open(
        (close) => (
          <ViewerFrame label="Picture" onClose={() => close(undefined)} testId="viewer">
            <button type="button" data-testid="viewer-control">
              control
            </button>
          </ViewerFrame>
        ),
        { kind: 'viewer' },
      );
    });
    const viewerBackdrop = screen.getByTestId('dialog-backdrop-1');
    expect(viewerBackdrop).toHaveClass('mfbe-dialog-backdrop', 'mfbe-dialog-backdrop-viewer');
    expect(screen.getByTestId('dialog-backdrop-0')).not.toHaveClass('mfbe-dialog-backdrop-viewer');
    expect(screen.getByTestId('dialog-backdrop-0')).toHaveAttribute('inert');
    const frame = screen.getByTestId('viewer');
    expect(frame).toHaveAttribute('role', 'dialog');
    expect(frame).toHaveAttribute('aria-modal', 'true');
    expect(frame).toHaveAttribute('aria-label', 'Picture');
    expect(frame).toHaveClass('mfbe-viewer');
  });

  it('keeps the focus inside, closes on Escape and gives the focus back', () => {
    const service = new DialogService();
    host(service);
    const outside = screen.getByTestId('outside');
    outside.focus();
    const closed: string[] = [];
    act(() => {
      void service
        .open<string>(
          (close) => (
            <ViewerFrame label="Picture" onClose={() => close('escape')} testId="viewer">
              <button type="button" data-testid="viewer-first">
                first
              </button>
              <button type="button" data-testid="viewer-last">
                last
              </button>
            </ViewerFrame>
          ),
          { kind: 'viewer' },
        )
        .then((result) => closed.push(result));
    });
    const first = screen.getByTestId('viewer-first');
    const last = screen.getByTestId('viewer-last');
    expect(first).toHaveFocus();
    // Focus that escapes is brought back in.
    act(() => outside.focus());
    expect(first).toHaveFocus();
    // Tab wraps around inside the viewer.
    act(() => last.focus());
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    // Escape closes; the focus returns where it was.
    fireEvent.keyDown(last, { key: 'Escape' });
    return Promise.resolve().then(() => {
      expect(closed).toEqual(['escape']);
      expect(screen.queryByTestId('viewer')).toBeNull();
      expect(outside).toHaveFocus();
    });
  });

  it('focuses the element the viewer names first', () => {
    const service = new DialogService();
    host(service);
    act(() => {
      void service.open(
        () => (
          <ViewerFrame label="Picture" onClose={() => undefined} initialFocus="[data-start]">
            <button type="button">first</button>
            <button type="button" data-start="" data-testid="start">
              start
            </button>
          </ViewerFrame>
        ),
        { kind: 'viewer' },
      );
    });
    expect(screen.getByTestId('start')).toHaveFocus();
  });
});
