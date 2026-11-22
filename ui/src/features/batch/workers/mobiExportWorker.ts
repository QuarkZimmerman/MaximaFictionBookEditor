/**
 * Feature 019 (T029): dedicated Web Worker for pure-JS MOBI 7 / KF8 HTML + CSS + MFBE envelope
 * generation.
 */

import type { Document } from '@/model/document';
import type { MobiFormat, MobiOpenAt, MobiSeriesInTitle, MobiTocPlacement } from '@/rpc/types';
import { buildKf8 } from '@/features/mobi/export/kf8';
import {
  buildExportPlan,
  buildMfbeRoundTripRecord,
  type MobiExportSummaryItem,
  type PlacedMobiPicture,
} from '@/features/mobi/export/metadata';
import { buildMobi7 } from '@/features/mobi/export/mobi7';

export interface MobiExportWorkerRequest {
  document: Document;
  pictures: [string, PlacedMobiPicture][];
  fallbackTitle: string;
  format: MobiFormat;
  tocPlacement: MobiTocPlacement;
  seriesInTitle: MobiSeriesInTitle;
  openAt: MobiOpenAt;
  kf8PopupFootnotes: boolean;
  genreNames?: [string, string][];
}

export interface MobiExportWorkerResult {
  metadata: ReturnType<typeof buildExportPlan>['metadata'];
  summary: MobiExportSummaryItem[];
  mobi7Html?: string;
  kf8Html?: string;
  kf8Css?: string;
  mfbeJson: string;
  nav: { label: string; anchorId: string; depth: number }[];
  guide: {
    type: 'cover' | 'title-page' | 'toc' | 'text' | 'colophon';
    title: string;
    anchorId: string;
  }[];
}

self.onmessage = (event: MessageEvent<MobiExportWorkerRequest>) => {
  try {
    const req = event.data;
    const pictures = new Map<string, PlacedMobiPicture>(req.pictures);
    const genreNames = req.genreNames ? new Map<string, string>(req.genreNames) : undefined;
    const opts = {
      document: req.document,
      pictures,
      fallbackTitle: req.fallbackTitle,
      tocPlacement: req.tocPlacement,
      seriesInTitle: req.seriesInTitle,
      openAt: req.openAt,
      kf8PopupFootnotes: req.kf8PopupFootnotes,
      genreNames,
    };

    self.postMessage({ type: 'progress', done: 0, total: 4 });
    const plan = buildExportPlan(opts);
    self.postMessage({ type: 'progress', done: 1, total: 4 });

    const mobi7Result =
      req.format === 'mobi7' || req.format === 'joint' ? buildMobi7(opts, plan) : null;
    self.postMessage({ type: 'progress', done: 2, total: 4 });

    const kf8Result = req.format === 'kf8' || req.format === 'joint' ? buildKf8(opts, plan) : null;
    self.postMessage({ type: 'progress', done: 3, total: 4 });

    const mfbe = buildMfbeRoundTripRecord(req.document, pictures, plan.attrs);
    const active = kf8Result ?? mobi7Result!;

    const data: MobiExportWorkerResult = {
      metadata: plan.metadata,
      summary: plan.summary,
      mobi7Html: mobi7Result?.html,
      kf8Html: kf8Result?.html,
      kf8Css: kf8Result?.css,
      mfbeJson: JSON.stringify(mfbe),
      nav: active.nav,
      guide: active.guide,
    };
    self.postMessage({ type: 'progress', done: 4, total: 4 });
    self.postMessage({ type: 'result', data });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
