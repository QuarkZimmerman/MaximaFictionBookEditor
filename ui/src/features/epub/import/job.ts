/**
 * Feature 012 (US2, US3; D14-D17, D23-D31, D33; FR-020-FR-031, FR-040-FR-045): File > Import > EPUB
 * File.... The first module of the lazy chunk `epub-import`.
 *
 * The unsaved-changes question first, as Open asks it; then the EPUB, opened by the core, which
 * refuses DRM, files that are not EPUB books and hostile archives before anything is read (D17,
 * D29). The package, the table of contents, the pages and the book's stylesheets are read here and
 * converted to an FB2 book; formulas and drawings are drawn before the book is made, its pictures
 * put into it - as JPEG or PNG only (D23) - before it replaces the window's book, and Save As
 * proposes the EPUB's name with `.fb2` (D15). The import is modal, with *Cancel*, yields often
 * enough for both to answer within a second (D29), and keeps nothing once it ends (D16, D33). A
 * summary lists what could not come over as written (D31).
 */

import type { CommandContext } from '@/app/commands';
import { startModalJob } from '@/app/modalJob';
import { uploadBinary } from '@/features/images/binaries';
import type { FileFeature } from '@/features/file/fileCommands';
import type { ConvertResult } from '@/features/markdown/convert';
import { buildBook } from '@/features/markdown/describe';
import { drawChar } from '@/features/markdown/pictures';
import type { BinaryMeta, Description } from '@/model/document';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type EpubSource, type GenreEntry } from '@/rpc/types';

import { xmlName } from '../shared/names';
import {
  classUseOf,
  convertPages,
  wordsOf,
  type ConvertedBook,
  type ConvertPage,
  type ImportSummaryItem,
} from './convert';
import { planClasses } from './css';
import { describe } from './description';
import { Dropped } from './dropped';
import { CancelledError, Yielder } from './limits';
import { readNavigation, readPackage, type EpubPackage } from './package';
import { decodePage, pageKind, parsePage } from './parse';
import { addPictures, drawSvg, entryBytes } from './pictures';

const REMOTE_URL = /url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi;

function stemOf(path: string): string {
  return path
    .slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    .replace(/\.epub$/i, '');
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/**
 * The pages of the reading order, parsed (D17: every form; a page that is not well-formed read as
 * HTML; an SVG page as a picture of its own, D23).
 */
async function readPages(
  token: string,
  pkg: EpubPackage,
  summary: ImportSummaryItem[],
  yielder: Yielder,
): Promise<ConvertPage[]> {
  const roles = new Map(pkg.guide.map((reference) => [reference.path, reference.type]));
  const pages: ConvertPage[] = [];
  for (const { item: first, linear } of pkg.spine) {
    await yielder.step();
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
    if (item === pkg.nav) continue;
    if (!kind) {
      summary.push({ kind: 'dropped', detail: item.path });
      continue;
    }
    if (kind === 'svg') {
      const doc = new DOMParser().parseFromString(
        '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>-</title></head><body>' +
          `<img src="${encodeURIComponent(nameOf(item.path))}" alt=""/></body></html>`,
        'application/xhtml+xml',
      );
      pages.push({ path: item.path, doc, linear, role: roles.get(item.path) });
      continue;
    }
    try {
      const { doc, recovered } = parsePage(decodePage(await entryBytes(token, item.path)), kind);
      if (recovered) summary.push({ kind: 'recovered', detail: item.path });
      pages.push({ path: item.path, doc, linear, role: roles.get(item.path) });
    } catch {
      summary.push({ kind: 'pageMissing', detail: item.path });
    }
  }
  return pages;
}

/** The book's stylesheets: its CSS files, then the pages' own `<style>` blocks (D26). */
async function bookStyles(token: string, pkg: EpubPackage, pages: readonly ConvertPage[]) {
  const sheets: string[] = [];
  for (const item of pkg.manifest.values()) {
    if (item.mediaType !== 'text/css') continue;
    try {
      sheets.push(decodePage(await entryBytes(token, item.path)));
    } catch {
      // an unreadable stylesheet adds no look
    }
  }
  for (const page of pages) {
    for (const style of Array.from(page.doc.getElementsByTagName('style'))) {
      sheets.push(style.textContent ?? '');
    }
  }
  return sheets;
}

interface Figure {
  id: string;
  blob: Blob;
  contentType: string;
}

/**
 * D23, D24: the formulas and drawings of the pages as pictures, their placeholders replaced by the
 * pictures - or, when one cannot be drawn, by its text, listed.
 */
async function drawFigures(
  book: ConvertedBook,
  summary: ImportSummaryItem[],
  yielder: Yielder,
): Promise<{ bodyXml: string; notesXml: string | null; drawn: Figure[] }> {
  const drawn: Figure[] = [];
  const placed = new Map<string, string>();
  if (book.formulas.length > 0) {
    const { drawMathML } = await import('@/features/markdown/diagrams/formula');
    for (const [index, formula] of book.formulas.entries()) {
      await yielder.step();
      try {
        const picture = await drawMathML(formula.markup, formula.display);
        drawn.push({ id: formula.id, blob: picture.blob, contentType: picture.contentType });
        placed.set(`math:${index}`, formula.id);
      } catch {
        summary.push({ kind: 'formulaAsText', detail: formula.alt || '\u2026' });
      }
    }
  }
  for (const [index, drawing] of book.drawings.entries()) {
    await yielder.step();
    try {
      const picture = await drawSvg(drawing.markup);
      drawn.push({ id: drawing.id, blob: picture.blob, contentType: picture.contentType });
      placed.set(`svg:${index}`, drawing.id);
    } catch {
      summary.push({ kind: 'drawingLeftOut', detail: drawing.alt || drawing.id });
    }
  }
  const replace = (xml: string): string =>
    xml.replace(
      /<!--mfbe-(math|svg)(-block)?:(\d+)-->/g,
      (_, kind: string, block: string | undefined, n: string) => {
        const item = (kind === 'math' ? book.formulas : book.drawings)[Number(n)]!;
        const id = placed.get(`${kind}:${n}`);
        const alt = item.alt ? ` alt="${escapeText(item.alt).replace(/"/g, '&quot;')}"` : '';
        if (id) return `<image l:href="#${id}"${alt}/>`;
        const text = escapeText(item.alt);
        if (!block) return text;
        return text ? `<p>${text}</p>` : '<empty-line/>';
      },
    );
  return {
    bodyXml: replace(book.bodyXml),
    notesXml: book.notesXml === null ? null : replace(book.notesXml),
    drawn,
  };
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
  let done = 0;
  let total = 1;
  const yielder = new Yielder(
    () => cancelled,
    () => modal.progress(Math.min(++done, total), total),
  );
  let source: EpubSource | null = null;
  try {
    source = await rpc.call('epub.open', { path });
    const token = source.token;
    const summary: ImportSummaryItem[] = [];
    const dropped = new Dropped();
    for (const name of source.outside) summary.push({ kind: 'outside', detail: name });
    const pkg = readPackage(
      decodePage(await entryBytes(token, source.packagePath)),
      source.packagePath,
    );
    // The pages are read, then converted, then the pictures added: the total grows once known.
    total = pkg.spine.length * 2 + 2;
    const navigationItem = pkg.nav ?? pkg.ncx;
    let navigationText = '';
    if (navigationItem) {
      navigationText = decodePage(await entryBytes(token, navigationItem.path));
    }
    const navigation = navigationItem
      ? readNavigation(navigationText, navigationItem.path, navigationItem !== pkg.nav)
      : [];
    if (/page-list|<pageList[\s>]/.test(navigationText)) dropped.add('droppedPageList');
    const pages = await readPages(token, pkg, summary, yielder);
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
    // D27: what FB2 has no place for, from the package.
    for (const item of pkg.manifest.values()) {
      if (/font|opentype|truetype|woff/.test(item.mediaType)) {
        dropped.add('droppedFonts', nameOf(item.path));
      } else if (item.mediaType === 'application/smil+xml') {
        dropped.add('droppedOverlays', nameOf(item.path));
      }
    }
    if (pkg.metadata.fixedLayout) dropped.add('droppedFixedLayout');
    // D26: the book's look, as FB2 forms, named styles and the paragraph look.
    const sheets = await bookStyles(token, pkg, pages);
    for (const sheet of sheets) {
      for (const match of sheet.matchAll(REMOTE_URL))
        summary.push({ kind: 'remote', detail: match[1]! });
    }
    const plan = planClasses(sheets, classUseOf(pages));
    for (const part of plan.dropped) summary.push({ kind: 'cssDropped', detail: part });
    const descriptionWords = new Set(
      wordsOf(
        [
          described.description.title,
          ...pkg.metadata.creators.map((person) => person.name),
          ...pkg.metadata.series.map((one) => `${one.name} ${one.number ?? ''}`),
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
      dropped,
      yielder,
    });
    summary.push(...converted.summary);
    total =
      done + converted.pictures.size + converted.formulas.length + converted.drawings.length + 2;
    const coverPath = converted.coverPath ?? pkg.coverImage?.path;
    if (coverPath && !converted.pictures.has(coverPath) && images.has(coverPath)) {
      const taken = new Set(converted.pictures.values());
      const stem = xmlName(nameOf(coverPath).replace(/\.[^.]*$/, '') || 'cover');
      let id = stem;
      for (let n = 2; taken.has(id); n++) id = `${stem}_${n}`;
      converted.pictures.set(coverPath, id);
    }
    if (coverPath && converted.pictures.has(coverPath)) {
      described.description.cover = `#${converted.pictures.get(coverPath)}`;
    }
    const figures = await drawFigures(converted, summary, yielder);

    const { xml: templateXml } = await rpc.call('template.xml');
    const xml = buildBook(templateXml, {
      description: described.description,
      bodyXml: figures.bodyXml,
      notesXml: figures.notesXml,
      stylesheets: plan.stylesheet
        ? [{ type: 'text/css', text: plan.stylesheet, foreign: false }]
        : [],
    } as unknown as ConvertResult);
    await yielder.step();
    // The core's job is not cancelled: it would leave the document it made unknown here. A
    // Cancel during it takes effect when it ends, and the new document is closed then.
    const opened = await rpc.runJob('doc.newFromXml', { xml, origin: { kind: 'epub', path } });
    const docId = opened.document.docId;
    // The pictures go into the new book before the window shows it, so that nothing asks for a
    // picture the book does not hold yet, and Cancel still leaves the window's book as it was (D16).
    const added: BinaryMeta[] = [];
    try {
      const settings = await rpc.call('settings.get').catch(() => null);
      const quality =
        (settings as { other?: { jpegQuality?: number } } | null)?.other?.jpegQuality ?? 90;
      added.push(
        ...(await addPictures(
          rpc,
          { token, docId, images, quality, yielder },
          converted.pictures,
          summary,
        )),
      );
      for (const figure of figures.drawn) {
        await yielder.step();
        added.push(
          await uploadBinary(docId, figure.blob, {
            contentType: figure.contentType,
            suggestedId: figure.id,
          }),
        );
      }
      // D25: the special characters as small pictures, as the Markdown import draws them.
      for (const char of converted.chars.values()) {
        const blob = await drawChar(char);
        if (blob) {
          added.push(
            await uploadBinary(docId, blob, { contentType: 'image/png', suggestedId: char.id }),
          );
        }
      }
      await yielder.step();
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
    summary.push(...dropped.summary());
    await rpc.call('epub.close', { token }).catch(() => undefined);
    source = null;
    // Only now is the window's book replaced (D15, D16).
    await files.loadImported(ctx, document, path);
    modal.progress(total, total);
    modal.end();
    const counts = ctx.t('epub.importDone', {
      sections: converted.stats.sections,
      pictures: added.length - converted.chars.size,
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
    if (cancelled || error instanceof CancelledError) {
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
