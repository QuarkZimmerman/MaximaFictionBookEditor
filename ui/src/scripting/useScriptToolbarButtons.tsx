/**
 * The scripts the Scripts toolbar can show (T105; feature 002 FR-063): every menu script that
 * ships an icon, known to the toolbar (`app/Toolbars.tsx`) by the script's command id, which
 * the user puts on it through its Customize dialog. Mounting (App.tsx):
 * `<Toolbars scripts={useScriptToolbarButtons()} />`.
 */

import { useMemo } from 'react';

import { scriptCommandId } from '@/app/commands';
import type { ScriptToolbarButtons } from '@/app/Toolbars';

import { useScriptsFeature, useScriptsRevision } from './ScriptsMenu';
import { ScriptToolbarButton } from './ScriptsToolbar';

/** The scripts the Scripts toolbar can show and their buttons, following the catalogue. */
export function useScriptToolbarButtons(): ScriptToolbarButtons {
  const feature = useScriptsFeature();
  const revision = useScriptsRevision(feature);
  return useMemo(
    () => {
      const scripts = new Map(
        (feature?.toolbarScripts() ?? []).map((script) => [scriptCommandId(script.id), script]),
      );
      return {
        commandIds: [...scripts.keys()],
        render: (commandId: string) => {
          const script = scripts.get(commandId);
          return script ? <ScriptToolbarButton script={script} /> : null;
        },
      };
    },
    // The revision is the input that changes the catalogue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feature, revision],
  );
}
