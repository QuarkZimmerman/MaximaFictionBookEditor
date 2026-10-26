/**
 * Image insertion flows (T093, FR-038, US7 scenarios 1 and 5), replacing the Add-menu stubs
 * `insert.image` / `insert.inlineImage` / `insert.sectionImage` / `insert.binary`:
 *
 *  - "Insert clear image?" (the original `OnEditInsImage`): asked before every insertion while
 *    `other.askOnNonClearImage` is on, with "Don't ask again" persisting the answer as
 *    `askOnNonClearImage: false` + `insertClearImages: <answer>`; Yes inserts an empty image
 *    element (href `#undefined`, completed later through the Links bar), No opens the file
 *    dialog (filters: Images jpg/jpeg/png/gif/bmp/webp/tif/tiff, All files);
 *  - the chosen file is embedded by the core (`binary.add`: unique id from the file name, type
 *    sniffing; non-JPEG/PNG kept as-is and converted on save) and the image node referencing
 *    `#<id>` is inserted where the schema allows it through the editing helpers of
 *    `editor/commands/insert.ts`;
 *  - Add > Binary Object... embeds one or more files without inserting a node (they appear in
 *    the Description's Binary Objects list).
 *
 * Feature 006 (US3, FR-024 to FR-026; I10; data-model §9.6, §9.7): the commands, paste and drop
 * act on the active editing target (`activeTableTarget`, the Body adapter today; the
 * description fields' adapters with US10), so a picture goes into a table cell as an inline
 * image; a target with `imagesOnlyInCells` (the fields) takes inline images in cells only; and
 * *Image* and *Section image* say why a cell refuses them ("a cell takes inline images only").
 */

import type { Command as PMCommand } from 'prosemirror-state';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { BINARY_SELECTED_TYPE, binaryFileTypes, imageFileTypes } from '@/dialogs/fileTypes';
import {
  addSectionImage,
  caretInCell,
  CLEAR_IMAGE_HREF,
  insertImage,
  insertInlineImage,
  type ImageAttrs,
} from '@/editor/commands/insert';
import { cmdKeys } from '@/features/editing/common';
import { reasonText } from '@/features/tables/reasons';
import { activeTableTarget, type TableEditTarget } from '@/features/tables/target';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';

import { addBinariesFromFiles, addBinaryToModel, fileName } from './binaries';
import { rememberCommandContext } from './context';

export type ImageKind = 'block' | 'inline' | 'section';

/**
 * The editor a picture is inserted into: the part of a `TableEditTarget` the image flows use,
 * which the Body adapter satisfies and the description fields' adapters will (US10).
 */
export type ImageTarget = Pick<
  TableEditTarget,
  'state' | 'view' | 'dom' | 'editable' | 'imagesOnlyInCells' | 'canRun' | 'run' | 'setSelection'
>;

const FACTORIES: Record<ImageKind, (attrs?: ImageAttrs) => PMCommand> = {
  block: insertImage,
  inline: insertInlineImage,
  section: addSectionImage,
};

/* ------------------------------------------------------------------------ */
/* "Insert clear image?"                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Decides between a clear (empty) image and a file per the settings, asking when
 * `askOnNonClearImage` is on. Persists "Don't ask again". Returns true for a clear image.
 */
export async function wantsClearImage(ctx: CommandContext): Promise<boolean> {
  const { store, rpc } = ctx;
  const settings = store.getState().settings;
  let clear = settings?.other.insertClearImages ?? false;
  if (!(settings?.other.askOnNonClearImage ?? true)) return clear;
  const answer = await ctx.dialogs.showMessageWithResult({
    text: ctx.t('dialog.addImage.insertClear'),
    caption: ctx.t('dialog.addImage.caption'),
    buttons: 'yesNo',
    icon: 'question',
    dontAskAgain: true,
    testId: 'dialog-insert-clear-image',
  });
  clear = answer.button === 'yes';
  if (answer.dontAskAgain && rpc) {
    try {
      const result = await rpc.call('settings.set', {
        patch: { other: { askOnNonClearImage: false, insertClearImages: clear } },
      });
      actions.setSettings(store, result.settings);
    } catch {
      // the settings are best effort; the answer still applies to this insertion
    }
  }
  return clear;
}

/**
 * Chooses the image of an Add > Image / Inline image / Section image command: the clear-image
 * placeholder or a file embedded as a binary. Null when cancelled.
 */
export async function chooseImage(ctx: CommandContext): Promise<ImageAttrs | null> {
  if (await wantsClearImage(ctx)) return { href: CLEAR_IMAGE_HREF };
  const { store, rpc } = ctx;
  const docId = store.getState().docId;
  if (!rpc || !docId) return null;
  const { paths } = await rpc.call('dialog.openFile', {
    title: ctx.t('dialog.addImage.chooseImage'),
    filters: imageFileTypes(ctx.t),
    selectedFilter: 0,
  });
  const path = paths[0];
  if (!path) return null;
  const suggestedId = fileName(path);
  try {
    const meta = await rpc.call('binary.add', { docId, path, suggestedId });
    addBinaryToModel(store, meta);
    return { href: `#${meta.id}`, alt: null, title: null };
  } catch (error) {
    if (error instanceof RpcError && error.code === RpcErrorCode.methodNotFound) {
      // A core without binary.add (older build): reference the file name so validation
      // reports the dangling reference and the id can be completed later.
      actions.setStatusMessage(
        store,
        ctx.t('editing.msg.binaryAddUnavailable', { name: suggestedId }),
      );
      return { href: `#${suggestedId}` };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------ */
/* Node insertion                                                           */
/* ------------------------------------------------------------------------ */

/**
 * The ProseMirror command inserting an image of `kind` on `target`, or null when the target
 * cannot take that kind at all: a target with `imagesOnlyInCells` takes inline images in cells
 * only (the description fields; spec Assumptions).
 */
export function imageCommandFor(
  target: Pick<ImageTarget, 'state' | 'imagesOnlyInCells'>,
  kind: ImageKind,
  attrs?: ImageAttrs,
): PMCommand | null {
  if (
    target.imagesOnlyInCells &&
    (kind !== 'inline' || !target.state || !caretInCell(target.state))
  ) {
    return null;
  }
  return FACTORIES[kind](attrs);
}

/**
 * Inserts an image node of `kind` at the caret of `target`, as one undo step; false when the
 * schema forbids it there.
 */
export function insertImageNode(target: ImageTarget, kind: ImageKind, attrs: ImageAttrs): boolean {
  const command = imageCommandFor(target, kind, attrs);
  if (!command || !target.canRun(command)) return false;
  return target.run(command);
}

/**
 * Pasted / dropped image: inline at the caret when the text block takes inline images (the
 * original pasted bitmaps as inline images; a table cell included), otherwise a block image
 * after the paragraph, otherwise the header image of the section - inline only on a target with
 * `imagesOnlyInCells`. Returns the kind used, or null.
 */
export function insertImageAtCaret(target: ImageTarget, attrs: ImageAttrs): ImageKind | null {
  for (const kind of ['inline', 'block', 'section'] as const) {
    if (insertImageNode(target, kind, attrs)) return kind;
  }
  return null;
}

/* ------------------------------------------------------------------------ */
/* Commands                                                                 */
/* ------------------------------------------------------------------------ */

/** The editable active target whose caret allows an image of `kind`, or null. */
function imageTargetOf(ctx: CommandContext, kind: ImageKind): ImageTarget | null {
  const target = activeTableTarget(ctx.store);
  if (!target?.editable) return null;
  const command = imageCommandFor(target, kind);
  return command && target.canRun(command) ? target : null;
}

/**
 * Add > Image (`block`), Inline image (`inline`) and Section image (`section`) on the active
 * editing target. The block forms tell why a cell refuses them (FR-026; `cellInlineOnly`).
 */
function imageCommand(id: string, labelKey: string, icon: string, kind: ImageKind): Command {
  return {
    id,
    group: 'edit',
    ...cmdKeys(id, labelKey),
    icon,
    enabled: (ctx) => {
      rememberCommandContext(ctx);
      return imageTargetOf(ctx, kind) !== null;
    },
    unavailableReason:
      kind === 'inline'
        ? undefined
        : (ctx) => {
            const target = activeTableTarget(ctx.store);
            return target?.editable && target.state && caretInCell(target.state)
              ? reasonText('cellInlineOnly', undefined, ctx.t)
              : null;
          },
    async run(ctx) {
      rememberCommandContext(ctx);
      if (!imageTargetOf(ctx, kind)) return;
      const attrs = await chooseImage(ctx);
      if (!attrs) return;
      // The prompt and the file dialog took their time: the target and its caret as they are now.
      const target = imageTargetOf(ctx, kind);
      const command = target && imageCommandFor(target, kind, attrs);
      if (target && command) target.run(command);
    },
  };
}

const connectedWithDocument = (ctx: CommandContext): boolean =>
  ctx.rpc !== null &&
  ctx.store.getState().connection === 'connected' &&
  ctx.store.getState().document !== null &&
  !ctx.store.getState().sourceOnly;

/** Add > Binary Object...: embeds files without inserting nodes (US7 scenario 5). */
export async function addBinaryObjects(ctx: CommandContext): Promise<number> {
  rememberCommandContext(ctx);
  const { store, rpc } = ctx;
  const docId = store.getState().docId;
  if (!rpc || !docId) return 0;
  const added = await addBinariesFromFiles(rpc, docId, {
    title: ctx.t('dialog.addImage.chooseBinaries'),
    filters: binaryFileTypes(ctx.t),
    selectedFilter: BINARY_SELECTED_TYPE,
    multiple: true,
  });
  for (const meta of added) addBinaryToModel(store, meta);
  if (added.length > 0) {
    actions.setModified(store, true);
    actions.setStatusMessage(store, ctx.t('images.msg.binariesAdded', { count: added.length }));
  }
  return added.length;
}

export function registerImageCommands(registry: CommandRegistry): void {
  const commands: Command[] = [
    imageCommand('insert.image', 'menu.add.image', 'id_edit_ins_image', 'block'),
    imageCommand('insert.inlineImage', 'menu.add.inlineImage', 'id_edit_ins_inlineimage', 'inline'),
    imageCommand('insert.sectionImage', 'menu.add.sectionImage', 'id_edit_add_image', 'section'),
    {
      id: 'insert.binary',
      group: 'edit',
      ...cmdKeys('insert.binary', 'menu.add.binary'),
      icon: 'id_edit_addbinary',
      enabled: (ctx) => {
        rememberCommandContext(ctx);
        return connectedWithDocument(ctx);
      },
      run: async (ctx) => {
        await addBinaryObjects(ctx);
      },
    },
  ];
  for (const command of commands) registry.replace(command);
}
