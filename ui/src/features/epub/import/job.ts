/**
 * Feature 012 (US2; D14-D17, D28, D30, D31, D33; FR-020-FR-031): File > Import > EPUB File.... The
 * first module of the lazy chunk `epub-import`.
 *
 * The unsaved-changes question first, as Open asks it; then the EPUB, opened by the core, which
 * refuses DRM, files that are not EPUB books and hostile archives before anything is read (D17,
 * D29). The package, the table of contents and the pages are read here, converted to an FB2 book
 * and opened as a new untitled book - the window's book is replaced only then, and Save As
 * proposes the EPUB's name with `.fb2` (D15). The import is modal, with *Cancel*; nothing of it is
 * kept once it ends (D16, D33). A summary lists what could not come over as written (D31).
 */

import type { CommandContext } from '@/app/commands';
import { startModalJob } from '@/app/modalJob';
import { uploadBinary } from '@/features/images/binaries';
import type { FileFeature } from '@/features/file/fileCommands';
import type { ConvertResult } from '@/features/markdown/convert';
import { buildBook } from '@/features/markdown/describe';
import { epubEntryUrl } from '@/model/binaryUrls';
import type { BinaryMeta, Description } from '@/model/document';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type EpubSource, type GenreEntry } from '@/rpc/types';

import { convertPages, wordsOf, type ConvertPage, type ImportSummaryItem } from './convert';
import { describe } from './description';
import { readNavigation, readPackage, type EpubPackage } from './package';
import { decodePage, pageKind, parsePage } from './parse';

class Cancelled extends Error {}

/** The formats the core decodes and a save converts to JPEG or PNG (D23). */
const CORE_PICTURES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
]);

function stemOf(path: string): string {
  return path
    .slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    .replace(/\.epub$/i, '');
}

async function entryBytes(token: string, name: string): Promise<Uint8Array> {
  const response = await fetch(epubEntryUrl(token, name));
  if (!response.ok)
    throw new Error(
      `${name}: ${response.status} ${response.headers.get('X-MFBE-Reason') ?? ''}`.trim(),
    );
  return new Uint8Array(await response.arrayBuffer());
}

function summaryLines(ctx: CommandContext, summary: readonly ImportSummaryItem[]): string[] {
  const counted = new Map<string, { item: ImportSummaryItem; count: number }>();
  for (const item of summary) {
    const key = `${item.kind}\u0000${item.detail}`;
    const entry = counted.get(key);
    if (entry) entry.count++;
    else counted.set(key, { item, count: 1 });
  }
  const lines = [...counted.values()].map(({ item, count }) => {
    const line = ctx.t(`epub.importSummary.${item.kind}`, { detail: item.detail });
    return count > 1 ? `${line} (\u00d7${count})` : line;
  });
  const shown = lines.slice(0, 40).map((line) => `\u2022 ${line}`);
  if (lines.length > 40) shown.push(ctx.t('epub.summaryMore', { count: lines.length - 40 }));
  return shown;
}

/** The pages of the reading order, parsed (D17: every form; a page that is not well-formed read as HTML). */
async function readPages(
  token: string,
  pkg: EpubPackage,
  summary: ImportSummaryItem[],
  progress: () => void,
  cancelled: () => boolean,
): Promise<ConvertPage[]> {
  const roles = new Map(pkg.guide.map((reference) => [reference.path, reference.type]));
  const pages: ConvertPage[] = [];
  for (const { item: first, linear } of pkg.spine) {
    if (cancelled()) throw new Cancelled();
    let item = first;
    // A page EPUB does not show itself (an XML island) is read through its fallback (D17).
    const seen = new Set<string>();
    while (!pageKind(item.mediaType) && item.fallback && !seen.has(item.id)) {
      seen.add(item.id);
      const next = pkg.manifest.get(item.fallback);
      if (!next) break;
      item = next;
    }
    const kind = pageKind(item.mediaType);
    if (!kind || kind === 'svg' || item === pkg.nav) {
      if (kind !== 'svg' && item !== pkg.nav) summary.push({ kind: 'dropped', detail: item.path });
      progress();
      continue;
    }
    try {
      const { doc, recovered } = parsePage(decodePage(await entryBytes(token, item.path)), kind);
      if (recovered) summary.push({ kind: 'recovered', detail: item.path });
      pages.push({ path: item.path, doc, linear, role: roles.get(item.path) });
    } catch {
      summary.push({ kind: 'pageMissing', detail: item.path });
    }
    progress();
  }
  return pages;
}

/** Runs the import; false when cancelled or refused (the window's book is then unchanged). */
export async function importEpub(ctx: CommandContext, files: FileFeature): Promise<boolean> {
  const rpc = ctx.rpc;
  if (!rpc) return false;
  if (!(await files.confirmDiscardChanges(ctx))) return false;
  const { paths } = await rpc.call('dialog.openFile', {
    title: ctx.t('epub.openTitle'),
    filters: [{ name: ctx.t('epub.filter'), extensions: ['epub'] }],
    selectedFilter: 0,
  });
  const path = paths[0];
  if (!path) return false;

  let cancelled = false;
  const modal = startModalJob(ctx.t('epub.importing'), () => {
    cancelled = true;
  });
  let source: EpubSource | null = null;
  try {
    source = await rpc.call('epub.open', { path });
    const token = source.token;
    const summary: ImportSummaryItem[] = [];
    for (const name of source.outside) summary.push({ kind: 'outside', detail: name });
    const pkg = readPackage(
      decodePage(await entryBytes(token, source.packagePath)),
      source.packagePath,
    );
    const navigationItem = pkg.nav ?? pkg.ncx;
    const navigation = navigationItem
      ? readNavigation(
          decodePage(await entryBytes(token, navigationItem.path)),
          navigationItem.path,
          navigationItem !== pkg.nav,
        )
      : [];
    let done = 0;
    // The pages, then the conversion, then each picture (known once the pages are converted).
    let total = pkg.spine.length + 2;
    const pages = await readPages(
      token,
      pkg,
      summary,
      () => modal.progress(++done, total),
      () => cancelled,
    );
    const genres = await rpc
      .call('resources.genres')
      .then((list) => list.entries as GenreEntry[])
      .catch(() => undefined);
    const described = describe(pkg.metadata, genres, stemOf(path));
    summary.push(...described.summary);
    const images = new Map(
      [...pkg.manifest.values()]
        .filter((item) => item.mediaType.startsWith('image/'))
        .map((item) => [item.path, item.mediaType]),
    );
    for (const item of pkg.manifest.values()) {
      if (/font|opentype|truetype|woff/.test(item.mediaType))
        summary.push({ kind: 'dropped', detail: item.path });
      if (item.mediaType === 'application/smil+xml')
        summary.push({ kind: 'dropped', detail: item.path });
    }
    const descriptionWords = new Set(
      wordsOf(
        [
          described.description.title,
          ...pkg.metadata.creators.map((person) => person.name),
          ...pkg.metadata.series.map((one) => `${one.name} ${one.number ?? ''}`),
        ].join(' '),
      ),
    );
    const converted = convertPages({
      pages,
      navigation,
      images,
      descriptionWords,
      notesTitle: ctx.t('editing.footnote.notesTitle'),
    });
    summary.push(...converted.summary);
    const coverPath = converted.coverPath ?? pkg.coverImage?.path;
    if (coverPath && !converted.pictures.has(coverPath) && images.has(coverPath)) {
      converted.pictures.set(
        coverPath,
        coverPath
          .slice(coverPath.lastIndexOf('/') + 1)
          .replace(/\.[^.]*$/, '')
          .replace(/[^A-Za-z0-9_.-]/g, '_') || 'cover',
      );
    }
    if (coverPath && converted.pictures.has(coverPath))
      described.description.cover = `#${converted.pictures.get(coverPath)}`;
    if (cancelled) throw new Cancelled();
    total = done + converted.pictures.size + 2;
    modal.progress(++done, total);

    const { xml: templateXml } = await rpc.call('template.xml');
    const xml = buildBook(templateXml, {
      description: described.description,
      bodyXml: converted.bodyXml,
      notesXml: converted.notesXml,
      stylesheets: [],
    } as unknown as ConvertResult);
    if (cancelled) throw new Cancelled();
    // The core's job is not cancelled: it would leave the document it made unknown here. A
    // Cancel during it takes effect when it ends, and the new document is closed then.
    const opened = await rpc.runJob('doc.newFromXml', { xml, origin: { kind: 'epub', path } });
    const docId = opened.document.docId;
    // The pictures go into the new book before the window shows it, so that nothing asks for a
    // picture the book does not hold yet, and Cancel still leaves the window's book as it was (D16).
    const added: BinaryMeta[] = [];
    try {
      for (const [picturePath, id] of converted.pictures) {
        if (cancelled) throw new Cancelled();
        const type = images.get(picturePath) ?? '';
        if (!CORE_PICTURES.has(type)) {
          summary.push({ kind: 'pictureLeftOut', detail: picturePath });
          continue;
        }
        try {
          const bytes = await entryBytes(token, picturePath);
          added.push(
            await uploadBinary(docId, bytes.buffer as ArrayBuffer, {
              contentType: type,
              suggestedId: id,
            }),
          );
        } catch {
          summary.push({ kind: 'pictureLeftOut', detail: picturePath });
        }
        modal.progress(++done, total);
      }
      if (cancelled) throw new Cancelled();
    } catch (error) {
      await rpc.call('doc.close', { docId }).catch(() => undefined);
      throw error;
    }
    const uploaded = new Set(added.map((binary) => binary.id));
    let document = {
      ...opened.document,
      binaries: [
        ...opened.document.binaries.filter((binary) => !uploaded.has(binary.id)),
        ...added,
      ],
    };
    // D7: an EPUB this editor made gives back its own description exactly.
    if (pkg.metadata.mfbeDescription) {
      try {
        const restored = JSON.parse(pkg.metadata.mfbeDescription) as Description;
        if (restored?.titleInfo) {
          const cover = described.description.cover;
          if (cover && restored.titleInfo.coverpage?.[0])
            restored.titleInfo.coverpage[0].href = cover;
          document = { ...document, description: restored };
        }
      } catch {
        summary.push({ kind: 'listedData', detail: 'mfbe:fb2-description' });
      }
    }
    await rpc.call('epub.close', { token }).catch(() => undefined);
    source = null;
    // Only now is the window's book replaced (D15, D16).
    await files.loadImported(ctx, document, path);
    modal.progress(total, total);
    modal.end();
    const counts = ctx.t('epub.importDone', {
      sections: converted.stats.sections,
      pictures: added.length,
      tables: converted.stats.tables,
      notes: converted.stats.notes,
    });
    if (summary.length === 0) {
      actions.setStatusMessage(ctx.store, counts);
    } else {
      await ctx.dialogs.showMessage({
        text: `${counts}\n\n${ctx.t('epub.importSummaryIntro')}\n${summaryLines(ctx, summary).join('\n')}`,
        caption: ctx.t('epub.importCaption'),
        icon: 'info',
        testId: 'dialog-epub-import-summary',
      });
    }
    return true;
  } catch (error) {
    modal.end();
    if (source) await rpc.call('epub.close', { token: source.token }).catch(() => undefined);
    if (cancelled || error instanceof Cancelled) {
      actions.setStatusMessage(ctx.store, ctx.t('epub.importCancelled'));
      return false;
    }
    let reason = error instanceof Error ? error.message : String(error);
    let testId = 'dialog-epub-import-failed';
    if (isRpcError(error) && error.code === RpcErrorCode.epubRefused) {
      const code = (
        (error.data as { reason?: string } | undefined)?.reason ?? 'epub.notZip'
      ).replace(/^epub\./, '');
      reason = ctx.t(`epub.refused.${code}`);
      if (code === 'protected') testId = 'dialog-epub-protected';
    }
    await ctx.dialogs.showMessage({
      text: ctx.t('epub.importFailed', { path, reason }),
      caption: ctx.t('epub.importCaption'),
      icon: 'error',
      testId,
    });
    return false;
  }
}
