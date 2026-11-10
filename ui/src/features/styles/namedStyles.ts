/**
 * Feature 011 (US9; D43 and its clarifications; FR-020f; contracts/styles.md §4; research DP-15):
 * named styles in the Body view. *Style → Named Style ▸ <name>* puts the `style` mark (`name`) on
 * each paragraph's selected part when text is selected, else the `style` attribute on the innermost
 * element at the caret that FB2 lets carry one - a paragraph, verse, subtitle or text author, a
 * table, a cell; *Remove Named Style* takes the mark or the attribute away. Each is one undo step.
 * The names are the class selectors of the book's CSS stylesheets (`classNamesOf`); an entry that
 * cannot run now is greyed with the reason in its tooltip.
 */
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { NodeSelection, type EditorState } from 'prosemirror-state';

import type { Command, CommandContext } from '@/app/commands';
import type { MenuItemSpec } from '@/app/menus';
import type { FeatureContext } from '@/app/services';
import { bodyController } from '@/features/editing/common';
import type { Stylesheet } from '@/model/document';
import {
  registerContextMenuExtension,
  type ContextMenuItem,
} from '@/views/body/contextMenuExtensions';

import { classNamesOf } from './classNames';

export const NAMED_STYLE_COMMAND_PREFIX = 'style.named:';
export const REMOVE_NAMED_STYLE = 'style.removeNamed';
export const NO_NAMED_STYLES = 'style.namedNone';

/** The command of the named style `name`. */
export function namedStyleCommandId(name: string): string {
  return `${NAMED_STYLE_COMMAND_PREFIX}${name}`;
}

/** The Body view's node types whose `style` attribute names a class (FB2 schema). */
const STYLED_ELEMENTS: ReadonlySet<string> = new Set([
  'p',
  'v',
  'subtitle',
  'text_author',
  'table',
  'th',
  'td',
]);

type Target =
  | { kind: 'text'; from: number; to: number }
  | { kind: 'element'; pos: number; node: ProseMirrorNode }
  | null;

/** What a named style would go on: the selected text, else the innermost styled element. */
export function styleTarget(state: EditorState): Target {
  const { selection } = state;
  if (selection instanceof NodeSelection) {
    // A selected picture or element carries no mark; a selected table carries the attribute.
    const node = selection.node;
    return STYLED_ELEMENTS.has(node.type.name)
      ? { kind: 'element', pos: selection.from, node }
      : null;
  }
  if (!selection.empty) {
    let text = false;
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (node.isText) text = true;
      return !text;
    });
    return text ? { kind: 'text', from: selection.from, to: selection.to } : null;
  }
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (STYLED_ELEMENTS.has(node.type.name))
      return { kind: 'element', pos: $from.before(depth), node };
  }
  return null;
}

/** The range of the `style` mark around the caret (null when there is none). */
function markRangeAtCaret(state: EditorState): { from: number; to: number } | null {
  const { $from } = state.selection;
  const type = state.schema.marks.style;
  if (!type || !type.isInSet($from.marks())) return null;
  const parent = $from.parent;
  const start = $from.start();
  let from = $from.pos;
  let to = $from.pos;
  parent.forEach((child, offset) => {
    const childFrom = start + offset;
    const childTo = childFrom + child.nodeSize;
    if (childTo < $from.pos - 1 || childFrom > $from.pos + 1) return;
    if (type.isInSet(child.marks)) {
      from = Math.min(from, childFrom);
      to = Math.max(to, childTo);
    }
  });
  return from < to ? { from, to } : null;
}

/** Whether there is a named style to remove at the selection or the caret. */
export function hasNamedStyle(state: EditorState): boolean {
  const type = state.schema.marks.style;
  if (!type) return false;
  const target = styleTarget(state);
  if (target?.kind === 'text') return state.doc.rangeHasMark(target.from, target.to, type);
  if (target?.kind === 'element' && target.node.attrs.style) return true;
  return markRangeAtCaret(state) !== null;
}

function bodyState(ctx: Pick<CommandContext, 'store'>): EditorState | null {
  if (ctx.store.getState().activeView !== 'body') return null;
  return bodyController(ctx.store)?.editorState ?? null;
}

/** Applies the named style `name` (one transaction, one undo step). */
export function applyNamedStyle(ctx: Pick<CommandContext, 'store'>, name: string): boolean {
  const controller = bodyController(ctx.store);
  const state = bodyState(ctx);
  const type = state?.schema.marks.style;
  if (!controller || !state || !type) return false;
  const target = styleTarget(state);
  if (!target) return false;
  const tr =
    target.kind === 'text'
      ? state.tr.addMark(target.from, target.to, type.create({ name }))
      : state.tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, style: name });
  controller.apply(tr.scrollIntoView());
  return true;
}

/** Removes the named style of the selection, the element or the text at the caret. */
export function removeNamedStyle(ctx: Pick<CommandContext, 'store'>): boolean {
  const controller = bodyController(ctx.store);
  const state = bodyState(ctx);
  const type = state?.schema.marks.style;
  if (!controller || !state || !type || !hasNamedStyle(state)) return false;
  const target = styleTarget(state);
  let tr = state.tr;
  if (target?.kind === 'text') tr = tr.removeMark(target.from, target.to, type);
  else if (target?.kind === 'element' && target.node.attrs.style) {
    tr = tr.setNodeMarkup(target.pos, undefined, { ...target.node.attrs, style: null });
  } else {
    const range = markRangeAtCaret(state);
    if (!range) return false;
    tr = tr.removeMark(range.from, range.to, type);
  }
  controller.apply(tr.scrollIntoView());
  return true;
}

/** Why the named style `name` cannot be applied now, or null. */
function applyReason(ctx: CommandContext, names: readonly string[]): string | null {
  if (names.length === 0) return ctx.t('styles.named.reason.none');
  if (ctx.store.getState().activeView !== 'body') return ctx.t('styles.named.reason.bodyView');
  const state = bodyState(ctx);
  return state && styleTarget(state) ? null : ctx.t('styles.named.reason.noTarget');
}

const namesOf = (ctx: Pick<CommandContext, 'store'>) =>
  classNamesOf(ctx.store.getState().document?.stylesheets ?? []);

function namedStyleCommand(name: string): Command {
  return {
    id: namedStyleCommandId(name),
    group: 'style',
    label: name,
    tooltip: name,
    descriptionKey: 'styles.named.applyTip',
    labelParams: { name },
    enabled: (ctx) => applyReason(ctx, namesOf(ctx)) === null,
    unavailableReason: (ctx) => applyReason(ctx, namesOf(ctx)),
    run: (ctx) => {
      applyNamedStyle(ctx, name);
    },
  };
}

const removeCommand: Command = {
  id: REMOVE_NAMED_STYLE,
  group: 'style',
  labelKey: 'menu.style.removeNamed',
  tooltipKey: 'cmd.style.removeNamed.tooltip',
  descriptionKey: 'cmd.style.removeNamed.description',
  enabled: (ctx) => {
    const state = bodyState(ctx);
    return !!state && hasNamedStyle(state);
  },
  unavailableReason: (ctx) =>
    ctx.store.getState().activeView !== 'body'
      ? ctx.t('styles.named.reason.bodyView')
      : ctx.t('styles.named.reason.nothingToRemove'),
  run: (ctx) => {
    removeNamedStyle(ctx);
  },
};

/** The entry of a book without named styles: always greyed, saying why (FR-020f). */
const noneCommand: Command = {
  id: NO_NAMED_STYLES,
  group: 'style',
  labelKey: 'menu.style.noNamedStyles',
  tooltipKey: 'menu.style.noNamedStyles',
  descriptionKey: 'styles.named.reason.none',
  enabled: () => false,
  unavailableReason: (ctx) => ctx.t('styles.named.reason.none'),
  run: () => undefined,
};

/** The Style menu's *Named Style* entries for the book's stylesheets (empty: the placeholder). */
export function namedStyleMenuItems(
  stylesheets: readonly Stylesheet[] | undefined,
): MenuItemSpec[] {
  const names = classNamesOf(stylesheets ?? []);
  if (names.length === 0) return [];
  return [
    ...names.map((name): MenuItemSpec => ({
      kind: 'command',
      commandId: namedStyleCommandId(name),
    })),
    { kind: 'separator' },
    { kind: 'command', commandId: REMOVE_NAMED_STYLE },
  ];
}

/** Registers *Remove Named Style* and one command per named style, kept current with the book. */
export function registerNamedStylesFeature(ctx: FeatureContext): void {
  const { commands, store } = ctx;
  commands.replace(removeCommand);
  commands.replace(noneCommand);
  let registered = new Set<string>();
  let last: readonly Stylesheet[] | undefined;
  const sync = () => {
    const sheets = store.getState().document?.stylesheets;
    if (sheets === last) return;
    last = sheets;
    const names = classNamesOf(sheets ?? []);
    const wanted = new Set(names.map(namedStyleCommandId));
    for (const id of registered) if (!wanted.has(id)) commands.unregister(id);
    for (const name of names) commands.replace(namedStyleCommand(name));
    registered = wanted;
  };
  sync();
  store.subscribe(sync);
  // The Body view's context menu: the same submenu (FR-020f).
  registerContextMenuExtension('namedStyles', (_controller, menuCtx) => {
    const names = namesOf(menuCtx);
    const entry = (id: string, label: string): ContextMenuItem => ({
      id,
      label,
      enabled: commands.isEnabled(id, menuCtx),
      title: commands.unavailableReason(id, menuCtx) ?? undefined,
      run: () => void commands.execute(id, menuCtx),
    });
    const items: ContextMenuItem[] =
      names.length > 0
        ? [
            ...names.map((name) => entry(namedStyleCommandId(name), name)),
            { separator: true, id: 'sep-named-remove' },
            entry(REMOVE_NAMED_STYLE, menuCtx.t('menu.style.removeNamed').replace(/&(?!&)/g, '')),
          ]
        : [
            {
              id: 'named-none',
              label: menuCtx.t('menu.style.noNamedStyles'),
              enabled: false,
              title: menuCtx.t('styles.named.reason.none'),
              run: () => undefined,
            },
          ];
    return [
      {
        id: 'namedStyle',
        label: menuCtx.t('menu.style.namedStyle').replace(/&(?!&)/g, ''),
        items,
        run: () => undefined,
      },
    ];
  });
}
