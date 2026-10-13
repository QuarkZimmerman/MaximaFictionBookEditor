/**
 * "Save image as..." (T093, US7 scenario 6, FR-023): the `image` slot of the Body context menu
 * and the `image.saveAs` command behind it. The image is the selected image node or the one
 * under the pointer when the menu opened (tracked through a capture-phase `contextmenu`
 * listener); `dialog.saveFile` (JPEG / PNG / All files, default name = binary id) then
 * `binary.export` write the stored bytes to the chosen file.
 */

import i18next from 'i18next';
import { NodeSelection } from 'prosemirror-state';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { bodyController, bodyEditable } from '@/features/editing/common';
import { actions, type AppStore } from '@/model/store';
import type { BodyEditorController } from '@/views/body/bodyEditor';
import {
  registerContextMenuExtension,
  type ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

import { extensionOf } from './binaries';
import { latestCommandContext, rememberCommandContext } from './context';

const contextTargets = new WeakMap<AppStore, string | null>();

/** The `href` of the image element under the last right-click inside the Body editor. */
export function lastContextImageHref(store: AppStore): string | null {
  return contextTargets.get(store) ?? null;
}

/** Records the image under the pointer when the context menu is requested. */
export function handleContextMenuTarget(store: AppStore, target: EventTarget | null): void {
  const element = target instanceof Element ? target : null;
  const image = element?.closest<HTMLElement>('.fb-image, .fb-inline-image') ?? null;
  contextTargets.set(store, image?.getAttribute('data-href') ?? null);
}

export function installContextTracking(store: AppStore, target: Document = document): () => void {
  const handler = (event: Event) => handleContextMenuTarget(store, event.target);
  target.addEventListener('contextmenu', handler, true);
  return () => target.removeEventListener('contextmenu', handler, true);
}

/** `#id` of the image the command would export: the selected image node or the clicked one. */
export function imageHrefForSaving(
  store: AppStore,
  controller: BodyEditorController | null,
): string | null {
  const state = controller?.editorState;
  if (state && state.selection instanceof NodeSelection) {
    const node = state.selection.node;
    if (node.type.name === 'image' || node.type.name === 'inline_image') {
      const href = String(node.attrs.href ?? '');
      if (isExportable(store, href)) return href;
    }
  }
  const clicked = lastContextImageHref(store);
  return clicked && isExportable(store, clicked) ? clicked : null;
}

function isExportable(store: AppStore, href: string): boolean {
  if (!href.startsWith('#') || href.length < 2 || href === '#undefined') return false;
  const id = href.slice(1);
  return store.getState().document?.binaries.some((b) => b.id === id) ?? false;
}

/** Suggested file name: the binary id, with an extension matching the content type. */
export function suggestedFileName(id: string, contentType: string): string {
  if (extensionOf(id)) return id;
  const lower = contentType.toLowerCase();
  if (lower === 'image/jpeg') return `${id}.jpg`;
  if (lower === 'image/png') return `${id}.png`;
  if (lower === 'image/gif') return `${id}.gif`;
  if (lower === 'image/bmp') return `${id}.bmp`;
  if (lower === 'image/webp') return `${id}.webp`;
  if (lower === 'image/tiff') return `${id}.tif`;
  return id;
}

/** Exports the binary `href` refers to; false when cancelled or unavailable. */
export async function saveImageAs(ctx: CommandContext, href: string): Promise<boolean> {
  const { store, rpc } = ctx;
  const state = store.getState();
  const id = href.slice(1);
  const binary = state.document?.binaries.find((b) => b.id === id);
  if (!rpc || !state.docId || !binary) return false;
  const choice = await rpc.call('dialog.saveFile', {
    title: ctx.t('images.saveAs.caption'),
    filters: [
      { name: ctx.t('images.saveAs.filterJpeg'), extensions: ['jpg', 'jpeg'] },
      { name: ctx.t('images.saveAs.filterPng'), extensions: ['png'] },
      { name: ctx.t('dialog.saveFile.filterAll'), extensions: ['*'] },
    ],
    defaultPath: suggestedFileName(id, binary.contentType),
  });
  if (!choice.path) return false;
  await rpc.call('binary.export', { docId: state.docId, id, path: choice.path });
  actions.setStatusMessage(store, ctx.t('images.msg.saved', { path: choice.path }));
  return true;
}

export const SAVE_IMAGE_COMMAND = 'image.saveAs';

export function saveImageCommand(): Command {
  return {
    id: SAVE_IMAGE_COMMAND,
    group: 'edit',
    labelKey: 'images.cmd.saveAs.label',
    tooltipKey: 'images.cmd.saveAs.tooltip',
    descriptionKey: 'images.cmd.saveAs.description',
    enabled: (ctx) => {
      rememberCommandContext(ctx);
      return (
        ctx.rpc !== null &&
        bodyEditable(ctx) &&
        imageHrefForSaving(ctx.store, bodyController(ctx.store)) !== null
      );
    },
    async run(ctx) {
      rememberCommandContext(ctx);
      const href = imageHrefForSaving(ctx.store, bodyController(ctx.store));
      if (href) await saveImageAs(ctx, href);
    },
  };
}

/** Entries of the context menu's `image` slot for the current selection / pointer target. */
export function imageContextMenuItems(
  store: AppStore,
  registry: CommandRegistry,
  controller: BodyEditorController,
): ContextMenuItem[] {
  const href = imageHrefForSaving(store, controller);
  if (!href) return [];
  const ctx = latestCommandContext(store);
  return [
    {
      id: 'save-image-as',
      label: i18next.t('images.cmd.saveAs.label'),
      enabled: ctx !== null && ctx.rpc !== null,
      run: () => {
        if (ctx) void registry.execute(SAVE_IMAGE_COMMAND, ctx);
      },
    },
  ];
}

export function registerSaveImageAs(store: AppStore, registry: CommandRegistry): () => void {
  registry.replace(saveImageCommand());
  const offMenu = registerContextMenuExtension('image', (controller) =>
    imageContextMenuItems(store, registry, controller),
  );
  const offTracking = typeof document !== 'undefined' ? installContextTracking(store) : () => {};
  return () => {
    offMenu();
    offTracking();
  };
}
