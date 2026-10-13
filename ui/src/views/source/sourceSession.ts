/**
 * Source view session - compatibility façade. The implementation moved to `sync.ts` (T081:
 * serialise on enter, parse on leave with the nodeId remap, blocked-switch message, dirty
 * tracking); this module keeps the import paths used by the file feature, the dialogs and the
 * application services.
 */

export {
  applyRemap,
  commitPendingSource,
  isSourceTextDirty,
  isValidationFresh,
  loadSourceText,
  onSourceSessionReset,
  registerViewCommands,
  remapCaret,
  requestViewSwitch,
  resetSourceSession,
  setCaretWhenReady,
  setSourceOnlyText,
  sourceSession,
  trackValidationFreshness,
  updateSourceText,
} from './sync';
export type { CommitResult, RemapTable, SourceSession } from './sync';
