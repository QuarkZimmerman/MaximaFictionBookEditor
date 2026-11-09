/**
 * Feature 011 (US10; D44 and its clarifications; FR-020g, FR-020i; research DP-17): Preview - the book
 * as a reader shows it, over the whole window. The frame is sandboxed (same origin, no scripts) and its
 * content security policy admits only the editor's own pictures and inline styles, so nothing is
 * fetched and nothing runs. It opens at the caret's element and scrolls through the whole book; links
 * jump, note references open their note in a pop-up, Back returns; nothing can be typed, pasted or
 * dropped. Building that takes longer than half a second shows "Rendering…" with Cancel. Esc and the
 * close button remove it and give the focus back where it was: the editor is exactly as it was.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { startModalJob, type ModalJobHandle } from '@/app/modalJob';
import { useAppServices } from '@/app/services';
import { tip } from '@/app/tooltips';
import { useAppState } from '@/model/store';

import { buildPreview, XHTML_NS, type PreviewBuild } from './buildPreview';
import type { PreviewRequest } from './previewState';

import './preview.css';

const FRAME_DOCUMENT =
  '<!doctype html><html><head><meta charset="utf-8">' +
  // Only the editor's own pictures and inline styles: no script, no request anywhere else.
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'\">" +
  '</head><body></body></html>';

export interface PreviewOverlayProps {
  request: PreviewRequest;
  onClose: () => void;
}

export function PreviewOverlay({ request, onClose }: PreviewOverlayProps) {
  const { t } = useTranslation();
  const { store } = useAppServices();
  const document = useAppState((s) => s.document, store);
  const docId = useAppState((s) => s.docId, store);
  const frame = useRef<HTMLIFrameElement>(null);
  const [back, setBack] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  const backRef = useRef(back);
  const closeRef = useRef(onClose);
  useEffect(() => {
    backRef.current = back;
    closeRef.current = onClose;
  });

  // The focus goes back where it was when Preview closes.
  useEffect(() => {
    const before = globalThis.document.activeElement as HTMLElement | null;
    return () => before?.focus?.({ preventScroll: true });
  }, []);

  const goBack = () => {
    const doc = frame.current?.contentDocument;
    const scroller = doc?.scrollingElement;
    const last = backRef.current.at(-1);
    if (!scroller || last === undefined) return;
    scroller.scrollTop = last;
    setBack((list) => list.slice(0, -1));
  };
  const goBackRef = useRef(goBack);
  useEffect(() => {
    goBackRef.current = goBack;
  });

  useEffect(() => {
    const iframe = frame.current;
    if (!iframe || !document) return;
    const controller = new AbortController();
    let modal: ModalJobHandle | null = null;
    const timer = window.setTimeout(() => {
      modal = startModalJob(t('preview.rendering'), () => controller.abort());
    }, 500);
    const finish = () => {
      window.clearTimeout(timer);
      modal?.end();
      modal = null;
    };
    const install = (doc: globalThis.Document, built: PreviewBuild) => {
      let note: Element | null = null;
      const closeNote = () => {
        note?.remove();
        note = null;
      };
      doc.addEventListener('click', (event) => {
        const link = (event.target as Element | null)?.closest?.('[data-href]');
        if (note && !(event.target as Element | null)?.closest?.('.mfbe-preview-note')) closeNote();
        if (!link) return;
        event.preventDefault();
        const href = link.getAttribute('data-href') ?? '';
        // A web address is never fetched: Preview works offline (FR-084).
        if (!href.startsWith('#')) return;
        const target = built.ids.get(href.slice(1));
        if (!target) return;
        if (link.getAttribute('data-note') === 'true') {
          closeNote();
          const popup = doc.createElementNS(XHTML_NS, 'div');
          popup.setAttribute('class', 'mfbe-preview-note');
          popup.setAttribute('data-testid', 'preview-note');
          for (const child of Array.from(target.childNodes)) {
            if ((child as Element).localName === 'title') continue;
            popup.append(child.cloneNode(true));
          }
          const box = link.getBoundingClientRect();
          const scroller = doc.scrollingElement;
          (popup as HTMLElement).style.left =
            `${Math.max(8, box.left + (scroller?.scrollLeft ?? 0) - 40)}px`;
          (popup as HTMLElement).style.top = `${box.bottom + (scroller?.scrollTop ?? 0) + 6}px`;
          doc.body.append(popup);
          note = popup;
          return;
        }
        const scroller = doc.scrollingElement;
        if (scroller) setBack((list) => [...list, scroller.scrollTop]);
        target.scrollIntoView({ block: 'start' });
      });
      doc.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          if (note) closeNote();
          else closeRef.current();
        } else if ((event.key === 'ArrowLeft' && event.altKey) || event.key === 'Backspace') {
          event.preventDefault();
          goBackRef.current();
        }
      });
      // Nothing can be typed, pasted or dropped (US10 scenario 3).
      for (const type of ['beforeinput', 'paste', 'drop', 'dragover', 'cut']) {
        doc.addEventListener(type, (event) => event.preventDefault());
      }
    };
    const onLoad = async () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      try {
        const built = await buildPreview(doc, document, {
          docId,
          signal: controller.signal,
          onProgress: (done, total) => modal?.progress(done, total),
        });
        finish();
        install(doc, built);
        const at = request.nodeId ? built.elements.get(request.nodeId) : undefined;
        at?.scrollIntoView({ block: 'start' });
        setReady(true);
        iframe.focus();
      } catch (error) {
        finish();
        if (controller.signal.aborted) closeRef.current();
        else throw error;
      }
    };
    iframe.addEventListener('load', () => void onLoad(), { once: true });
    iframe.srcdoc = FRAME_DOCUMENT;
    return () => {
      controller.abort();
      finish();
    };
    // Preview shows the book as it was when it opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="mfbe-preview"
      role="dialog"
      aria-modal="true"
      aria-label={t('preview.title')}
      data-testid="preview"
      data-ready={ready ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="mfbe-preview-bar">
        <span className="mfbe-preview-title">{t('preview.title')}</span>
        <button
          type="button"
          data-testid="preview-back"
          disabled={back.length === 0}
          onClick={goBack}
          {...tip(back.length === 0 ? t('preview.backNothing') : t('preview.backTip'))}
        >
          {t('preview.back')}
        </button>
        <button
          type="button"
          data-testid="preview-close"
          onClick={onClose}
          {...tip(t('preview.closeTip'))}
        >
          {t('preview.close')}
        </button>
      </div>
      <iframe
        ref={frame}
        className="mfbe-preview-frame"
        title={t('preview.title')}
        sandbox="allow-same-origin"
        data-testid="preview-frame"
      />
    </div>
  );
}
