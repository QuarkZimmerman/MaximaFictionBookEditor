/**
 * Transient notice (feature 003, FR-014): the short completion notice of a long script run,
 * shown in the work area above the document's lower edge. A live region (`role="status"`) that
 * hides by itself after its time to live, closes on a click and never takes the focus - the
 * caret stays where the user left it. State: `transientNotices.ts`.
 */

import { useSyncExternalStore } from 'react';

import { useAppServices } from './services';
import { transientNotices } from './transientNotices';

import './transientNotice.css';

export function TransientNotice() {
  const { store } = useAppServices();
  const notices = transientNotices(store);
  const notice = useSyncExternalStore(notices.subscribe, notices.get, notices.get);
  if (!notice) return null;
  return (
    <div
      key={notice.id}
      className="mfbe-transient-notice"
      role="status"
      aria-live="polite"
      data-testid="transient-notice"
      data-kind={notice.kind}
      // A click dismisses the notice without moving the focus: nothing in the notice is
      // focusable, and the mouse-down must not blur the editor or a dialog field.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => notices.dismiss(notice.id)}
    >
      {notice.text}
    </div>
  );
}
