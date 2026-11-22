/**
 * Feature 019 (T036, T045, T050, T053, T057): modal Batch Converter dialog.
 *
 * Strictly modal: while scanning, converting, or cancelling, every non-Cancel control is disabled
 * and `canClose()` returns `false` (blocking Escape, the title-bar close box, and host-level
 * dismissal). Session-only memory restores non-destructive choices on reopen while ALWAYS starting
 * `overwrite` unchecked.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import { getSettingsFeature, openSettingsDialog } from '@/features/settings';
import { actions } from '@/model/store';
import type { Settings } from '@/rpc/types';

import {
  canRunParallel,
  computeMaxWorkers,
  createInitialBatchConfig,
  effectiveWorkerCount,
  isZipOutputSupported,
  reduceBatchConfig,
  validateBatchConfig,
  zipOverrideKey,
  type BatchConfigAction,
} from './engine/configState';
import { formatActiveExportSummary } from './engine/exportSummary';
import { defaultReportFilename, formatBatchReportText } from './engine/reportFormat';
import { mapBatchError, startBatchRun, type BatchRunController } from './engine/scheduler';
import {
  BATCH_BOOK_FORMATS,
  type BatchBookFormat,
  type BatchJobConfig,
  type BatchProgressSnapshot,
  type BatchReport,
} from './engine/types';
import { getBatchSessionMemory, saveBatchSessionMemory } from './sessionState';

import './BatchConverterDialog.css';

export interface BatchConverterDialogProps {
  ctx: CommandContext;
  cpuCores: number;
  initialSettings: Settings | null;
  canCloseRef: MutableRefObject<boolean>;
  onClose: () => void;
}

type IssueFilter = 'all' | 'failed' | 'skipped';

const INITIAL_PROGRESS: BatchProgressSnapshot = {
  phase: 'idle',
  scannedCount: 0,
  totalCount: 0,
  completedCount: 0,
  convertedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  activeWorkers: [],
};

export function BatchConverterDialog({
  ctx,
  cpuCores,
  initialSettings,
  canCloseRef,
  onClose,
}: BatchConverterDialogProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings | null>(initialSettings);
  const [pdfCustomFontName, setPdfCustomFontName] = useState<string | undefined>(undefined);

  const initialMemory = useMemo(() => getBatchSessionMemory(), []);
  const zipOverridesRef = useRef<Partial<Record<string, boolean>>>({
    ...(initialMemory?.zipOverrides ?? {}),
  });

  const [config, setConfig] = useState<BatchJobConfig>(() =>
    createInitialBatchConfig(cpuCores, initialSettings, initialMemory),
  );
  const [progress, setProgress] = useState<BatchProgressSnapshot>(INITIAL_PROGRESS);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [reportFilter, setReportFilter] = useState<IssueFilter>('all');
  const [reportSaveNotice, setReportSaveNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const runRef = useRef<BatchRunController | null>(null);
  const running =
    progress.phase === 'scanning' ||
    progress.phase === 'converting' ||
    progress.phase === 'cancelling';

  // Keep host-level and Dialog-level close guard strictly synchronized with running state.
  canCloseRef.current = !running;

  // Persist non-destructive configuration choices in session-only memory whenever config changes.
  useEffect(() => {
    saveBatchSessionMemory(config, zipOverridesRef.current);
  }, [config]);

  // Cancel any in-flight batch run defensively on unmount so zero workers/temp dirs linger.
  useEffect(() => {
    return () => {
      runRef.current?.cancel();
      runRef.current = null;
      canCloseRef.current = true;
    };
  }, [canCloseRef]);

  // Resolve custom added PDF font display name when active font is a hash id.
  useEffect(() => {
    const fontId = settings?.pdf?.textFont ?? 'noto-serif';
    if (!ctx.rpc || !/^[0-9a-f]{64}(-\d+)?$/.test(fontId)) {
      setPdfCustomFontName(undefined);
      return;
    }
    let cancelled = false;
    ctx.rpc
      .call('pdf.fonts.list', {})
      .then((list) => {
        if (cancelled) return;
        const found = list.added.find((f) => f.id === fontId);
        setPdfCustomFontName(found?.name);
      })
      .catch(() => {
        if (!cancelled) setPdfCustomFontName(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.rpc, settings?.pdf?.textFont]);

  const dispatch = useCallback(
    (action: BatchConfigAction, overrideSettings?: Settings | null) => {
      const effectiveSettings = overrideSettings !== undefined ? overrideSettings : settings;
      setValidationError(null);
      if (action.type === 'setZipOutput') {
        const key = zipOverrideKey(config.direction, config.exportFormat);
        zipOverridesRef.current = { ...zipOverridesRef.current, [key]: action.checked };
      }
      setConfig((prev) =>
        reduceBatchConfig(prev, action, cpuCores, effectiveSettings, zipOverridesRef.current),
      );
    },
    [config.direction, config.exportFormat, cpuCores, settings],
  );

  const handleBrowse = async (kind: 'source' | 'destination') => {
    if (!ctx.rpc || running) return;
    const hint = kind === 'source' ? config.sourceDir.trim() : config.destinationDir.trim();
    const title = t(
      kind === 'source' ? 'batch.paths.browseSourceTitle' : 'batch.paths.browseDestinationTitle',
    );
    try {
      const answer = await ctx.rpc.call('dialog.pickFolder', {
        title,
        ...(hint ? { folder: hint } : {}),
      });
      if (answer.path) {
        dispatch(
          kind === 'source'
            ? { type: 'setSourceDir', path: answer.path }
            : { type: 'setDestinationDir', path: answer.path },
        );
      }
    } catch {
      // Dialog unavailable or cancelled; leave current path untouched.
    }
  };

  const handleOpenExportSettings = async () => {
    if (!ctx.rpc || running) return;
    const settingsFeature = getSettingsFeature(ctx.store);
    if (!settingsFeature) return;
    const key = zipOverrideKey('fb2ToExport', config.exportFormat);
    await openSettingsDialog(ctx, settingsFeature, {
      initialPage: 'exports',
      initialExportFormat: config.exportFormat,
    });
    // Reload active settings from core/store so the summary and ZIP default reflect any changes.
    try {
      const fresh = await ctx.rpc.call('settings.get');
      actions.setSettings(ctx.store, fresh);
      setSettings(fresh);
      // Clear manual zip override for this format so newly changed Settings -> Exports ZIP default applies.
      const nextOverrides = { ...zipOverridesRef.current };
      delete nextOverrides[key];
      zipOverridesRef.current = nextOverrides;
      dispatch({ type: 'syncExportSettings' }, fresh);
    } catch {
      const latest = ctx.store.getState().settings;
      if (latest) {
        setSettings(latest);
        dispatch({ type: 'syncExportSettings' }, latest);
      }
    }
  };

  const handleStart = async () => {
    if (running || !ctx.rpc) return;
    const errorKey = validateBatchConfig(config);
    if (errorKey) {
      setValidationError(t(errorKey));
      return;
    }
    setValidationError(null);
    setReport(null);
    setReportSaveNotice(null);
    setReportFilter('all');

    const latestSettings = ctx.store.getState().settings ?? settings;
    const openDocId = ctx.store.getState().docId ?? undefined;

    const controller = startBatchRun({
      ctx,
      config,
      settings: latestSettings,
      cpuCores,
      openDocId,
      onProgress: (snap) => setProgress(snap),
    });
    runRef.current = controller;

    try {
      const outcome = await controller.promise;
      runRef.current = null;
      if (outcome === null) {
        // Cancelled during initial scan -> return cleanly to editable form.
        setProgress(INITIAL_PROGRESS);
      } else {
        setReport(outcome);
      }
    } catch (error) {
      runRef.current = null;
      setProgress(INITIAL_PROGRESS);
      setValidationError(mapBatchError(error, t));
    }
  };

  const handleCancel = () => {
    if (runRef.current) {
      runRef.current.cancel();
    }
  };

  const handleSaveReport = async () => {
    if (!ctx.rpc || !report || running) return;
    setReportSaveNotice(null);
    try {
      const chosen = await ctx.rpc.call('dialog.saveFile', {
        title: t('batch.report.saveTitle'),
        defaultPath: defaultReportFilename(),
        filters: [
          { name: t('batch.report.saveFilterText'), extensions: ['txt'] },
          { name: t('batch.report.saveFilterAll'), extensions: ['*'] },
        ],
        selectedFilter: 0,
      });
      if (!chosen.path) return;
      const content = formatBatchReportText(
        report,
        effectiveWorkerCount(report.config, cpuCores),
        t,
      );
      try {
        const written = await ctx.rpc.call('batch.writeReport', {
          path: chosen.path,
          content,
        });
        setReportSaveNotice({
          kind: 'ok',
          text: t('batch.report.savedMessage', { path: written.path }),
        });
      } catch (writeErr) {
        setReportSaveNotice({
          kind: 'error',
          text: t('batch.report.saveFailed', {
            path: chosen.path,
            reason: mapBatchError(writeErr, t),
          }),
        });
      }
    } catch (dialogErr) {
      setReportSaveNotice({
        kind: 'error',
        text: mapBatchError(dialogErr, t),
      });
    }
  };

  const handleNewBatch = () => {
    if (running) return;
    setReport(null);
    setReportSaveNotice(null);
    setProgress(INITIAL_PROGRESS);
    setValidationError(null);
  };

  const maxWorkers = computeMaxWorkers(cpuCores);
  const parallelSupported = canRunParallel(cpuCores);
  const zipSupported = isZipOutputSupported(config.direction, config.exportFormat);
  const keepTreeEnabled = !running && config.includeSubfolders && !config.inPlace;

  const activeExportSummary = useMemo(
    () =>
      formatActiveExportSummary(
        config.exportFormat,
        settings,
        config.zipOutput,
        t,
        pdfCustomFontName,
      ),
    [config.exportFormat, config.zipOutput, pdfCustomFontName, settings, t],
  );

  // Dialog footer buttons strictly enforce FR-015 (only Cancel enabled while running).
  const buttons: DialogButton[] = useMemo(() => {
    if (running) {
      return [
        {
          id: 'cancel',
          label:
            progress.phase === 'cancelling'
              ? t('batch.actions.cancelling')
              : t('batch.actions.cancel'),
          disabled: progress.phase === 'cancelling',
          title: t('batch.tips.cancel'),
          onClick: handleCancel,
        },
      ];
    }
    if (report) {
      const list: DialogButton[] = [
        {
          id: 'save-report',
          label: t('batch.actions.saveReport'),
          title: t('batch.tips.saveReport'),
          onClick: () => void handleSaveReport(),
        },
        {
          id: 'run-again',
          label: t('batch.actions.runAgain'),
          onClick: handleNewBatch,
        },
        {
          id: 'close',
          label: t('batch.actions.close'),
          title: t('batch.tips.close'),
          onClick: onClose,
        },
      ];
      return list;
    }
    return [
      {
        id: 'start',
        label: t('batch.actions.start'),
        title: t('batch.tips.start'),
        onClick: () => void handleStart(),
      },
      {
        id: 'close',
        label: t('batch.actions.close'),
        title: t('batch.tips.close'),
        onClick: onClose,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, progress.phase, report, config, settings, t]);

  const overallPercent =
    progress.totalCount > 0
      ? Math.min(100, Math.round((progress.completedCount / progress.totalCount) * 100))
      : 0;

  const visibleIssues = useMemo(() => {
    if (!report) return [];
    const failedItems = report.failed.map((entry) => ({ kind: 'failed' as const, entry }));
    const skippedItems = report.skipped.map((entry) => ({ kind: 'skipped' as const, entry }));
    if (reportFilter === 'failed') return failedItems;
    if (reportFilter === 'skipped') return skippedItems;
    return [...failedItems, ...skippedItems];
  }, [report, reportFilter]);

  const totalIssueCount = (report?.failed.length ?? 0) + (report?.skipped.length ?? 0);

  return (
    <Dialog
      title={t('batch.title')}
      buttons={buttons}
      defaultButtonId={running ? null : report ? 'close' : 'start'}
      cancelButtonId={running ? undefined : 'close'}
      canClose={() => !running}
      testId="dialog-batch-converter"
      className="mfbe-batch-dialog"
      closeLabel={t('batch.actions.close')}
    >
      {!running && !report ? (
        <div className="mfbe-batch-form" data-testid="batch-config-view">
          {validationError ? (
            <div className="mfbe-batch-error" role="alert" data-testid="batch-validation-error">
              {validationError}
            </div>
          ) : null}

          <fieldset className="mfbe-batch-fieldset">
            <legend>{t('batch.direction.group')}</legend>
            <div className="mfbe-batch-radio-row" {...tip(t('batch.tips.direction'))}>
              <label className="mfbe-batch-radio">
                <input
                  type="radio"
                  name="batch-direction"
                  checked={config.direction === 'fb2ToExport'}
                  disabled={running}
                  data-testid="batch-dir-export"
                  onChange={() => dispatch({ type: 'setDirection', direction: 'fb2ToExport' })}
                />
                <span>{t('batch.direction.fb2ToExport')}</span>
              </label>
              <label className="mfbe-batch-radio">
                <input
                  type="radio"
                  name="batch-direction"
                  checked={config.direction === 'importToFb2'}
                  disabled={running}
                  data-testid="batch-dir-import"
                  onChange={() => dispatch({ type: 'setDirection', direction: 'importToFb2' })}
                />
                <span>{t('batch.direction.importToFb2')}</span>
              </label>
            </div>

            {config.direction === 'fb2ToExport' ? (
              <>
                <div className="mfbe-batch-row">
                  <label className="mfbe-batch-label" htmlFor="batch-target-format">
                    {t('batch.export.targetFormat')}
                  </label>
                  <select
                    id="batch-target-format"
                    className="mfbe-batch-select"
                    data-testid="batch-export-format"
                    value={config.exportFormat}
                    disabled={running}
                    onChange={(event) =>
                      dispatch({
                        type: 'setExportFormat',
                        format: event.target.value as BatchBookFormat,
                      })
                    }
                    {...tip(t('batch.tips.targetFormat'))}
                  >
                    {BATCH_BOOK_FORMATS.map((fmt) => (
                      <option key={fmt} value={fmt}>
                        {t(`exports.settings.formats.${fmt}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mfbe-batch-defaults-bar" data-testid="batch-export-defaults">
                  <span className="mfbe-batch-defaults-text">
                    <strong>{t('batch.export.activeSettings')}</strong> {activeExportSummary}
                  </span>
                  <button
                    type="button"
                    className="mfbe-button"
                    data-testid="batch-export-settings-btn"
                    disabled={running}
                    onClick={() => void handleOpenExportSettings()}
                    {...tip(t('batch.tips.exportSettings'))}
                  >
                    {t('batch.export.settingsButton')}
                  </button>
                </div>
              </>
            ) : (
              <div data-testid="batch-import-formats-panel">
                <label className="mfbe-batch-check" {...tip(t('batch.tips.importAll'))}>
                  <input
                    type="checkbox"
                    checked={config.importAll}
                    disabled={running}
                    data-testid="batch-import-all"
                    onChange={(event) =>
                      dispatch({ type: 'setImportAll', checked: event.target.checked })
                    }
                  />
                  <span>{t('batch.import.allFormats')}</span>
                </label>
                <div className="mfbe-batch-formats-grid">
                  {BATCH_BOOK_FORMATS.map((fmt) => (
                    <label key={fmt} className="mfbe-batch-check">
                      <input
                        type="checkbox"
                        checked={config.importFormats[fmt]}
                        disabled={running}
                        data-testid={`batch-import-fmt-${fmt}`}
                        onChange={(event) =>
                          dispatch({
                            type: 'setImportFormat',
                            format: fmt,
                            checked: event.target.checked,
                          })
                        }
                      />
                      <span>{t(`exports.settings.formats.${fmt}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </fieldset>

          <fieldset className="mfbe-batch-fieldset">
            <legend>{t('batch.paths.sourceGroup')}</legend>
            <div className="mfbe-batch-row">
              <label className="mfbe-batch-label" htmlFor="batch-source-dir">
                {t('batch.paths.sourceLabel')}
              </label>
              <input
                id="batch-source-dir"
                type="text"
                className="mfbe-batch-path-input"
                data-testid="batch-source-input"
                value={config.sourceDir}
                placeholder={t('batch.paths.sourcePlaceholder')}
                disabled={running}
                onChange={(event) =>
                  dispatch({ type: 'setSourceDir', path: event.target.value })
                }
                {...tip(t('batch.tips.sourceDir'))}
              />
              <button
                type="button"
                className="mfbe-button"
                data-testid="batch-source-browse"
                disabled={running}
                onClick={() => void handleBrowse('source')}
                {...tip(t('batch.tips.browseSource'))}
              >
                {t('batch.paths.browse')}
              </button>
            </div>
            <label className="mfbe-batch-check" {...tip(t('batch.tips.includeSubfolders'))}>
              <input
                type="checkbox"
                checked={config.includeSubfolders}
                disabled={running}
                data-testid="batch-include-subfolders"
                onChange={(event) =>
                  dispatch({ type: 'setIncludeSubfolders', checked: event.target.checked })
                }
              />
              <span>{t('batch.paths.includeSubfolders')}</span>
            </label>
          </fieldset>

          <fieldset className="mfbe-batch-fieldset">
            <legend>{t('batch.paths.destinationGroup')}</legend>
            <label className="mfbe-batch-check" {...tip(t('batch.tips.inPlace'))}>
              <input
                type="checkbox"
                checked={config.inPlace}
                disabled={running}
                data-testid="batch-in-place"
                onChange={(event) =>
                  dispatch({ type: 'setInPlace', checked: event.target.checked })
                }
              />
              <span>{t('batch.paths.inPlace')}</span>
            </label>
            <div className="mfbe-batch-row">
              <label className="mfbe-batch-label" htmlFor="batch-destination-dir">
                {t('batch.paths.destinationLabel')}
              </label>
              <input
                id="batch-destination-dir"
                type="text"
                className="mfbe-batch-path-input"
                data-testid="batch-destination-input"
                value={config.destinationDir}
                placeholder={t('batch.paths.destinationPlaceholder')}
                disabled={running || config.inPlace}
                onChange={(event) =>
                  dispatch({ type: 'setDestinationDir', path: event.target.value })
                }
                {...tip(t('batch.tips.destinationDir'))}
              />
              <button
                type="button"
                className="mfbe-button"
                data-testid="batch-destination-browse"
                disabled={running || config.inPlace}
                onClick={() => void handleBrowse('destination')}
                {...tip(t('batch.tips.browseDestination'))}
              >
                {t('batch.paths.browse')}
              </button>
            </div>
            <label
              className={`mfbe-batch-check${!keepTreeEnabled ? ' disabled' : ''}`}
              {...tip(t('batch.tips.keepTree'))}
            >
              <input
                type="checkbox"
                checked={config.keepTree}
                disabled={!keepTreeEnabled}
                data-testid="batch-keep-tree"
                onChange={(event) =>
                  dispatch({ type: 'setKeepTree', checked: event.target.checked })
                }
              />
              <span>{t('batch.paths.keepTree')}</span>
            </label>
          </fieldset>

          <fieldset className="mfbe-batch-fieldset">
            <legend>{t('batch.options.group')}</legend>
            <div className="mfbe-batch-row">
              <label
                className={`mfbe-batch-check${!zipSupported ? ' disabled' : ''}`}
                {...tip(t('batch.tips.zipOutput'))}
              >
                <input
                  type="checkbox"
                  checked={config.zipOutput}
                  disabled={running || !zipSupported}
                  data-testid="batch-zip-output"
                  onChange={(event) =>
                    dispatch({ type: 'setZipOutput', checked: event.target.checked })
                  }
                />
                <span>{t('batch.options.zipOutput')}</span>
              </label>
              {!zipSupported ? (
                <span className="mfbe-batch-note">{t('batch.options.zipEpubNote')}</span>
              ) : null}
            </div>

            <label className="mfbe-batch-check" {...tip(t('batch.tips.overwrite'))}>
              <input
                type="checkbox"
                checked={config.overwrite}
                disabled={running}
                data-testid="batch-overwrite"
                onChange={(event) =>
                  dispatch({ type: 'setOverwrite', checked: event.target.checked })
                }
              />
              <span>{t('batch.options.overwrite')}</span>
            </label>

            <div className="mfbe-batch-row">
              <label
                className={`mfbe-batch-check${!parallelSupported ? ' disabled' : ''}`}
                {...tip(t('batch.tips.parallel'))}
              >
                <input
                  type="checkbox"
                  checked={config.parallel}
                  disabled={running || !parallelSupported}
                  data-testid="batch-parallel"
                  onChange={(event) =>
                    dispatch({ type: 'setParallel', checked: event.target.checked })
                  }
                />
                <span>{t('batch.options.parallel')}</span>
              </label>
              {parallelSupported ? (
                <>
                  <label htmlFor="batch-worker-count">{t('batch.options.workersLabel')}</label>
                  <input
                    id="batch-worker-count"
                    type="number"
                    className="mfbe-batch-workers-input"
                    data-testid="batch-worker-count"
                    min={2}
                    max={maxWorkers}
                    step={1}
                    value={config.workerCount}
                    disabled={running || !config.parallel}
                    onChange={(event) =>
                      dispatch({
                        type: 'setWorkerCount',
                        count: Number.parseInt(event.target.value, 10) || 2,
                      })
                    }
                    {...tip(t('batch.tips.workerCount'))}
                  />
                  <span className="mfbe-batch-note">
                    {t('batch.options.workersMaxNote', { max: maxWorkers })}
                  </span>
                </>
              ) : (
                <span className="mfbe-batch-note" data-testid="batch-single-core-note">
                  {t('batch.options.singleCoreNote')}
                </span>
              )}
            </div>
          </fieldset>
        </div>
      ) : null}

      {running ? (
        <div className="mfbe-batch-progress" data-testid="batch-progress-view">
          <div className="mfbe-batch-progress-block">
            <div className="mfbe-batch-progress-header">
              <span data-testid="batch-overall-label">
                {progress.phase === 'scanning'
                  ? t('batch.progress.scanning', { count: progress.scannedCount })
                  : progress.phase === 'cancelling'
                    ? t('batch.progress.cancellingStatus', {
                        completed: progress.completedCount,
                        total: progress.totalCount,
                      })
                    : t('batch.progress.overall', {
                        completed: progress.completedCount,
                        total: progress.totalCount,
                        percent: overallPercent,
                      })}
              </span>
            </div>
            {progress.phase === 'scanning' ? (
              <progress className="mfbe-batch-bar" data-testid="batch-overall-progress" />
            ) : (
              <progress
                className="mfbe-batch-bar"
                data-testid="batch-overall-progress"
                value={progress.completedCount}
                max={Math.max(1, progress.totalCount)}
              />
            )}
            {progress.phase !== 'scanning' ? (
              <div className="mfbe-batch-progress-counts" data-testid="batch-live-counts">
                {t('batch.progress.counts', {
                  converted: progress.convertedCount,
                  skipped: progress.skippedCount,
                  failed: progress.failedCount,
                })}
              </div>
            ) : null}
          </div>

          {progress.phase !== 'scanning' ? (
            <div className="mfbe-batch-progress-block">
              <span>{t('batch.progress.activeFiles')}</span>
              <div className="mfbe-batch-workers-list" data-testid="batch-workers-list">
                {progress.activeWorkers.map((worker) => (
                  <div
                    key={worker.slot}
                    className="mfbe-batch-worker-row"
                    data-testid={`batch-worker-row-${worker.slot}`}
                  >
                    <div className="mfbe-batch-worker-meta">
                      <span className="mfbe-batch-worker-file" title={worker.displayPath}>
                        {worker.displayPath}
                      </span>
                      <span className="mfbe-batch-worker-stage">{worker.stage}</span>
                    </div>
                    {worker.total > 0 ? (
                      <progress
                        className="mfbe-batch-worker-bar"
                        value={worker.done}
                        max={worker.total}
                      />
                    ) : (
                      <progress className="mfbe-batch-worker-bar" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {!running && report ? (
        <div className="mfbe-batch-report" data-testid="batch-report-view">
          <h3 className="mfbe-batch-report-heading" data-testid="batch-report-heading">
            {report.counts.total === 0
              ? t('batch.report.headingEmpty')
              : report.cancelled
                ? t('batch.report.headingCancelled')
                : t('batch.report.headingCompleted')}
          </h3>

          {report.counts.total === 0 ? (
            <div className="mfbe-batch-info" data-testid="batch-empty-notice">
              {t('batch.report.emptyMessage')}
            </div>
          ) : (
            <>
              <div className="mfbe-batch-summary-pills" data-testid="batch-report-summary">
                <span className="mfbe-batch-pill" data-testid="batch-count-total">
                  {t('batch.report.summaryTotal', { count: report.counts.total })}
                </span>
                <span className="mfbe-batch-pill" data-testid="batch-count-converted">
                  {t('batch.report.summaryConverted', { count: report.counts.converted })}
                </span>
                <span className="mfbe-batch-pill" data-testid="batch-count-skipped">
                  {t('batch.report.summarySkipped', { count: report.counts.skipped })}
                </span>
                <span className="mfbe-batch-pill" data-testid="batch-count-failed">
                  {t('batch.report.summaryFailed', { count: report.counts.failed })}
                </span>
                {report.counts.cancelled > 0 ? (
                  <span className="mfbe-batch-pill" data-testid="batch-count-cancelled">
                    {t('batch.report.summaryCancelled', { count: report.counts.cancelled })}
                  </span>
                ) : null}
              </div>

              {totalIssueCount === 0 ? (
                <div className="mfbe-batch-info" data-testid="batch-no-issues">
                  {t('batch.report.noIssues')}
                </div>
              ) : (
                <>
                  <div className="mfbe-batch-filter-bar" role="group">
                    <button
                      type="button"
                      className="mfbe-batch-filter-btn"
                      aria-pressed={reportFilter === 'all'}
                      data-testid="batch-filter-all"
                      onClick={() => setReportFilter('all')}
                    >
                      {t('batch.report.filterAll', { count: totalIssueCount })}
                    </button>
                    <button
                      type="button"
                      className="mfbe-batch-filter-btn"
                      aria-pressed={reportFilter === 'failed'}
                      data-testid="batch-filter-failed"
                      onClick={() => setReportFilter('failed')}
                    >
                      {t('batch.report.filterFailed', { count: report.failed.length })}
                    </button>
                    <button
                      type="button"
                      className="mfbe-batch-filter-btn"
                      aria-pressed={reportFilter === 'skipped'}
                      data-testid="batch-filter-skipped"
                      onClick={() => setReportFilter('skipped')}
                    >
                      {t('batch.report.filterSkipped', { count: report.skipped.length })}
                    </button>
                  </div>

                  {visibleIssues.length === 0 ? (
                    <div className="mfbe-batch-info">{t('batch.report.noFilterMatches')}</div>
                  ) : (
                    <ul className="mfbe-batch-issues-list" data-testid="batch-issues-list">
                      {visibleIssues.map((item, idx) => (
                        <li
                          key={`${item.kind}-${idx}-${item.entry.displayPath}`}
                          className="mfbe-batch-issue-item"
                          data-testid={`batch-issue-${item.kind}`}
                        >
                          <div className="mfbe-batch-issue-head">
                            <span
                              className={`mfbe-batch-badge ${
                                item.kind === 'failed'
                                  ? 'mfbe-batch-badge-failed'
                                  : 'mfbe-batch-badge-skipped'
                              }`}
                            >
                              {t(
                                item.kind === 'failed'
                                  ? 'batch.report.badgeFailed'
                                  : 'batch.report.badgeSkipped',
                              )}
                            </span>
                            <span className="mfbe-batch-issue-path">{item.entry.displayPath}</span>
                          </div>
                          <div className="mfbe-batch-issue-reason">{item.entry.reason}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </>
          )}

          {reportSaveNotice ? (
            <div
              className={
                reportSaveNotice.kind === 'error' ? 'mfbe-batch-error' : 'mfbe-batch-info'
              }
              role={reportSaveNotice.kind === 'error' ? 'alert' : 'status'}
              data-testid="batch-report-save-notice"
            >
              {reportSaveNotice.text}
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
