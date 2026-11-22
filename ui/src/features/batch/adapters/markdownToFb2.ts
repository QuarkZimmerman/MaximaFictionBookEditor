/**
 * Feature 019 (T044; US2, FR-006, FR-007, FR-017, FR-024): unattended Markdown -> FB2 batch
 * adapter. Supports bare `.md`/`.markdown` files and `.md.zip`/`.zip` archives (extracted into a
 * jailed `tempDir` via `batch.extractEntry`), enforces strict `tempDir` path containment for
 * bundled pictures and CSS, automatically selects `candidates[0]` on `needsEncoding`, runs
 * `markdown/worker.ts` with abort support, serializes Mermaid rendering via `drawDiagram` (T019),
 * finishes all binary uploads BEFORE ephemeral `doc.save`, and applies companion `.fbd` silently
 * for foreign Markdown files.
 */

import { uploadBinary } from '@/features/images/binaries';
import type { ConvertOptions, ConvertResult, MarkdownStylesheet, SummaryItem } from '@/features/markdown/convert';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import { pathBasename, pathDirname } from '../engine/paths';
import { WorkerCancelledError } from '../workers/workerCall';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  createEphemeralFb2FromXml,
  runCancellableRpcJob,
  saveEphemeralFb2,
  throwIfAborted,
} from './fb2LoadSave';

function isOwnMarkdownText(text: string): boolean {
  const front = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1] ?? '';
  return /^document:\s*$[\s\S]*?^\s+id:\s*\S/m.test(front);
}

/**
 * Normalizes a POSIX or Windows path by resolving `.` and `..` segments cleanly so we can enforce
 * strict containment inside an extracted `.md.zip` `tempDir`.
 */
function normalizeAbsolutePath(raw: string): string {
  const winDrive = /^([A-Za-z]:)[\\/]/.exec(raw);
  const prefix = winDrive ? `${winDrive[1]!.toLowerCase()}/` : raw.startsWith('/') ? '/' : '';
  const body = winDrive ? raw.slice(3) : raw.startsWith('/') ? raw.slice(1) : raw;
  const parts: string[] = [];
  for (const seg of body.split(/[\\/]+/)) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (parts.length > 0) parts.pop();
    } else {
      parts.push(seg);
    }
  }
  return prefix + parts.join('/');
}

function isInsideJail(candidatePath: string, jailDir: string): boolean {
  const normJail = normalizeAbsolutePath(jailDir).replace(/\/+$/, '');
  const normCand = normalizeAbsolutePath(candidatePath);
  return normCand === normJail || normCand.startsWith(`${normJail}/`);
}

function runMarkdownWorkerCancellable(
  text: string,
  options: ConvertOptions,
  signal: AbortSignal,
): Promise<ConvertResult> {
  if (signal.aborted) return Promise.reject(new WorkerCancelledError());
  return new Promise<ConvertResult>((resolve, reject) => {
    const worker = new Worker(new URL('../../markdown/worker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new WorkerCancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (
      event: MessageEvent<{ ok: true; result: ConvertResult } | { ok: false; error: string }>,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || 'Markdown worker failed'));
    };
    worker.postMessage({ text, options });
  });
}

export async function runMarkdownToFb2(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, config, runId, item, targetPath, outputStem, signal, onStage, cache } = params;

  const [{ withFbd }, { buildBook }, { addPictures }] = await Promise.all([
    import('@/features/importShared/fbdApply'),
    import('@/features/markdown/describe'),
    import('@/features/markdown/pictures'),
  ]);

  let mdPath = item.sourcePath;
  let jailDir: string | null = null;
  let archiveFbdPath: string | undefined;
  let docId: string | null = null;

  try {
    if (item.archiveEntry) {
      onStage('batch.progress.stageExtracting', 0, 1);
      const extracted = await runCancellableRpcJob(
        rpc,
        () =>
          rpc.call('batch.extractEntry', {
            runId,
            itemId: item.itemId,
            archivePath: item.sourcePath,
            entry: item.archiveEntry!,
            format: 'markdown',
            fbdEntry: item.archiveFbdEntry,
          }),
        { signal },
      );
      mdPath = extracted.extractedPath;
      jailDir = extracted.tempDir;
      archiveFbdPath = extracted.fbdPath;
    }

    throwIfAborted(signal);
    onStage('batch.progress.stageReading', 0, 1);

    let readRes = await rpc.call('import.readMarkdown', { path: mdPath });
    if ('needsEncoding' in readRes) {
      const candidate = readRes.needsEncoding.candidates[0] ?? 'utf-8';
      readRes = await rpc.call('import.readMarkdown', { path: mdPath, encoding: candidate });
      if ('needsEncoding' in readRes) {
        throw new Error(ctx.t('batch.reasons.encodingFailed'));
      }
    }
    throwIfAborted(signal);

    const [{ xml: templateXml }, genresList] = await Promise.all([
      rpc.call('template.xml'),
      cache.getGenres(),
    ]);
    const genres = new Set(genresList.map((g) => g.code));
    const folder = pathDirname(mdPath);

    onStage('batch.progress.stageConverting', 0, 3);
    const result = await runMarkdownWorkerCancellable(
      readRes.text,
      {
        fileName: outputStem,
        baseDir: folder,
        notesTitle: ctx.t('editing.footnote.notesTitle'),
        genres,
        diagramAlt: ctx.t('markdown.diagramAlt'),
      },
      signal,
    );
    throwIfAborted(signal);

    const summary: SummaryItem[] = [...result.summary];

    // Translate inline & linked CSS (strictly jailed to tempDir for .md.zip).
    const stylesheets: MarkdownStylesheet[] = [];
    const foreignCss: string[] = result.stylesheets.filter((s) => s.foreign).map((s) => s.text);
    for (const sheet of result.stylesheets) {
      if (!sheet.foreign) stylesheets.push(sheet);
    }
    for (const entry of result.cssFiles) {
      throwIfAborted(signal);
      const candidate = /^([a-zA-Z]:[\\/]|[\\/])/.test(entry) ? entry : `${folder}/${entry}`;
      if (jailDir && !isInsideJail(candidate, jailDir)) {
        summary.push({ kind: 'cssFile', detail: entry });
        continue;
      }
      try {
        const cssRead = await rpc.call('import.readMarkdown', {
          path: candidate,
          encoding: 'utf-8',
        });
        if ('needsEncoding' in cssRead) summary.push({ kind: 'cssFile', detail: entry });
        else foreignCss.push(cssRead.text);
      } catch {
        summary.push({ kind: 'cssFile', detail: entry });
      }
    }
    if (foreignCss.length > 0) {
      const { translateCss } = await import('@/features/markdown/cssTranslate');
      for (const cssText of foreignCss) {
        const translated = translateCss(cssText);
        if (translated.css) {
          stylesheets.push({ type: 'text/css', text: translated.css, foreign: false });
        }
        if (translated.dropped.length > 0) {
          summary.push({ kind: 'cssDropped', detail: translated.dropped.join(', ') });
        }
      }
    }

    onStage('batch.progress.stageConverting', 1, 3);
    // Draw Mermaid diagrams (serialized in T019) and LaTeX formulas when present.
    let bodyXml = result.bodyXml;
    let notesXml = result.notesXml;
    const drawn: { id: string; blob: Blob; contentType: string }[] = [];

    if (result.diagrams.length > 0) {
      const { drawDiagram } = await import('@/features/markdown/diagrams/render');
      const forms = new Map<number, string>();
      for (const diagram of result.diagrams) {
        throwIfAborted(signal);
        try {
          const pic = await drawDiagram(diagram.source, diagram.index);
          drawn.push({ id: diagram.id, blob: pic.blob, contentType: pic.contentType });
          forms.set(diagram.index, diagram.imageXml);
        } catch (err) {
          forms.set(diagram.index, diagram.codeXml);
          const first = diagram.source.trim().split('\n')[0] ?? '';
          const reason = err instanceof Error ? err.message.split('\n')[0] : '';
          summary.push({ kind: 'diagram', detail: reason ? `${first} (${reason})` : first });
        }
      }
      bodyXml = bodyXml.replace(
        /<!--mfbe-diagram:(\d+)-->/g,
        (_, index: string) => forms.get(Number(index)) ?? '',
      );
    }

    if (result.formulas.length > 0) {
      const { drawFormula } = await import('@/features/markdown/diagrams/formula');
      const forms = new Map<number, string>();
      for (const formula of result.formulas) {
        throwIfAborted(signal);
        try {
          const pic = await drawFormula(formula.source, formula.display);
          drawn.push({ id: formula.id, blob: pic.blob, contentType: pic.contentType });
          forms.set(formula.index, formula.imageXml);
        } catch (err) {
          forms.set(formula.index, formula.textXml);
          const reason = err instanceof Error ? err.message.split('\n')[0] : '';
          summary.push({
            kind: 'formula',
            detail: reason ? `${formula.source} (${reason})` : formula.source,
          });
        }
      }
      const putFormula = (xml: string) =>
        xml.replace(
          /<!--mfbe-formula:(\d+)-->/g,
          (_, index: string) => forms.get(Number(index)) ?? '',
        );
      bodyXml = putFormula(bodyXml);
      notesXml = notesXml === null ? null : putFormula(notesXml);
    }

    onStage('batch.progress.stageConverting', 2, 3);
    throwIfAborted(signal);

    const fb2Xml = buildBook(templateXml, { ...result, bodyXml, notesXml, stylesheets });
    const opened = await createEphemeralFb2FromXml(
      rpc,
      fb2Xml,
      { kind: 'markdown', path: mdPath },
      { signal },
    );
    docId = opened.docId;
    let book = opened.document;

    // Enforce tempDir path jail on all local picture references when importing from .md.zip.
    const safePictures = [];
    for (const pic of result.pictures) {
      if (pic.kind === 'file' && jailDir && pic.path && !isInsideJail(pic.path, jailDir)) {
        summary.push({ kind: 'webPicture', detail: `${pic.path} (outside archive)` });
        continue;
      }
      safePictures.push(pic);
    }

    // Complete ALL binary uploads BEFORE ephemeral doc.save!
    const picOutcome = await addPictures(rpc, docId, safePictures, result.chars);
    for (const fig of drawn) {
      throwIfAborted(signal);
      try {
        picOutcome.added.push(
          await uploadBinary(docId, fig.blob, {
            contentType: fig.contentType,
            suggestedId: fig.id,
          }),
        );
      } catch {
        summary.push({ kind: 'diagram', detail: fig.id });
      }
    }
    for (const failedPic of picOutcome.failed) {
      summary.push({
        kind: 'webPicture',
        detail: `${failedPic.source} (${ctx.t(`markdown.picture.${failedPic.reason}`)})`,
      });
    }

    const uploadedIds = new Set(picOutcome.added.map((b) => b.id));
    book = {
      ...book,
      binaries: [
        ...book.binaries.filter((b) => !uploadedIds.has(b.id)),
        ...picOutcome.added,
      ],
    };

    const extraWarnings: string[] = [];
    if (!isOwnMarkdownText(readRes.text)) {
      let fbdToApply = archiveFbdPath;
      if (!fbdToApply && !item.archiveEntry) {
        const beside = await rpc
          .call('files.fbdBeside', { path: item.sourcePath })
          .catch(() => ({ path: undefined }));
        fbdToApply = beside.path;
      }
      if (fbdToApply) {
        const applied = await withFbd(ctx, docId, book, fbdToApply);
        if (applied.error) {
          extraWarnings.push(
            ctx.t('batch.reasons.unreadableFbd', {
              detail:
                applied.error instanceof Error ? applied.error.message : pathBasename(fbdToApply),
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

    const warnings = [
      ...summary.map((s) => ctx.t(`markdown.summary.${s.kind}`, { detail: s.detail })),
      ...extraWarnings,
    ];
    return { warnings };
  } catch (error) {
    if (isRpcError(error) && error.code === RpcErrorCode.importNotText) {
      throw new Error(ctx.t('markdown.notText'));
    }
    if (isRpcError(error) && error.code === RpcErrorCode.importTooLarge) {
      throw new Error(ctx.t('markdown.tooLarge'));
    }
    throw error;
  } finally {
    await closeEphemeralDoc(rpc, docId);
  }
}
