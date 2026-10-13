/**
 * Hotkeys page helpers (T131): the group list of the original dialog, command naming for the
 * collision messages and the scratch map the page edits until OK / Apply.
 */

import type { TFunction } from 'i18next';

import {
  COMMAND_GROUPS,
  commandTooltip,
  type Command,
  type CommandGroup,
  type CommandRegistry,
} from '@/app/commands';
import { HotkeyMap, type DefaultHotkey } from '@/app/hotkeys';

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

export function commandsOfGroup(
  registry: CommandRegistry,
  group: CommandGroup,
  t: TFunction,
): Command[] {
  return registry
    .byGroup(group)
    .slice()
    .sort((a, b) => commandTooltip(a, t).localeCompare(commandTooltip(b, t)));
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
