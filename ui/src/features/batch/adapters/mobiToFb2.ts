/**
 * Feature 019 (T041; US2, FR-006, FR-007, FR-024): unattended MOBI / KF8 -> FB2 batch adapter.
 * Supports bare `.mobi`/`.azw3`/`.azw`/`.prc` and `.zip` archives, maps DRM/KFX refusals to clear
 * messages, silently prefers embedded description for editor-exported MOBIs, silently applies
 * archive or sibling `.fbd` for foreign MOBIs, and writes UTF-8 `.fb2` or `.fb2.zip` atomically.
 */

import { uploadBinary } from '@/features/images/binaries';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import { normaliseGenres } from '@/views/description/resources';

import { pathBasename } from '../engine/paths';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  runCancellableRpcJob,
  saveEphemeralFb2,
  throwIfAborted,
} from './fb2LoadSave';

const FB2_NS = 'http://www.gribuser.ru/xml/fictionbook/2.0';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function runMobiToFb2(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, outputStem, signal, onStage, cache } =
    params;

  const [
    { withFbd },
    { buildBook },
    { convertMobiToFb2 },
    { buildForeignDescription },
    { drawMathMlMarkup, drawSvgMarkup, fetchImportText, transferMobiPictures },
    { resolveMfbeMode, serializeDescriptionXml, serializeStylesheetsXml },
  ] = await Promise.all([
    import('@/features/importShared/fbdApply'),
    import('@/features/markdown/describe'),
    import('@/features/mobi/import/convert'),
    import('@/features/mobi/import/metadata'),
    import('@/features/mobi/import/pictures'),
    import('@/features/mobi/import/roundtrip'),
  ]);

  let token: string | null = null;
  let docId: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const begun = await rpc.call('mobiImport.begin', {
      path: item.sourcePath,
      entry: item.archiveEntry,
    });
    if ('archive' in begun) {
      throw new Error('Archive requires an explicit MOBI entry');
    }
    token = begun.token;
    throwIfAborted(signal);

    const readRes = await runCancellableRpcJob(
      rpc,
      () => rpc.call('mobiImport.read', { token: token! }),
      {
        signal,
        onProgress: (d, tot) => onStage('batch.progress.stageReading', d, Math.max(tot, 1)),
      },
    );
    throwIfAborted(signal);

    const [htmlOrText, templateRes, genresEntries] = await Promise.all([
      fetchImportText(token, 'html'),
      rpc.call('template.xml'),
      cache.getGenres(),
    ]);
    throwIfAborted(signal);

    const cssFlows: string[] = [];
    for (let i = 0; i < readRes.cssFlowCount; i++) {
      throwIfAborted(signal);
      cssFlows.push(await fetchImportText(token, `css/${i}`));
    }

    const mfbeRes = resolveMfbeMode({
      mfbeStatus: readRes.mfbeStatus,
      mfbeHtmlMatches: readRes.mfbeHtmlMatches,
      mfbeMetaMatches: readRes.mfbeMetaMatches,
      mfbe: readRes.mfbe,
    });

    const summary: { kind: string; detail: string }[] = [...mfbeRes.summary];
    if (readRes.fellBackToMobi7) {
      summary.push({ kind: 'fellBackToMobi7', detail: '' });
    }

    onStage('batch.progress.stageConverting', 0, 100);
    let stepCount = 0;
    const converted = await convertMobiToFb2({
      activePart: readRes.activePart,
      htmlOrText,
      cssFlows,
      metadata: readRes.metadata,
      navigation: readRes.navigation,
      guide: readRes.guide,
      pictures: readRes.pictures,
      coverIndex: readRes.coverIndex,
      thumbnailIndex: readRes.thumbnailIndex,
      mfbeBodyRecord: mfbeRes.useBody ? mfbeRes.record : null,
      yieldStep: async () => {
        throwIfAborted(signal);
        stepCount = Math.min(stepCount + 5, 90);
        onStage('batch.progress.stageConverting', stepCount, 100);
        await nextTask();
        throwIfAborted(signal);
      },
    });
    summary.push(...converted.summary);

    // Draw MathML / SVG figures.
    const drawn: { id: string; blob: Blob; contentType: string }[] = [];
    const placedFigures = new Map<string, string>();
    for (const [index, formula] of converted.formulas.entries()) {
      throwIfAborted(signal);
      try {
        const pic = await drawMathMlMarkup(formula.markup, formula.display);
        drawn.push({ id: formula.id, blob: pic.blob, contentType: pic.contentType });
        placedFigures.set(`math:${index}`, formula.id);
      } catch {
        summary.push({ kind: 'formulaAsText', detail: formula.alt || '\u2026' });
      }
    }
    for (const [index, drawing] of converted.drawings.entries()) {
      throwIfAborted(signal);
      try {
        const pic = await drawSvgMarkup(drawing.markup);
        drawn.push({ id: drawing.id, blob: pic.blob, contentType: pic.contentType });
        placedFigures.set(`svg:${index}`, drawing.id);
      } catch {
        summary.push({ kind: 'drawingLeftOut', detail: drawing.alt || drawing.id });
      }
    }
    const replace = (xmlText: string): string =>
      xmlText.replace(
        /<!--mfbe-(math|svg)(-block)?:(\d+)-->/g,
        (_, kind: string, block: string | undefined, n: string) => {
          const entry = (kind === 'math' ? converted.formulas : converted.drawings)[Number(n)]!;
          const id = placedFigures.get(`${kind}:${n}`);
          const alt = entry.alt ? ` alt="${escText(entry.alt).replace(/"/g, '&quot;')}"` : '';
          if (id) return `<image l:href="#${id}"${alt}/>`;
          const text = escText(entry.alt);
          if (!block) return text;
          return text ? `<p>${text}</p>` : '<empty-line/>';
        },
      );

    const bodyXml = replace(converted.bodyXml);
    const notesXml = converted.notesXml === null ? null : replace(converted.notesXml);
    const annotationXml =
      converted.annotationXml === null ? null : replace(converted.annotationXml);
    const historyXml = converted.historyXml === null ? null : replace(converted.historyXml);

    let fb2Xml: string;
    if (mfbeRes.useMeta && mfbeRes.record) {
      const descXml = serializeDescriptionXml(mfbeRes.record.description, undefined, {
        annotationXml,
        historyXml,
      });
      const cssXml = serializeStylesheetsXml(mfbeRes.record.stylesheets);
      fb2Xml =
        `<?xml version="1.0" encoding="utf-8"?>\n` +
        `<FictionBook xmlns="${FB2_NS}" xmlns:l="${XLINK_NS}">` +
        `${cssXml}${descXml}${bodyXml}${notesXml ?? ''}</FictionBook>\n`;
    } else {
      const genreEntries = normaliseGenres({ entries: genresEntries, userFiles: [] }).entries;
      const foreign = buildForeignDescription(readRes.metadata, genreEntries, outputStem);
      summary.push(...foreign.summary);
      if (converted.coverBinaryId) {
        foreign.description.cover = `#${converted.coverBinaryId}`;
      }
      fb2Xml = buildBook(
        templateRes.xml,
        {
          description: foreign.description,
          bodyXml,
          notesXml,
          stylesheets: converted.stylesheets,
          pictures: [],
          formulas: [],
          chars: [],
          diagrams: [],
          summary: [],
          cssFiles: [],
          stats: {
            sections: converted.counts.sections,
            pictures: converted.counts.pictures,
            tables: converted.counts.tables,
            notes: converted.counts.notes,
          },
        },
        { annotationXml, historyXml },
      );
    }

    throwIfAborted(signal);
    const opened = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('doc.newFromXml', {
          xml: fb2Xml,
          ...(mfbeRes.useMeta ? { keepDetails: true } : {}),
        }),
      { signal },
    );
    docId = opened.document.docId;
    let book = opened.document;

    const pictureIndex = new Map(readRes.pictures.map((p) => [p.index, p]));
    const quality = settings?.other?.jpegQuality ?? 90;
    const transferred = await transferMobiPictures({
      rpc,
      token,
      docId,
      pictureIndex,
      needed: converted.neededPictures,
      quality,
      summary: summary as never,
      onStep: async () => {
        throwIfAborted(signal);
      },
    });
    const uploadedDrawn = [];
    for (const fig of drawn) {
      throwIfAborted(signal);
      try {
        uploadedDrawn.push(
          await uploadBinary(docId, fig.blob, {
            contentType: fig.contentType,
            suggestedId: fig.id,
          }),
        );
      } catch {
        summary.push({ kind: 'drawingLeftOut', detail: fig.id });
      }
    }
    book = {
      ...book,
      binaries: [...book.binaries, ...transferred.added, ...uploadedDrawn],
    };

    // Unattended companion FBD: editor-made MOBI keeps embedded description; foreign MOBI applies
    // archive FBD or sibling FBD silently.
    const extraWarnings: string[] = [];
    if (!mfbeRes.useMeta) {
      let fbdPath: string | null = null;
      if (item.archiveEntry && item.archiveFbdEntry) {
        try {
          fbdPath = (
            await rpc.call('mobiImport.extractFbd', { token, entry: item.archiveFbdEntry })
          ).path;
        } catch (err) {
          extraWarnings.push(
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
          extraWarnings.push(
            ctx.t('batch.reasons.unreadableFbd', {
              detail:
                applied.error instanceof Error ? applied.error.message : pathBasename(fbdPath),
            }),
          );
        } else {
          book = { ...book, ...applied.document };
          summary.push({ kind: 'fbdApplied', detail: pathBasename(fbdPath) });
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

    const counted = new Map<string, { kind: string; detail: string; count: number }>();
    for (const entry of summary) {
      const key = `${entry.kind}\u0000${entry.detail}`;
      const existing = counted.get(key);
      if (existing) existing.count++;
      else counted.set(key, { kind: entry.kind, detail: entry.detail, count: 1 });
    }
    const warnings = [
      ...[...counted.values()].map(({ kind, detail, count }) => {
        let key: string;
        let msgParams: Record<string, string | number> = { detail };
        switch (kind) {
          case 'fellBackToMobi7':
            key = 'mobi.importSummary.fallbackMobi7';
            break;
          case 'externallyModified':
            key = 'mobi.importSummary.mfbeExternallyModified';
            break;
          case 'fbdApplied':
            key = 'mobi.importSummary.fbd';
            msgParams = { name: detail };
            break;
          default:
            key = `mobi.importSummary.${kind}`;
            break;
        }
        const line = ctx.t(key, msgParams);
        return count > 1 ? `${line} (\u00d7${count})` : line;
      }),
      ...extraWarnings,
    ];
    return { warnings };
  } catch (error) {
    if (isRpcError(error) && error.code === RpcErrorCode.mobiRefused) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'damaged';
      if (reason === 'encrypted') {
        throw new Error(ctx.t('batch.reasons.encryptedMobi'));
      }
      throw new Error(
        ctx.t(`mobi.refused.${reason}`, {
          defaultValue: error.message || reason,
        }),
      );
    }
    throw error;
  } finally {
    if (token) {
      await rpc.call('mobiImport.end', { token }).catch(() => undefined);
    }
    await closeEphemeralDoc(rpc, docId);
  }
}
