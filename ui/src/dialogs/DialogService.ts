/**
 * Dialog stack. `DialogService.open()` returns a Promise resolved by the dialog's
 * `close(result)`; `DialogHost` (Dialog.tsx) renders the stack. Dialogs are modal unless
 * opened `modeless` (Find, Replace): those leave the window usable and only a modal dialog
 * blocks the application hotkeys and menus (`isModalOpen`).
 */

import { useSyncExternalStore, type ReactNode } from 'react';

export interface DialogInstance {
  id: number;
  /** Renders the dialog; `close(result)` resolves the promise returned by `open()`. */
  render: (close: (result: unknown) => void) => ReactNode;
  modeless: boolean;
}

export interface DialogOpenOptions {
  /** The window stays usable while the dialog is open (the original's Find and Replace). */
  modeless?: boolean;
}

export class DialogService {
  private stackValue: DialogInstance[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly resolvers = new Map<number, (result: unknown) => void>();
  private nextId = 1;

  /** Opens a dialog; resolves with whatever the dialog passes to `close()`. */
  open<T>(
    render: (close: (result: T) => void) => ReactNode,
    options: DialogOpenOptions = {},
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve) => {
      this.resolvers.set(id, resolve as (result: unknown) => void);
      this.stackValue = [
        ...this.stackValue,
        {
          id,
          render: (close) => render(close as (result: T) => void),
          modeless: options.modeless ?? false,
        },
      ];
      this.emit();
    });
  }

  /** Closes a dialog by id with a result (no-op when already closed). */
  close(id: number, result: unknown): void {
    const resolve = this.resolvers.get(id);
    if (!resolve) return;
    this.resolvers.delete(id);
    this.stackValue = this.stackValue.filter((d) => d.id !== id);
    this.emit();
    resolve(result);
  }

  /** Closes the top-most dialog (Escape from the host level). */
  closeTop(result: unknown = undefined): boolean {
    const top = this.stackValue[this.stackValue.length - 1];
    if (!top) return false;
    this.close(top.id, result);
    return true;
  }

  get stack(): readonly DialogInstance[] {
    return this.stackValue;
  }

  get isOpen(): boolean {
    return this.stackValue.length > 0;
  }

  /** A modal dialog is open: the rest of the window does not take input. */
  get isModalOpen(): boolean {
    return this.stackValue.some((dialog) => !dialog.modeless);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): readonly DialogInstance[] => this.stackValue;

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export function useDialogStack(service: DialogService): readonly DialogInstance[] {
  return useSyncExternalStore(service.subscribe, service.getSnapshot, service.getSnapshot);
}
