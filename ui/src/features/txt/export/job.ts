/**
 * Feature 017 (D1 to D16; tasks T031): the lazy part of the TXT export (chunk `txt-export`) - the
 * layout, the core's writing in the chosen encoding, and the summary of what the encoding could not
 * write (D16), else the status bar's file name.
 */
import type { CommandContext } from '@/app/commands';
import { actions } from '@/model/store';
import { isRpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import { normaliseGenres, normaliseLanguages } from '@/views/description/resources';

import type { TxtRun } from '../exportCommand';
import { layoutTxt } from './layout';

/** "« (U+00AB)": the character and its number, so that an invisible one can be named too. */
function characterName(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  const number = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  return /[\p{L}\p{N}\p{P}\p{S}]/u.test(char) ? `${char} (${number})` : number;
}

export async function exportTxt(ctx: CommandContext, docId: string, run: TxtRun): Promise<boolean> {
  const { store, rpc } = ctx;
  const { modal, path } = run;
  if (!rpc) return false;
  let jobId: string | null = null;
  const cancel = (): void => {
    if (jobId) void rpc.call('job.cancel', { jobId }).catch(() => undefined);
  };
  try {
    const state = store.getState();
    if (!state.document || state.docId !== docId) {
      modal.end();
      return false;
    }
    const [genres, languages, info] = await Promise.all([
      rpc.call('resources.genres'),
      rpc.call('resources.languages'),
      rpc.call('app.info'),
    ]);
    // The lists as the description's fields read them (views/description/resources.ts).
    const languageList = normaliseLanguages(languages).groups.flatMap((group) =>
      group.languages.map((language) => ({ code: language.code, names: language.name })),
    );
    const layout = layoutTxt(
      state.document,
      { genres: normaliseGenres(genres).entries, languages: languageList },
      run.stem,
      info.version,
    );
    if (run.cancelled()) throw new Error('cancelled');
    const result = await rpc.runJob(
      'txt.export',
      {
        docId,
        path,
        text: layout.text,
        encoding: run.encoding,
        bom: run.bom,
        zip: run.zip,
        // D13: the archive's FBD is the book's description, as Export as FBD writes it.
        ...(run.zip ? { document: state.document } : {}),
      },
      {
        onStart: (id) => {
          jobId = id;
          if (run.cancelled()) cancel();
        },
        onProgress: (progress) => modal.progress(progress.done, progress.total),
      },
    );
    modal.end();
    const lines = [
      ...result.replaced.map((r) =>
        ctx.t(r.as === '' ? 'txt.summary.leftOut' : 'txt.summary.replaced', {
          char: characterName(r.char),
          as: r.as,
          count: r.count,
        }),
      ),
      ...(layout.missingTitle ? [ctx.t('txt.summary.noTitle', { detail: run.stem })] : []),
    ];
    if (lines.length === 0)
      actions.setStatusMessage(store, ctx.t('txt.exported', { path: result.path }));
    else
      await ctx.dialogs.showMessage({
        text: `${ctx.t('txt.exported', { path: result.path })}\n\n${ctx.t('txt.summary.intro', {
          encoding: run.encoding,
        })}\n${lines.join('\n')}`,
        caption: ctx.t('txt.exportCaption'),
        icon: 'info',
        testId: 'dialog-txt-export-summary',
      });
    return true;
  } catch (error) {
    modal.end();
    if (run.cancelled()) {
      actions.setStatusMessage(store, ctx.t('txt.exportCancelled'));
      return false;
    }
    const detail =
      isRpcError(error) && error.code === RpcErrorCode.docSameAsOpenFile
        ? ctx.t('txt.ownFile')
        : error instanceof Error
          ? error.message
          : String(error);
    await ctx.dialogs.showMessage({
      text: ctx.t('txt.exportFailed', { path, detail }),
      caption: ctx.t('txt.exportCaption'),
      icon: 'error',
      testId: 'dialog-txt-export-failed',
    });
    return false;
  }
}
