/**
 * Clipboard commands of the Edit menu, the toolbar and the context menu (T065): Cut / Copy /
 * Paste for the Body editor. Copy and Cut go through the browser's clipboard events (so the
 * editor plugin in `editor/plugins/clipboard.ts` writes the structured, HTML and plain
 * flavours); Paste reads the async clipboard API when available and falls back to the
 * `paste` command. Enable states: Cut/Copy need a selection, Paste an editable Body view.
 * An image on the clipboard is handed to the images feature (`features/images/paste.ts`),
 * which uploads it as a binary and inserts an image node (US7).
 */

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import {
  MFBE_CLIPBOARD_MIME,
  MFBE_CLIPBOARD_WEB_MIME,
  pasteData,
  payloadFromSlice,
  type PasteData,
} from '@/editor/plugins/clipboard';
import type { BodyEditorController } from '@/views/body/bodyEditor';

import { bodyController, bodyEditable, cmdKeys } from './editing/common';
import { pasteImageFile, reportImageFailure } from './images/paste';

export {
  flattenToParagraphs,
  insertSlice,
  MFBE_CLIPBOARD_MIME,
  pasteData,
  sliceFromExternalHtml,
  sliceFromPlainText,
} from '@/editor/plugins/clipboard';

function hasSelection(ctx: CommandContext): boolean {
  const controller = bodyController(ctx.store);
  const state = controller?.selectionState;
  return !!state && bodyEditable(ctx) && !state.selection.empty;
}

/** Clipboard content: the text flavours plus an image blob when the clipboard holds one (US7). */
interface ClipboardContent extends PasteData {
  image?: Blob | null;
}

/** Reads the system clipboard through the async API; null when unavailable or denied. */
async function readClipboard(): Promise<ClipboardContent | null> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (!clipboard?.read) return null;
  try {
    const items = await clipboard.read();
    const data: ClipboardContent = {};
    for (const item of items) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type.startsWith('image/')) {
          data.image ??= blob;
          continue;
        }
        const text = await blob.text();
        if (type === MFBE_CLIPBOARD_WEB_MIME || type === MFBE_CLIPBOARD_MIME) data.json = text;
        else if (type === 'text/html') data.html = text;
        else if (type === 'text/plain') data.text = text;
      }
    }
    if (!data.json && !data.html && !data.text && !data.image) return null;
    return data;
  } catch {
    return null;
  }
}

/** Writes the selection to the system clipboard with the async API (best effort). */
async function writeClipboard(controller: BodyEditorController): Promise<boolean> {
  const view = controller.editorView;
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (
    !view ||
    !clipboard?.write ||
    typeof ClipboardItem === 'undefined' ||
    view.state.selection.empty
  ) {
    return false;
  }
  const slice = view.state.selection.content();
  const { dom, text } = view.serializeForClipboard(slice);
  const items: Record<string, Blob> = {
    'text/html': new Blob([dom.innerHTML], { type: 'text/html' }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  };
  try {
    items[MFBE_CLIPBOARD_WEB_MIME] = new Blob([JSON.stringify(payloadFromSlice(slice))], {
      type: MFBE_CLIPBOARD_WEB_MIME,
    });
    await clipboard.write([new ClipboardItem(items)]);
    return true;
  } catch {
    try {
      delete items[MFBE_CLIPBOARD_WEB_MIME];
      await clipboard.write([new ClipboardItem(items)]);
      return true;
    } catch {
      return false;
    }
  }
}

export async function copySelection(controller: BodyEditorController, cut: boolean): Promise<void> {
  const view = controller.editorView;
  if (!view) return;
  view.focus();
  controller.syncSelection();
  // The synchronous command fires the copy/cut event handled by the editor plugin.
  const ok = document.execCommand(cut ? 'cut' : 'copy');
  if (!ok) {
    const written = await writeClipboard(controller);
    if (written && cut) view.dispatch(view.state.tr.deleteSelection().scrollIntoView());
  }
}

export interface PasteOptions {
  /**
   * Handles an image found on the clipboard (US7: uploaded as a binary and inserted as an
   * image node). Without a handler, or when it returns false, the text flavours are used.
   */
  onImage?: (image: Blob) => Promise<boolean>;
}

export async function pasteIntoEditor(
  controller: BodyEditorController,
  options: PasteOptions = {},
): Promise<void> {
  const view = controller.editorView;
  if (!view) return;
  view.focus();
  const data = await readClipboard();
  if (data) {
    // An image wins over the text flavours unless the clipboard holds the editor's own slice.
    if (data.image && !data.json && options.onImage && (await options.onImage(data.image))) {
      return;
    }
    if (data.json || data.html || data.text) {
      pasteData(view, data);
      return;
    }
  }
  document.execCommand('paste');
}

export function registerClipboardCommands(registry: CommandRegistry): void {
  const commands: Command[] = [
    {
      id: 'edit.cut',
      group: 'edit',
      ...cmdKeys('edit.cut', 'menu.edit.cut'),
      icon: 'id_edit_cut',
      enabled: hasSelection,
      run: (ctx) => copySelection(bodyController(ctx.store)!, true),
    },
    {
      id: 'edit.copy',
      group: 'edit',
      ...cmdKeys('edit.copy', 'menu.edit.copy'),
      icon: 'id_edit_copy',
      enabled: hasSelection,
      run: (ctx) => copySelection(bodyController(ctx.store)!, false),
    },
    {
      id: 'edit.paste',
      group: 'edit',
      ...cmdKeys('edit.paste', 'menu.edit.paste'),
      icon: 'id_edit_paste',
      enabled: (ctx) => bodyEditable(ctx) && !!bodyController(ctx.store)?.isMounted,
      run: (ctx) => {
        const controller = bodyController(ctx.store)!;
        return pasteIntoEditor(controller, {
          onImage: async (image) => {
            try {
              await pasteImageFile(ctx.store, controller, image);
              return true;
            } catch (error) {
              reportImageFailure(ctx.store, error);
              return true;
            }
          },
        });
      },
    },
  ];
  for (const command of commands) registry.replace(command);
}
