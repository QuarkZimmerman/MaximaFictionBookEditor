/**
 * Feature 017 (D25 to D30, D37; tasks T039): the lazy part of the TXT import (chunk `txt-import`) - the
 * paragraphs of the text, the new book made by the core, and the summary (D37). The window's book is
 * replaced only by the finished new one; *Cancel* and failures leave it as it was.
 */
import type { CommandContext } from '@/app/commands';
import type { FileFeature } from '@/features/file/fileCommands';
import { dictionaryAsker, knownWords } from '@/features/text/joinWords';
import { actions } from '@/model/store';

import type { TxtImportRun } from '../importCommand';
import { bodyXml, bookXml, templateDescription } from './build';
import { brokenCandidates, foreignParagraphs, linesOf } from './layout';

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
  const { modal } = run;
  if (!rpc) return false;
  const check = (): void => {
    if (run.cancelled()) throw new Cancelled();
  };
  try {
    // D27 (clarify): words broken at line ends, asked of the dictionaries before the layout joins them.
    const { lines } = linesOf(run.text);
    const candidates = brokenCandidates(lines);
    const known =
      candidates.size > 0
        ? await knownWords(candidates, await dictionaryAsker(rpc), undefined, check)
        : new Set<string>();
    check();
    const paragraphs = foreignParagraphs(run.text, (word) => known.has(word));
    const { xml: template } = await rpc.call('template.xml');
    const xml = bookXml(
      templateDescription(template, stemOf(run.entry ?? run.path)),
      bodyXml(paragraphs.items),
    );
    check();
    const opened = await rpc.runJob('doc.newFromXml', {
      xml,
      origin: { kind: 'txt', path: run.path },
    });
    check();
    await rpc.call('txtImport.end', { token: run.token }).catch(() => undefined);
    modal.end();
    await files.loadImported(ctx, opened.document, run.path);
    // D37: one line for each thing worth naming, else the status bar says what came in.
    const lines37 = [
      ...(run.encoding !== 'utf-8' && run.source !== 'bom'
        ? [ctx.t('txt.summary.encoding', { encoding: run.encoding })]
        : []),
      ...(paragraphs.controlsLeftOut > 0
        ? [ctx.t('txt.summary.controls', { count: paragraphs.controlsLeftOut })]
        : []),
    ];
    const done = ctx.t('txt.importDone', {
      path: run.path,
      paragraphs: paragraphs.items.filter((item) => item !== null).length,
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
