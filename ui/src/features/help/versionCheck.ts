/**
 * Check for a new version (feature 002 FR-080 to FR-082; feature 003 US5, FR-040 to FR-045):
 * asks the core for the latest published release (the shell sends the editor's one network
 * request, decision D15), compares its version numbers with the running one's and, when it is
 * newer, offers its page in the system browser. Messages after the original's update check.
 *
 * Two callers share `fetchLatest()` and `promptNewer()`:
 *  - Help > Check for new version (`checkForNewVersion`): the three messages - newer, latest,
 *    "Can't connect to server";
 *  - the scheduled check at start-up (`runScheduledCheck`, App.tsx): due per `schedule.ts`, it
 *    announces only a newer release - once no modal dialog, file dialog or script run is
 *    active - and is silent on "latest" and on failure.
 * Both record the time of a check that got an answer as `session.lastVersionCheck`; a failed
 * check (no network, server unreachable, no answer within the shell's 15 seconds, unexpected
 * answer) records nothing, so the next start tries again.
 */

import type { Command, CommandContext } from '@/app/commands';
import type { FeatureContext } from '@/app/services';
import { isRunLocked, type AppStore } from '@/model/store';
import type { ReleaseInfo } from '@/rpc/types';

import { cmdKeys } from '../editing/common';
import { isDue, nextRecord } from './schedule';

/**
 * Compares two versions - SemVer 2.0.0's precedence on top of feature 002's lenient numbers
 * (feature 002 FR-080, amended by feature 006 FR-055, decision 13). Everything from the first
 * `+` is dropped, and the rest is split at its first `-` into the numbers and the pre-release.
 * The numbers compare part by part, split at `.`, a missing or non-numeric part counting as 0.
 * With equal numbers a version without a pre-release is newer (`0.0.6` > `0.0.6-rc`); two
 * pre-releases compare their `.`-separated identifiers from left to right - numerically when
 * both are digits only, otherwise by UTF-16 code units (plain `<`, never by locale), a
 * digits-only identifier sorting before any other (`rc.2` < `rc.10`, `1` < `alpha`) - and when
 * every compared identifier is equal, the shorter list is older (`rc` < `rc.0`). Otherwise the
 * two are equal, so a release rebuilt under the same version (the same numbers and pre-release,
 * any `+build`) is not newer. Negative when `a` is older than `b`, 0 when the two are equal,
 * positive when `a` is newer.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < Math.max(left.numbers.length, right.numbers.length); i++) {
    const order = compareValues(left.numbers[i] ?? 0, right.numbers[i] ?? 0);
    if (order !== 0) return order;
  }
  if (left.prerelease === null || right.prerelease === null) {
    // Equal numbers: the version without a pre-release is newer; two without one are equal.
    return (left.prerelease === null ? 1 : 0) - (right.prerelease === null ? 1 : 0);
  }
  for (let i = 0; i < Math.min(left.prerelease.length, right.prerelease.length); i++) {
    const order = compareIdentifiers(left.prerelease[i], right.prerelease[i]);
    if (order !== 0) return order;
  }
  return compareValues(left.prerelease.length, right.prerelease.length);
}

/** A version as `compareVersions` reads it. */
interface VersionParts {
  /** The dot-separated numbers; a non-numeric part is 0. */
  numbers: number[];
  /** The pre-release identifiers; null without a pre-release (an empty one counts as none). */
  prerelease: string[] | null;
}

function parseVersion(version: string): VersionParts {
  const build = version.indexOf('+');
  const precedence = build < 0 ? version : version.slice(0, build);
  const dash = precedence.indexOf('-');
  const numbers = dash < 0 ? precedence : precedence.slice(0, dash);
  const prerelease = dash < 0 ? '' : precedence.slice(dash + 1);
  return {
    numbers: numbers.split('.').map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isNaN(value) ? 0 : value;
    }),
    prerelease: prerelease === '' ? null : prerelease.split('.'),
  };
}

const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Two pre-release identifiers: digits-only ones by their value and before any other, the others
 * by UTF-16 code units.
 */
function compareIdentifiers(a: string, b: string): number {
  const aNumeric = DIGITS_ONLY.test(a);
  const bNumeric = DIGITS_ONLY.test(b);
  if (aNumeric && bNumeric) {
    // By value without a conversion, so that no length loses precision: without leading zeros
    // the longer one is the larger, and equal lengths compare digit by digit.
    const x = a.replace(/^0+/, '');
    const y = b.replace(/^0+/, '');
    return x.length !== y.length ? compareValues(x.length, y.length) : compareValues(x, y);
  }
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return compareValues(a, b);
}

/** -1, 0 or 1 by `<` - numbers by value, strings by UTF-16 code units. */
function compareValues<T extends number | string>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** What a check found: a newer release, the running version is the latest, or no answer. */
export type LatestOutcome =
  | { status: 'newer'; release: ReleaseInfo }
  | { status: 'latest'; release: ReleaseInfo }
  | { status: 'failed' };

/**
 * Records `at` as the time of the last check that got an answer (FR-041): in the store at
 * once and in the settings file through `settings.set`. A failed write is not reported - the
 * record only decides when the next automatic check runs.
 */
export async function recordCheck(ctx: CommandContext, at: Date): Promise<void> {
  const lastVersionCheck = at.toISOString();
  const settings = ctx.store.getState().settings;
  if (settings) {
    ctx.store.setState({
      settings: { ...settings, session: { ...settings.session, lastVersionCheck } },
    });
  }
  if (!ctx.rpc) return;
  try {
    await ctx.rpc.call('settings.set', { patch: { session: { lastVersionCheck } } });
  } catch {
    // the record is kept on a best-effort basis; the check itself has happened
  }
}

/**
 * Asks for the latest release and compares it with the running version. Any answer - newer
 * or latest - is recorded as the last check before this resolves; a failure is not.
 */
export async function fetchLatest(
  ctx: CommandContext,
  now: () => Date = () => new Date(),
): Promise<LatestOutcome> {
  if (!ctx.rpc) return { status: 'failed' };
  let release: ReleaseInfo;
  try {
    release = await ctx.rpc.call('app.latestRelease');
  } catch {
    // No network, server unreachable, no answer within 15 seconds or an unexpected one.
    return { status: 'failed' };
  }
  await recordCheck(ctx, now());
  return compareVersions(release.version, ctx.version) > 0
    ? { status: 'newer', release }
    : { status: 'latest', release };
}

/**
 * "A new version ... is available: <version>. Open its page?" - Yes opens the release's page
 * in the system browser (the shell opens new windows there, never inside the editor).
 */
export async function promptNewer(ctx: CommandContext, release: ReleaseInfo): Promise<void> {
  const answer = await ctx.dialogs.showMessage({
    text: ctx.t('msg.versionCheck.newVersion', { version: release.version }),
    caption: ctx.t('app.name'),
    buttons: 'yesNo',
    icon: 'question',
    testId: 'dialog-version-new',
  });
  if (answer === 'yes') window.open(release.url, '_blank', 'noopener');
}

/** Help > Check for new version: the three messages of the original's update check. */
export async function checkForNewVersion(ctx: CommandContext): Promise<void> {
  if (!ctx.rpc) return;
  const outcome = await fetchLatest(ctx);
  if (outcome.status === 'failed') {
    await ctx.dialogs.showMessage({
      text: ctx.t('msg.versionCheck.cantConnect'),
      caption: ctx.t('app.name'),
      icon: 'error',
      testId: 'dialog-version-cant-connect',
    });
    return;
  }
  if (outcome.status === 'newer') {
    await promptNewer(ctx, outcome.release);
    return;
  }
  await ctx.dialogs.showMessage({
    text: ctx.t('msg.versionCheck.latest'),
    caption: ctx.t('app.name'),
    icon: 'info',
    testId: 'dialog-version-latest',
  });
}

/* ------------------------------------------------------------------------ */
/* The scheduled check at start-up                                          */
/* ------------------------------------------------------------------------ */

/** What the notice of an automatic check must not appear on top of (FR-043). */
export interface QuietSources {
  /** The dialog stack: a modal dialog blocks the notice until it closes. */
  dialogs: { readonly isModalOpen: boolean; subscribe(listener: () => void): () => void };
  /** The RPC client: a platform file dialog waiting for its answer; null without a core. */
  rpc: {
    readonly fileDialogOpen: boolean;
    onFileDialog(listener: (open: boolean) => void): () => void;
  } | null;
  /** The store: the run lock (`runLock`, a script run or an AI request). */
  store: AppStore;
}

/**
 * Resolves as soon as no modal dialog, no file dialog and no run (a script, an AI request) is
 * active - at once when none is; otherwise when the last of them ends.
 */
export function whenQuiet(sources: QuietSources): Promise<void> {
  const quiet = () =>
    !sources.dialogs.isModalOpen &&
    !sources.rpc?.fileDialogOpen &&
    !isRunLocked(sources.store.getState());
  if (quiet()) return Promise.resolve();
  return new Promise((resolve) => {
    const offs: (() => void)[] = [];
    let settled = false;
    const check = () => {
      if (settled || !quiet()) return;
      settled = true;
      for (const off of offs) off();
      resolve();
    };
    offs.push(sources.dialogs.subscribe(check), sources.store.subscribe(check));
    if (sources.rpc) offs.push(sources.rpc.onFileDialog(check));
    check();
  });
}

export type ScheduledCheckResult = 'skipped' | 'newer' | 'latest' | 'failed';

/**
 * The scheduled check at start-up (FR-042, FR-043), called once the window is usable - the
 * settings read and the first document shown. A record later than now is first clamped to
 * now (recorded, so the next start sees it). When the schedule is due, the same single
 * request as Help > Check for new version goes out in the background; a newer release is
 * announced with the manual prompt once `sources` are quiet; "latest" records the check and
 * shows nothing; a failure shows nothing, records nothing and logs nothing - the next start
 * tries again.
 */
export async function runScheduledCheck(
  ctx: CommandContext,
  sources: QuietSources,
  now: () => Date = () => new Date(),
): Promise<ScheduledCheckResult> {
  const settings = ctx.store.getState().settings;
  if (!ctx.rpc || !settings) return 'skipped';
  const current = now();
  const recorded = settings.session.lastVersionCheck;
  const record = nextRecord(recorded, current);
  if (record !== recorded && record !== undefined) await recordCheck(ctx, new Date(record));
  if (!isDue(settings.other.versionCheck, record, current)) return 'skipped';
  const outcome = await fetchLatest(ctx, now);
  if (outcome.status !== 'newer') return outcome.status;
  await whenQuiet(sources);
  await promptNewer(ctx, outcome.release);
  return 'newer';
}

export function registerHelpFeature(ctx: FeatureContext): void {
  const command: Command = {
    id: 'help.checkVersion',
    group: 'help',
    ...cmdKeys('help.checkVersion', 'menu.help.checkVersion'),
    enabled: (commandCtx) =>
      commandCtx.rpc !== null && commandCtx.store.getState().connection === 'connected',
    // The Help menu stays available while a script runs (feature 003 FR-011): a check the user
    // asks for is the user's own choice.
    duringScriptRun: 'allowed',
    run: (commandCtx) => checkForNewVersion(commandCtx),
  };
  ctx.commands.replace(command);
}
