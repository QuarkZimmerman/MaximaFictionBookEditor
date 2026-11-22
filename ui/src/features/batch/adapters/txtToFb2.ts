/**
 * Feature 019 (T043; US2, FR-006, FR-007, FR-017): unattended TXT -> FB2 batch adapter.
 * Handles bare `.txt` and `.txt` inside `.zip`, automatically selects `candidates[0]` on
 * `needsEncoding`, offloads TXT parsing & XML building to `txtImportWorker.ts`, silently applies
 * archive or sibling `.fbd`, and writes UTF-8 `.fb2` or `.fb2.zip` atomically.
 */

import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import { normaliseGenres, normaliseLanguages } from '@/views/description/resources';

import { pathBasename } from '../engine/paths';
import type { TxtImportWorkerRequest, TxtImportWorkerResult } from '../workers/txtImportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  createEphemeralFb2FromXml,
  saveEphemeralFb2,
  throwIfAborted,
} from './fb2LoadSave';

export async function runTxtToFb2(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, config, item, targetPath, outputStem, signal, onStage, cache } = params;

  const [{ withFbd }, { dictionaryAsker, knownWords }] = await Promise.all([
    import('@/features/importShared/fbdApply'),
    import('@/features/text/joinWords'),
  ]);

  let token: string | null = null;
  let docId: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const begun = await rpc.call('txtImport.begin', {
      path: item.sourcePath,
      entry: item.archiveEntry,
    });
    if ('archive' in begun) {
      throw new Error('Archive requires an explicit TXT entry');
    }
    token = begun.token;
    throwIfAborted(signal);

    let readRes = await rpc.call('txtImport.read', { token });
    if ('needsEncoding' in readRes) {
      const candidate = readRes.needsEncoding.candidates[0] ?? 'utf-8';
      readRes = await rpc.call('txtImport.read', { token, encoding: candidate });
      if ('needsEncoding' in readRes) {
        throw new Error(ctx.t('batch.reasons.encodingFailed'));
      }
    }
    throwIfAborted(signal);

    const { text, encoding, source } = readRes;
    onStage('batch.progress.stageConverting', 0, 3);

    // Phase 1 in worker: check whether editor-exported TXT or extract broken-word candidates.
    const candRes = await runWorkerTask<TxtImportWorkerRequest, TxtImportWorkerResult>(
      () =>
        new Worker(new URL('../workers/txtImportWorker.ts', import.meta.url), { type: 'module' }),
      { kind: 'candidates', text },
      { signal },
    );
    if (candRes.kind !== 'candidates') throw new Error('Unexpected TXT worker reply');

    let knownList: string[] = [];
    if (!candRes.isOwn && candRes.candidates.length > 0) {
      const known = await knownWords(
        new Set(candRes.candidates),
        await dictionaryAsker(rpc),
        undefined,
        () => throwIfAborted(signal),
      );
      knownList = [...known];
    }
    throwIfAborted(signal);
    onStage('batch.progress.stageConverting', 1, 3);

    const [{ xml: template }, genresRaw, languagesRaw] = await Promise.all([
      rpc.call('template.xml'),
      candRes.isOwn ? cache.getGenres() : Promise.resolve([]),
      candRes.isOwn ? cache.getLanguages() : Promise.resolve([]),
    ]);
    throwIfAborted(signal);

    const lists = {
      genres: normaliseGenres({ entries: genresRaw, userFiles: [] }).entries,
      languages: normaliseLanguages(languagesRaw).groups.flatMap((group) =>
        group.languages.map((language) => ({ code: language.code, names: language.name })),
      ),
    };

    // Phase 2 in worker: build complete FB2 XML.
    const buildRes = await runWorkerTask<TxtImportWorkerRequest, TxtImportWorkerResult>(
      () =>
        new Worker(new URL('../workers/txtImportWorker.ts', import.meta.url), { type: 'module' }),
      {
        kind: 'build',
        text,
        template,
        stem: outputStem,
        knownWords: knownList,
        lists,
      },
      { signal },
    );
    if (buildRes.kind !== 'build') throw new Error('Unexpected TXT worker reply');
    onStage('batch.progress.stageConverting', 3, 3);

    throwIfAborted(signal);
    const opened = await createEphemeralFb2FromXml(
      rpc,
      buildRes.xml,
      { kind: 'txt', path: item.sourcePath },
      { signal },
    );
    docId = opened.docId;
    let book = opened.document;

    const warnings: string[] = [];
    if (encoding !== 'utf-8' && source !== 'bom') {
      warnings.push(ctx.t('txt.summary.encoding', { encoding }));
    }
    if (buildRes.controlsLeftOut > 0) {
      warnings.push(ctx.t('txt.summary.controls', { count: buildRes.controlsLeftOut }));
    }
    for (const detail of buildRes.unread) {
      warnings.push(ctx.t('txt.summary.unread', { detail }));
    }

    // Companion FBD: archive FBD when inside ZIP, or sibling FBD beside bare TXT.
    let fbdPath: string | null = null;
    if (item.archiveEntry && item.archiveFbdEntry) {
      try {
        fbdPath = (await rpc.call('txtImport.extractFbd', { token, entry: item.archiveFbdEntry }))
          .path;
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
            detail: applied.error instanceof Error ? applied.error.message : pathBasename(fbdPath),
          }),
        );
      } else {
        book = { ...book, ...applied.document };
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

    return { warnings };
  } catch (error) {
    if (isRpcError(error) && error.code === RpcErrorCode.textImportRefused) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'binary';
      throw new Error(ctx.t(`txt.refused.${reason}`, { defaultValue: error.message || reason }), {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (token) {
      await rpc.call('txtImport.end', { token }).catch(() => undefined);
    }
    await closeEphemeralDoc(rpc, docId);
  }
}
