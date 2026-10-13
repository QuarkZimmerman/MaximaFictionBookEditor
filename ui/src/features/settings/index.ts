/**
 * Settings feature registrar (US9, T129-T133) and the About dialog entry (T149).
 *
 * Replaces the `tools.settings` stub with the Settings dialog (View / Other / Hotkeys / Words
 * pages, OK / Cancel / Apply) and the foundation's message-box `help.about` with the About
 * dialog. Installs the settings runtime (`apply.ts`): Body CSS variables, run-time language
 * switch, session persistence and the hotkeys load/save.
 */

import { createElement } from 'react';

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { AboutDialog } from '@/dialogs/AboutDialog';
import { SettingsDialog } from '@/dialogs/SettingsDialog';

import { cmdKeys } from '../editing/common';

import { getSettingsFeature, registerSettingsRuntime, type SettingsFeature } from './apply';

export { getSettingsFeature, registerSettingsRuntime, SettingsFeature } from './apply';

const isConnected = (ctx: CommandContext): boolean =>
  ctx.rpc !== null && ctx.store.getState().connection === 'connected';

/** Opens the Settings dialog (modal); resolves when it closes. */
export async function openSettingsDialog(
  ctx: CommandContext,
  feature: SettingsFeature,
): Promise<void> {
  await feature.attach(ctx.rpc);
  await ctx.dialogs.openCustom<void>((close) =>
    createElement(SettingsDialog, { ctx, feature, onClose: () => close() }),
  );
}

/** Opens the About dialog (modal); resolves when it closes. */
export async function openAboutDialog(ctx: CommandContext): Promise<void> {
  await ctx.dialogs.openCustom<void>((close) =>
    createElement(AboutDialog, { ctx, onClose: () => close() }),
  );
}

export function registerSettingsFeature(ctx: FeatureContext): void {
  const feature = registerSettingsRuntime(ctx);

  const settings: Command = {
    id: 'tools.settings',
    group: 'tools',
    ...cmdKeys('tools.settings', 'menu.tools.settings'),
    icon: 'id_view_options',
    enabled: isConnected,
    run: (commandCtx) => openSettingsDialog(commandCtx, feature),
  };
  const about: Command = {
    id: 'help.about',
    group: 'help',
    ...cmdKeys('help.about', 'menu.help.about'),
    run: async (commandCtx) => {
      // Attaching here is harmless and lets a core with `hotkeys.get` deliver the user bindings
      // even before App.tsx wires `attach()` on connect.
      void getSettingsFeature(commandCtx.store)?.attach(commandCtx.rpc);
      await openAboutDialog(commandCtx);
    },
  };
  ctx.commands.replace(settings);
  ctx.commands.replace(about);
}
