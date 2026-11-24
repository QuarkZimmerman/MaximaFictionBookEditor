/**
 * Feature 019 (T036, T045, T050, T053, T057): modal Batch Converter dialog.
 *
 * Strictly modal: while scanning, converting, or cancelling, every non-Cancel control is disabled
 * and `canClose()` returns `false` (blocking Escape, the title-bar close box, and host-level
 * dismissal). All configuration choices and batch-local export format settings persist in
 * `<Config>/batch-converter.json` via `batch.settings.get` / `batch.settings.save` (last closed
 * dialog wins).
 */

import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

import type { CommandContext } from '@/app/commands';
import { tip } from '@/app/tooltips';
import { Dialog, type DialogButton } from '@/dialogs/Dialog';
import type {
  BatchPersistedExportSettings,
  BatchPersistedSettings,
  OcrCatalogReport,
  Settings,
} from '@/rpc/types';

import { BatchExportSettingsDialog } from './BatchExportSettingsDialog';
import {
  applyBatchExportSettingsPatch,
  canRunParallel,
  cloneExportSettingsOverrides,
  computeMaxWorkers,
  createInitialBatchConfig,
  effectiveWorkerCount,
  extractExportSettingsFromGlobal,
  isBatchPdfOcrControlsEnabled,
  isBatchPdfOcrLanguagesEnabled,
  isZipOutputSupported,
  mergeBatchExportSettings,
  reduceBatchConfig,
  selectedImportFormats,
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
  type BatchDirection,
  type BatchExportSettingsOverrides,
  type BatchJobConfig,
  type BatchProgressSnapshot,
  type BatchReport,
  type BatchSessionMemory,
} from './engine/types';
import { getBatchSessionMemory, saveBatchSessionMemory } from './sessionState';

import './BatchConverterDialog.css';

const DIRECTION_TABS: readonly BatchDirection[] = ['fb2ToExport', 'importToFb2'] as const;

const KNOWN_PERSISTED_KEYS = new Set([
  'schemaVersion',
  'direction',
  'exportFormat',
  'importAll',
  'importFormats',
  'sourceDir',
  'destinationDir',
  'includeSubfolders',
  'keepTree',
  'inPlace',
  'fixBroken',
  'overwrite',
  'parallel',
  'workerCount',
  'pdfUseOcr',
  'ocrAutoDetect',
  'ocrLanguages',
  'zipOverrides',
  'exportSettings',
]);

export interface BatchConverterDialogProps {
  ctx: CommandContext;
  cpuCores: number;
  initialSettings: Settings | null;
  initialPersisted?: BatchPersistedSettings | null;
  initialOcrReport?: OcrCatalogReport | null;
  canCloseRef: MutableRefObject<boolean>;
  onClose: () => void;
}

type IssueFilter = 'all' | 'failed' | 'skipped' | 'fixed' | 'ocr';

const INITIAL_PROGRESS: BatchProgressSnapshot = {
  phase: 'idle',
  scannedCount: 0,
  totalCount: 0,
  completedCount: 0,
  convertedCount: 0,
  fixedCount: 0,
  skippedCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  activeWorkers: [],
};

function memoryFromPersisted(persisted: BatchPersistedSettings): BatchSessionMemory {
  return {
    direction: persisted.direction,
    exportFormat: persisted.exportFormat,
    importAll: persisted.importAll,
    importFormats: { ...persisted.importFormats },
    sourceDir: persisted.sourceDir,
    destinationDir: persisted.destinationDir,
    includeSubfolders: persisted.includeSubfolders,
    keepTree: persisted.keepTree,
    inPlace: persisted.inPlace,
    fixBroken: persisted.fixBroken,
    overwrite: persisted.overwrite,
    ...(persisted.parallel !== undefined ? { parallel: persisted.parallel } : {}),
    ...(persisted.workerCount !== undefined ? { workerCount: persisted.workerCount } : {}),
    ...(persisted.pdfUseOcr !== undefined ? { pdfUseOcr: persisted.pdfUseOcr } : {}),
    ...(persisted.ocrAutoDetect !== undefined ? { ocrAutoDetect: persisted.ocrAutoDetect } : {}),
    ...(persisted.ocrLanguages !== undefined ? { ocrLanguages: [...persisted.ocrLanguages] } : {}),
    zipOverrides: { ...persisted.zipOverrides },
  };
}

export function BatchConverterDialog({
  ctx,
  cpuCores,
  initialSettings,
  initialPersisted = null,
  initialOcrReport,
  canCloseRef,
  onClose,
}: BatchConverterDialogProps) {
  const { t } = useTranslation();
  const baseSettings = initialSettings;
  const [ocrReport, setOcrReport] = useState<OcrCatalogReport | null>(initialOcrReport ?? null);

  useEffect(() => {
    if (initialOcrReport !== undefined || !ctx.rpc) return;
    let cancelled = false;
    ctx.rpc
      .call('ocr.report')
      .then((res) => {
        if (!cancelled) setOcrReport(res);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.rpc, initialOcrReport]);

  const storedExtraRef = useRef<Record<string, unknown>>(
    (() => {
      const extras: Record<string, unknown> = {};
      if (initialPersisted) {
        for (const [k, v] of Object.entries(initialPersisted)) {
          if (!KNOWN_PERSISTED_KEYS.has(k)) {
            extras[k] = v;
          }
        }
      }
      return extras;
    })(),
  );

  const initialMemory = useMemo<BatchSessionMemory | null>(
    () => (initialPersisted ? memoryFromPersisted(initialPersisted) : getBatchSessionMemory()),
    [initialPersisted],
  );

  const zipOverridesRef = useRef<Partial<Record<string, boolean>>>({
    ...(initialMemory?.zipOverrides ?? {}),
  });

  const [exportSettings, setExportSettings] = useState<BatchPersistedExportSettings>(() => {
    if (initialPersisted?.exportSettings) {
      return cloneExportSettingsOverrides(
        initialPersisted.exportSettings,
      ) as BatchPersistedExportSettings;
    }
    const seed = extractExportSettingsFromGlobal(baseSettings);
    return initialMemory?.exportSettingsOverrides
      ? applyBatchExportSettingsPatch(seed, initialMemory.exportSettingsOverrides)
      : seed;
  });

  const effectiveSettings = useMemo(
    () => mergeBatchExportSettings(baseSettings, exportSettings),
    [baseSettings, exportSettings],
  );
  const [resolvedPdfFont, setResolvedPdfFont] = useState<{
    id: string;
    name: string | undefined;
  } | null>(null);
  const activePdfFontId = effectiveSettings?.pdf?.textFont ?? 'noto-serif';
  const pdfCustomFontName =
    resolvedPdfFont?.id === activePdfFontId ? resolvedPdfFont.name : undefined;

  const [config, setConfig] = useState<BatchJobConfig>(() =>
    createInitialBatchConfig(cpuCores, effectiveSettings, initialMemory),
  );
  const [progress, setProgress] = useState<BatchProgressSnapshot>(INITIAL_PROGRESS);
  const [report, setReport] = useState<BatchReport | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [reportFilter, setReportFilter] = useState<IssueFilter>('all');
  const [reportSaveNotice, setReportSaveNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const configRef = useRef(config);
  const exportSettingsRef = useRef(exportSettings);
  const closingRef = useRef(false);

  const runRef = useRef<BatchRunController | null>(null);
  const running =
    progress.phase === 'scanning' ||
    progress.phase === 'converting' ||
    progress.phase === 'cancelling';

  // Keep host-level and Dialog-level close guard strictly synchronized with running state.
  useLayoutEffect(() => {
    canCloseRef.current = !running;
  }, [canCloseRef, running]);

  // Keep refs synchronized synchronously after commit so immediate Close/Start never reads stale state.
  useLayoutEffect(() => {
    configRef.current = config;
    exportSettingsRef.current = exportSettings;
  }, [config, exportSettings]);

  // Keep in-memory fallback synchronized with live dialog edits.
  useEffect(() => {
    saveBatchSessionMemory(config, zipOverridesRef.current, exportSettings);
  }, [config, exportSettings]);

  const buildPersistedPayload = useCallback(
    (
      nextConfig: BatchJobConfig,
      nextExportSettings: BatchPersistedExportSettings,
    ): BatchPersistedSettings => {
      const zipOverrides: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(zipOverridesRef.current)) {
        if (typeof v === 'boolean') zipOverrides[k] = v;
      }
      const payload: BatchPersistedSettings = {
        ...storedExtraRef.current,
        schemaVersion: 1,
        direction: nextConfig.direction,
        exportFormat: nextConfig.exportFormat,
        importAll: nextConfig.importAll,
        importFormats: { ...nextConfig.importFormats },
        sourceDir: nextConfig.sourceDir,
        destinationDir: nextConfig.destinationDir,
        includeSubfolders: nextConfig.includeSubfolders,
        keepTree: nextConfig.keepTree,
        inPlace: nextConfig.inPlace,
        fixBroken: nextConfig.fixBroken,
        overwrite: nextConfig.overwrite,
        pdfUseOcr: nextConfig.pdfUseOcr,
        ocrAutoDetect: nextConfig.ocrAutoDetect,
        ocrLanguages: [...nextConfig.ocrLanguages],
        zipOverrides,
        exportSettings: cloneExportSettingsOverrides(
          nextExportSettings,
        ) as BatchPersistedExportSettings,
      };
      // Only persist parallel/workerCount on multi-core hosts so 1-2 core runs never clobber
      // stored multi-core settings or default `cores - 1` behavior.
      if (canRunParallel(cpuCores)) {
        payload.parallel = nextConfig.parallel;
        payload.workerCount = nextConfig.workerCount;
      }
      return payload;
    },
    [cpuCores],
  );

  const persistSettings = useCallback(
    async (
      nextConfig: BatchJobConfig,
      nextExportSettings: BatchPersistedExportSettings,
    ): Promise<void> => {
      saveBatchSessionMemory(nextConfig, zipOverridesRef.current, nextExportSettings);
      if (!ctx.rpc) return;
      try {
        await ctx.rpc.call('batch.settings.save', {
          settings: buildPersistedPayload(nextConfig, nextExportSettings),
        });
      } catch {
        // Best-effort persistence: never block closing or starting a batch run on a config write error.
      }
    },
    [buildPersistedPayload, ctx.rpc],
  );

  const handleClose = useCallback(() => {
    if (running || closingRef.current) return;
    closingRef.current = true;
    void persistSettings(configRef.current, exportSettingsRef.current).finally(() => {
      onClose();
    });
  }, [onClose, persistSettings, running]);

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
    if (!ctx.rpc || !/^[0-9a-f]{64}(-\d+)?$/.test(activePdfFontId)) {
      return;
    }
    let cancelled = false;
    ctx.rpc
      .call('pdf.fonts.list', {})
      .then((list) => {
        if (cancelled) return;
        const found = list.added.find((f) => f.id === activePdfFontId);
        setResolvedPdfFont({ id: activePdfFontId, name: found?.name });
      })
      .catch(() => {
        if (!cancelled) setResolvedPdfFont({ id: activePdfFontId, name: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.rpc, activePdfFontId]);

  const dispatch = useCallback(
    (action: BatchConfigAction, overrideSettings?: Settings | null) => {
      const targetSettings = overrideSettings !== undefined ? overrideSettings : effectiveSettings;
      setValidationError(null);
      if (action.type === 'setZipOutput') {
        const key = zipOverrideKey(config.direction, config.exportFormat);
        zipOverridesRef.current = { ...zipOverridesRef.current, [key]: action.checked };
      }
      setConfig((prev) =>
        reduceBatchConfig(prev, action, cpuCores, targetSettings, zipOverridesRef.current),
      );
    },
    [config.direction, config.exportFormat, cpuCores, effectiveSettings],
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
    if (running || config.exportFormat === 'epub') return;
    const format = config.exportFormat;
    const applyPatchAndPersist = async (patch: BatchExportSettingsOverrides) => {
      const updated = applyBatchExportSettingsPatch(exportSettingsRef.current, patch);
      exportSettingsRef.current = updated;
      setExportSettings(updated);
      await persistSettings(configRef.current, updated);
    };
    await ctx.dialogs.openCustom<void>((close) =>
      createElement(BatchExportSettingsDialog, {
        ctx,
        format,
        effectiveSettings,
        onApply: (patch) => applyPatchAndPersist(patch),
        onSave: async (patch) => {
          await applyPatchAndPersist(patch);
          close();
        },
        onCancel: () => close(),
      }),
    );
  };

  const ocrPacks = useMemo(() => ocrReport?.packs ?? [], [ocrReport]);
  const installedOcrCodes = useMemo(
    () => (ocrReport ? ocrReport.packs.map((pack) => pack.code) : null),
    [ocrReport],
  );

  const handleToggleOcrLanguage = (code: string, checked: boolean) => {
    // Prune any uninstalled pack codes only when the user actively edits batch selections.
    const base = installedOcrCodes
      ? config.ocrLanguages.filter((c) => installedOcrCodes.includes(c))
      : [...config.ocrLanguages];
    const next = checked
      ? base.includes(code)
        ? base
        : [...base, code]
      : base.filter((c) => c !== code);
    dispatch({ type: 'setOcrLanguages', languages: next });
  };

  const handleStart = async () => {
    if (running || !ctx.rpc) return;
    const errorKey = validateBatchConfig(config, installedOcrCodes);
    if (errorKey) {
      setValidationError(t(errorKey));
      return;
    }
    setValidationError(null);
    setReport(null);
    setReportSaveNotice(null);
    setReportFilter('all');
    void persistSettings(configRef.current, exportSettingsRef.current);

    const latestBaseSettings = ctx.store.getState().settings ?? baseSettings;
    const runSettings = mergeBatchExportSettings(latestBaseSettings, exportSettingsRef.current);
    const openDocId = ctx.store.getState().docId ?? undefined;

    const controller = startBatchRun({
      ctx,
      config,
      settings: runSettings,
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
  const noImportFormatSelected =
    config.direction === 'importToFb2' && selectedImportFormats(config).length === 0;
  const pdfOcrControlsEnabled = !running && isBatchPdfOcrControlsEnabled(config);
  const pdfOcrLanguagesEnabled = !running && isBatchPdfOcrLanguagesEnabled(config);
  const noOcrLanguageSelected =
    isBatchPdfOcrLanguagesEnabled(config) &&
    (installedOcrCodes
      ? config.ocrLanguages.filter((code) => installedOcrCodes.includes(code)).length === 0
      : config.ocrLanguages.length === 0);

  const activeExportSummary = useMemo(
    () =>
      formatActiveExportSummary(
        config.exportFormat,
        effectiveSettings,
        config.zipOutput,
        t,
        pdfCustomFontName,
      ),
    [config.exportFormat, config.zipOutput, effectiveSettings, pdfCustomFontName, t],
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
          onClick: handleClose,
        },
      ];
      return list;
    }
    return [
      {
        id: 'start',
        label: t('batch.actions.start'),
        disabled: noImportFormatSelected || noOcrLanguageSelected,
        title: t('batch.tips.start'),
        onClick: () => void handleStart(),
      },
      {
        id: 'close',
        label: t('batch.actions.close'),
        title: t('batch.tips.close'),
        onClick: handleClose,
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    running,
    progress.phase,
    report,
    config,
    effectiveSettings,
    noImportFormatSelected,
    noOcrLanguageSelected,
    handleClose,
    t,
  ]);

  const overallPercent =
    progress.totalCount > 0
      ? Math.min(100, Math.round((progress.completedCount / progress.totalCount) * 100))
      : 0;

  const visibleIssues = useMemo(() => {
    if (!report) return [];
    const failedItems = report.failed.map((entry) => ({ kind: 'failed' as const, entry }));
    const skippedItems = report.skipped.map((entry) => ({ kind: 'skipped' as const, entry }));
    const fixedItems = report.fixed.map((entry) => ({ kind: 'fixed' as const, entry }));
    const ocrItems = (report.ocr ?? []).map((entry) => ({ kind: 'ocr' as const, entry }));
    if (reportFilter === 'failed') return failedItems;
    if (reportFilter === 'skipped') return skippedItems;
    if (reportFilter === 'fixed') return fixedItems;
    if (reportFilter === 'ocr') return ocrItems;
    return [...failedItems, ...skippedItems, ...fixedItems, ...ocrItems];
  }, [report, reportFilter]);

  const totalIssueCount =
    (report?.failed.length ?? 0) +
    (report?.skipped.length ?? 0) +
    (report?.fixed.length ?? 0) +
    (report?.ocr?.length ?? 0);

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

          <div className="mfbe-batch-direction-section">
            <div className="mfbe-batch-tabs" role="tablist" aria-label={t('batch.direction.group')}>
              {DIRECTION_TABS.map((dir) => {
                const isExport = dir === 'fb2ToExport';
                const selected = config.direction === dir;
                const tabId = isExport ? 'batch-tab-export' : 'batch-tab-import';
                return (
                  <button
                    key={dir}
                    id={tabId}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="batch-direction-panel"
                    tabIndex={selected ? 0 : -1}
                    disabled={running}
                    className="mfbe-batch-tab"
                    data-testid={isExport ? 'batch-dir-export' : 'batch-dir-import'}
                    onClick={() => dispatch({ type: 'setDirection', direction: dir })}
                    onKeyDown={(event) => {
                      const idx = DIRECTION_TABS.indexOf(config.direction);
                      let next: BatchDirection | null = null;
                      if (event.key === 'ArrowRight') {
                        next = DIRECTION_TABS[(idx + 1) % DIRECTION_TABS.length]!;
                      } else if (event.key === 'ArrowLeft') {
                        next =
                          DIRECTION_TABS[
                            (idx + DIRECTION_TABS.length - 1) % DIRECTION_TABS.length
                          ]!;
                      } else if (event.key === 'Home') {
                        next = DIRECTION_TABS[0]!;
                      } else if (event.key === 'End') {
                        next = DIRECTION_TABS[DIRECTION_TABS.length - 1]!;
                      }
                      if (!next) return;
                      event.preventDefault();
                      dispatch({ type: 'setDirection', direction: next });
                      const nextId =
                        next === 'fb2ToExport' ? 'batch-tab-export' : 'batch-tab-import';
                      event.currentTarget.parentElement
                        ?.querySelector<HTMLButtonElement>(`#${nextId}`)
                        ?.focus();
                    }}
                    {...tip(t(isExport ? 'batch.tips.tabFromFb2' : 'batch.tips.tabToFb2'))}
                  >
                    {t(isExport ? 'batch.direction.fb2ToExport' : 'batch.direction.importToFb2')}
                  </button>
                );
              })}
            </div>

            <div
              id="batch-direction-panel"
              role="tabpanel"
              aria-labelledby={
                config.direction === 'fb2ToExport' ? 'batch-tab-export' : 'batch-tab-import'
              }
              className="mfbe-batch-tab-panel"
            >
              {config.direction === 'fb2ToExport' ? (
                <>
                  <div className="mfbe-batch-format-row">
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
                    <label
                      className={`mfbe-batch-check mfbe-batch-zip-inline${!zipSupported ? ' disabled' : ''}`}
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
                        {...tip(t('batch.tips.zipOutput'))}
                      />
                      <span>{t('batch.options.zipOutput')}</span>
                    </label>
                    {!zipSupported ? (
                      <span className="mfbe-batch-note">{t('batch.options.zipEpubNote')}</span>
                    ) : null}
                  </div>
                  <label className="mfbe-batch-check" {...tip(t('batch.tips.fixBroken'))}>
                    <input
                      type="checkbox"
                      checked={config.fixBroken}
                      disabled={running}
                      data-testid="batch-fix-broken"
                      onChange={(event) =>
                        dispatch({ type: 'setFixBroken', checked: event.target.checked })
                      }
                      {...tip(t('batch.tips.fixBroken'))}
                    />
                    <span>{t('batch.options.fixBroken')}</span>
                  </label>
                  <div className="mfbe-batch-defaults-bar" data-testid="batch-export-defaults">
                    <span className="mfbe-batch-defaults-text">
                      <strong>{t('batch.export.activeSettings')}</strong> {activeExportSummary}
                    </span>
                    <button
                      type="button"
                      className="mfbe-button"
                      data-testid="batch-export-settings-btn"
                      disabled={running || config.exportFormat === 'epub'}
                      onClick={() => void handleOpenExportSettings()}
                      {...tip(
                        t(
                          config.exportFormat === 'epub'
                            ? 'batch.tips.exportSettingsEpub'
                            : 'batch.tips.exportSettings',
                        ),
                      )}
                    >
                      {t('batch.export.settingsButton')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="mfbe-batch-import-panel" data-testid="batch-import-formats-panel">
                  <label className="mfbe-batch-check" {...tip(t('batch.tips.importAll'))}>
                    <input
                      type="checkbox"
                      checked={config.importAll}
                      disabled={running}
                      data-testid="batch-import-all"
                      onChange={(event) =>
                        dispatch({ type: 'setImportAll', checked: event.target.checked })
                      }
                      {...tip(t('batch.tips.importAll'))}
                    />
                    <span>{t('batch.import.allFormats')}</span>
                  </label>
                  <div className="mfbe-batch-formats-grid">
                    {BATCH_BOOK_FORMATS.map((fmt) => {
                      const fmtTip = t('batch.tips.importFormat', {
                        format: t(`exports.settings.formats.${fmt}`),
                      });
                      return (
                        <label key={fmt} className="mfbe-batch-check" {...tip(fmtTip)}>
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
                            {...tip(fmtTip)}
                          />
                          <span>{t(`exports.settings.formats.${fmt}`)}</span>
                        </label>
                      );
                    })}
                  </div>
                  {noImportFormatSelected ? (
                    <div
                      className="mfbe-batch-error"
                      role="alert"
                      data-testid="batch-no-format-hint"
                    >
                      {t('batch.validation.noImportFormat')}
                    </div>
                  ) : null}
                  <div
                    className={`mfbe-batch-ocr-panel${!pdfOcrControlsEnabled ? ' disabled' : ''}`}
                    data-testid="batch-ocr-panel"
                  >
                    <div className="mfbe-batch-ocr-header">{t('batch.ocr.group')}</div>
                    <label
                      className={`mfbe-batch-check${!pdfOcrControlsEnabled ? ' disabled' : ''}`}
                      {...tip(t('batch.tips.pdfUseOcr'))}
                    >
                      <input
                        type="checkbox"
                        checked={config.pdfUseOcr}
                        disabled={!pdfOcrControlsEnabled}
                        data-testid="batch-pdf-use-ocr"
                        onChange={(event) =>
                          dispatch({ type: 'setPdfUseOcr', checked: event.target.checked })
                        }
                        {...tip(t('batch.tips.pdfUseOcr'))}
                      />
                      <span>{t('batch.ocr.useOcr')}</span>
                    </label>
                    {!config.importFormats.pdf ? (
                      <span className="mfbe-batch-note" data-testid="batch-ocr-disabled-note">
                        {t('batch.ocr.disabledNote')}
                      </span>
                    ) : null}
                    <label
                      className={`mfbe-batch-check mfbe-batch-ocr-indent${!pdfOcrLanguagesEnabled ? ' disabled' : ''}`}
                      {...tip(t('batch.tips.ocrAutoDetect'))}
                    >
                      <input
                        type="checkbox"
                        checked={config.ocrAutoDetect}
                        disabled={!pdfOcrLanguagesEnabled}
                        data-testid="batch-ocr-auto-detect"
                        onChange={(event) =>
                          dispatch({ type: 'setOcrAutoDetect', checked: event.target.checked })
                        }
                        {...tip(t('batch.tips.ocrAutoDetect'))}
                      />
                      <span>{t('batch.ocr.autoDetect')}</span>
                    </label>
                    <div
                      className="mfbe-batch-ocr-langs-block mfbe-batch-ocr-indent"
                      {...tip(t('batch.tips.ocrLanguages'))}
                    >
                      <span className="mfbe-batch-ocr-langs-label">
                        {t('batch.ocr.languagesLabel')}
                      </span>
                      <div className="mfbe-batch-ocr-langs-grid" data-testid="batch-ocr-languages">
                        {ocrPacks.map((pack) => {
                          const label = t(`ocr.languages.${pack.code}`, {
                            defaultValue: pack.code.toUpperCase(),
                          });
                          return (
                            <label
                              key={pack.code}
                              className={`mfbe-batch-check${!pdfOcrLanguagesEnabled ? ' disabled' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={config.ocrLanguages.includes(pack.code)}
                                disabled={!pdfOcrLanguagesEnabled}
                                data-testid={`batch-ocr-lang-${pack.code}`}
                                onChange={(event) =>
                                  handleToggleOcrLanguage(pack.code, event.target.checked)
                                }
                                {...tip(t('batch.tips.ocrLanguages'))}
                              />
                              <span>{label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    {noOcrLanguageSelected ? (
                      <div
                        className="mfbe-batch-error"
                        role="alert"
                        data-testid="batch-ocr-no-languages-hint"
                      >
                        {t('batch.validation.noOcrLanguage')}
                      </div>
                    ) : null}
                  </div>
                  <div className="mfbe-batch-import-zip-row">
                    <label className="mfbe-batch-check" {...tip(t('batch.tips.zipOutput'))}>
                      <input
                        type="checkbox"
                        checked={config.zipOutput}
                        disabled={running}
                        data-testid="batch-zip-output"
                        onChange={(event) =>
                          dispatch({ type: 'setZipOutput', checked: event.target.checked })
                        }
                        {...tip(t('batch.tips.zipOutput'))}
                      />
                      <span>{t('batch.options.zipOutput')}</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

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
                onChange={(event) => dispatch({ type: 'setSourceDir', path: event.target.value })}
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
                {...tip(t('batch.tips.includeSubfolders'))}
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
                {...tip(t('batch.tips.inPlace'))}
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
                {...tip(t('batch.tips.keepTree'))}
              />
              <span>{t('batch.paths.keepTree')}</span>
            </label>
          </fieldset>

          <fieldset className="mfbe-batch-fieldset">
            <legend>{t('batch.options.group')}</legend>
            <label className="mfbe-batch-check" {...tip(t('batch.tips.overwrite'))}>
              <input
                type="checkbox"
                checked={config.overwrite}
                disabled={running}
                data-testid="batch-overwrite"
                onChange={(event) =>
                  dispatch({ type: 'setOverwrite', checked: event.target.checked })
                }
                {...tip(t('batch.tips.overwrite'))}
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
                  {...tip(t('batch.tips.parallel'))}
                />
                <span>{t('batch.options.parallel')}</span>
              </label>
              <label htmlFor="batch-worker-count">{t('batch.options.workersLabel')}</label>
              <input
                id="batch-worker-count"
                type="number"
                className="mfbe-batch-workers-input"
                data-testid="batch-worker-count"
                min={parallelSupported ? 2 : 1}
                max={maxWorkers}
                step={1}
                value={config.workerCount}
                disabled={running || !parallelSupported || !config.parallel}
                onChange={(event) =>
                  dispatch({
                    type: 'setWorkerCount',
                    count: Number.parseInt(event.target.value, 10) || 2,
                  })
                }
                {...tip(t('batch.tips.workerCount'))}
              />
              {parallelSupported ? (
                <span className="mfbe-batch-note">
                  {t('batch.options.workersMaxNote', { max: maxWorkers })}
                </span>
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
                  fixed: progress.fixedCount,
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
        <div
          className="mfbe-batch-report"
          data-testid="batch-report-view"
          data-duration-ms={report.durationMs}
        >
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
                <span className="mfbe-batch-pill" data-testid="batch-count-fixed">
                  {t('batch.report.summaryFixed', { count: report.counts.fixed })}
                </span>
                {report.config.direction === 'importToFb2' || (report.counts.ocr ?? 0) > 0 ? (
                  <span className="mfbe-batch-pill" data-testid="batch-count-ocr">
                    {t('batch.report.summaryOcr', { count: report.counts.ocr ?? 0 })}
                  </span>
                ) : null}
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
                      {...tip(t('batch.tips.filterAll'))}
                    >
                      {t('batch.report.filterAll', { count: totalIssueCount })}
                    </button>
                    <button
                      type="button"
                      className="mfbe-batch-filter-btn"
                      aria-pressed={reportFilter === 'failed'}
                      data-testid="batch-filter-failed"
                      onClick={() => setReportFilter('failed')}
                      {...tip(t('batch.tips.filterFailed'))}
                    >
                      {t('batch.report.filterFailed', { count: report.failed.length })}
                    </button>
                    <button
                      type="button"
                      className="mfbe-batch-filter-btn"
                      aria-pressed={reportFilter === 'skipped'}
                      data-testid="batch-filter-skipped"
                      onClick={() => setReportFilter('skipped')}
                      {...tip(t('batch.tips.filterSkipped'))}
                    >
                      {t('batch.report.filterSkipped', { count: report.skipped.length })}
                    </button>
                    <button
                      type="button"
                      className="mfbe-batch-filter-btn"
                      aria-pressed={reportFilter === 'fixed'}
                      data-testid="batch-filter-fixed"
                      onClick={() => setReportFilter('fixed')}
                      {...tip(t('batch.tips.filterFixed'))}
                    >
                      {t('batch.report.filterFixed', { count: report.fixed.length })}
                    </button>
                    {report.config.direction === 'importToFb2' || (report.ocr?.length ?? 0) > 0 ? (
                      <button
                        type="button"
                        className="mfbe-batch-filter-btn"
                        aria-pressed={reportFilter === 'ocr'}
                        data-testid="batch-filter-ocr"
                        onClick={() => setReportFilter('ocr')}
                        {...tip(t('batch.tips.filterOcr'))}
                      >
                        {t('batch.report.filterOcr', { count: report.ocr?.length ?? 0 })}
                      </button>
                    ) : null}
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
                                  : item.kind === 'skipped'
                                    ? 'mfbe-batch-badge-skipped'
                                    : item.kind === 'ocr'
                                      ? 'mfbe-batch-badge-ocr'
                                      : 'mfbe-batch-badge-fixed'
                              }`}
                            >
                              {t(
                                item.kind === 'failed'
                                  ? 'batch.report.badgeFailed'
                                  : item.kind === 'skipped'
                                    ? 'batch.report.badgeSkipped'
                                    : item.kind === 'ocr'
                                      ? 'batch.report.badgeOcr'
                                      : 'batch.report.badgeFixed',
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
              className={reportSaveNotice.kind === 'error' ? 'mfbe-batch-error' : 'mfbe-batch-info'}
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
