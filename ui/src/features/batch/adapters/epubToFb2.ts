/**
 * Feature 019 (T040; US2, FR-006, FR-007, FR-024): unattended EPUB -> FB2 batch adapter.
 * Handles both bare `.epub` files and `.epub` entries wrapped inside `.zip` archives (via
 * `batch.extractEntry`), silently applies matched archive/beside `.fbd` for foreign EPUBs,
 * preserves reversible round-trip metadata for editor-exported EPUBs, and writes UTF-8 `.fb2` or
 * `.fb2.zip` atomically via ephemeral `doc.save`.
 */

import type { ConvertResult } from '@/features/markdown/convert';
import { uploadBinary } from '@/features/images/binaries';
import type { BinaryMeta, Description, Stylesheet } from '@/model/document';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type EpubSource, type GenreEntry } from '@/rpc/types';

import { pathBasename, stripBookStem } from '../engine/paths';
import type { BatchAdapterContext, BatchAdapterOutcome } from './adapterTypes';
import {
  closeEphemeralDoc,
  createEphemeralFb2FromXml,
  runCancellableRpcJob,
  saveEphemeralFb2,
  throwIfAborted,
} from './fb2LoadSave';

const REMOTE_URL = /url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi;

function nameOf(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function runEpubToFb2(params: BatchAdapterContext): Promise<BatchAdapterOutcome> {
  const {
    ctx,
    rpc,
    settings,
    config,
    runId,
    item,
    targetPath,
    outputStem,
    signal,
    onStage,
    cache,
  } = params;

  const [
    { withFbd },
    { buildBook },
    { drawChar },
    { xmlName },
    { classUseOf, convertPages, wordsOf },
    { namedStylesPlan, planClasses },
    { describe },
    { Dropped },
    { Yielder },
    { readLandmarks, readNavigation, readPackage },
    { decodePage, pageKind, parsePage },
    { addPictures, drawSvg, entryBytes },
  ] = await Promise.all([
    import('@/features/importShared/fbdApply'),
    import('@/features/markdown/describe'),
    import('@/features/markdown/pictures'),
    import('@/features/epub/shared/names'),
    import('@/features/epub/import/convert'),
    import('@/features/epub/import/css'),
    import('@/features/epub/import/description'),
    import('@/features/epub/import/dropped'),
    import('@/features/epub/import/limits'),
    import('@/features/epub/import/package'),
    import('@/features/epub/import/parse'),
    import('@/features/epub/import/pictures'),
  ]);

  let epubPath = item.sourcePath;
  let archiveFbdPath: string | undefined;
  let source: EpubSource | null = null;
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
            format: 'epub',
            fbdEntry: item.archiveFbdEntry,
          }),
        { signal },
      );
      epubPath = extracted.extractedPath;
      archiveFbdPath = extracted.fbdPath;
    }

    throwIfAborted(signal);
    onStage('batch.progress.stageReading', 0, 100);
    source = await rpc.call('epub.open', { path: epubPath });
    const token = source.token;
    const summary: { kind: string; detail: string }[] = [];
    const dropped = new Dropped();
    for (const name of source.outside) summary.push({ kind: 'outside', detail: name });

    let done = 0;
    let total = 10;
    const yielder = new Yielder(
      () => signal.aborted,
      () => {
        done = Math.min(done + 1, Math.max(1, total - 1));
        onStage('batch.progress.stageConverting', done, total);
      },
    );

    const pkg = readPackage(
      decodePage(await entryBytes(token, source.packagePath)),
      source.packagePath,
    );
    total = pkg.spine.length * 2 + 4;
    const navigationItem = pkg.nav ?? pkg.ncx;
    let navigationText = '';
    if (navigationItem) {
      navigationText = decodePage(await entryBytes(token, navigationItem.path));
    }
    const navigation = navigationItem
      ? readNavigation(navigationText, navigationItem.path, navigationItem !== pkg.nav)
      : [];
    const landmarks =
      navigationItem && navigationItem === pkg.nav
        ? readLandmarks(navigationText, navigationItem.path)
        : new Map<string, string>();
    if (/page-list|<pageList[\s>]/.test(navigationText)) dropped.add('droppedPageList');

    // Read spine pages.
    const roles = new Map(pkg.guide.map((ref) => [ref.path, ref.type]));
    for (const [target, landmarkType] of landmarks) {
      if (!roles.has(target)) roles.set(target, landmarkType);
    }
    const pages: { path: string; doc: globalThis.Document; linear: boolean; role?: string }[] = [];
    for (const { item: first, linear } of pkg.spine) {
      await yielder.step();
      let cur = first;
      const seen = new Set<string>();
      while (!pageKind(cur.mediaType) && cur.fallback && !seen.has(cur.id)) {
        seen.add(cur.id);
        const next = pkg.manifest.get(cur.fallback);
        if (!next) break;
        cur = next;
      }
      const kind = pageKind(cur.mediaType);
      if (cur === pkg.nav) continue;
      if (!kind) {
        summary.push({ kind: 'dropped', detail: cur.path });
        continue;
      }
      if (kind === 'svg') {
        const doc = new DOMParser().parseFromString(
          '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>-</title></head><body>' +
            `<img src="${encodeURIComponent(nameOf(cur.path))}" alt=""/></body></html>`,
          'application/xhtml+xml',
        );
        pages.push({ path: cur.path, doc, linear, role: roles.get(cur.path) });
        continue;
      }
      try {
        const { doc, recovered } = parsePage(decodePage(await entryBytes(token, cur.path)), kind);
        if (recovered) summary.push({ kind: 'recovered', detail: cur.path });
        pages.push({ path: cur.path, doc, linear, role: roles.get(cur.path) });
      } catch {
        summary.push({ kind: 'pageMissing', detail: cur.path });
      }
    }

    const genres = (await cache.getGenres()) as GenreEntry[];
    const described = describe(pkg.metadata, genres, outputStem);
    summary.push(...described.summary);

    const images = new Map(
      [...pkg.manifest.values()]
        .filter((m) => m.mediaType.startsWith('image/'))
        .map((m) => [m.path, m.mediaType]),
    );
    for (const m of pkg.manifest.values()) {
      if (/font|opentype|truetype|woff/.test(m.mediaType)) {
        dropped.add('droppedFonts', nameOf(m.path));
      } else if (m.mediaType === 'application/smil+xml') {
        dropped.add('droppedOverlays', nameOf(m.path));
      }
    }
    if (pkg.metadata.fixedLayout) dropped.add('droppedFixedLayout');

    const sheets: string[] = [];
    for (const m of pkg.manifest.values()) {
      if (m.mediaType !== 'text/css') continue;
      try {
        sheets.push(decodePage(await entryBytes(token, m.path)));
      } catch {
        // ignore unreadable CSS
      }
    }
    for (const pg of pages) {
      for (const style of Array.from(pg.doc.getElementsByTagName('style'))) {
        sheets.push(style.textContent ?? '');
      }
    }
    for (const sheet of sheets) {
      for (const match of sheet.matchAll(REMOTE_URL)) {
        summary.push({ kind: 'remote', detail: match[1]! });
      }
    }

    const editorBook = Boolean(pkg.metadata.mfbeDescription);
    let restoredSheets: Stylesheet[] | null = null;
    if (editorBook && pkg.metadata.mfbeStylesheets) {
      try {
        restoredSheets = JSON.parse(pkg.metadata.mfbeStylesheets) as Stylesheet[];
      } catch {
        summary.push({ kind: 'listedData', detail: 'mfbe:fb2-stylesheets' });
      }
    }

    const plan = editorBook
      ? namedStylesPlan(classUseOf(pages))
      : planClasses(sheets, classUseOf(pages));
    for (const part of plan.dropped) summary.push({ kind: 'cssDropped', detail: part });

    const descriptionWords = new Set(
      wordsOf(
        [
          described.description.title,
          ...pkg.metadata.creators.map((p) => p.name),
          ...pkg.metadata.series.map((s) => `${s.name} ${s.number ?? ''}`),
        ].join(' '),
      ),
    );
    const converted = await convertPages({
      pages,
      navigation,
      images,
      descriptionWords,
      notesTitle: ctx.t('editing.footnote.notesTitle'),
      classes: plan,
      editorBook,
      dropped,
      yielder,
    });
    summary.push(...converted.summary);

    const coverPath = converted.coverPath ?? pkg.coverImage?.path;
    if (coverPath && !converted.pictures.has(coverPath) && images.has(coverPath)) {
      const taken = new Set(converted.pictures.values());
      const stem = xmlName(stripBookStem(nameOf(coverPath)) || 'cover');
      let id = stem;
      for (let n = 2; taken.has(id); n++) id = `${stem}_${n}`;
      converted.pictures.set(coverPath, id);
    }
    if (coverPath && converted.pictures.has(coverPath)) {
      described.description.cover = `#${converted.pictures.get(coverPath)}`;
    }

    // Draw MathML & SVG figures if present.
    const drawn: { id: string; blob: Blob; contentType: string }[] = [];
    const placedFigures = new Map<string, string>();
    if (converted.formulas.length > 0) {
      const { drawMathML } = await import('@/features/markdown/diagrams/formula');
      for (const [index, formula] of converted.formulas.entries()) {
        await yielder.step();
        try {
          const pic = await drawMathML(formula.markup, formula.display);
          drawn.push({ id: formula.id, blob: pic.blob, contentType: pic.contentType });
          placedFigures.set(`math:${index}`, formula.id);
        } catch {
          summary.push({ kind: 'formula', detail: formula.alt || '\u2026' });
        }
      }
    }
    for (const [index, drawing] of converted.drawings.entries()) {
      await yielder.step();
      try {
        const pic = await drawSvg(drawing.markup);
        drawn.push({ id: drawing.id, blob: pic.blob, contentType: pic.contentType });
        placedFigures.set(`svg:${index}`, drawing.id);
      } catch {
        summary.push({ kind: 'drawing', detail: drawing.alt || drawing.id });
      }
    }
    const replacePlaceholders = (xmlText: string): string =>
      xmlText.replace(
        /<!--mfbe-(math|svg)(-block)?:(\d+)-->/g,
        (_, kind: string, block: string | undefined, n: string) => {
          const entry = (kind === 'math' ? converted.formulas : converted.drawings)[Number(n)]!;
          const id = placedFigures.get(`${kind}:${n}`);
          const alt = entry.alt ? ` alt="${escapeText(entry.alt).replace(/"/g, '&quot;')}"` : '';
          if (id) return `<image l:href="#${id}"${alt}/>`;
          const text = escapeText(entry.alt);
          if (!block) return text;
          return text ? `<p>${text}</p>` : '<empty-line/>';
        },
      );

    const bodyXml = replacePlaceholders(converted.bodyXml);
    const notesXml = converted.notesXml === null ? null : replacePlaceholders(converted.notesXml);
    const historyXml =
      converted.historyXml === null ? null : replacePlaceholders(converted.historyXml);

    const { xml: templateXml } = await rpc.call('template.xml');
    const xml = buildBook(
      templateXml,
      {
        description: described.description,
        bodyXml,
        notesXml,
        stylesheets: restoredSheets
          ? restoredSheets.map(({ type, content }) => ({ type, text: content, foreign: false }))
          : plan.stylesheet
            ? [{ type: 'text/css', text: plan.stylesheet, foreign: false }]
            : [],
      } as unknown as ConvertResult,
      { historyXml },
    );

    throwIfAborted(signal);
    const opened = await createEphemeralFb2FromXml(
      rpc,
      xml,
      { kind: 'epub', path: epubPath },
      { signal },
    );
    docId = opened.docId;

    const quality = settings?.other?.jpegQuality ?? 90;
    const added: BinaryMeta[] = [];
    added.push(
      ...(await addPictures(
        rpc,
        { token, docId, images, quality, yielder },
        converted.pictures,
        summary as never,
      )),
    );
    for (const fig of drawn) {
      await yielder.step();
      added.push(
        await uploadBinary(docId, fig.blob, {
          contentType: fig.contentType,
          suggestedId: fig.id,
        }),
      );
    }
    for (const ch of converted.chars.values()) {
      const blob = await drawChar(ch);
      if (blob) {
        added.push(
          await uploadBinary(docId, blob, { contentType: 'image/png', suggestedId: ch.id }),
        );
      }
    }

    const uploadedIds = new Set(added.map((b) => b.id));
    let document = {
      ...opened.document,
      binaries: [...opened.document.binaries.filter((b) => !uploadedIds.has(b.id)), ...added],
    };

    const extraWarnings: string[] = [];
    if (pkg.metadata.mfbeDescription) {
      try {
        const restored = JSON.parse(pkg.metadata.mfbeDescription) as Description;
        if (restored?.titleInfo) {
          const cover = described.description.cover;
          if (cover && restored.titleInfo.coverpage?.[0]) {
            restored.titleInfo.coverpage[0].href = cover;
          }
          if (
            !restored.documentInfo.history &&
            historyXml &&
            opened.document.description.documentInfo.history
          ) {
            restored.documentInfo = {
              ...restored.documentInfo,
              history: opened.document.description.documentInfo.history,
            };
          }
          document = { ...document, description: restored };
        }
      } catch {
        summary.push({ kind: 'listedData', detail: 'mfbe:fb2-description' });
      }
    } else {
      // Unattended foreign EPUB: apply matched archive FBD or sibling FBD silently.
      let fbdToApply = archiveFbdPath;
      if (!fbdToApply && !item.archiveEntry) {
        const beside = await rpc
          .call('files.fbdBeside', { path: item.sourcePath })
          .catch(() => ({ path: undefined }));
        fbdToApply = beside.path;
      }
      if (fbdToApply) {
        const applied = await withFbd(ctx, docId, document, fbdToApply);
        if (applied.error) {
          extraWarnings.push(
            ctx.t('batch.reasons.unreadableFbd', {
              detail:
                applied.error instanceof Error ? applied.error.message : pathBasename(fbdToApply),
            }),
          );
        } else {
          document = { ...document, ...applied.document };
        }
      }
    }

    summary.push(...dropped.summary());
    await rpc.call('epub.close', { token }).catch(() => undefined);
    source = null;

    throwIfAborted(signal);
    onStage('batch.progress.stageWriting', 0, 1);
    await saveEphemeralFb2(rpc, docId, document, targetPath, {
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
        const line = ctx.t(`epub.importSummary.${kind}`, { detail });
        return count > 1 ? `${line} (\u00d7${count})` : line;
      }),
      ...extraWarnings,
    ];
    return { warnings };
  } catch (error) {
    if (isRpcError(error) && error.code === RpcErrorCode.epubRefused) {
      const reason = (error.data as { reason?: string } | undefined)?.reason ?? 'epub.notZip';
      throw new Error(
        ctx.t(`epub.refused.${reason.replace(/^epub\./, '')}`, { path: item.sourcePath }),
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (source) {
      await rpc.call('epub.close', { token: source.token }).catch(() => undefined);
    }
    await closeEphemeralDoc(rpc, docId);
  }
}
