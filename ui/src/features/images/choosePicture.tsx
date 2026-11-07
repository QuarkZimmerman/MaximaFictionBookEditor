/**
 * Feature 010, US2 (D3-D7): gives the picture at `pos` of an editor view the image chosen in the
 * picture chooser. Only the picture's reference changes - its title, alternative text, id and
 * place stay - in one transaction of that view, so one undo step of the Body view or of the
 * Description field it belongs to. Nothing happens while a script or an assistant request runs,
 * in a read-only view, or when the chooser is cancelled or answers the picture's own image.
 */

import type { EditorView } from 'prosemirror-view';

import type { CommandContext } from '@/app/commands';
import { isRunLocked } from '@/model/store';

import { addBinaryToModel, removeBinaryFromModel } from './binaries';
import { openPictureView } from './openPictureView';
import { PictureChooser } from './PictureChooser';

const PICTURE_NODES = new Set(['image', 'inline_image']);

export async function choosePictureFor(
  view: EditorView,
  pos: number,
  ctx: Pick<CommandContext, 'store' | 'rpc' | 'dialogs' | 't'>,
): Promise<boolean> {
  const { store, rpc, dialogs, t } = ctx;
  const state = store.getState();
  if (isRunLocked(state) || !view.editable) return false;
  const node = view.state.doc.nodeAt(pos);
  if (!node || !PICTURE_NODES.has(node.type.name)) return false;
  const docId = state.docId;
  const binaries = (state.document?.binaries ?? []).filter((binary) => binary.decodable);
  const current = String(node.attrs.href ?? '');
  const initial = binaries.some((binary) => `#${binary.id}` === current) ? current : null;
  const href = await dialogs.openCustom<string | null>((close) => (
    <PictureChooser
      rpc={rpc}
      docId={docId}
      binaries={binaries}
      initial={initial}
      caption={t('pictureChooser.caption')}
      onBinaryAdded={(meta) => addBinaryToModel(store, meta)}
      onBinaryRemoved={(id) => removeBinaryFromModel(store, id)}
      onShowPicture={(binary) => {
        if (docId) void openPictureView(dialogs, { docId, binary, store });
      }}
      onClose={close}
    />
  ));
  if (!href || href === current) return false;
  const latest = view.state.doc.nodeAt(pos);
  if (!latest || !PICTURE_NODES.has(latest.type.name)) return false;
  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...latest.attrs, href }));
  return true;
}
