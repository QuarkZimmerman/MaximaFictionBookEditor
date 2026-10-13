/**
 * Scripts toolbar buttons (T105): one button per menu script that ships an icon, in menu
 * order, next to the built-in "Last script" button of the Scripts toolbar container
 * (`app/Toolbars.tsx`). Mounting (App.tsx): `<Toolbars scripts={<ScriptsToolbar />} />`.
 */

import { useTranslation } from 'react-i18next';

import { commandDescription, commandTooltip, scriptCommandId } from '@/app/commands';
import { useAppRevision, useAppServices, useCommandContext } from '@/app/services';
import { scriptIconUrl } from './icons';
import { useScriptsFeature, useScriptsRevision } from './ScriptsMenu';
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

/** The dynamic part of the Scripts toolbar. */
export function ScriptsToolbar() {
  const feature = useScriptsFeature();
  useScriptsRevision(feature);
  if (!feature) return null;
  const scripts = feature.toolbarScripts();
  if (scripts.length === 0) return null;
  return (
    <span className="mfbe-scripts-toolbar-items" data-testid="scripts-toolbar-items">
      {scripts.map((script) => (
        <ScriptToolbarButton key={script.id} script={script} />
      ))}
    </span>
  );
}
