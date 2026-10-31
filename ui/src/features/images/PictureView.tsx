/**
 * The picture view (feature 007, US6; data-model §5, FR-050 to FR-055; DP-5): a Binary objects
 * thumbnail opens the picture over the whole editor window, through the dialog service's
 * `viewer` kind (`openPictureView.tsx`). A picture larger than the window opens fitted; a click on
 * it, Space or Enter shows it at its natural size, scrollable, and back. Esc, the close
 * control and a click outside the picture close the view, which changes nothing in the book;
 * it also closes when its binary goes away (undo, a script, Remove) or the document does, and
 * refits when the window changes size. The rules are in `pictureViewModel.ts`.
 */

import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewerFrame } from '@/dialogs/Dialog';
import type { BinaryMeta } from '@/model/document';
import { useAppState, type AppStore } from '@/model/store';

import {
  displaySize,
  exceedsWindow,
  initialMode,
  pictureViewUrl,
  toggledMode,
  type PictureViewMode,
  type Size,
} from './pictureViewModel';

import './pictureView.css';

export interface PictureViewProps {
  docId: string;
  /** A binary `canViewPicture` accepts. */
  binary: BinaryMeta;
  store: AppStore;
  onClose: () => void;
}

function windowSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function PictureView({ docId, binary, store, onClose }: PictureViewProps) {
  const { t } = useTranslation();
  const picture: Size = { width: binary.width ?? 1, height: binary.height ?? 1 };
  const [view, setView] = useState<Size>(windowSize);
  const [mode, setMode] = useState<PictureViewMode>(() => initialMode(picture, windowSize()));

  // The window's size: fitted pictures refit, and whether a click toggles follows it.
  useEffect(() => {
    const onResize = () => setView(windowSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // The binary (or its document) went away while the view was open.
  const present = useAppState(
    (s) => s.docId === docId && (s.document?.binaries.some((b) => b.id === binary.id) ?? false),
    store,
  );
  useEffect(() => {
    if (!present) onClose();
  }, [present, onClose]);

  const toggles = exceedsWindow(picture, view);
  const size = displaySize(mode, picture, view);
  const toggle = () => setMode((current) => toggledMode(current, picture, view));
  const zoom = toggles ? (mode === 'fitted' ? 'zoom-in' : 'zoom-out') : null;

  const onPictureKeyDown = (event: KeyboardEvent<HTMLImageElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    }
  };
  const onAreaClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <ViewerFrame
      label={binary.id}
      onClose={onClose}
      testId="picture-view-frame"
      initialFocus="[data-picture-view-picture]"
    >
      <div className="mfbe-picture-view" data-mode={mode} data-testid="picture-view">
        <div
          className="mfbe-picture-view-area"
          data-testid="picture-view-area"
          onClick={onAreaClick}
        >
          <img
            className={`mfbe-picture-view-picture${zoom ? ` mfbe-picture-view-${zoom}` : ''}`}
            src={pictureViewUrl(docId, binary) ?? undefined}
            alt={binary.id}
            width={size.width}
            height={size.height}
            style={{ width: `${size.width}px`, height: `${size.height}px` }}
            title={
              toggles ? t(mode === 'fitted' ? 'pictureView.natural' : 'pictureView.fit') : undefined
            }
            tabIndex={0}
            draggable={false}
            decoding="async"
            data-picture-view-picture=""
            data-testid="picture-view-picture"
            onClick={toggle}
            onKeyDown={onPictureKeyDown}
          />
        </div>
      </div>
      <button
        type="button"
        className="mfbe-picture-view-close"
        aria-label={t('pictureView.close')}
        title={t('pictureView.close')}
        data-testid="picture-view-close"
        onClick={onClose}
      >
        <span aria-hidden="true">{'×'}</span>
      </button>
    </ViewerFrame>
  );
}
