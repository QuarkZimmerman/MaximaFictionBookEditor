/**
 * Feature 019 (T033; FR-004, FR-005): unattended FB2 -> TXT batch adapter.
 * Reuses Settings -> Exports -> TXT language/encoding/BOM resolution, runs `layoutTxt` off-thread
 * in `txtExportWorker.ts`, and writes bare `.txt` or `.zip` (`<stem>.txt` + `<stem>.fbd`).
 */

import { defaultEncoding } from '@/features/txt/encodings';
import { normaliseGenres, normaliseLanguages } from '@/views/description/resources';

import type { TxtExportWorkerRequest } from '../workers/txtExportWorker';
import { runWorkerTask } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  openEphemeralFb2,
  runCancellableRpcJob,
  throwIfAborted,
} from './fb2LoadSave';

function characterName(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  const number = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(char) ? `${char} (${number})` : number;
}

export async function runFb2ToTxt(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, outputStem, signal, onStage, cache } =
    params;

  let docId: string | null = null;
  try {
    onStage('batch.progress.stageReading', 0, 100);
    const opened = await openEphemeralFb2(rpc, item.sourcePath, item.archiveEntry, {
      fixBroken: config.fixBroken,
      t: ctx.t,
      signal,
      onProgress: (done, total) =>
        onStage('batch.progress.stageReading', done, Math.max(total, 100)),
    });
    docId = opened.docId;
    const { document } = opened;
    throwIfAborted(signal);

    const [txtEncodings, genresRaw, languagesRaw, version] = await Promise.all([
      cache.getTxtEncodings(),
      cache.getGenres(),
      cache.getLanguages(),
      cache.getAppVersion(),
    ]);
    throwIfAborted(signal);

    const lang = document.description.titleInfo.lang;
    const encoding = defaultEncoding(txtEncodings, lang, settings?.txt);
    const bom = encoding === 'utf-8' && Boolean(settings?.txt?.bom);
    const zip = config.zipOutput;

    const languageList = normaliseLanguages(languagesRaw).groups.flatMap((group) =>
      group.languages.map((language) => ({ code: language.code, names: language.name })),
    );
    const genreList = normaliseGenres({ entries: genresRaw, userFiles: [] }).entries;

    onStage('batch.progress.stageConverting', 0, 1);
    const layout = await runWorkerTask<
      TxtExportWorkerRequest,
      { text: string; missingTitle: boolean }
    >(
      () =>
        new Worker(new URL('../workers/txtExportWorker.ts', import.meta.url), { type: 'module' }),
      {
        document,
        lists: { genres: genreList, languages: languageList },
        fileStem: outputStem,
        version,
      },
      { signal, pool: { pool: cache.workerPool, key: 'txtExport' } },
    );
    throwIfAborted(signal);

    onStage('batch.progress.stageWriting', 0, 1);
    const result = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('txt.export', {
          docId: docId!,
          path: targetPath,
          text: layout.text,
          encoding,
          bom,
          zip,
          ...(zip ? { document } : {}),
        }),
      {
        signal,
        onProgress: (done, total) =>
          onStage('batch.progress.stageWriting', done, Math.max(total, 1)),
      },
    );

    const warnings: string[] = [
      ...result.replaced.map((r) =>
        ctx.t(r.as === '' ? 'txt.summary.leftOut' : 'txt.summary.replaced', {
          char: characterName(r.char),
          as: r.as,
          count: r.count,
        }),
      ),
      ...(layout.missingTitle ? [ctx.t('txt.summary.noTitle', { detail: outputStem })] : []),
    ];
    return { warnings, ...(opened.repairedReason ? { fixedReason: opened.repairedReason } : {}) };
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
