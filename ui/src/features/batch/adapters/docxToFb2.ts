/**
 * Feature 023 (T041; US5): unattended DOCX -> FB2 batch adapter.
 * Supports bare `.docx` and `.zip` archives, maps `.doc`/`.docm`/encrypted/empty refusals cleanly,
 * silently prefers embedded description for editor-exported DOCX (zero prompts), silently applies
 * archive or sibling `.fbd` for foreign DOCX, and writes UTF-8 `.fb2` or `.fb2.zip` atomically.
 */
import { docxImportPartUrl } from '@/model/binaryUrls';
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

async function fetchPartTextIfPresent(
  token: string,
  entrySet: ReadonlySet<string>,
  entry: string,
): Promise<string | undefined> {
  const exact = entrySet.has(entry)
    ? entry
    : [...entrySet].find((e) => e.toLowerCase() === entry.toLowerCase());
  if (!exact) return undefined;
  const response = await fetch(docxImportPartUrl(token, exact));
  if (!response.ok) return undefined;
  return response.text();
}

export async function runDocxToFb2(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const { ctx, rpc, settings, config, item, targetPath, outputStem, signal, onStage, cache } =
    params;

  const [
    { withFbd },
    { assembleDocxToFb2Xml, transferDocxPictures },
    { DocxEmptyError, parseDocxOoxml },
    { resolveDocxRoundtrip },
  ] = await Promise.all([
    import('@/features/importShared/fbdApply'),
    import('@/features/docx/import/docxFb2Assembler'),
    import('@/features/docx/import/docxOoxmlParser'),
    import('@/features/docx/import/docxRoundtripRestorer'),
  ]);

  let token: string | null = null;
  let docId: string | null = null;

  try {
    onStage('batch.progress.stageReading', 0, 100);
    const begun = await rpc.call('docxImport.begin', {
      path: item.sourcePath,
      entry: item.archiveEntry,
    });
    if ('archive' in begun) {
      throw new Error('Archive requires an explicit DOCX entry');
    }
    token = begun.token;
    throwIfAborted(signal);

    const entrySet = new Set(begun.entries);
    const [
      documentXml,
      documentRelsXml,
      stylesXml,
      numberingXml,
      footnotesXml,
      footnotesRelsXml,
      endnotesXml,
      endnotesRelsXml,
      coreXml,
      templateRes,
      genresEntries,
    ] = await Promise.all([
      fetchPartTextIfPresent(token, entrySet, 'word/document.xml'),
      fetchPartTextIfPresent(token, entrySet, 'word/_rels/document.xml.rels'),
      fetchPartTextIfPresent(token, entrySet, 'word/styles.xml'),
      fetchPartTextIfPresent(token, entrySet, 'word/numbering.xml'),
      fetchPartTextIfPresent(token, entrySet, 'word/footnotes.xml'),
      fetchPartTextIfPresent(token, entrySet, 'word/_rels/footnotes.xml.rels'),
      fetchPartTextIfPresent(token, entrySet, 'word/endnotes.xml'),
      fetchPartTextIfPresent(token, entrySet, 'word/_rels/endnotes.xml.rels'),
      fetchPartTextIfPresent(token, entrySet, 'docProps/core.xml'),
      rpc.call('template.xml'),
      cache.getGenres(),
    ]);
    throwIfAborted(signal);

    if (!documentXml) {
      throw new Error(ctx.t('docx.refused.damaged'));
    }

    const customXmlEntries = begun.entries.filter(
      (e) => /^customxml\/item\d+\.xml$/i.test(e) && !/itemprops/i.test(e),
    );
    const customXmlParts: string[] = [];
    for (const cx of customXmlEntries) {
      throwIfAborted(signal);
      const xml = await fetchPartTextIfPresent(token, entrySet, cx);
      if (xml) customXmlParts.push(xml);
    }

    onStage('batch.progress.stageConverting', 20, 100);
    const roundtrip = await resolveDocxRoundtrip({
      customXmlParts,
      documentXml,
      documentRelsXml,
      notesXml: footnotesXml ?? endnotesXml ?? '',
      notesRelsXml: footnotesXml ? footnotesRelsXml : endnotesRelsXml,
      coreXml,
    });
    throwIfAborted(signal);

    const headerFooterCount = begun.entries.filter((e) =>
      /^word\/(?:header|footer)\d*\.xml$/i.test(e),
    ).length;

    const parsed = parseDocxOoxml({
      documentXml,
      documentRelsXml,
      stylesXml,
      numberingXml,
      footnotesXml,
      footnotesRelsXml,
      endnotesXml,
      endnotesRelsXml,
      coreXml,
      headerFooterCount,
      roundtrip,
    });

    const summary = [...parsed.summary];
    for (const m of begun.strayMacros) {
      summary.push({ kind: 'strayMacrosIgnored', detail: m });
    }
    for (const o of begun.outside) {
      summary.push({ kind: 'outsideArchiveEntry', detail: o });
    }

    const genreMap = new Map<string, string>();
    for (const entry of normaliseGenres({ entries: genresEntries, userFiles: [] }).entries) {
      genreMap.set(entry.code.toLowerCase(), entry.code);
      for (const label of Object.values(entry.names)) {
        if (label) genreMap.set(label.toLowerCase(), entry.code);
      }
    }

    onStage('batch.progress.stageConverting', 60, 100);
    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: templateRes.xml,
      fallbackTitle: outputStem,
      genreMap,
    });
    summary.push(...assembled.summary.slice(parsed.summary.length));
    throwIfAborted(signal);

    const opened = await runCancellableRpcJob(
      rpc,
      () =>
        rpc.call('doc.newFromXml', {
          xml: assembled.fb2Xml,
          ...(assembled.useEmbeddedMeta ? { keepDetails: true } : {}),
        }),
      { signal },
    );
    docId = opened.document.docId;
    let book = opened.document;

    const quality = settings?.other?.jpegQuality ?? 90;
    const transferred = await transferDocxPictures({
      rpc,
      token,
      docId,
      needed: assembled.neededImages,
      jpegQuality: quality,
      summary,
      onStep: async () => {
        throwIfAborted(signal);
      },
    });
    book = { ...book, binaries: [...book.binaries, ...transferred.added] };

    // Unattended companion FBD: editor-made DOCX keeps embedded description silently;
    // foreign DOCX silently applies paired archive FBD or sibling FBD.
    const extraWarnings: string[] = [];
    if (!assembled.useEmbeddedMeta) {
      let fbdPath: string | null = null;
      if (item.archiveEntry && item.archiveFbdEntry) {
        try {
          fbdPath = (
            await rpc.call('docxImport.extractFbd', { token, fbdEntry: item.archiveFbdEntry })
          ).path;
        } catch (err) {
          extraWarnings.push(
            ctx.t('batch.reasons.unreadableFbd', {
              detail: err instanceof Error ? err.message : item.archiveFbdEntry,
            }),
          );
        }
      } else if (!item.archiveEntry && begun.siblingFbdPath) {
        fbdPath = begun.siblingFbdPath;
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
      if (existing) existing.count += entry.count ?? 1;
      else counted.set(key, { kind: entry.kind, detail: entry.detail, count: entry.count ?? 1 });
    }
    const alreadyCounted = new Set([
      'skippedDeletions',
      'skippedComments',
      'equationsAsText',
      'droppedStyling',
      'droppedUnsupportedDrawings',
      'droppedHeadersFooters',
      'droppedOleOrMedia',
      'droppedRemoteImages',
      'flattenedNestedTables',
      'strippedControlChars',
    ]);
    const warnings = [
      ...[...counted.values()].map(({ kind, detail, count }) => {
        const line = ctx.t(`docx.importSummary.${kind}`, { detail });
        return count > 1 && !alreadyCounted.has(kind) ? `${line} (\u00d7${count})` : line;
      }),
      ...extraWarnings,
    ];
    return { warnings };
  } catch (error) {
    if (error instanceof DocxEmptyError) {
      throw new Error(ctx.t('docx.refused.empty'), { cause: error });
    }
    if (isRpcError(error) && error.code === RpcErrorCode.docxRefused) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'damaged';
      throw new Error(ctx.t(`docx.refused.${reason}`, { defaultValue: error.message || reason }), {
        cause: error,
      });
    }
    throw error;
  } finally {
    if (token) {
      await rpc.call('docxImport.end', { token }).catch(() => undefined);
    }
    await closeEphemeralDoc(rpc, docId);
  }
}
