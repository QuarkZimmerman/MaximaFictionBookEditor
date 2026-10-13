/**
 * Toolbars row: the Commands toolbar (buttons exactly as the original `IDR_MAINFRAME TOOLBAR`,
 * with its 24 px icons), the Scripts toolbar, the Links bar and the Table bar. Each toolbar is
 * toggled from the View menu (store `toolbars.*`). Links/Table bar fields are placeholders until
 * T062 binds them to the selection.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppState } from '@/model/store';

import { useAppServices, useCommandContext, useAppRevision } from './services';
import { commandDescription, commandTooltip } from './commands';
import { LinksBar } from './LinksBar';
import { TableBar } from './TableBar';
import { COMMANDS_TOOLBAR, iconUrl } from './toolbarDefinitions';

export interface ToolbarButtonProps {
  commandId: string;
  size?: 16 | 24;
}

/** A command button with icon, tooltip (short name + hotkey), pressed and disabled states. */
export function ToolbarButton({ commandId, size = 24 }: ToolbarButtonProps) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const command = services.commands.get(commandId);
  if (!command) return null;
  const enabled = services.commands.isEnabled(commandId, ctx);
  const checked = services.commands.isChecked(commandId, ctx);
  const tooltip = commandTooltip(command, t);
  const hotkey = services.hotkeys.display(commandId);
  const title = hotkey ? `${tooltip} (${hotkey})` : tooltip;
  return (
    <button
      type="button"
      className={`mfbe-toolbar-button${checked ? ' mfbe-toolbar-button-pressed' : ''}`}
      data-testid={`toolbar-${commandId}`}
      data-command={commandId}
      title={title}
      aria-label={tooltip}
      aria-description={commandDescription(command, t)}
      aria-pressed={command.checked ? checked : undefined}
      disabled={!enabled}
      onClick={() => void services.commands.execute(commandId, ctx)}
    >
      {command.icon ? (
        <img
          src={iconUrl(command.icon, size)}
          width={size}
          height={size}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="mfbe-toolbar-button-text">{tooltip}</span>
      )}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mfbe-toolbar-separator" role="separator" aria-orientation="vertical" />;
}

export function CommandsToolbar() {
  const { t } = useTranslation();
  return (
    <div
      className="mfbe-toolbar mfbe-toolbar-commands"
      role="toolbar"
      aria-label={t('toolbar.commands')}
      data-testid="toolbar-commands"
    >
      {COMMANDS_TOOLBAR.map((id, index) =>
        id === null ? (
          <ToolbarSeparator key={`sep-${index}`} />
        ) : (
          <ToolbarButton key={id} commandId={id} />
        ),
      )}
    </div>
  );
}

/** Scripts toolbar: "Last script" plus one button per script with an icon (added by T105). */
export function ScriptsToolbar({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      className="mfbe-toolbar mfbe-toolbar-scripts"
      role="toolbar"
      aria-label={t('toolbar.scripts')}
      data-testid="toolbar-scripts"
    >
      <ToolbarButton commandId="scripts.last" size={16} />
      {children}
    </div>
  );
}

/** All toolbars, each shown according to the View menu toggles. */
export function Toolbars({ scripts }: { scripts?: ReactNode }) {
  const services = useAppServices();
  const toolbars = useAppState((s) => s.toolbars, services.store);
  if (!toolbars.commands && !toolbars.scripts && !toolbars.links && !toolbars.table) return null;
  return (
    <div className="mfbe-toolbars" data-testid="toolbars">
      {toolbars.commands ? <CommandsToolbar /> : null}
      {toolbars.scripts ? <ScriptsToolbar>{scripts}</ScriptsToolbar> : null}
      {toolbars.links ? <LinksBar /> : null}
      {toolbars.table ? <TableBar /> : null}
    </div>
  );
}
