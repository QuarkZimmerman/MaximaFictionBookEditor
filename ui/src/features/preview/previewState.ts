/**
 * Feature 011 (US10): whether Preview is open, and where it opens - one overlay per window, opened by
 * *View → Preview* (Shift+F5), its toolbar and status bar buttons, closed by Esc or its button.
 */
import { useSyncExternalStore } from 'react';

export interface PreviewRequest {
  /** The element Preview opens at (the caret's in the Body view, the selected one in Source). */
  nodeId: string | null;
}

type Listener = () => void;

let current: PreviewRequest | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openPreview(request: PreviewRequest): void {
  current = request;
  emit();
}

export function closePreview(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function currentPreview(): PreviewRequest | null {
  return current;
}

export function onPreview(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open Preview's request (null while closed). */
export function usePreview(): PreviewRequest | null {
  return useSyncExternalStore(onPreview, currentPreview, currentPreview);
}
