/**
 * Feature 019 (T042; US2, FR-006, FR-007, FR-017, FR-024): unattended PDF -> FB2 batch adapter.
 * Fails password-protected PDFs immediately without prompting, reconstructs editor-exported PDFs
 * losslessly via `convertOurs`, silently applies archive/beside `.fbd` for foreign PDFs, and saves
 * UTF-8 `.fb2` or `.fb2.zip` atomically.
 */

import { pdfImportReason } from '@/features/pdf/importCommand';
import type { BinaryMeta } from '@/model/document';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type PdfImportOcrSummary } from '@/rpc/types';

import { pathBasename } from '../engine/paths';
import type { BatchOcrReportEntry } from '../engine/types';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  createEphemeralFb2FromXml,
  runCancellableRpcJob,
  saveEphemeralFb2,
  throwIfAborted,
} from './fb2LoadSave';

const MAX_PICTURES = 10_000;

function resolveLanguageLabel(rawLanguages: unknown, code: string, uiLang: string): string {
  const target = code.toLowerCase();
  const inspectList = (items: unknown): string | null => {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as {
        code?: unknown;
        name?: Record<string, string>;
        names?: Record<string, string>;
      };
      if (typeof rec.code === 'string' && rec.code.toLowerCase() === target) {
        const names = rec.names ?? rec.name;
        if (names && typeof names === 'object') {
          return names[uiLang] ?? names.en ?? code;
        }
      }
    }
    return null;
  };
  if (Array.isArray(rawLanguages)) {
    return inspectList(rawLanguages) ?? code;
  }
  if (rawLanguages && typeof rawLanguages === 'object') {
    const obj = rawLanguages as { entries?: unknown; groups?: Array<{ languages?: unknown }> };
    const direct = inspectList(obj.entries);
    if (direct) return direct;
    if (Array.isArray(obj.groups)) {
      for (const group of obj.groups) {
        const found = inspectList(group?.languages);
        if (found) return found;
      }
    }
  }
  return code;
}

function formatBatchOcrReason(
  summary: PdfImportOcrSummary,
  rawLanguages: unknown,
  uiLang: string,
  t: BatchAdapterContext['ctx']['t'],
): Omit<BatchOcrReportEntry, 'displayPath' | 'sourcePath' | 'targetPath'> {
  const parts: string[] = [];
  if (summary.pagesRecognized > 0) {
    parts.push(t('batch.ocr.summaryPages', { pages: summary.pagesRecognized }));
  }
  if (summary.imageBlocksRecognized > 0) {
    parts.push(t('batch.ocr.summaryImages', { images: summary.imageBlocksRecognized }));
  }
  const langNames = summary.languages.map((code) => resolveLanguageLabel(rawLanguages, code, uiLang));
  const partsText = parts.join(', ');
  const reason =
    langNames.length > 0
      ? t('batch.ocr.summaryWithLangs', { parts: partsText, languages: langNames.join(', ') })
      : partsText;
  return {
    ocrPages: summary.pagesRecognized,
    ocrImageBlocks: summary.imageBlocksRecognized,
    languages: [...summary.languages],
    reason,
  };
}

export async function runPdfToFb2(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, config, item, targetPath, outputStem, signal, onStage, cache, settings } =
    params;

  const [
    { withFbd },
    { brokenWordCandidate, knownWords },
    { FB2_NS, XLINK_NS },
    { convertOurs },
    { loadDocument, loadPages },
    { flatten },
    { guessLanguage, metadataDescription, resolveImportLanguage },
    { furnitureOf, layoutParts, linesOf },
    { fromLatin1, looksLatin1Cyrillic },
    { textBody },
    { mendFb2 },
  ] = await Promise.all([
    import('@/features/importShared/fbdApply'),
    import('@/features/text/joinWords'),
    import('@/features/pdf/import/fb2'),
    import('@/features/pdf/import/ours'),
    import('@/features/pdf/import/pages'),
    import('@/features/pdf/import/parts'),
    import('@/features/pdf/import/describe'),
    import('@/features/pdf/import/layout'),
    import('@/features/pdf/import/mend'),
    import('@/features/pdf/import/text'),
    import('@/features/pdf/import/valid'),
  ]);

  let token: string | null = null;
  let docId: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const begun = await rpc.call('pdfImport.begin', {
      path: item.sourcePath,
      entry: item.archiveEntry,
    });
    if (!begun.token) {
      throw new Error('Archive requires an explicit PDF entry');
    }
    const activeToken = begun.token;
    token = activeToken;
    throwIfAborted(signal);

    // Bound simultaneous PDF OCR reader processes in parallel batch runs so peak RSS and CPU stay
    // predictable; each reader is also capped to 1 OCR thread when Batch parallel mode is enabled.
    const releaseOcrSlot = config.pdfUseOcr ? await cache.pdfOcrSlots.acquire(signal) : null;
    let readStats;
    try {
      const inspectParams = config.pdfUseOcr
        ? {
            token: activeToken,
            ocr: {
              enabled: true,
              autoDetect: config.ocrAutoDetect,
              languages: config.ocrLanguages,
              ...(config.parallel ? { maxThreads: 1 } : {}),
            },
          }
        : { token: activeToken };
      const inspected = await rpc.call('pdfImport.inspect', inspectParams);
      if (inspected.needsPassword || inspected.ownerPassword || !inspected.opened) {
        // Unattended batch rule (FR-017, FR-020): fail encrypted/copy-restricted PDFs immediately.
        throw new Error(ctx.t('batch.reasons.passwordPdf'));
      }

      readStats = await runCancellableRpcJob(
        rpc,
        () => rpc.call('pdfImport.read', { token: activeToken }),
        {
          signal,
          onProgress: (d, tot, phase) => {
            const stageKey =
              phase === 'ocrDetect'
                ? 'batch.progress.stageOcrDetect'
                : phase === 'ocr'
                  ? 'batch.progress.stageOcr'
                  : 'batch.progress.stageReading';
            onStage(stageKey, d, Math.max(tot, 1));
          },
        },
      );
    } finally {
      releaseOcrSlot?.();
    }
    throwIfAborted(signal);

    const pdfDoc = await loadDocument(activeToken);
    const models = await loadPages(
      activeToken,
      pdfDoc.pages,
      (done, count) => onStage('batch.progress.stageConverting', done, Math.max(count, 1)),
      () => signal.aborted,
    );
    throwIfAborted(signal);

    let xml: string;
    let wanted: { readerId: string; page: number; binaryId: string }[] = [];
    const warnings: string[] = [];

    if (pdfDoc.record) {
      // Editor-made PDF: silently prefer embedded description and exact hints for round-trip fidelity.
      const hints = JSON.parse(pdfDoc.record.hints);
      const result = convertOurs(
        hints,
        flatten(pdfDoc.structure ?? [], pdfDoc.orphans ?? []),
        models,
        pdfDoc.record.description,
        { descriptionPages: true },
      );
      xml = result.xml;
      wanted = result.pictures;
      if (result.mismatches > 0) {
        warnings.push(ctx.t('pdfImport.summary.mismatches', { count: result.mismatches }));
      }
    } else {
      const { xml: template } = await rpc.call('template.xml');
      const dictionaries = await rpc.call('spell.dictionaries').catch(() => []);
      const dictionaryOf = (code: string): string | undefined =>
        dictionaries.find(
          (d) =>
            d.lang.toLowerCase().startsWith(code) || (d.tag ?? '').toLowerCase().startsWith(code),
        )?.lang;
      const misspelled = async (list: string[], code: string): Promise<string[]> => {
        const dictionary = dictionaryOf(code);
        if (!dictionary || list.length === 0) return list;
        return (await rpc.call('spell.check', { words: list, langs: [dictionary] })).misspelled;
      };

      const tagged = pdfDoc.structure?.length
        ? flatten(pdfDoc.structure, pdfDoc.orphans ?? []).parts
        : null;
      const taggedRuns = (tagged ?? []).flatMap((part) => [
        ...part.runs,
        ...(part.rows ?? []).flatMap((row) => row.flatMap((cell) => cell.runs)),
        ...(part.caption ?? []),
      ]);
      const BROKEN = /(\p{L}+)-\u2063(\p{L}+)/gu;
      const candidates = new Set<string>();
      for (const run of taggedRuns) {
        for (const match of run.text.matchAll(BROKEN)) candidates.add(`${match[1]}${match[2]}`);
      }
      for (const model of models) {
        model.words.forEach((word, index) => {
          const next = model.words[index + 1];
          const candidate = next ? brokenWordCandidate(word.t, next.t) : null;
          if (candidate) candidates.add(candidate);
        });
      }
      const knownWordSet = await knownWords(candidates, misspelled, undefined, () =>
        throwIfAborted(signal),
      );
      for (const run of taggedRuns) {
        run.text = run.text
          .replace(BROKEN, (_all, head: string, tail: string) =>
            knownWordSet.has(`${head}${tail}`) ? `${head}${tail}` : `${head}-${tail}`,
          )
          .replace(/\u2063/g, '');
      }

      const wordsOf = (texts: string[]): number =>
        texts.join(' ').split(/\s+/).filter(Boolean).length;
      const lettersOf = (text: string): number => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
      const sum = (values: Iterable<number>): number => [...values].reduce((a, b) => a + b, 0);

      const taggedLetters = new Map<number, number>();
      const taggedTokens = new Map<number, number>();
      for (const run of taggedRuns) {
        if (!run.text.trim()) continue;
        taggedLetters.set(run.page, (taggedLetters.get(run.page) ?? 0) + lettersOf(run.text));
        taggedTokens.set(run.page, (taggedTokens.get(run.page) ?? 0) + wordsOf([run.text]));
      }
      const pageLines = models.map(linesOf);
      const furniture = furnitureOf(pageLines);
      const pageText = pageLines.map((lines) =>
        lines.filter((line) => !furniture.has(line)).flatMap((line) => line.words),
      );
      const pageLetters = pageText.map((words) => sum(words.map((w) => lettersOf(w.t))));

      const tok = (word: string): string => word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const drawn = new Set<string>();
      for (const model of models) {
        let previous = '';
        for (const word of model.words) {
          const t = tok(word.t);
          if (!t) continue;
          if (previous) drawn.add(`${model.n} ${previous} ${t}`);
          previous = t;
        }
      }
      let pairs = 0;
      let inOrder = 0;
      for (const part of tagged ?? []) {
        let previous = '';
        let pageNum = -1;
        for (const run of part.runs) {
          for (const word of run.text.split(/\s+/)) {
            const t = tok(word);
            if (!t) continue;
            if (previous && pageNum === run.page) {
              pairs++;
              if (drawn.has(`${run.page} ${previous} ${t}`)) inOrder++;
            }
            previous = t;
            pageNum = run.page;
          }
        }
      }

      const hasOcrPages = models.some(
        (model) => model.ocrUsed || (model.ocrImages?.length ?? 0) > 0,
      );
      const layout =
        !hasOcrPages &&
        tagged &&
        sum(taggedLetters.values()) >= sum(pageLetters) * 0.97 &&
        inOrder >= pairs * 0.97
          ? null
          : layoutParts(models, {
              outline: pdfDoc.outline,
              known: (word) => knownWordSet.has(word),
            });

      let fromTags = tagged ?? [];
      if (!layout && tagged) {
        const untagged = models.filter((model, index) => {
          const words = pageText[index]!.length;
          return (
            words >= 5 &&
            ((taggedLetters.get(model.n) ?? 0) < pageLetters[index]! * 0.9 ||
              (taggedTokens.get(model.n) ?? 0) > words * 1.5)
          );
        });
        if (untagged.length > 0) {
          const replaced = new Set(untagged.map((m) => m.n));
          const isText = (part: (typeof tagged)[number]): boolean =>
            part.kind === 'p' || part.kind === 'title';
          const kept = tagged
            .map((part) =>
              isText(part)
                ? { ...part, runs: part.runs.filter((run) => !replaced.has(run.page)) }
                : part,
            )
            .filter((part) =>
              isText(part) ? part.runs.some((run) => run.text.trim()) : !replaced.has(part.page),
            );
          const extra = layoutParts(untagged, {
            outline: [],
            known: (word) => knownWordSet.has(word),
          }).parts;
          const merged: typeof tagged = [];
          let k = 0;
          for (const part of kept) {
            while (k < extra.length && extra[k]!.page < part.page) merged.push(extra[k++]!);
            merged.push(part);
          }
          fromTags = [...merged, ...extra.slice(k)];
        }
      }
      const parts = layout ? layout.parts : fromTags;
      if (layout?.cover) {
        wanted.push({ readerId: layout.cover, page: 1, binaryId: 'cover' });
      }
      const sample = parts.flatMap((part) => part.runs.map((run) => run.text)).join(' ');
      if (looksLatin1Cyrillic(sample)) {
        const words = fromLatin1(sample)
          .split(/\s+/)
          .filter((w) => /^\p{L}{3,}$/u.test(w))
          .slice(0, 500);
        const wrong = (await misspelled(words, 'ru')).length;
        if (words.length > 0 && wrong / words.length < 0.5) {
          for (const part of parts) for (const run of part.runs) run.text = fromLatin1(run.text);
        }
      }

      const pagePictures = new Map(
        models.map((m) => [
          m.n,
          [...m.pictures, ...(m.drawings ?? [])].sort((a, b) => a.box[1] - b.box[1]),
        ]),
      );
      const picture = (page: number, _alt: string, readerId?: string): string | null => {
        const id = readerId ?? pagePictures.get(page)?.shift()?.id;
        if (!id) return null;
        const binaryId = `picture-${wanted.length + 1}`;
        wanted.push({ readerId: id, page, binaryId });
        return binaryId;
      };
      const link = (run: { uri?: string }): { href: string; note: boolean } | null =>
        run.uri ? { href: run.uri, note: false } : null;
      const words = parts.flatMap((part) => part.runs.flatMap((run) => run.text.split(/\s+/)));
      const guessedLang = await guessLanguage(words, misspelled);
      const language = resolveImportLanguage({
        pdfLang: pdfDoc.metadata.lang,
        ocrSummary: readStats.ocr,
        totalPages: pdfDoc.pages,
        guessedLang,
      });
      const body = textBody(parts, link, picture, { bookLang: language });
      xml =
        `<?xml version="1.0" encoding="UTF-8"?>\n<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
        metadataDescription(
          pdfDoc.metadata.info,
          template,
          outputStem,
          language,
          layout?.cover ? 'cover' : null,
        ) +
        body.xml +
        '</FictionBook>';

      if ((readStats.drawingsLeftOut ?? 0) > 0) {
        warnings.push(
          ctx.t('pdfImport.summary.drawingsLeftOut', { count: readStats.drawingsLeftOut }),
        );
      }
      if (!readStats.ocr?.used && (readStats.kinds.garbled ?? 0) > 0) {
        warnings.push(
          ctx.t('pdfImport.summary.garbledPages', { count: readStats.kinds.garbled }),
        );
      }
      if (readStats.ocr?.used) {
        if (readStats.ocr.fallbackPages > 0) {
          warnings.push(
            ctx.t('pdfImport.summary.ocrFallbackPages', { count: readStats.ocr.fallbackPages }),
          );
        }
        if (readStats.ocr.lowConfidencePages > 0) {
          warnings.push(
            ctx.t('pdfImport.summary.ocrLowConfidence', {
              count: readStats.ocr.lowConfidencePages,
            }),
          );
        }
      }
    }

    throwIfAborted(signal);
    xml = mendFb2(xml).xml;
    const opened = await createEphemeralFb2FromXml(
      rpc,
      xml,
      { kind: 'pdf', path: item.sourcePath },
      { keepDetails: Boolean(pdfDoc.record), signal },
    );
    docId = opened.docId;

    const added: BinaryMeta[] = [];
    let picturesLeftOut = 0;
    if (wanted.length > MAX_PICTURES) {
      picturesLeftOut += wanted.length - MAX_PICTURES;
      wanted = wanted.slice(0, MAX_PICTURES);
    }
    if (wanted.length > 0) {
      const picRes = await runCancellableRpcJob(
        rpc,
        () =>
          rpc.call('pdfImport.addPictures', {
            token: token!,
            docId: docId!,
            pictures: wanted.map((w) => ({
              id: w.readerId,
              page: w.page,
              suggestedId: w.binaryId,
            })),
          }),
        { signal },
      );
      added.push(...picRes.added.map((e) => e.binary));
      picturesLeftOut += picRes.failed.length;
    }
    if (picturesLeftOut > 0) {
      warnings.push(ctx.t('pdfImport.summary.picturesLeftOut', { count: picturesLeftOut }));
    }

    const uploadedIds = new Set(added.map((b) => b.id));
    let book = {
      ...opened.document,
      binaries: [...opened.document.binaries.filter((b) => !uploadedIds.has(b.id)), ...added],
    };

    // Unattended foreign PDF: silently apply archive or sibling FBD when present.
    if (!pdfDoc.record) {
      let fbdPath: string | null = null;
      if (item.archiveEntry && item.archiveFbdEntry) {
        try {
          fbdPath = (
            await rpc.call('pdfImport.extractFbd', {
              token: activeToken,
              entry: item.archiveFbdEntry,
            })
          ).path;
        } catch (err) {
          warnings.push(
            ctx.t('batch.reasons.unreadableFbd', {
              detail: err instanceof Error ? err.message : item.archiveFbdEntry,
            }),
          );
        }
      } else if (!item.archiveEntry) {
        const beside = await rpc
          .call('files.fbdBeside', { path: item.sourcePath })
          .catch(() => ({ path: undefined }));
        if (beside.path) fbdPath = beside.path;
      }
      if (fbdPath) {
        const applied = await withFbd(ctx, docId, book, fbdPath);
        if (applied.error) {
          warnings.push(
            ctx.t('batch.reasons.unreadableFbd', {
              detail:
                applied.error instanceof Error ? applied.error.message : pathBasename(fbdPath),
            }),
          );
        } else {
          book = { ...book, ...applied.document };
        }
      }
    }

    throwIfAborted(signal);
    onStage('batch.progress.stageWriting', 0, 1);
    await saveEphemeralFb2(rpc, docId, book, targetPath, {
      zipOutput: config.zipOutput,
      outputStem,
      signal,
      onProgress: (d, tot) => onStage('batch.progress.stageWriting', d, Math.max(tot, 1)),
    });

    let ocr: BatchAdapterOutcome['ocr'];
    if (readStats.ocr?.used) {
      const langTable = await cache.getLanguages();
      const uiLang = settings?.view?.uiLanguage ?? 'en';
      ocr = formatBatchOcrReason(readStats.ocr, langTable, uiLang, ctx.t);
    }

    return ocr ? { warnings, ocr } : { warnings };
  } catch (error) {
    if (isRpcError(error) && error.code === RpcErrorCode.pdfImportFailed) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'damaged';
      if (reason === 'passwordCancelled' || reason === 'copyForbidden') {
        throw new Error(ctx.t('batch.reasons.passwordPdf'), { cause: error });
      }
      throw new Error(pdfImportReason(ctx, error), { cause: error });
    }
    throw error;
  } finally {
    if (token) {
      await rpc.call('pdfImport.end', { token }).catch(() => undefined);
    }
    await closeEphemeralDoc(rpc, docId);
  }
}
