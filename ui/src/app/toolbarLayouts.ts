/**
 * Toolbar layouts (feature 002 FR-062, FR-063; data-model §4): the buttons of the Commands and
 * Scripts toolbars in order, kept per user in `session.toolbarLayouts` as lists of item ids with
 * "-" for a separator. The original layouts are the defaults and what Reset restores: the
 * Commands toolbar's original buttons and separators, and "Last script" alone on the Scripts
 * toolbar. A script button is stored by its script id, so scripts added or removed later never
 * re-target it; a button whose script is gone is not shown.
 *
 * A button of a registered command whose `visible` predicate says no - the AI assistant's
 * `ai.toggle` while the assistant is disabled (feature 005 FR-096) - is a *hidden item*: the
 * toolbar renders nothing for it and the Customize dialog does not list it, yet the stored
 * layout keeps it where it is through every edit (`withHiddenItems`), so the button is back
 * in its place when the assistant is enabled again (FR-097: "nothing else changed").
 */

import type { Settings } from '@/rpc/types';
import { actions, type AppStore } from '@/model/store';

import type { CommandContext, CommandRegistry } from './commands';
import { COMMANDS_TOOLBAR, COMMANDS_TOOLBAR_OFFERED } from './toolbarDefinitions';

export type CustomizableToolbar = 'commands' | 'scripts';

/** A separator in a stored layout. */
export const SEPARATOR = '-';

/** The Scripts toolbar's "Last script" button (its command id). */
export const LAST_SCRIPT = 'scripts.last';

/**
 * The Commands toolbar's buttons: its original layout without the separators, then the table
 * buttons it offers only in Customize (feature 006, FR-041).
 */
const COMMAND_BUTTONS: readonly string[] = [
  ...COMMANDS_TOOLBAR.filter((id): id is string => id !== null),
  ...COMMANDS_TOOLBAR_OFFERED,
];

/** The original layout of a toolbar, which Reset restores. */
export function originalLayout(toolbar: CustomizableToolbar): string[] {
  return toolbar === 'commands' ? COMMANDS_TOOLBAR.map((id) => id ?? SEPARATOR) : [LAST_SCRIPT];
}

/**
 * The buttons a toolbar offers besides separators: the Commands toolbar's original buttons
 * followed by *Table…* and the 24 table commands (feature 006, none shown until the user adds
 * it); "Last script" and the given scripts (command ids of the menu scripts with an icon).
 */
export function availableButtons(
  toolbar: CustomizableToolbar,
  scriptCommandIds: readonly string[] = [],
): string[] {
  return toolbar === 'commands' ? [...COMMAND_BUTTONS] : [LAST_SCRIPT, ...scriptCommandIds];
}

/**
 * The buttons a toolbar shows: the stored layout (else the original one) without the items the
 * toolbar does not offer - among them the buttons of scripts that are gone - and without a
 * button's second appearance.
 */
export function shownLayout(
  settings: Settings | null,
  toolbar: CustomizableToolbar,
  scriptCommandIds: readonly string[] = [],
): string[] {
  const offered = new Set(availableButtons(toolbar, scriptCommandIds));
  const shown = new Set<string>();
  const stored = settings?.session.toolbarLayouts?.[toolbar] ?? originalLayout(toolbar);
  return stored.filter((item) => {
    if (item === SEPARATOR) return true;
    if (!offered.has(item) || shown.has(item)) return false;
    shown.add(item);
    return true;
  });
}

/**
 * True for an item a layout keeps but shows nowhere: a registered command whose `visible`
 * predicate says no (feature 005 FR-096 - the AI assistant's button while the assistant is
 * disabled). An unregistered command is not hidden (it is not offered at all).
 */
export function isHiddenItem(
  item: string,
  commands: CommandRegistry,
  ctx: CommandContext,
): boolean {
  return item !== SEPARATOR && commands.has(item) && !commands.isVisible(item, ctx);
}

/**
 * Puts the hidden items of `stored` back into `edited`, an edited copy of its visible part
 * (the Customize dialog's lists, a Shift+drag): each hidden item follows the nearest button -
 * not a separator, which a layout repeats - that preceded it in `stored` and is still in
 * `edited`; with none left it leads the layout. Several hidden items keep their order; an
 * item `edited` already holds gets no second copy.
 */
export function withHiddenItems(
  stored: readonly string[],
  edited: readonly string[],
  hidden: (item: string) => boolean,
): string[] {
  const result = [...edited];
  const leading: string[] = [];
  stored.forEach((item, index) => {
    if (!hidden(item) || result.includes(item)) return;
    let at = -1;
    for (let before = index - 1; before >= 0 && at < 0; before -= 1) {
      const anchor = stored[before]!;
      if (anchor !== SEPARATOR) at = result.indexOf(anchor);
    }
    if (at < 0) leading.push(item);
    else result.splice(at + 1, 0, item);
  });
  return [...leading, ...result];
}

/** Stores a toolbar's layout (null: back to the original), at once and for the next start. */
export async function saveLayout(
  ctx: Pick<CommandContext, 'store' | 'rpc'>,
  toolbar: CustomizableToolbar,
  items: string[] | null,
): Promise<void> {
  applyLocally(ctx.store, toolbar, items);
  if (!ctx.rpc) return;
  actions.countLayoutSave(ctx.store, 1);
  try {
    await ctx.rpc.call('settings.set', {
      patch: { session: { toolbarLayouts: { [toolbar]: items } } },
    });
  } catch {
    // The layout still applies for this session.
  } finally {
    actions.countLayoutSave(ctx.store, -1);
  }
}

function applyLocally(store: AppStore, toolbar: CustomizableToolbar, items: string[] | null): void {
  const settings = store.getState().settings;
  if (!settings) return;
  const layouts = { ...settings.session.toolbarLayouts };
  if (items) layouts[toolbar] = items;
  else delete layouts[toolbar];
  store.setState({
    settings: { ...settings, session: { ...settings.session, toolbarLayouts: layouts } },
  });
}
