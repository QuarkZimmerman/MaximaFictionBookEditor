/**
 * Links and footnotes feature (T061): Style > Link... (href asked in `LinkDialog`), Style >
 * Footnote... (a note section `n_<N>` with title `N` is appended to the `notes` body - created
 * with a localised title when absent - and the selection becomes a `type="note"` link to it;
 * the caret moves into the new note so its text can be typed), Style > Remove link, and Edit >
 * Go to footnote or reference (jump to the link target, or from a note section back to the text
 * referencing it; "Reference not found." when the target is missing). Everything works across
 * the section window: targets in unmounted sections are located through the model.
 */

import { TextSelection } from 'prosemirror-state';

import type { Command, CommandContext, CommandRegistry } from '@/app/commands';
import { showLinkDialog } from './linkTargets';
import {
  appendNoteSection,
  canCreateLink,
  collectIds,
  createNoteSection,
  createNotesBody,
  findById,
  findNotesBody,
  findReference,
  gotoFootnote,
  gotoReference,
  linkRangeAt,
  linkTargetAt,
  nextNoteNumber,
  NOTES_BODY_NAME,
  referenceIdAt,
  removeLink,
  selectionIntoTarget,
  setLink,
} from '@/editor/commands/links';
import { M } from '@/editor/commands/util';
import type { ModelNodeJson } from '@/editor/fromModel';
import { assignNodeIds, createNodeIdGenerator, findNodeById } from '@/editor/schema';
import { nodeToModel } from '@/editor/toModel';
import type { BodyNode, Document, SectionNode } from '@/model/document';
import type { BodyEditorController, ModelStep } from '@/views/body/bodyEditor';

import { bodyController, bodyEditable, cmdKeys, pmCommand } from './editing/common';

const modelNodeIds = createNodeIdGenerator('uim_');

/* ------------------------------------------------------------------------ */
/* Model lookups (unmounted sections)                                       */
/* ------------------------------------------------------------------------ */

/** All XML ids of the model (every body, mounted or not). */
export function collectModelIds(model: Pick<Document, 'bodies'>): Set<string> {
  const ids = new Set<string>();
  const visit = (json: ModelNodeJson) => {
    const id = json.attrs?.id;
    if (typeof id === 'string' && id) ids.add(id);
    for (const child of json.content ?? []) visit(child);
  };
  for (const body of model.bodies) visit(body as unknown as ModelNodeJson);
  return ids;
}

/** nodeId of the model node carrying the XML id. */
export function findIdInModel(model: Pick<Document, 'bodies'>, id: string): string | null {
  let found: string | null = null;
  const visit = (json: ModelNodeJson) => {
    if (found) return;
    if (json.attrs?.id === id && typeof json.attrs.nodeId === 'string') {
      found = json.attrs.nodeId;
      return;
    }
    for (const child of json.content ?? []) visit(child);
  };
  for (const body of model.bodies) visit(body as unknown as ModelNodeJson);
  return found;
}

/** A text or an inline image of a text block: the children a reference can be made of. */
function isReferenceChild(child: ModelNodeJson): boolean {
  return child.type === 'text' || child.type === 'inline-image';
}

/**
 * First text block (nodeId, end offset of the link) holding a link to `#id`: on a text or on an
 * inline image - a note reference may be a picture alone (feature 006, FR-067; the image counts
 * as one position). The first in document order wins.
 */
export function findReferenceInModel(
  model: Pick<Document, 'bodies'>,
  id: string,
): { nodeId: string; offset: number } | null {
  const href = `#${id}`;
  let found: { nodeId: string; offset: number } | null = null;
  const visit = (json: ModelNodeJson) => {
    if (found) return;
    if (json.content && json.content.some(isReferenceChild)) {
      let offset = 0;
      for (const child of json.content) {
        const length = child.type === 'text' ? (child.text ?? '').length : 1;
        if (
          isReferenceChild(child) &&
          child.marks?.some((m) => m.type === 'link' && m.attrs?.href === href)
        ) {
          const nodeId = json.attrs?.nodeId;
          if (typeof nodeId === 'string') {
            found = { nodeId, offset: offset + length };
            return;
          }
        }
        offset += length;
      }
    }
    for (const child of json.content ?? []) visit(child);
  };
  for (const body of model.bodies) visit(body as unknown as ModelNodeJson);
  return found;
}

/* ------------------------------------------------------------------------ */
/* Footnote creation                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Note section appended to the notes body of the model, or `notesBody` (title + the section)
 * appended as a new body when the document has none. Reversible by node ids.
 */
function appendNoteStep(notesBody: BodyNode, section: SectionNode): ModelStep {
  const bodyNodeId = notesBody.attrs.nodeId;
  const sectionNodeId = section.attrs.nodeId;
  return {
    apply(model: Document): Document {
      const index = model.bodies.findIndex((b) => b.attrs.name === NOTES_BODY_NAME);
      if (index < 0) return { ...model, bodies: [...model.bodies, notesBody] };
      const body = model.bodies[index]!;
      const updated: BodyNode = { ...body, content: [...body.content, section] };
      return { ...model, bodies: model.bodies.map((b, i) => (i === index ? updated : b)) };
    },
    revert(model: Document): Document {
      const bodies = model.bodies
        .map((body) => {
          if (body.attrs.nodeId === bodyNodeId) return null; // the body this step created
          if (body.attrs.name !== NOTES_BODY_NAME) return body;
          const content = body.content.filter((c) => c.attrs.nodeId !== sectionNodeId);
          return content.length === body.content.length ? body : { ...body, content };
        })
        .filter((body): body is BodyNode => body !== null);
      return { ...model, bodies };
    },
  };
}

export function canCreateFootnote(controller: BodyEditorController): boolean {
  const state = controller.selectionState;
  if (!state) return false;
  const { $from, $to } = state.selection;
  return $from.parent.inlineContent && $from.sameParent($to) && $from.parent.isTextblock;
}

/**
 * Creates the footnote for the selection (or inserts `[N]` at the caret): one undo entry
 * covering the link and the note section; the caret lands in the new note's paragraph.
 */
export function createFootnote(ctx: CommandContext, controller: BodyEditorController): boolean {
  const state = controller.editorState;
  const model = controller.currentModel;
  if (!state || !model || !canCreateFootnote(controller)) return false;
  const ids = collectModelIds(model);
  collectIds(state.doc, ids);
  const n = nextNoteNumber(ids);
  const id = `n_${n}`;
  const notesTitle = ctx.t('editing.footnote.notesTitle');
  const label = ctx.t('editing.footnote.undoLabel');

  ctx.undo.beginGroup(label);
  try {
    const tr = state.tr;
    const { from, to, empty } = state.selection;
    const mark = M.link!.create({ href: `#${id}`, type: 'note' });
    if (empty) {
      const text = `[${n}]`; // the legacy footnote scripts' link text pattern
      tr.insertText(text, from, to);
      tr.addMark(from, from + text.length, mark);
    } else {
      tr.removeMark(from, to, M.link!);
      tr.addMark(from, to, mark);
    }

    const window = controller.currentWindow;
    const notesMounted = findNotesBody(tr.doc) !== null;
    const canAppendInEditor =
      window?.wholeBook || (notesMounted && window !== null && window.after === 0);
    if (canAppendInEditor) {
      const result = appendNoteSection(tr, n, window?.wholeBook ? notesTitle : null);
      if (result) {
        controller.apply(tr.setSelection(TextSelection.near(tr.doc.resolve(result.notePos + 1))));
        // Caret into the note's paragraph (after the title).
        const target = findById(controller.editorState!.doc, id);
        if (target) {
          controller.apply(
            controller
              .editorState!.tr.setSelection(
                selectionIntoTarget(controller.editorState!.doc, target),
              )
              .scrollIntoView(),
          );
        }
        controller.focus();
        return true;
      }
    }
    controller.apply(tr);
    const notesBody = nodeToModel(
      assignNodeIds(createNotesBody(notesTitle, createNoteSection(n)), modelNodeIds),
    ) as unknown as BodyNode;
    const section = notesBody.content[1] as SectionNode;
    controller.applyModelStep(appendNoteStep(notesBody, section), label);
    // The note lives in an unmounted part of the book: the caret stays on the reference (moving
    // the window would reset the ProseMirror history); "Go to footnote" jumps there.
    return true;
  } finally {
    ctx.undo.endGroup();
  }
}

/* ------------------------------------------------------------------------ */
/* Go to footnote or reference                                              */
/* ------------------------------------------------------------------------ */

export async function gotoFootnoteOrReference(
  ctx: CommandContext,
  controller: BodyEditorController,
): Promise<boolean> {
  const state = controller.editorState;
  const model = controller.currentModel;
  if (!state || !model) return false;
  // 1. Link at the caret -> its target (mounted or not).
  const targetId = linkTargetAt(state);
  if (targetId) {
    if (controller.execute(gotoFootnote)) return true;
    const nodeId = findIdInModel(model, targetId);
    if (nodeId && controller.moveWindowTo(nodeId)) {
      const doc = controller.editorState!.doc;
      const target = findById(doc, targetId) ?? findNodeById(doc, nodeId);
      if (target) {
        // The focus first: ProseMirror scrolls to the selection only while it owns the DOM
        // selection (as `BodyEditorController.setCaret` does).
        controller.focus();
        controller.apply(
          controller
            .editorState!.tr.setSelection(selectionIntoTarget(doc, target))
            .scrollIntoView(),
        );
        return true;
      }
    }
  } else {
    // 2. Inside a note section -> the text referencing it.
    const refId = referenceIdAt(state);
    if (refId) {
      if (controller.execute(gotoReference)) return true;
      const ref = findReferenceInModel(model, refId);
      if (ref && controller.selectRange(ref.nodeId, ref.offset, ref.offset)) return true;
    }
  }
  await ctx.dialogs.showMessage({
    text: ctx.t('msg.referenceNotFound'),
    caption: ctx.t('app.name'),
    icon: 'info',
    testId: 'dialog-reference-not-found',
  });
  return false;
}

/* ------------------------------------------------------------------------ */
/* Links bar support                                                        */
/* ------------------------------------------------------------------------ */

/** Sets the href of the link at the caret / the selected image (Links bar "Href"). */
export function setHrefAtSelection(controller: BodyEditorController, href: string): boolean {
  const state = controller.editorState;
  if (!state) return false;
  const context = controller.getContext();
  if (context.image) {
    const { node, pos } = context.image;
    controller.apply(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, href }, node.marks));
    return true;
  }
  const range = linkRangeAt(state);
  if (!range) return false;
  return controller.execute(setLink(href, range.type));
}

/* ------------------------------------------------------------------------ */
/* Registration                                                             */
/* ------------------------------------------------------------------------ */

export function registerFootnoteCommands(registry: CommandRegistry): void {
  const commands: Command[] = [
    {
      id: 'style.link',
      group: 'style',
      ...cmdKeys('style.link', 'menu.style.link'),
      icon: 'id_style_link',
      enabled: (ctx) => {
        const state = bodyController(ctx.store)?.selectionState;
        return !!state && bodyEditable(ctx) && canCreateLink(state);
      },
      async run(ctx) {
        const controller = bodyController(ctx.store);
        controller?.syncSelection();
        const state = controller?.editorState;
        if (!controller || !state || !canCreateLink(state)) return;
        const current = linkRangeAt(state);
        const targets = [...collectIds(state.doc)].sort();
        const href = await showLinkDialog(ctx.dialogs, {
          initialHref: current?.href ?? '',
          targets,
        });
        if (href === null) return;
        controller.execute(setLink(href, current?.type ?? null));
      },
    },
    {
      id: 'style.footnote',
      group: 'style',
      ...cmdKeys('style.footnote', 'menu.style.footnote'),
      icon: 'id_style_note',
      enabled: (ctx) => {
        const controller = bodyController(ctx.store);
        return !!controller && bodyEditable(ctx) && canCreateFootnote(controller);
      },
      run(ctx) {
        const controller = bodyController(ctx.store);
        controller?.syncSelection();
        if (controller) createFootnote(ctx, controller);
      },
    },
    pmCommand({
      id: 'style.removeLink',
      group: 'style',
      keys: cmdKeys('style.removeLink', 'menu.style.removeLink'),
      icon: 'id_style_nolink',
      command: removeLink,
    }),
    {
      id: 'edit.gotoFootnote',
      group: 'navigation',
      ...cmdKeys('edit.gotoFootnote', 'menu.edit.gotoFootnote'),
      icon: 'id_goto_footnote',
      enabled: (ctx) => {
        const state = bodyController(ctx.store)?.editorState;
        return (
          !!state &&
          bodyEditable(ctx) &&
          (linkTargetAt(state) !== null || referenceIdAt(state) !== null)
        );
      },
      async run(ctx) {
        const controller = bodyController(ctx.store);
        if (controller) await gotoFootnoteOrReference(ctx, controller);
      },
    },
  ];
  for (const command of commands) registry.replace(command);
}

export { findReference };
