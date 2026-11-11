/**
 * Feature 010, US8 (spec D26-D32, D36; FR-080-FR-094): the Markdown import. The question about
 * unsaved changes, the file, its text (the encoding asked only when the core cannot tell), the
 * template, the conversion in the worker, a new untitled book from the FB2 text, its pictures -
 * and only then is the window's book closed (D36). A summary lists what could not come over as
 * written; otherwise the status bar says what came in.
 */

import type { CommandContext } from '@/app/commands';
import { markdownFileTypes } from '@/dialogs/fileTypes';
import { showEncodingDialog } from '@/dialogs/show';
import { addBinariesToModel, uploadBinary } from '@/features/images/binaries';
import type { FileFeature } from '@/features/file/fileCommands';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode, type MarkdownText } from '@/rpc/types';

import type { ConvertResult, MarkdownStylesheet, SummaryItem } from './convert';
import type { DrawnDiagram } from './diagrams/raster';
import { buildBook } from './describe';
import { addPictures } from './pictures';
import { convertInWorker } from './run';

function parts(path: string): { folder: string; stem: string } {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(at + 1);
  return { folder: at >= 0 ? path.slice(0, at) : '', stem: name.replace(/\.(md|markdown)$/i, '') };
}

async function readText(ctx: CommandContext, path: string): Promise<MarkdownText | null> {
  const rpc = ctx.rpc!;
  const first = await rpc.call('import.readMarkdown', { path });
  if (!('needsEncoding' in first)) return first;
  // D31: asked only when the judge cannot tell - the most plausible encodings, best first.
  const candidates = first.needsEncoding.candidates;
  const answer = await showEncodingDialog(ctx.dialogs, {
    defaultEncoding: candidates[0] ?? 'utf-8',
    path,
  });
  if (!answer) return null;
  const chosen = await rpc.call('import.readMarkdown', { path, encoding: answer });
  return 'needsEncoding' in chosen ? null : chosen;
}

/**
 * Feature 011 (US7; D46; FR-074): the book's stylesheets - the export's own exactly, the CSS written
 * for HTML translated to FB2, the local files the header's `css:` names read beside the Markdown
 * file (never a web address); what cannot be read or used is listed in the summary.
 */
async function bookStylesheets(
  ctx: CommandContext,
  result: ConvertResult,
  folder: string,
  summary: SummaryItem[],
): Promise<MarkdownStylesheet[]> {
  const sheets: MarkdownStylesheet[] = [];
  const foreign: string[] = result.stylesheets
    .filter((sheet) => sheet.foreign)
    .map((sheet) => sheet.text);
  for (const sheet of result.stylesheets) if (!sheet.foreign) sheets.push(sheet);
  for (const entry of result.cssFiles) {
    const absolute = /^([a-zA-Z]:[\\/]|[\\/])/.test(entry) ? entry : `${folder}/${entry}`;
    try {
      const read = await ctx.rpc!.call('import.readMarkdown', {
        path: absolute,
        encoding: 'utf-8',
      });
      if ('needsEncoding' in read) summary.push({ kind: 'cssFile', detail: entry });
      else foreign.push(read.text);
    } catch {
      // A missing file or one that is not text: listed, the import goes on (U2).
      summary.push({ kind: 'cssFile', detail: entry });
    }
  }
  if (foreign.length > 0) {
    const { translateCss } = await import('./cssTranslate');
    for (const text of foreign) {
      const translated = translateCss(text);
      if (translated.css) sheets.push({ type: 'text/css', text: translated.css, foreign: false });
      if (translated.dropped.length > 0) {
        summary.push({ kind: 'cssDropped', detail: translated.dropped.join(', ') });
      }
    }
  }
  return sheets;
}

/**
 * Feature 011 (D49, FR-075a): the Mermaid blocks drawn as pictures - Mermaid needs the page, so the
 * worker left a marker per block -, the body with each marker replaced by the picture or, for a
 * diagram that cannot be drawn, by the block as code (listed in the summary). Mermaid is loaded only
 * when the file has a diagram.
 */
async function drawDiagrams(
  result: ConvertResult,
  summary: SummaryItem[],
): Promise<{ bodyXml: string; drawn: { id: string; picture: DrawnDiagram }[] }> {
  if (result.diagrams.length === 0) return { bodyXml: result.bodyXml, drawn: [] };
  const { drawDiagram } = await import('./diagrams/render');
  const drawn: { id: string; picture: DrawnDiagram }[] = [];
  const forms = new Map<number, string>();
  for (const diagram of result.diagrams) {
    try {
      drawn.push({ id: diagram.id, picture: await drawDiagram(diagram.source, diagram.index) });
      forms.set(diagram.index, diagram.imageXml);
    } catch (error) {
      forms.set(diagram.index, diagram.codeXml);
      const first = diagram.source.trim().split('\n')[0] ?? '';
      const reason = error instanceof Error ? error.message.split('\n')[0] : '';
      summary.push({ kind: 'diagram', detail: reason ? `${first} (${reason})` : first });
    }
  }
  const bodyXml = result.bodyXml.replace(
    /<!--mfbe-diagram:(\d+)-->/g,
    (_, index: string) => forms.get(Number(index)) ?? '',
  );
  return { bodyXml, drawn };
}

/**
 * Feature 011 (D50, FR-075b): the formulas drawn as pictures - in the body and in the notes -, each
 * marker replaced by its picture or, when it cannot be drawn, by the formula as written (listed).
 * MathJax is loaded only when the file has a formula.
 */
async function drawFormulas(
  result: ConvertResult,
  xml: { bodyXml: string; notesXml: string | null },
  summary: SummaryItem[],
): Promise<{
  bodyXml: string;
  notesXml: string | null;
  drawn: { id: string; picture: DrawnDiagram }[];
}> {
  if (result.formulas.length === 0) return { ...xml, drawn: [] };
  const { drawFormula } = await import('./diagrams/formula');
  const drawn: { id: string; picture: DrawnDiagram }[] = [];
  const forms = new Map<number, string>();
  for (const formula of result.formulas) {
    try {
      drawn.push({ id: formula.id, picture: await drawFormula(formula.source, formula.display) });
      forms.set(formula.index, formula.imageXml);
    } catch (error) {
      forms.set(formula.index, formula.textXml);
      const reason = error instanceof Error ? error.message.split('\n')[0] : '';
      summary.push({
        kind: 'formula',
        detail: reason ? `${formula.source} (${reason})` : formula.source,
      });
    }
  }
  const put = (text: string) =>
    text.replace(
      /<!--mfbe-formula:(\d+)-->/g,
      (_, index: string) => forms.get(Number(index)) ?? '',
    );
  return {
    bodyXml: put(xml.bodyXml),
    notesXml: xml.notesXml === null ? null : put(xml.notesXml),
    drawn,
  };
}

/** Runs the import; false when cancelled or refused (the window's book is then unchanged). */
export async function importMarkdown(ctx: CommandContext, files: FileFeature): Promise<boolean> {
  const rpc = ctx.rpc;
  if (!rpc) return false;
  if (!(await files.confirmDiscardChanges(ctx))) return false;
  const { paths } = await rpc.call('dialog.openFile', {
    title: ctx.t('markdown.openTitle'),
    filters: markdownFileTypes(ctx.t),
    selectedFilter: 0,
  });
  const path = paths[0];
  if (!path) return false;
  try {
    const text = await readText(ctx, path);
    if (!text) return false;
    const { xml: templateXml } = await rpc.call('template.xml');
    const genres = await rpc
      .call('resources.genres')
      .then((list) => new Set(list.entries.map((entry) => entry.code)))
      .catch(() => undefined);
    const { folder, stem } = parts(path);
    const result = await convertInWorker(text.text, {
      fileName: stem,
      baseDir: folder,
      notesTitle: ctx.t('editing.footnote.notesTitle'),
      genres,
      diagramAlt: ctx.t('markdown.diagramAlt'),
    });
    const summary: SummaryItem[] = [...result.summary];
    const stylesheets = await bookStylesheets(ctx, result, folder, summary);
    const diagrams = await drawDiagrams(result, summary);
    const {
      bodyXml,
      notesXml,
      drawn: formulas,
    } = await drawFormulas(
      result,
      { bodyXml: diagrams.bodyXml, notesXml: result.notesXml },
      summary,
    );
    const drawn = [...diagrams.drawn, ...formulas];
    const opened = await rpc.runJob('doc.newFromXml', {
      xml: buildBook(templateXml, { ...result, bodyXml, notesXml, stylesheets }),
      origin: { kind: 'markdown', path },
    });
    await files.loadImported(ctx, opened.document, path);
    const outcome = await addPictures(rpc, opened.document.docId, result.pictures, result.chars);
    for (const { id, picture } of drawn) {
      try {
        outcome.added.push(
          await uploadBinary(opened.document.docId, picture.blob, {
            contentType: picture.contentType,
            suggestedId: id,
          }),
        );
      } catch {
        summary.push({ kind: 'diagram', detail: id });
      }
    }
    addBinariesToModel(ctx.store, outcome.added);
    for (const failed of outcome.failed) {
      summary.push({
        kind: 'webPicture',
        detail: `${failed.source} (${ctx.t(`markdown.picture.${failed.reason}`)})`,
      });
    }
    const counts = ctx.t('markdown.done', {
      encoding: text.encoding,
      sections: result.stats.sections,
      pictures: result.stats.pictures + drawn.length,
      tables: result.stats.tables,
      notes: result.stats.notes,
    });
    if (summary.length === 0) {
      actions.setStatusMessage(ctx.store, counts);
    } else {
      await ctx.dialogs.showMessage({
        text: `${counts}\n\n${ctx.t('markdown.summaryIntro')}\n${summary
          .map(
            (item) => `\u2022 ${ctx.t(`markdown.summary.${item.kind}`, { detail: item.detail })}`,
          )
          .join('\n')}`,
        caption: ctx.t('markdown.caption'),
        icon: 'info',
        testId: 'dialog-markdown-summary',
      });
    }
    return true;
  } catch (error) {
    const reason =
      isRpcError(error) && error.code === RpcErrorCode.importNotText
        ? ctx.t('markdown.notText')
        : isRpcError(error) && error.code === RpcErrorCode.importTooLarge
          ? ctx.t('markdown.tooLarge')
          : error instanceof Error
            ? error.message
            : String(error);
    await ctx.dialogs.showMessage({
      text: ctx.t('markdown.failed', { path, reason }),
      caption: ctx.t('dialog.error.caption'),
      icon: 'error',
      testId: 'dialog-markdown-failed',
    });
    return false;
  }
}
