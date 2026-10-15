/**
 * A script's button on the Scripts toolbar (T105; feature 002 FR-063): the script's icon (or its
 * initial), its name and hotkey as the tooltip, enabled as its command. Which scripts the toolbar
 * shows is the user's layout (`useScriptToolbarButtons`, `app/Toolbars.tsx`).
 */

import { useTranslation } from 'react-i18next';

import { commandDescription, commandTooltip, scriptCommandId } from '@/app/commands';
import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { scriptIconUrl } from './icons';
import type { ScriptInfo } from './types';

export function ScriptToolbarButton({ script }: { script: ScriptInfo }) {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  useAppRevision();
  const commandId = scriptCommandId(script.id);
  const command = services.commands.get(commandId);
  if (!command) return null;
  const enabled = services.commands.isEnabled(commandId, ctx);
  const tooltip = commandTooltip(command, t);
  const hotkey = services.hotkeys.display(commandId);
  const icon = scriptIconUrl(script);
  return (
    <button
      type="button"
      className="mfbe-toolbar-button"
      data-testid={`scripts-toolbar-${script.id}`}
      data-command={commandId}
      title={hotkey ? `${tooltip} (${hotkey})` : tooltip}
      aria-label={tooltip}
      aria-description={commandDescription(command, t)}
      disabled={!enabled}
      onClick={() => void services.commands.execute(commandId, ctx)}
    >
      {icon ? (
        <img
          className="mfbe-script-toolbar-icon"
          src={icon}
          width={16}
          height={16}
          alt=""
          draggable={false}
        />
      ) : (
        <span className="mfbe-script-toolbar-glyph" aria-hidden="true">
          {tooltip.slice(0, 1)}
        </span>
      )}
    </button>
  );
}
