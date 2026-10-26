/**
 * Add-menu and Style-menu commands of the Body view (T058/T059/T063): the structure commands
 * of `editor/commands/insert.ts`, the inline style toggles and paragraph styles of
 * `editor/commands/marks.ts`, the Table properties dialog flow and the image insertion flows
 * ("Insert clear image?" per settings, file dialog + `binary.add`; `insert.binary` stays with
 * US7). Everything runs against the Body controller and is enabled only where the schema
 * allows the element.
 */

import type { Command as PMCommand } from 'prosemirror-state';
import { createElement } from 'react';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { imageFileTypes } from '@/dialogs/fileTypes';
import { TablePropertiesDialog, type TableProperties } from '@/dialogs/TablePropertiesDialog';
import type { Dialogs } from '@/dialogs/types';
import {
  addAnnotation,
  addEpigraph,
  addSectionImage,
  addTextAuthor,
  addTitle,
  insertBodyAtEnd,
  insertCite,
  insertImage,
  insertInlineImage,
  insertPoem,
  newBodyNode,
  type ImageAttrs,
} from '@/editor/commands/insert';
import {
  INLINE_MARKS,
  currentParagraphStyle,
  markActive,
  setParagraphStyle,
  toggleInlineMark,
  type InlineMarkName,
  type ParagraphStyle,
} from '@/editor/commands/marks';
import { canInsertTable, insertTable } from '@/editor/commands/table';
import { M } from '@/editor/commands/util';
import { nodeToModel } from '@/editor/toModel';
import type { BinaryMeta, BodyNode, Document } from '@/model/document';
import { actions } from '@/model/store';
import { RpcError } from '@/rpc/client';
import { RpcErrorCode } from '@/rpc/types';
import type { BodyEditorController, ModelStep } from '@/views/body/bodyEditor';

import { bodyController, bodyEditable, cmdKeys, pmCommand } from './common';

const MARK_ICONS: Record<InlineMarkName, string> = {
  strong: 'id_edit_bold',
  emphasis: 'id_edit_italic',
  strikethrough: 'id_edit_strik',
  sub: 'id_edit_sub',
  sup: 'id_edit_sup',
  code: 'id_edit_code',
};

const PARAGRAPH_STYLE_COMMANDS: Record<
  ParagraphStyle,
  { id: string; label: string; icon: string }
> = {
  normal: { id: 'style.normal', label: 'menu.style.normal', icon: 'id_style_normal' },
  textAuthor: {
    id: 'style.textAuthor',
    label: 'menu.style.textAuthor',
    icon: 'id_style_textauthor',
  },
  subtitle: { id: 'style.subtitle', label: 'menu.style.subtitle', icon: 'id_style_subtitle' },
};

/** Opens the Table properties dialog; resolves with `{rows, header}` or null when cancelled. */
export function showTablePropertiesDialog(
  dialogs: Dialogs,
  initial?: Partial<TableProperties>,
): Promise<TableProperties | null> {
  return dialogs.openCustom<TableProperties | null>((close) =>
    createElement(TablePropertiesDialog, { initial, onClose: close }),
  );
}

/* ------------------------------------------------------------------------ */
/* Images                                                                   */
/* ------------------------------------------------------------------------ */

type ImageCommandFactory = (attrs?: ImageAttrs) => PMCommand;

/**
 * Chooses the image for an Add > Image / Inline image / Section image command: a clear image
 * (placeholder reference, set later through the Links bar) when the settings say so, otherwise
 * an image file added as a binary object through the core. Returns null when cancelled.
 */
export async function chooseImage(ctx: CommandContext): Promise<ImageAttrs | null> {
  const { store, rpc } = ctx;
  const settings = store.getState().settings;
  let clear = settings?.other.insertClearImages ?? false;
  if (settings?.other.askOnNonClearImage ?? true) {
    const answer = await ctx.dialogs.showMessageWithResult({
      text: ctx.t('dialog.addImage.insertClear'),
      caption: ctx.t('app.name'),
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
        // settings are best effort
      }
    }
  }
  if (clear) return { href: '#undefined' };
  if (!rpc) return null;
  const { paths } = await rpc.call('dialog.openFile', {
    title: ctx.t('dialog.addImage.caption'),
    filters: imageFileTypes(ctx.t),
    selectedFilter: 0,
  });
  const path = paths[0];
  if (!path) return null;
  const docId = store.getState().docId;
  if (!docId) return null;
  const suggestedId = path.split(/[\\/]/).pop() ?? 'image';
  try {
    const meta = await rpc.call('binary.add', { docId, path, suggestedId });
    addBinaryToModel(ctx, meta);
    return { href: `#${meta.id}`, alt: null, title: null };
  } catch (error) {
    if (error instanceof RpcError && error.code === RpcErrorCode.methodNotFound) {
      // The core does not add binaries yet (US7): reference the file name so the dangling
      // reference is reported by validation and the id can be completed later.
      actions.setStatusMessage(
        store,
        ctx.t('editing.msg.binaryAddUnavailable', { name: suggestedId }),
      );
      return { href: `#${suggestedId}` };
    }
    throw error;
  }
}

function addBinaryToModel(ctx: CommandContext, meta: BinaryMeta): void {
  const document = ctx.store.getState().document;
  if (!document) return;
  const binaries = document.binaries.filter((b) => b.id !== meta.id).concat(meta);
  ctx.store.setState({ document: { ...document, binaries } });
}

function imageCommand(
  id: string,
  labelKey: string,
  icon: string,
  factory: ImageCommandFactory,
): Command {
  return {
    id,
    group: 'edit',
    ...cmdKeys(id, labelKey),
    icon,
    enabled: (ctx) => bodyEditable(ctx) && bodyController(ctx.store)!.canExecute(factory()),
    async run(ctx) {
      const controller = bodyController(ctx.store);
      if (!controller || !controller.canExecute(factory())) return;
      const attrs = await chooseImage(ctx);
      if (!attrs) return;
      controller.execute(factory(attrs));
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Body                                                                     */
/* ------------------------------------------------------------------------ */

/** Model-level "add body" for windowed documents (the new body is not mounted). */
function addBodyStep(): ModelStep {
  const body = nodeToModel(newBodyNode()) as unknown as BodyNode;
  const nodeId = `ui_body_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6)}`;
  body.attrs = { ...body.attrs, nodeId };
  return {
    apply: (model: Document) => ({ ...model, bodies: [...model.bodies, body] }),
    revert: (model: Document) => ({
      ...model,
      bodies: model.bodies.filter((b) => b.attrs.nodeId !== nodeId),
    }),
  };
}

function addBodyCommand(): Command {
  return {
    id: 'insert.body',
    group: 'edit',
    ...cmdKeys('insert.body', 'menu.add.body'),
    icon: 'id_edit_add_body',
    enabled: (ctx) => bodyEditable(ctx),
    run(ctx) {
      const controller = bodyController(ctx.store)!;
      const window = controller.currentWindow;
      if (window?.wholeBook) {
        controller.execute(insertBodyAtEnd);
        return;
      }
      const model = controller.applyModelStep(addBodyStep(), ctx.t('cmd.insert.body.tooltip'));
      if (model) controller.selectBody(model.bodies.length - 1);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Registration                                                             */
/* ------------------------------------------------------------------------ */

export function registerBodyCommands(
  registry: CommandRegistry,
  controller: BodyEditorController,
): void {
  void controller;
  const commands: Command[] = [
    addBodyCommand(),
    pmCommand({
      id: 'insert.title',
      group: 'edit',
      keys: cmdKeys('insert.title', 'menu.add.title'),
      icon: 'id_edit_add_title',
      command: addTitle,
    }),
    pmCommand({
      id: 'insert.epigraph',
      group: 'edit',
      keys: cmdKeys('insert.epigraph', 'menu.add.epigraph'),
      icon: 'id_edit_add_epigraph',
      command: addEpigraph,
    }),
    pmCommand({
      id: 'insert.annotation',
      group: 'edit',
      keys: cmdKeys('insert.annotation', 'menu.add.annotation'),
      icon: 'id_edit_add_ann',
      command: addAnnotation,
    }),
    pmCommand({
      id: 'insert.textAuthor',
      group: 'edit',
      keys: cmdKeys('insert.textAuthor', 'menu.add.textAuthor'),
      command: addTextAuthor,
    }),
    imageCommand('insert.image', 'menu.add.image', 'id_edit_ins_image', insertImage),
    imageCommand(
      'insert.inlineImage',
      'menu.add.inlineImage',
      'id_edit_ins_inlineimage',
      insertInlineImage,
    ),
    imageCommand(
      'insert.sectionImage',
      'menu.add.sectionImage',
      'id_edit_add_image',
      addSectionImage,
    ),
    pmCommand({
      id: 'insert.poem',
      group: 'edit',
      keys: cmdKeys('insert.poem', 'menu.add.poem'),
      icon: 'id_edit_ins_poem',
      command: insertPoem,
    }),
    pmCommand({
      id: 'insert.cite',
      group: 'edit',
      keys: cmdKeys('insert.cite', 'menu.add.cite'),
      icon: 'id_edit_ins_cite',
      command: insertCite,
    }),
    {
      id: 'insert.table',
      group: 'edit',
      ...cmdKeys('insert.table', 'menu.add.table'),
      // The project's own pair (feature 006, C27): the original's exists at 16 px only.
      icon: 'table-insert',
      enabled: (ctx) =>
        bodyEditable(ctx) && canInsertTable(bodyController(ctx.store)!.editorState!),
      async run(ctx) {
        const controller = bodyController(ctx.store);
        if (!controller?.editorState || !canInsertTable(controller.editorState)) return;
        const result = await showTablePropertiesDialog(ctx.dialogs);
        if (!result) return;
        controller.execute(insertTable(result.rows, result.header));
      },
    },
  ];

  for (const name of INLINE_MARKS) {
    const id = `style.${name}`;
    commands.push(
      pmCommand({
        id,
        group: 'edit',
        keys: cmdKeys(id),
        icon: MARK_ICONS[name],
        command: toggleInlineMark(name),
        checked: (ctx) => {
          const state = bodyController(ctx.store)?.selectionState;
          return !!state && bodyEditable(ctx) && markActive(state, M[name]!);
        },
      }),
    );
  }

  for (const style of Object.keys(PARAGRAPH_STYLE_COMMANDS) as ParagraphStyle[]) {
    const spec = PARAGRAPH_STYLE_COMMANDS[style];
    commands.push(
      pmCommand({
        id: spec.id,
        group: 'style',
        keys: cmdKeys(spec.id, spec.label),
        icon: spec.icon,
        command: setParagraphStyle(style),
        checked: (ctx) => {
          const state = bodyController(ctx.store)?.selectionState;
          return !!state && bodyEditable(ctx) && currentParagraphStyle(state) === style;
        },
      }),
    );
  }

  for (const command of commands) registry.replace(command);
}
