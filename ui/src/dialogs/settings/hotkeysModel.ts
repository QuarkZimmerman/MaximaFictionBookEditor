/**
 * Hotkeys page helpers (T131): the group list of the original dialog, command naming for the
 * collision messages and the scratch map the page edits until OK / Apply.
 */

import type { TFunction } from 'i18next';

import {
  COMMAND_GROUPS,
  commandTooltip,
  type Command,
  type CommandContext,
  type CommandGroup,
  type CommandRegistry,
} from '@/app/commands';
import { HotkeyMap, type Chord, type DefaultHotkey } from '@/app/hotkeys';

/** The groups of the original dialog (no Help group: the About box has no shortcut). */
export const HOTKEY_PAGE_GROUPS: readonly CommandGroup[] = COMMAND_GROUPS.filter(
  (group) => group !== 'help',
);

export function groupLabel(group: CommandGroup, t: TFunction): string {
  return group === 'help' ? t('dialog.settings.hotkeys.groupHelp') : t(`hotkeys.groups.${group}`);
}

/** "Group \ Command" as the original named a colliding command. */
export function qualifiedCommandName(command: Command, t: TFunction): string {
  return `${groupLabel(command.group, t)} \\ ${commandTooltip(command, t)}`;
}

/**
 * The commands of a group in the page's order; an invisible command (the AI assistant's while
 * the assistant is disabled, feature 005 FR-096) has no row.
 */
export function commandsOfGroup(
  registry: CommandRegistry,
  group: CommandGroup,
  t: TFunction,
  ctx: CommandContext,
): Command[] {
  return registry
    .byGroup(group)
    .filter((command) => registry.isVisible(command.id, ctx))
    .sort((a, b) => commandTooltip(a, t).localeCompare(commandTooltip(b, t)));
}

/**
 * True for a registered command the page does not show (`visible` says no): the AI assistant's
 * inert stubs while the assistant is disabled (feature 005 FR-096). An unregistered command
 * is not invisible - its default still counts for collisions, as `createScratchHotkeys` says.
 */
export function isInvisibleCommand(
  commandId: string,
  registry: CommandRegistry,
  ctx: CommandContext,
): boolean {
  return registry.has(commandId) && !registry.isVisible(commandId, ctx);
}

/**
 * The other command holding `chord`, as the page reports it ("Assigned to ..."). Decision of
 * feature 005 US9 (FR-096): an invisible command is never named - the user cannot see it, so
 * "Assigned to Tools \ Ask AI..." would show the feature in the editor while it is disabled.
 * Its chord counts as free; assigning the chord displaces the invisible holder as any
 * assignment does (`HotkeyMap.assign`).
 */
export function reportedCollision(
  hotkeys: HotkeyMap,
  registry: CommandRegistry,
  chord: Chord | string,
  exceptCommandId: string,
  ctx: CommandContext,
): string | undefined {
  return hotkeys
    .lookup(chord)
    .find((id) => id !== exceptCommandId && !isInvisibleCommand(id, registry, ctx));
}

/**
 * Restores a command's default chord for the page: a default held by an invisible command is
 * taken back without the "Replace?" question (the same decision); one held by a visible
 * command is reported for the page to ask.
 */
export function restoreDefaultChord(
  hotkeys: HotkeyMap,
  registry: CommandRegistry,
  commandId: string,
  ctx: CommandContext,
): { ok: boolean; collision?: string } {
  const result = hotkeys.resetToDefault(commandId);
  if (result.ok || !result.collision || !isInvisibleCommand(result.collision, registry, ctx)) {
    return result;
  }
  return hotkeys.resetToDefault(commandId, { force: true });
}

/**
 * A scratch copy of the live map: same platform, the same defaults (including the dynamic
 * symbol / script defaults added at run time) and the same user overrides.
 */
export function createScratchHotkeys(live: HotkeyMap, registry: CommandRegistry): HotkeyMap {
  const defaults: DefaultHotkey[] = [];
  for (const command of registry.all()) {
    const keys = live.defaultFor(command.id);
    if (keys) defaults.push({ commandId: command.id, keys });
  }
  // Defaults of commands not (yet) registered still count for collisions.
  for (const binding of live.bindings()) {
    if (binding.source === 'default' && !defaults.some((d) => d.commandId === binding.commandId)) {
      defaults.push({ commandId: binding.commandId, keys: binding.keys });
    }
  }
  const scratch = new HotkeyMap(live.platform, { defaults });
  scratch.setUserBindings(live.userBindings());
  return scratch;
}

/** True when the two maps differ in their user overrides. */
export function sameUserBindings(a: HotkeyMap, b: HotkeyMap): boolean {
  const left = a
    .userBindings()
    .map((x) => `${x.commandId}=${x.keys}`)
    .sort();
  const right = b
    .userBindings()
    .map((x) => `${x.commandId}=${x.keys}`)
    .sort();
  return left.length === right.length && left.every((item, i) => item === right[i]);
}
