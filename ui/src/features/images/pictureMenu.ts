/**
 * Feature 010, US2 (D4, D5): *Change picture…* and *Show picture* for every picture - the
 * `image.change` and `image.show` commands and the Body view's `image` slot, which also keeps
 * *Save image as…* (`saveAs.ts`). A right-click on a picture outside the selection selects it
 * first; inside a larger selection the selection stays and the entries act on the right-clicked
 * picture, remembered by its node id.
 */

import i18next from 'i18next';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { bodyController, bodyEditable } from '@/features/editing/common';
import type { BinaryMeta } from '@/model/document';
import { isRunLocked, type AppStore } from '@/model/store';
import {
  registerContextMenuExtension,
  type ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

import { choosePictureFor } from './choosePicture';
import { latestCommandContext, rememberCommandContext } from './context';
import { openPictureView } from './openPictureView';
import { imageContextMenuItems } from './saveAs';

const PICTURES = new Set(['image', 'inline_image']);

export const CHANGE_PICTURE_COMMAND = 'image.change';
export const SHOW_PICTURE_COMMAND = 'image.show';

export interface PictureTarget {
  pos: number;
  node: PMNode;
}

const rightClicked = new WeakMap<AppStore, HTMLElement | null>();

/** The picture element under the last right-click anywhere in the page (Body or a field). */
export function lastRightClickedPicture(store: AppStore): HTMLElement | null {
  return rightClicked.get(store) ?? null;
}

/** The picture with this node id in `doc`, or null. */
export function pictureByNodeId(doc: PMNode, nodeId: string): PictureTarget | null {
  let found: PictureTarget | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (PICTURES.has(node.type.name) && node.attrs.nodeId === nodeId) {
      found = { pos, node };
      return false;
    }
    return true;
  });
  return found;
}

/** The picture a command acts on in `view`: the selected picture, else the right-clicked one. */
export function targetPicture(view: EditorView, store: AppStore): PictureTarget | null {
  const selection = view.state.selection;
  if (selection instanceof NodeSelection && PICTURES.has(selection.node.type.name)) {
    return { pos: selection.from, node: selection.node };
  }
  const element = lastRightClickedPicture(store);
  if (!element || !view.dom.contains(element)) return null;
  const nodeId = element.getAttribute('data-node-id');
  return nodeId ? pictureByNodeId(view.state.doc, nodeId) : null;
}

/** The decodable binary a picture shows, or null (empty, missing, external, undecodable). */
export function pictureBinary(store: AppStore, node: PMNode): BinaryMeta | null {
  const href = String(node.attrs.href ?? '');
  if (!href.startsWith('#') || href === '#undefined') return null;
  const id = href.slice(1);
  return store.getState().document?.binaries.find((b) => b.id === id && b.decodable) ?? null;
}

/** D5: a right-click on a picture of `view` outside its selection selects that picture. */
export function selectRightClickedPicture(view: EditorView, element: HTMLElement): void {
  const nodeId = element.getAttribute('data-node-id');
  if (!nodeId) return;
  const found = pictureByNodeId(view.state.doc, nodeId);
  if (!found) return;
  const { from, to, empty } = view.state.selection;
  if (!empty && from <= found.pos && found.pos + found.node.nodeSize <= to) return;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found.pos)));
}

/** Records the right-clicked picture and applies D5 in the Body view (capture phase). */
export function installPictureRightClick(store: AppStore, target: Document = document): () => void {
  const handler = (event: Event) => {
    const element =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('.fb-image, .fb-inline-image')
        : null;
    rightClicked.set(store, element);
    const view = bodyController(store)?.editorView ?? null;
    if (element && view && view.dom.contains(element)) selectRightClickedPicture(view, element);
  };
  target.addEventListener('contextmenu', handler, true);
  return () => target.removeEventListener('contextmenu', handler, true);
}

function bodyPicture(ctx: CommandContext): { view: EditorView; target: PictureTarget } | null {
  const view = bodyController(ctx.store)?.editorView ?? null;
  const target = view ? targetPicture(view, ctx.store) : null;
  return view && target ? { view, target } : null;
}

export function changePictureCommand(): Command {
  return {
    id: CHANGE_PICTURE_COMMAND,
    group: 'edit',
    labelKey: 'images.cmd.change.label',
    tooltipKey: 'images.cmd.change.tooltip',
    descriptionKey: 'images.cmd.change.description',
    enabled: (ctx) => {
      rememberCommandContext(ctx);
      return (
        ctx.rpc !== null &&
        bodyEditable(ctx) &&
        !isRunLocked(ctx.store.getState()) &&
        bodyPicture(ctx) !== null
      );
    },
    async run(ctx) {
      rememberCommandContext(ctx);
      const found = bodyPicture(ctx);
      if (found) await choosePictureFor(found.view, found.target.pos, ctx);
    },
  };
}

export function showPictureCommand(): Command {
  return {
    id: SHOW_PICTURE_COMMAND,
    group: 'edit',
    labelKey: 'images.cmd.show.label',
    tooltipKey: 'images.cmd.show.tooltip',
    descriptionKey: 'images.cmd.show.description',
    enabled: (ctx) => {
      rememberCommandContext(ctx);
      const found = bodyPicture(ctx);
      return !!found && pictureBinary(ctx.store, found.target.node) !== null;
    },
    async run(ctx) {
      rememberCommandContext(ctx);
      const found = bodyPicture(ctx);
      const binary = found ? pictureBinary(ctx.store, found.target.node) : null;
      const docId = ctx.store.getState().docId;
      if (binary && docId) await openPictureView(ctx.dialogs, { docId, binary, store: ctx.store });
    },
  };
}

/** The Body view's `image` slot: Change picture…, Show picture, then Save image as…. */
export function pictureContextMenuItems(
  store: AppStore,
  registry: CommandRegistry,
  controller: Parameters<typeof imageContextMenuItems>[2],
): ContextMenuItem[] {
  const view = controller.editorView;
  const target = view ? targetPicture(view, store) : null;
  const ctx = latestCommandContext(store);
  const items: ContextMenuItem[] = [];
  if (target) {
    items.push({
      id: 'change-picture',
      label: i18next.t('images.cmd.change.label'),
      enabled: ctx !== null && registry.isEnabled(CHANGE_PICTURE_COMMAND, ctx),
      run: () => {
        if (ctx) void registry.execute(CHANGE_PICTURE_COMMAND, ctx);
      },
    });
    if (pictureBinary(store, target.node)) {
      items.push({
        id: 'show-picture',
        label: i18next.t('images.cmd.show.label'),
        enabled: ctx !== null,
        run: () => {
          if (ctx) void registry.execute(SHOW_PICTURE_COMMAND, ctx);
        },
      });
    }
  }
  return items.concat(imageContextMenuItems(store, registry, controller));
}

export function registerPictureMenu(store: AppStore, registry: CommandRegistry): () => void {
  registry.replace(changePictureCommand());
  registry.replace(showPictureCommand());
  // One provider per slot: this one replaces Save image as…'s own and keeps its entries last.
  const offMenu = registerContextMenuExtension('image', (controller) =>
    pictureContextMenuItems(store, registry, controller),
  );
  const offTracking =
    typeof document !== 'undefined' ? installPictureRightClick(store) : () => undefined;
  return () => {
    offMenu();
    offTracking();
  };
}
