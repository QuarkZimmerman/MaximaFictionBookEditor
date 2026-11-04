/**
 * The backup side of a save (feature 009, User Story 1): whether a save asks the core to keep
 * the replaced file as `<file>.bak`, and the status line it leaves. Shared by the File commands
 * and the commands' own Save path; kept apart from both so neither imports the other.
 */
import type { TFunction } from 'i18next';

import type { AppStore } from '@/model/store';
import type { SaveResult } from '@/rpc/types';

/**
 * Whether saves keep the replaced file as `<file>.bak` (feature 009, FR-006): on unless
 * Settings > Other turned it off; every way of saving sends it (FR-003).
 */
export function keepsBackup(store: AppStore): boolean {
  return store.getState().settings?.other.keepBackup !== false;
}

/**
 * The status line after a save: a backup that was wanted but could not be made comes first
 * (FR-005, D4), else the validation summary as before.
 */
export function savedMessage(t: TFunction, result: SaveResult): string {
  if (result.backup && !result.backup.kept && result.backup.reason) {
    return t('status.savedBackupNotKept', { reason: result.backup.reason });
  }
  return result.validation.errorCount === 0
    ? t('status.savedNoErrors')
    : t('msg.errorsFound', { count: result.validation.errorCount });
}
