/**
 * Feature 019 (T039): dedicated Web Worker for pure-JS TXT import parsing & FB2 XML assembly.
 * Supports two phases:
 *  - `candidates`: checks whether text is an editor-exported TXT (`parseOwnTxt`) or extracts
 *    broken-word candidates for dictionary lookup.
 *  - `build`: assembles the complete FB2 XML (editor-made round-trip or foreign layout).
 */

import { bodyXml, bookXml, templateDescription } from '@/features/txt/import/build';
import { brokenCandidates, foreignParagraphs, linesOf } from '@/features/txt/import/layout';
import { ownBodies, ownDescription, parseOwnTxt } from '@/features/txt/import/ours';
import type { RecordLists } from '@/features/txt/export/record';

export type TxtImportWorkerRequest =
  | { kind: 'candidates'; text: string }
  | {
      kind: 'build';
      text: string;
      template: string;
      stem: string;
      knownWords: string[];
      lists: RecordLists;
    };

export type TxtImportWorkerResult =
  | { kind: 'candidates'; isOwn: boolean; candidates: string[] }
  | {
      kind: 'build';
      xml: string;
      isOwn: boolean;
      controlsLeftOut: number;
      unread: string[];
    };

self.onmessage = (event: MessageEvent<TxtImportWorkerRequest>) => {
  try {
    const req = event.data;
    if (req.kind === 'candidates') {
      const own = parseOwnTxt(req.text);
      if (own) {
        self.postMessage({
          type: 'result',
          data: { kind: 'candidates', isOwn: true, candidates: [] } satisfies TxtImportWorkerResult,
        });
        return;
      }
      const { lines } = linesOf(req.text);
      const candidates = [...brokenCandidates(lines)];
      self.postMessage({
        type: 'result',
        data: { kind: 'candidates', isOwn: false, candidates } satisfies TxtImportWorkerResult,
      });
      return;
    }

    const own = parseOwnTxt(req.text);
    if (own) {
      const desc = ownDescription(own, req.template, req.lists);
      const xml = bookXml(desc.xml, ownBodies(own).xml);
      self.postMessage({
        type: 'result',
        data: {
          kind: 'build',
          xml,
          isOwn: true,
          controlsLeftOut: 0,
          unread: desc.unread,
        } satisfies TxtImportWorkerResult,
      });
      return;
    }

    const known = new Set(req.knownWords);
    const paragraphs = foreignParagraphs(req.text, (word) => known.has(word));
    const xml = bookXml(templateDescription(req.template, req.stem), bodyXml(paragraphs.items));
    self.postMessage({
      type: 'result',
      data: {
        kind: 'build',
        xml,
        isOwn: false,
        controlsLeftOut: paragraphs.controlsLeftOut,
        unread: [],
      } satisfies TxtImportWorkerResult,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
