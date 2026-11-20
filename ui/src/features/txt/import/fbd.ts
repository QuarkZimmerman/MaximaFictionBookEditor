/**
 * Feature 017 (D32 to D34; clarify): the FBD of a TXT, taken without a question. From a ZIP archive: one TXT
 * and one FBD are a pair; else the FBD with the TXT's name (extension aside, letter case ignored, any folder);
 * else, when the archive has FBDs, the list of them with None. Outside an archive: the FBD beside the file with
 * its name (files.fbdBeside), for the editor's own TXT too. Never an FBD beside an archive.
 */
import type { CommandContext } from '@/app/commands';
import { showArchiveBookChooser } from '@/dialogs/show';
import type { ArchiveChoice } from '@/rpc/types';

import type { TxtImportRun } from '../importCommand';

const baseName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
const stemOf = (path: string): string =>
  baseName(path)
    .replace(/\.[^.]*$/, '')
    .toLowerCase();

/** The FBD to take: an archive entry, a file beside the TXT, none - or 'cancel' when the list was cancelled. */
export async function chooseFbd(
  ctx: CommandContext,
  run: TxtImportRun,
): Promise<{ entry?: string; path?: string; name: string } | null | 'cancel'> {
  const rpc = ctx.rpc!;
  if (run.entry === undefined) {
    const { path } = await rpc.call('files.fbdBeside', { path: run.path });
    return path ? { path, name: baseName(path) } : null;
  }
  if (run.fbds.length === 0) return null;
  if (run.txts === 1 && run.fbds.length === 1)
    return { entry: run.fbds[0]!.entry, name: baseName(run.fbds[0]!.entry) };
  const named = run.fbds.find((fbd) => stemOf(fbd.entry) === stemOf(run.entry!));
  if (named) return { entry: named.entry, name: baseName(named.entry) };
  const choice: ArchiveChoice = {
    archive: run.path,
    books: [
      { entry: '', name: ctx.t('txt.fbd.none'), folder: '', size: 0, kind: 'fbd' },
      ...run.fbds.map(({ entry, size }) => {
        const at = entry.lastIndexOf('/');
        return {
          entry,
          name: entry.slice(at + 1),
          folder: at >= 0 ? entry.slice(0, at) : '',
          size,
          kind: 'fbd' as const,
        };
      }),
    ],
    otherFiles: 0,
    booksTotal: run.fbds.length + 1,
  };
  const chosen = await showArchiveBookChooser(ctx.dialogs, choice, baseName(run.path));
  if (chosen === null) return 'cancel';
  return chosen === '' ? null : { entry: chosen, name: baseName(chosen) };
}
