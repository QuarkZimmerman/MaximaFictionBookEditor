/**
 * Help > Check for new version (feature 002 FR-080 to FR-082): asks the core for the latest
 * published release (the shell sends the editor's one network request, decision D15), compares
 * its version numbers with the running one's and, when it is newer, offers its page in the
 * system browser. Never runs on its own. Messages after the original's update check.
 */

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import type { ReleaseInfo } from '@/rpc/types';

import { cmdKeys } from '../editing/common';

/**
 * Compares two versions by their dot-separated numbers; missing or non-numeric parts count as
 * 0, so a release rebuilt under the same number is not newer. Negative, 0 or positive.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version.split('.').map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isNaN(value) ? 0 : value;
    });
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function checkForNewVersion(ctx: CommandContext): Promise<void> {
  if (!ctx.rpc) return;
  let release: ReleaseInfo;
  try {
    release = await ctx.rpc.call('app.latestRelease');
  } catch {
    // No network, server unreachable, no answer within 15 seconds or an unexpected one.
    await ctx.dialogs.showMessage({
      text: ctx.t('msg.versionCheck.cantConnect'),
      caption: ctx.t('app.name'),
      icon: 'error',
      testId: 'dialog-version-cant-connect',
    });
    return;
  }
  if (compareVersions(release.version, ctx.version) > 0) {
    const answer = await ctx.dialogs.showMessage({
      text: ctx.t('msg.versionCheck.newVersion', { version: release.version }),
      caption: ctx.t('app.name'),
      buttons: 'yesNo',
      icon: 'question',
      testId: 'dialog-version-new',
    });
    // The shell opens new windows in the system browser, never inside the editor.
    if (answer === 'yes') window.open(release.url, '_blank', 'noopener');
    return;
  }
  await ctx.dialogs.showMessage({
    text: ctx.t('msg.versionCheck.latest'),
    caption: ctx.t('app.name'),
    icon: 'info',
    testId: 'dialog-version-latest',
  });
}

export function registerHelpFeature(ctx: FeatureContext): void {
  const command: Command = {
    id: 'help.checkVersion',
    group: 'help',
    ...cmdKeys('help.checkVersion', 'menu.help.checkVersion'),
    enabled: (commandCtx) =>
      commandCtx.rpc !== null && commandCtx.store.getState().connection === 'connected',
    run: (commandCtx) => checkForNewVersion(commandCtx),
  };
  ctx.commands.replace(command);
}
