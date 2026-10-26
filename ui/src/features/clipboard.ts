/**
 * Clipboard commands of the Edit menu, the toolbar and the context menu (T065): Cut / Copy /
 * Paste for the Body editor and, as in the original, for the Source editor and the Description
 * view's text fields (feature 002). In the Body, Copy and Cut go through the browser's
 * clipboard events (so the editor plugin in `editor/plugins/clipboard.ts` writes the
 * structured, HTML and plain flavours); Paste reads the async clipboard API when available and
 * falls back to the `paste` command. Enable states: Cut/Copy need a selection, Paste an
 * editable target. An image on the clipboard is handed to the images feature
 * (`features/images/paste.ts`), which uploads it as a binary and inserts an image node (US7).
 */

import type { EditorView } from '@codemirror/view';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import {
  cutOrCopy,
  hasSelectedText,
  isWritable,
  lastFocusedTextField,
  pasteIntoField,
} from '@/app/textFields';
import { htmlHasTextTable } from '@/editor/clipboard/foreignHtml';
import {
  MFBE_CLIPBOARD_MIME,
  MFBE_CLIPBOARD_WEB_MIME,
  cutTransaction,
  pasteData,
  payloadFromSlice,
  type PasteData,
} from '@/editor/plugins/clipboard';
import type { BodyEditorController } from '@/views/body/bodyEditor';
import { pasteIntoSource } from '@/views/source/sourceClipboard';
import { getSourceEditor } from '@/views/source/sourceEditor';

import { bodyActive, bodyController, bodyEditable, cmdKeys } from './editing/common';
import { pasteImageFile, reportImageFailure } from './images/paste';
import { activeTableTarget } from './tables/target';

export {
  flattenToParagraphs,
  insertSlice,
  MFBE_CLIPBOARD_MIME,
  pasteData,
  sliceFromExternalHtml,
  sliceFromPlainText,
} from '@/editor/plugins/clipboard';

/**
 * A non-empty Body selection. Copy needs only that (copying stays available under the quiet
 * lock of a script run, feature 003 FR-011); Cut additionally needs an editable Body.
 */
function hasSelection(ctx: CommandContext, cut: boolean): boolean {
  const controller = bodyController(ctx.store);
  const state = controller?.selectionState;
  if (!state || state.selection.empty) return false;
  return cut ? bodyEditable(ctx) : bodyActive(ctx) && !!controller?.editorState;
}

/** The Source editor the commands act on in the Source view. */
function sourceView(ctx: CommandContext): EditorView | null {
  if (ctx.store.getState().activeView !== 'source') return null;
  return getSourceEditor(ctx.store)?.editorView ?? null;
}

/** The Description view's text field the commands act on: the one that had the focus last. */
function descriptionField(ctx: CommandContext): HTMLElement | null {
  if (ctx.store.getState().activeView !== 'description') return null;
  const field = lastFocusedTextField();
  return field?.closest('[data-testid="description-view"]') ? field : null;
}

function sourceSelected(view: EditorView): boolean {
  return view.state.selection.ranges.some((range) => !range.empty);
}

function canCopy(ctx: CommandContext, cut: boolean): boolean {
  const source = sourceView(ctx);
  if (source) return sourceSelected(source) && !(cut && source.state.readOnly);
  const field = descriptionField(ctx);
  if (field) return hasSelectedText(field) && !(cut && !isWritable(field));
  return hasSelection(ctx, cut);
}

function cutOrCopyIn(ctx: CommandContext, cut: boolean): Promise<void> | void {
  const source = sourceView(ctx);
  if (source) {
    source.focus();
    document.execCommand(cut ? 'cut' : 'copy');
    return;
  }
  const field = descriptionField(ctx);
  if (field) return cutOrCopy(field, cut);
  return copySelection(bodyController(ctx.store)!, cut);
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
    // A selected table goes through the Delete table transform, as in the cut event (C24).
    if (written && cut) view.dispatch(cutTransaction(view.state, controller.nextNodeId));
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
    // An image wins over the text flavours unless the clipboard holds the editor's own slice or
    // an HTML table with text, which the picture a spreadsheet adds beside it does not beat
    // (feature 006, R5.9; data-model §8.9).
    const tableWins = !!data.html && htmlHasTextTable(data.html);
    if (
      data.image &&
      !data.json &&
      !tableWins &&
      options.onImage &&
      (await options.onImage(data.image))
    ) {
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
      enabled: (ctx) => canCopy(ctx, true),
      run: (ctx) => cutOrCopyIn(ctx, true),
    },
    {
      id: 'edit.copy',
      group: 'edit',
      ...cmdKeys('edit.copy', 'menu.edit.copy'),
      icon: 'id_edit_copy',
      enabled: (ctx) => canCopy(ctx, false),
      // Copying never changes the document: available under the quiet lock of a script run.
      duringScriptRun: 'allowed',
      run: (ctx) => cutOrCopyIn(ctx, false),
    },
    {
      id: 'edit.paste',
      group: 'edit',
      ...cmdKeys('edit.paste', 'menu.edit.paste'),
      icon: 'id_edit_paste',
      enabled: (ctx) => {
        const source = sourceView(ctx);
        if (source) return !source.state.readOnly;
        const field = descriptionField(ctx);
        if (field) return isWritable(field);
        return bodyEditable(ctx) && !!bodyController(ctx.store)?.isMounted;
      },
      run: (ctx) => {
        const source = sourceView(ctx);
        if (source) return pasteIntoSource(source);
        const field = descriptionField(ctx);
        if (field) return pasteIntoField(field);
        const controller = bodyController(ctx.store)!;
        return pasteIntoEditor(controller, {
          onImage: async (image) => {
            // The image goes to the active editing target: a table cell takes it as an inline
            // image (feature 006, FR-025).
            const target = activeTableTarget(ctx.store);
            if (!target?.editable) return false;
            try {
              await pasteImageFile(ctx.store, target, image);
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
