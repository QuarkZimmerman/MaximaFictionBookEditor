/**
 * Feature 023 (T027 & T032; contracts/rpc-api.md §4): lazy DOCX import orchestrator.
 * Lives inside the `docx-import` lazy chunk — loaded only after the user picks a `.docx` or `.zip`.
 */
import type { CommandContext } from '@/app/commands';
import { showArchiveBookChooser } from '@/dialogs/show';
import type { FileFeature } from '@/features/file/fileCommands';
import { closeRead, readDescriptionFile, withFbd } from '@/features/importShared/fbdApply';
import { docxImportPartUrl } from '@/model/binaryUrls';
import type { Document } from '@/model/document';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type ArchiveChoice } from '@/rpc/types';
import { normaliseGenres } from '@/views/description/resources';

import type { DocxImportRun } from '../importCommand';
import type { DocxSummaryItem } from '../shared/docxRoundtripTypes';
import { assembleDocxToFb2Xml, transferDocxPictures } from './docxFb2Assembler';
import { DocxEmptyError, parseDocxOoxml } from './docxOoxmlParser';
import { descriptionsCanonicallyEqual, resolveDocxRoundtrip } from './docxRoundtripRestorer';

class Cancelled extends Error {}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function baseName(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

function stemOf(p: string): string {
  const b = baseName(p);
  return b.replace(/\.[^.]*$/, '') || b;
}

function folderOfEntry(entry: string): string {
  const at = entry.lastIndexOf('/');
  return at >= 0 ? entry.slice(0, at) : '';
}

async function fetchPartTextIfPresent(
  token: string,
  entrySet: ReadonlySet<string>,
  entry: string,
): Promise<string | undefined> {
  // Match case-insensitively to tolerate mixed-case third-party DOCX archives.
  const exact = entrySet.has(entry)
    ? entry
    : [...entrySet].find((e) => e.toLowerCase() === entry.toLowerCase());
  if (!exact) return undefined;
  const response = await fetch(docxImportPartUrl(token, exact));
  if (!response.ok) return undefined;
  return response.text();
}

function formatSummaryLines(ctx: CommandContext, items: readonly DocxSummaryItem[]): string[] {
  const counted = new Map<string, { item: DocxSummaryItem; count: number }>();
  for (const item of items) {
    const key = `${item.kind}\u0000${item.detail}`;
    const existing = counted.get(key);
    if (existing) existing.count += item.count ?? 1;
    else counted.set(key, { item, count: item.count ?? 1 });
  }
  const lines = [...counted.values()].map(({ item, count }) => {
    const line = ctx.t(`docx.importSummary.${item.kind}`, { detail: item.detail });
    const alreadyCountedInDetail =
      item.kind === 'skippedDeletions' ||
      item.kind === 'skippedComments' ||
      item.kind === 'equationsAsText' ||
      item.kind === 'droppedStyling' ||
      item.kind === 'droppedUnsupportedDrawings' ||
      item.kind === 'droppedHeadersFooters' ||
      item.kind === 'droppedOleOrMedia' ||
      item.kind === 'droppedRemoteImages' ||
      item.kind === 'flattenedNestedTables' ||
      item.kind === 'strippedControlChars';
    return count > 1 && !alreadyCountedInDetail ? `${line} (\u00d7${count})` : line;
  });
  const shown = lines.slice(0, 40).map((l) => `\u2022 ${l}`);
  if (lines.length > 40) shown.push(ctx.t('docx.summaryMore', { count: lines.length - 40 }));
  return shown;
}

async function resolveArchiveFbdChoice(
  ctx: CommandContext,
  run: DocxImportRun,
): Promise<{ entry: string; name: string } | null | 'cancel'> {
  if (!run.fromArchive || run.fbdEntries.length === 0) return null;
  const chosenEntry = run.archiveEntry ?? '';
  const bookFolder = folderOfEntry(chosenEntry);
  const bookStem = stemOf(chosenEntry).toLowerCase();

  // 1. Exact stem match in same folder
  const sameFolder = run.fbdEntries.find(
    (e) => folderOfEntry(e) === bookFolder && stemOf(e).toLowerCase() === bookStem,
  );
  if (sameFolder) return { entry: sameFolder, name: baseName(sameFolder) };

  // 2. Sole .fbd in archive
  if (run.fbdEntries.length === 1) {
    return { entry: run.fbdEntries[0]!, name: baseName(run.fbdEntries[0]!) };
  }

  // 3. Multiple unmatched FBDs -> chooser listing archive FBDs + None
  const choice: ArchiveChoice = {
    archive: run.path,
    books: [
      { entry: '', name: ctx.t('docx.archive.fbdNone'), folder: '', size: 0, kind: 'fbd' },
      ...run.fbdEntries.map((entry) => ({
        entry,
        name: baseName(entry),
        folder: folderOfEntry(entry),
        size: 0,
        kind: 'fbd' as const,
      })),
    ],
    otherFiles: 0,
    booksTotal: run.fbdEntries.length + 1,
  };
  const chosen = await showArchiveBookChooser(ctx.dialogs, choice, baseName(run.path));
  if (chosen === null) return 'cancel';
  return chosen === '' ? null : { entry: chosen, name: baseName(chosen) };
}

export async function importDocx(
  ctx: CommandContext,
  files: FileFeature,
  run: DocxImportRun,
): Promise<boolean> {
  const { rpc, store } = ctx;
  let modal = run.modal;
  if (!rpc) {
    modal.end();
    return false;
  }
  actions.setStatusMessage(store, '');

  let createdDocId: string | null = null;
  const check = (): void => {
    if (run.cancelled()) throw new Cancelled();
  };

  try {
    const SCALE = 10_000;
    const entrySet = new Set(run.entries);

    // 1. Fetch required & optional OOXML parts over authenticated loopback HTTP.
    modal.progress(500, SCALE);
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
      genresRes,
    ] = await Promise.all([
      fetchPartTextIfPresent(run.token, entrySet, 'word/document.xml'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/_rels/document.xml.rels'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/styles.xml'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/numbering.xml'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/footnotes.xml'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/_rels/footnotes.xml.rels'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/endnotes.xml'),
      fetchPartTextIfPresent(run.token, entrySet, 'word/_rels/endnotes.xml.rels'),
      fetchPartTextIfPresent(run.token, entrySet, 'docProps/core.xml'),
      rpc.call('template.xml'),
      rpc.call('resources.genres').catch(() => null),
    ]);
    check();
    if (!documentXml) {
      throw new Error(ctx.t('docx.refused.damaged'));
    }

    // Fetch candidate Custom XML parts (`customXml/item*.xml`, excluding itemProps*).
    const customXmlEntries = run.entries.filter(
      (e) => /^customxml\/item\d+\.xml$/i.test(e) && !/itemprops/i.test(e),
    );
    const customXmlParts: string[] = [];
    for (const cx of customXmlEntries) {
      check();
      const xml = await fetchPartTextIfPresent(run.token, entrySet, cx);
      if (xml) customXmlParts.push(xml);
    }
    modal.progress(2_000, SCALE);
    await nextTask();
    check();

    // 2. Resolve reversible round-trip vs externally modified vs foreign mode.
    const notesXmlForDigest = footnotesXml ?? endnotesXml ?? '';
    const notesRelsForDigest = footnotesXml ? footnotesRelsXml : endnotesRelsXml;
    const roundtrip = await resolveDocxRoundtrip({
      customXmlParts,
      documentXml,
      documentRelsXml,
      notesXml: notesXmlForDigest,
      notesRelsXml: notesRelsForDigest,
      coreXml,
    });
    modal.progress(3_000, SCALE);
    await nextTask();
    check();

    const headerFooterCount = run.entries.filter((e) =>
      /^word\/(?:header|footer)\d*\.xml$/i.test(e),
    ).length;

    // 3. Parse OOXML into structured blocks, notes, and image requirements.
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

    // Include core container security findings (stray macros, outside entries).
    const summary: DocxSummaryItem[] = [...parsed.summary];
    for (const m of run.strayMacros) {
      summary.push({ kind: 'strayMacrosIgnored', detail: m });
    }
    for (const o of run.outside) {
      summary.push({ kind: 'outsideArchiveEntry', detail: o });
    }

    const genreMap = new Map<string, string>();
    if (genresRes) {
      for (const entry of normaliseGenres(genresRes).entries) {
        genreMap.set(entry.code.toLowerCase(), entry.code);
        for (const label of Object.values(entry.names)) {
          if (label) genreMap.set(label.toLowerCase(), entry.code);
        }
      }
    }

    const fallbackTitle = stemOf(run.archiveEntry ?? run.path);
    modal.progress(4_500, SCALE);
    await nextTask();
    check();

    // 4. First pass assembly with predicted IDs to create the document in core, OR transfer
    //    pictures onto the newly created document (matching EPUB/MOBI order).
    const assembled = assembleDocxToFb2Xml(parsed, {
      templateXml: templateRes.xml,
      fallbackTitle,
      genreMap,
    });
    // Merge assembler summary (e.g. broken internal links) without duplicating parser items.
    const assemblerExtra = assembled.summary.slice(parsed.summary.length);
    summary.push(...assemblerExtra);

    modal.progress(5_500, SCALE);
    await nextTask();
    check();

    // 5. Create new unsaved FB2 document in core (fire-and-forget: never sets path/recent).
    const opened = await rpc.runJob(
      'doc.newFromXml',
      {
        xml: assembled.fb2Xml,
        ...(assembled.useEmbeddedMeta ? { keepDetails: true } : {}),
      },
      {
        onProgress: (p) => {
          if (p.total <= 0) return;
          const frac = Math.min(1, p.done / p.total);
          modal.progress(5_500 + Math.round(frac * 2_000), SCALE);
        },
      },
    );
    createdDocId = opened.document.docId;
    let book: Document = opened.document;
    modal.progress(7_500, SCALE);
    check();

    // 6. Transfer referenced raster images via `docxImport.picture` + rasterize standalone SVGs.
    const quality = store.getState().settings?.other.jpegQuality ?? 90;
    const totalPics = Math.max(1, assembled.neededImages.size);
    let picDone = 0;
    const transferred = await transferDocxPictures({
      rpc,
      token: run.token,
      docId: book.docId,
      needed: assembled.neededImages,
      jpegQuality: quality,
      summary,
      onStep: async () => {
        check();
        modal.progress(7_500 + Math.round((++picDone / totalPics) * 1_800), SCALE);
      },
    });
    book = { ...book, binaries: [...book.binaries, ...transferred.added] };
    modal.progress(9_400, SCALE);
    check();

    // 7. Companion FBD pairing (archive FBD + conflict prompt for editor DOCX; sibling FBD for bare foreign DOCX only).
    if (run.fromArchive && run.fbdEntries.length > 0) {
      const chosenEntry = run.archiveEntry ?? '';
      const hasAutoMatch =
        run.fbdEntries.length === 1 ||
        run.fbdEntries.some(
          (e) =>
            folderOfEntry(e) === folderOfEntry(chosenEntry) &&
            stemOf(e).toLowerCase() === stemOf(chosenEntry).toLowerCase(),
        );
      if (!hasAutoMatch) modal.end();
      const chosen = await resolveArchiveFbdChoice(ctx, run);
      if (!hasAutoMatch) modal = run.reopen();
      if (chosen === 'cancel') throw new Cancelled();

      if (chosen) {
        const extracted = await rpc
          .call('docxImport.extractFbd', { token: run.token, fbdEntry: chosen.entry })
          .catch(() => null);
        if (extracted?.path) {
          if (assembled.useEmbeddedMeta) {
            let archiveRead = null;
            try {
              archiveRead = await readDescriptionFile(ctx, book.docId, extracted.path);
              const same = descriptionsCanonicallyEqual(archiveRead.description, book.description);
              await closeRead(ctx, archiveRead);
              archiveRead = null;

              if (!same) {
                modal.end();
                const choice = await ctx.dialogs.showMessage({
                  text: ctx.t('docx.archive.fbdConflictPrompt', { fbd: chosen.name }),
                  caption: ctx.t('docx.archive.fbdConflictTitle'),
                  buttons: 'yesNoCancel',
                  icon: 'question',
                  labels: {
                    yes: ctx.t('docx.archive.useArchiveFbd'),
                    no: ctx.t('docx.archive.keepDocxDescription'),
                  },
                  testId: 'dialog-docx-fbd-conflict',
                });
                modal = run.reopen();
                if (choice === 'cancel') throw new Cancelled();
                if (choice === 'yes') {
                  const applied = await withFbd(ctx, book.docId, book, extracted.path);
                  if (!applied.error) {
                    book = { ...book, ...applied.document };
                    summary.push({ kind: 'fbdApplied', detail: chosen.name });
                  }
                }
              }
            } catch (err) {
              await closeRead(ctx, archiveRead);
              if (err instanceof Cancelled) throw err;
            }
          } else {
            const applied = await withFbd(ctx, book.docId, book, extracted.path);
            if (!applied.error) {
              book = { ...book, ...applied.document };
              summary.push({ kind: 'fbdApplied', detail: chosen.name });
            }
          }
        }
      }
    } else if (!run.fromArchive && !assembled.useEmbeddedMeta && run.siblingFbdPath) {
      // Bare foreign DOCX: silently apply sibling FBD (bare editor DOCX ignores sibling FBD).
      const applied = await withFbd(ctx, book.docId, book, run.siblingFbdPath);
      if (!applied.error) {
        book = { ...book, ...applied.document };
        summary.push({ kind: 'fbdApplied', detail: baseName(run.siblingFbdPath) });
      }
    }

    // 8. End import session, close progress modal, load into editor activating Body view!
    await rpc.call('docxImport.end', { token: run.token }).catch(() => undefined);
    modal.progress(SCALE, SCALE);
    modal.end();

    createdDocId = null; // ownership transferred to window
    await files.loadImported(ctx, book);

    const doneMsg = ctx.t('docx.importDone', {
      sections: assembled.counts.sections,
      pictures: transferred.added.length,
      tables: assembled.counts.tables,
      notes: assembled.counts.notes,
    });

    if (summary.length === 0) {
      actions.setStatusMessage(store, doneMsg);
    } else {
      await ctx.dialogs.showMessage({
        text: `${doneMsg}\n\n${ctx.t('docx.importSummaryIntro')}\n${formatSummaryLines(ctx, summary).join('\n')}`,
        caption: ctx.t('docx.importCaption'),
        icon: 'info',
        testId: 'dialog-docx-import-summary',
      });
    }
    return true;
  } catch (error) {
    modal.end();
    if (createdDocId) {
      await rpc.call('doc.close', { docId: createdDocId }).catch(() => undefined);
    }
    await rpc.call('docxImport.end', { token: run.token }).catch(() => undefined);
    if (
      run.cancelled() ||
      error instanceof Cancelled ||
      (isRpcError(error) && error.code === RpcErrorCode.cancelled)
    ) {
      actions.setStatusMessage(store, ctx.t('docx.importCancelled'));
      return false;
    }
    if (error instanceof DocxEmptyError) {
      await ctx.dialogs.showMessage({
        text: ctx.t('docx.importFailed', {
          path: run.path,
          reason: ctx.t('docx.refused.empty'),
        }),
        caption: ctx.t('docx.importCaption'),
        icon: 'error',
        testId: 'dialog-docx-import-failed',
      });
      return false;
    }
    throw error;
  }
}
