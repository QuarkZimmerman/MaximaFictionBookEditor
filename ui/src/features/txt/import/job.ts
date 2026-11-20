/**
 * Feature 017 (D25 to D30, D37; tasks T039): the lazy part of the TXT import (chunk `txt-import`) - the
 * paragraphs of the text, the new book made by the core, and the summary (D37). The window's book is
 * replaced only by the finished new one; *Cancel* and failures leave it as it was.
 */
import type { CommandContext } from '@/app/commands';
import type { FileFeature } from '@/features/file/fileCommands';
import { withFbd } from '@/features/importShared/fbdApply';
import { dictionaryAsker, knownWords } from '@/features/text/joinWords';
import { actions } from '@/model/store';
import { normaliseGenres, normaliseLanguages } from '@/views/description/resources';

import type { TxtImportRun } from '../importCommand';
import { bodyXml, bookXml, templateDescription } from './build';
import { chooseFbd } from './fbd';
import { brokenCandidates, foreignParagraphs, linesOf } from './layout';
import { ownBodies, ownDescription, parseOwnTxt } from './ours';

class Cancelled extends Error {}

/** The name of the file the text came from, without its extension (D27: the title). */
function stemOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return name.replace(/\.[^.]*$/, '') || name;
}

export async function importTxt(
  ctx: CommandContext,
  files: FileFeature,
  run: TxtImportRun,
): Promise<boolean> {
  const { rpc, store } = ctx;
  let { modal } = run;
  if (!rpc) return false;
  const check = (): void => {
    if (run.cancelled()) throw new Cancelled();
  };
  try {
    const { xml: template } = await rpc.call('template.xml');
    // D28, D29: the editor's own TXT gives its description and notes back.
    const own = parseOwnTxt(run.text);
    let xml: string;
    let paragraphCount: number;
    let controlsLeftOut = 0;
    let unread: string[] = [];
    if (own) {
      const [genres, languages] = await Promise.all([
        rpc.call('resources.genres'),
        rpc.call('resources.languages'),
      ]);
      const lists = {
        genres: normaliseGenres(genres).entries,
        languages: normaliseLanguages(languages).groups.flatMap((group) =>
          group.languages.map((language) => ({ code: language.code, names: language.name })),
        ),
      };
      const description = ownDescription(own, template, lists);
      unread = description.unread;
      xml = bookXml(description.xml, ownBodies(own).xml);
      paragraphCount = own.items.filter((item) => item.kind === 'p').length;
    } else {
      // D27 (clarify): words broken at line ends, asked of the dictionaries before the layout joins them.
      const { lines } = linesOf(run.text);
      const candidates = brokenCandidates(lines);
      const known =
        candidates.size > 0
          ? await knownWords(candidates, await dictionaryAsker(rpc), undefined, check)
          : new Set<string>();
      check();
      const paragraphs = foreignParagraphs(run.text, (word) => known.has(word));
      xml = bookXml(
        templateDescription(template, stemOf(run.entry ?? run.path)),
        bodyXml(paragraphs.items),
      );
      paragraphCount = paragraphs.items.filter((item) => item !== null).length;
      controlsLeftOut = paragraphs.controlsLeftOut;
    }
    check();
    const opened = await rpc.runJob('doc.newFromXml', {
      xml,
      origin: { kind: 'txt', path: run.path },
    });
    check();
    // D32 to D34: the FBD of the TXT - its archive's, or the one beside it - gives the description whole.
    let book = opened.document;
    let fbdTaken: string | null = null;
    let fbdError: { name: string; error: unknown } | null = null;
    // The list of an archive's FBDs is a question: the progress steps aside while it is asked.
    const asks = run.entry !== undefined && run.fbds.length > 0;
    if (asks) modal.end();
    const fbd = await chooseFbd(ctx, run);
    if (asks) modal = run.reopen();
    if (fbd === 'cancel') throw new Cancelled();
    if (fbd) {
      const fbdPath =
        fbd.path ??
        (await rpc.call('txtImport.extractFbd', { token: run.token, entry: fbd.entry! })).path;
      const applied = await withFbd(ctx, opened.document.docId, book, fbdPath);
      if (applied.error) fbdError = { name: fbd.name, error: applied.error };
      else {
        book = { ...opened.document, ...applied.document };
        fbdTaken = fbd.name;
      }
    }
    await rpc.call('txtImport.end', { token: run.token }).catch(() => undefined);
    modal.end();
    if (fbdError)
      await ctx.dialogs.showMessage({
        text: ctx.t('txt.fbdUnreadable', {
          name: fbdError.name,
          reason: fbdError.error instanceof Error ? fbdError.error.message : String(fbdError.error),
        }),
        caption: ctx.t('txt.importCaption'),
        icon: 'warning',
        testId: 'dialog-txt-fbd-unreadable',
      });
    await files.loadImported(ctx, book);
    // D37: one line for each thing worth naming, else the status bar says what came in.
    const lines37 = [
      ...(run.encoding !== 'utf-8' && run.source !== 'bom'
        ? [ctx.t('txt.summary.encoding', { encoding: run.encoding })]
        : []),
      ...(controlsLeftOut > 0 ? [ctx.t('txt.summary.controls', { count: controlsLeftOut })] : []),
      ...unread.map((detail) => ctx.t('txt.summary.unread', { detail })),
      ...(fbdTaken ? [ctx.t('txt.summary.fbd', { name: fbdTaken })] : []),
    ];
    const done = ctx.t('txt.importDone', {
      path: run.path,
      paragraphs: paragraphCount,
    });
    if (lines37.length === 0) actions.setStatusMessage(store, done);
    else
      await ctx.dialogs.showMessage({
        text: `${done}\n\n${lines37.join('\n')}`,
        caption: ctx.t('txt.importCaption'),
        icon: 'info',
        testId: 'dialog-txt-import-summary',
      });
    return true;
  } catch (error) {
    modal.end();
    await rpc.call('txtImport.end', { token: run.token }).catch(() => undefined);
    if (run.cancelled() || error instanceof Cancelled) {
      actions.setStatusMessage(store, ctx.t('txt.importCancelled'));
      return false;
    }
    throw error;
  }
}
