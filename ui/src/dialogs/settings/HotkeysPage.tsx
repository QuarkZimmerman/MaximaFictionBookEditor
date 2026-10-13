/**
 * Settings > Hotkeys (T131) after `IDD_SETTINGS_HOTKEYS`: Groups list (File, Edit, Navigation,
 * Style, View, Tools, Symbols, Scripts), Commands list of the selected group, the "Shortcut:"
 * capture control, the Assign / Delete / Default buttons, the "Assigned to" box ("Assigned to
 * \"X\"" / "Not assigned to other command" / "Wrong shortcut!") and the Description box.
 *
 * The page edits a scratch `HotkeyMap` (a copy of the live one) so Cancel discards the changes;
 * the dialog copies the scratch overrides into the live map on OK / Apply.
 */

import { useEffect, useMemo, useReducer, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import {
  commandDescription,
  commandTooltip,
  type CommandContext,
  type CommandGroup,
  type CommandRegistry,
} from '@/app/commands';
import { captureHotkey, type CapturedHotkey, type HotkeyMap } from '@/app/hotkeys';

import { GroupBox } from './controls';
import {
  HOTKEY_PAGE_GROUPS,
  commandsOfGroup,
  groupLabel,
  qualifiedCommandName,
} from './hotkeysModel';

export interface HotkeysPageProps {
  commands: CommandRegistry;
  /** Scratch map edited by the page. */
  hotkeys: HotkeyMap;
  ctx: CommandContext;
}

export function HotkeysPage({ commands, hotkeys, ctx }: HotkeysPageProps) {
  const { t } = useTranslation();
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => hotkeys.subscribe(bump), [hotkeys]);
  useEffect(() => commands.subscribe(bump), [commands]);

  const [group, setGroup] = useState<CommandGroup>(HOTKEY_PAGE_GROUPS[0]!);
  const groupCommands = useMemo(() => commandsOfGroup(commands, group, t), [commands, group, t]);
  const [selectedId, setSelectedId] = useState<string | null>(groupCommands[0]?.id ?? null);
  const selected = groupCommands.find((c) => c.id === selectedId) ?? groupCommands[0] ?? null;
  const [captured, setCaptured] = useState<CapturedHotkey | null>(null);

  const selectGroup = (next: CommandGroup) => {
    setGroup(next);
    setSelectedId(commandsOfGroup(commands, next, t)[0]?.id ?? null);
    setCaptured(null);
  };

  const selectCommand = (id: string) => {
    setSelectedId(id);
    setCaptured(null);
  };

  const onCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const bare = !event.ctrlKey && !event.altKey && !event.metaKey;
    // Keep keyboard navigation and the dialog's Escape working.
    if ((event.key === 'Tab' || event.key === 'Escape') && bare) return;
    event.preventDefault();
    event.stopPropagation();
    setCaptured(captureHotkey(event.nativeEvent, hotkeys.platform));
  };

  const collision =
    captured?.complete && captured.validation.ok && captured.chord && selected
      ? hotkeys.findCollision(captured.chord, selected.id)
      : undefined;
  const collisionCommand = collision ? commands.get(collision) : undefined;

  let collisionText = '';
  if (captured?.complete) {
    if (!captured.validation.ok) collisionText = t('hotkeys.wrong');
    else if (collision) {
      collisionText = t('hotkeys.assigned', {
        command: collisionCommand ? qualifiedCommandName(collisionCommand, t) : collision,
      });
    } else collisionText = t('hotkeys.notAssigned');
  }

  const canAssign = !!selected && !!captured?.complete && captured.validation.ok;

  const assign = () => {
    if (!selected || !captured?.chord) return;
    const result = hotkeys.assign(selected.id, captured.chord);
    if (result.ok) setCaptured(null);
  };

  const remove = () => {
    if (!selected) return;
    hotkeys.unassign(selected.id);
    setCaptured(null);
  };

  const restoreDefault = async () => {
    if (!selected) return;
    const result = hotkeys.resetToDefault(selected.id);
    if (!result.ok && result.collision) {
      const other = commands.get(result.collision);
      const answer = await ctx.dialogs.showMessage({
        text: t('hotkeys.defaultCollision', {
          command: other ? qualifiedCommandName(other, t) : result.collision,
        }),
        caption: t('dialog.error.caption'),
        buttons: 'yesNo',
        icon: 'warning',
        testId: 'dialog-hotkey-default-collision',
      });
      if (answer === 'yes') hotkeys.resetToDefault(selected.id, { force: true });
    }
    setCaptured(null);
  };

  const currentChord = selected ? hotkeys.display(selected.id) : undefined;
  const captureText = captured
    ? captured.complete && !captured.validation.ok
      ? t('hotkeys.wrong')
      : captured.text
    : (currentChord ?? '');

  return (
    <div className="mfbe-settings-page" data-testid="settings-page-hotkeys">
      <div className="mfbe-hotkeys-lists">
        <div>
          <div className="mfbe-settings-label" id="settings-hotkeys-groups-label">
            {t('dialog.settings.hotkeys.groups')}
          </div>
          <ul
            className="mfbe-hotkeys-listbox"
            role="listbox"
            aria-labelledby="settings-hotkeys-groups-label"
            tabIndex={0}
            data-testid="settings-hotkeys-groups"
            onKeyDown={(event) => {
              const index = HOTKEY_PAGE_GROUPS.indexOf(group);
              if (event.key === 'ArrowDown' && index < HOTKEY_PAGE_GROUPS.length - 1) {
                event.preventDefault();
                selectGroup(HOTKEY_PAGE_GROUPS[index + 1]!);
              } else if (event.key === 'ArrowUp' && index > 0) {
                event.preventDefault();
                selectGroup(HOTKEY_PAGE_GROUPS[index - 1]!);
              }
            }}
          >
            {HOTKEY_PAGE_GROUPS.map((item) => (
              <li
                key={item}
                role="option"
                aria-selected={item === group}
                data-testid={`settings-hotkeys-group-${item}`}
                onClick={() => selectGroup(item)}
              >
                {groupLabel(item, t)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mfbe-settings-label" id="settings-hotkeys-commands-label">
            {t('dialog.settings.hotkeys.commands')}
          </div>
          <ul
            className="mfbe-hotkeys-listbox"
            role="listbox"
            aria-labelledby="settings-hotkeys-commands-label"
            tabIndex={0}
            data-testid="settings-hotkeys-commands"
            onKeyDown={(event) => {
              const index = groupCommands.findIndex((c) => c.id === selected?.id);
              if (event.key === 'ArrowDown' && index < groupCommands.length - 1) {
                event.preventDefault();
                selectCommand(groupCommands[index + 1]!.id);
              } else if (event.key === 'ArrowUp' && index > 0) {
                event.preventDefault();
                selectCommand(groupCommands[index - 1]!.id);
              }
            }}
          >
            {groupCommands.map((command) => (
              <li
                key={command.id}
                role="option"
                aria-selected={command.id === selected?.id}
                ref={(element) => {
                  if (element && command.id === selected?.id) {
                    element.scrollIntoView?.({ block: 'nearest' });
                  }
                }}
                data-testid={`settings-hotkeys-command-${command.id}`}
                onClick={() => selectCommand(command.id)}
              >
                <span>{commandTooltip(command, t)}</span>
                <span className="mfbe-hotkeys-chord">{hotkeys.display(command.id) ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mfbe-hotkeys-bottom">
        <div>
          <div className="mfbe-settings-row">
            <label className="mfbe-settings-label" htmlFor="settings-hotkeys-capture">
              {t('dialog.settings.hotkeys.shortcut')}
            </label>
            <input
              id="settings-hotkeys-capture"
              className={`mfbe-inputdialog-input mfbe-hotkeys-capture${
                captured?.complete && !captured.validation.ok ? ' mfbe-settings-invalid' : ''
              }`}
              type="text"
              readOnly
              value={captureText}
              placeholder={t('dialog.settings.hotkeys.capturePlaceholder')}
              disabled={!selected}
              onKeyDown={onCaptureKeyDown}
              onFocus={() => setCaptured(null)}
              data-testid="settings-hotkeys-capture"
              data-complete={captured?.complete ? 'true' : 'false'}
            />
          </div>
          <div className="mfbe-settings-note" data-testid="settings-hotkeys-current">
            {t('dialog.settings.hotkeys.current')} {currentChord ?? t('hotkeys.none')}
          </div>
          <GroupBox title={t('dialog.settings.hotkeys.assignedTo')}>
            <div className="mfbe-hotkeys-collision" data-testid="settings-hotkeys-collision">
              {collisionText}
            </div>
          </GroupBox>
        </div>
        <GroupBox title={t('dialog.settings.hotkeys.actions')} className="mfbe-hotkeys-actions">
          <button
            type="button"
            className="mfbe-button"
            disabled={!selected}
            onClick={() => void restoreDefault()}
            data-testid="settings-hotkeys-default"
          >
            {t('dialog.settings.hotkeys.default')}
          </button>
          <button
            type="button"
            className="mfbe-button"
            disabled={!selected || !currentChord}
            onClick={remove}
            data-testid="settings-hotkeys-delete"
          >
            {t('dialog.settings.hotkeys.delete')}
          </button>
          <button
            type="button"
            className="mfbe-button"
            disabled={!canAssign}
            onClick={assign}
            data-testid="settings-hotkeys-assign"
          >
            {t('dialog.settings.hotkeys.assign')}
          </button>
        </GroupBox>
      </div>

      <GroupBox title={t('dialog.settings.hotkeys.description')}>
        <div className="mfbe-hotkeys-description" data-testid="settings-hotkeys-description">
          {selected ? commandDescription(selected, t) : t('dialog.settings.hotkeys.noDescription')}
        </div>
      </GroupBox>
    </div>
  );
}
