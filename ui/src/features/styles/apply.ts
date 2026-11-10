/**
 * Feature 011 (US8; FR-020e, FR-020h; research DP-14, DP-16): changing the book's stylesheets from
 * the Styles view. The interface's model is the book: an edit replaces `document.stylesheets` (and,
 * for a renamed class, the marks and `style` attributes that use it) as one undo step of the Styles
 * view, and Save writes it with the rest of the book. Stylesheets the edit did not touch keep their
 * text byte for byte (guard G13).
 */
import type { CommandContext } from '@/app/commands';
import type { ModelNodeJson } from '@/editor/fromModel';
import { getBodyController, hasBodyController } from '@/views/body/bodyEditor';
import { getSourceEditor } from '@/views/source/sourceEditor';
import { actions } from '@/model/store';
import type { Document, Stylesheet } from '@/model/document';

/** Shows `document` in the views (the Body view's model, the Source view's text). */
function show(
  ctx: Pick<CommandContext, 'store'> & Partial<CommandContext>,
  document: Document,
): void {
  const { store } = ctx;
  if (hasBodyController(store)) getBodyController(store).showModel(document);
  else actions.updateDocument(store, document);
  if (store.getState().activeView === 'source' && ctx.store) {
    void getSourceEditor(store)?.load(ctx as CommandContext);
  }
}

/** Replaces the book with `after` as one undo step named `label`. */
export function commitDocument(ctx: CommandContext, after: Document, label: string): boolean {
  const before = ctx.store.getState().document;
  if (!before) return false;
  show(ctx, after);
  ctx.undo.recordSnapshot('styles', label, {
    undo: () => show(ctx, before),
    redo: () => show(ctx, after),
  });
  return true;
}

/** Replaces the book's stylesheets as one undo step. */
export function setStylesheets(
  ctx: CommandContext,
  stylesheets: readonly Stylesheet[],
  label: string,
): boolean {
  const before = ctx.store.getState().document;
  if (!before) return false;
  return commitDocument(ctx, { ...before, stylesheets: [...stylesheets] }, label);
}

/** The element types whose `style` attribute names a class (contracts/styles.md §4). */
const STYLED_ELEMENTS = new Set(['p', 'v', 'subtitle', 'text-author', 'table', 'th', 'td']);

interface Uses {
  count: number;
}

/** `node` with every use of the class `from` renamed to `to` (null `to`: counts only). */
function renameIn(node: ModelNodeJson, from: string, to: string | null, uses: Uses): ModelNodeJson {
  let changed = false;
  let next: ModelNodeJson = node;
  if (STYLED_ELEMENTS.has(node.type) && node.attrs?.style === from) {
    uses.count += 1;
    if (to !== null) {
      next = { ...next, attrs: { ...next.attrs, style: to } };
      changed = true;
    }
  }
  if (node.type === 'text' && node.marks) {
    const marks = node.marks.map((mark) => {
      if (mark.type === 'style' && mark.attrs?.name === from) {
        uses.count += 1;
        return to === null ? mark : { ...mark, attrs: { ...mark.attrs, name: to } };
      }
      return mark;
    });
    if (to !== null && marks.some((mark, i) => mark !== node.marks![i])) {
      next = { ...next, marks };
      changed = true;
    }
  }
  if (node.content) {
    const content = node.content.map((child) => renameIn(child, from, to, uses));
    if (content.some((child, i) => child !== node.content![i])) {
      next = { ...next, content };
      changed = true;
    }
  }
  return changed ? next : node;
}

/** The places of the book that use the class `name` (marks and `style` attributes). */
export function classUses(document: Document, name: string): number {
  const uses: Uses = { count: 0 };
  for (const body of document.bodies) renameIn(body as unknown as ModelNodeJson, name, null, uses);
  const { titleInfo, documentInfo } = document.description;
  for (const block of [titleInfo.annotation, documentInfo.history]) {
    if (block) renameIn(block as unknown as ModelNodeJson, name, null, uses);
  }
  return uses.count;
}

/** The book with every use of the class `from` renamed to `to`. */
export function renameClassUses(document: Document, from: string, to: string): Document {
  const uses: Uses = { count: 0 };
  const bodies = document.bodies.map(
    (body) => renameIn(body as unknown as ModelNodeJson, from, to, uses) as unknown as typeof body,
  );
  const rename = <T>(block: T | undefined): T | undefined =>
    block ? (renameIn(block as unknown as ModelNodeJson, from, to, uses) as unknown as T) : block;
  return {
    ...document,
    bodies,
    description: {
      ...document.description,
      titleInfo: {
        ...document.description.titleInfo,
        annotation: rename(document.description.titleInfo.annotation),
      },
      documentInfo: {
        ...document.description.documentInfo,
        history: rename(document.description.documentInfo.history),
      },
    },
  };
}

/** `selector` with the class `.from` written `.to`. */
export function renameClassInSelector(selector: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return selector.replace(new RegExp(`\\.${escaped}(?![\\w-])`, 'g'), `.${to}`);
}
