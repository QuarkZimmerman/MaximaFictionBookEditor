/**
 * Edit > Paste as plain text (feature 009, User Story 4; FR-040 to FR-045, research DP-13): the
 * clipboard's text alone. In the Body view and the Description's rich fields it goes through the
 * paste router as text copied from a plain-text editor - lines become paragraphs, without
 * formatting, links, pictures, tables or ids, in one undo step; the Source view and plain fields
 * take it as Paste does. With no text on the clipboard nothing changes and the status bar says
 * so. It is available where Paste is (FR-045), with the default key Mod+Shift+V.
 */

import type { EditorView as CodeMirrorView } from '@codemirror/view';
import type { EditorView as ProseMirrorView } from 'prosemirror-view';

import type { Command, CommandContext } from '@/app/commands';
import { clipboardText, insertTextIntoField } from '@/app/textFields';
import { pasteData } from '@/editor/plugins/clipboard';
import { actions } from '@/model/store';
import { insertIntoSource } from '@/views/source/sourceClipboard';

import { pasteEnabled, pasteTargetOf } from './clipboard';
import { bodyController, cmdKeys } from './editing/common';
import { fieldTargetFor } from './tables/target';

/** Where the text goes: a plain field, a rich editor (Body or field), the Source view. */
export type PlainPastePlace =
  { field: HTMLElement } | { view: ProseMirrorView | null } | { source: CodeMirrorView };

/** Pastes the clipboard's text, alone, into `place` (also the context menus' entry). */
export async function pastePlainInto(
  ctx: Pick<CommandContext, 'store' | 't'>,
  place: PlainPastePlace,
): Promise<void> {
  const text = await clipboardText();
  if (!text) {
    actions.setStatusMessage(ctx.store, ctx.t('edit.msg.clipboardNoText'));
    return;
  }
  if ('field' in place) {
    insertTextIntoField(place.field, text);
  } else if ('source' in place) {
    insertIntoSource(place.source, text);
  } else if (place.view) {
    place.view.focus();
    pasteData(place.view, { text });
  }
}

/** Edit > Paste as plain text: where Paste would put the clipboard. */
export function pastePlainText(ctx: CommandContext): Promise<void> {
  const target = pasteTargetOf(ctx);
  if (target.kind === 'source') return pastePlainInto(ctx, { source: target.view });
  if (target.kind === 'field') {
    const rich = fieldTargetFor(target.field);
    return pastePlainInto(ctx, rich ? { view: rich.view } : { field: target.field });
  }
  return pastePlainInto(ctx, { view: bodyController(ctx.store)?.editorView ?? null });
}

export const pastePlainCommand: Command = {
  id: 'edit.pastePlain',
  group: 'edit',
  ...cmdKeys('edit.pastePlain', 'menu.edit.pastePlain'),
  enabled: (ctx) => pasteEnabled(ctx),
  run: (ctx) => pastePlainText(ctx),
};
