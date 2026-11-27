/**
 * Dedicated left sidebar panel for FBD ZIP Package mode (feature 022, T020, FR-008, FR-012).
 *
 * Replaces `DocumentTree` in the left sidebar slot when `editorMode === 'package'`, providing `+`
 * Add files, per-file Remove, active file selection, left-side cover thumbnail icons, right-click
 * context menu (Import description, Add/Replace cover, Clear cover, Remove), format/size/metadata
 * indicators, and AI run-lock guarding while Description or read-only Source stays visible beside it.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PopupMenu } from '@/app/PopupMenu';
import { useAppServices, useCommandContext } from '@/app/services';
import { tip } from '@/app/tooltips';
import { hasNonEmptyDescription } from '@/features/package';
import { binaryPreviewUrl } from '@/model/binaryUrls';
import { isRunLocked, useAppState } from '@/model/store';

import './packageFiles.css';

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function PackageFilesSidebar() {
  const { t } = useTranslation();
  const services = useAppServices();
  const ctx = useCommandContext();
  const pkg = useAppState((s) => s.packageState, services.store);
  const runLocked = useAppState(isRunLocked, services.store);
  const [contextMenu, setContextMenu] = useState<{
    entryId: string;
    x: number;
    y: number;
  } | null>(null);

  const entries = pkg?.entries ?? [];
  const activeId = pkg?.activeEntryId ?? null;
  const menuEntry = contextMenu
    ? (entries.find((e) => e.entryId === contextMenu.entryId) ?? null)
    : null;
  const menuHasCover = menuEntry
    ? menuEntry.document.binaries.length > 0 ||
      menuEntry.document.description.titleInfo.coverpage.length > 0
    : false;

  return (
    <div className="mfbe-package-sidebar" data-testid="package-files-sidebar">
      <div className="mfbe-package-sidebar-header">
        <div className="mfbe-package-sidebar-title-group">
          <span className="mfbe-package-sidebar-title">{t('package.sidebar.title')}</span>
          <span className="mfbe-package-sidebar-count" data-testid="package-files-count">
            {t('package.sidebar.count', { count: entries.length })}
          </span>
        </div>
        <button
          type="button"
          className="mfbe-package-add-btn"
          data-testid="package-files-add"
          aria-label={t('package.sidebar.add')}
          disabled={runLocked || !pkg}
          {...tip(t('tip.package.addFile'))}
          onClick={() => void services.packages.addFilesWithDialog(ctx)}
        >
          +
        </button>
      </div>

      {runLocked ? (
        <div className="mfbe-package-sidebar-lock" data-testid="package-files-locked" role="status">
          {t('package.sidebar.lockedByAi')}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="mfbe-package-sidebar-empty" data-testid="package-files-empty">
          <p>{t('package.sidebar.empty')}</p>
        </div>
      ) : (
        <ul
          className="mfbe-package-file-list"
          role="listbox"
          aria-label={t('package.sidebar.title')}
          data-testid="package-files-list"
        >
          {entries.map((entry) => {
            const active = entry.entryId === activeId;
            const ready = hasNonEmptyDescription(entry.document);
            const coverBin = entry.document.binaries[0];
            const hasCover =
              coverBin !== undefined || entry.document.description.titleInfo.coverpage.length > 0;
            const thumbUrl = coverBin
              ? binaryPreviewUrl(entry.docId, `#${coverBin.id}`, 64, 96)
              : null;
            const extLabel = entry.extension ? entry.extension.toUpperCase() : 'FILE';
            return (
              <li
                key={entry.entryId}
                className={`mfbe-package-file-row${active ? ' mfbe-package-file-row-active' : ''}`}
                role="option"
                aria-selected={active}
                data-no-tooltip
                data-testid={`package-file-item-${entry.entryId}`}
                data-filename={entry.fileName}
                data-active={active ? 'true' : 'false'}
                onContextMenu={(event) => {
                  event.preventDefault();
                  if (runLocked) return;
                  setContextMenu({
                    entryId: entry.entryId,
                    x: Math.round(event.clientX),
                    y: Math.round(event.clientY),
                  });
                }}
              >
                <button
                  type="button"
                  className="mfbe-package-file-select"
                  data-testid={`package-file-select-${entry.entryId}`}
                  disabled={runLocked}
                  {...tip(t('tip.package.selectFile'))}
                  onClick={() => services.packages.selectEntry(ctx, entry.entryId)}
                >
                  {thumbUrl ? (
                    <span className="mfbe-package-file-thumb-wrap" aria-hidden="true">
                      <img
                        className="mfbe-package-file-thumb"
                        data-testid={`package-file-cover-thumb-${entry.entryId}`}
                        src={thumbUrl}
                        alt=""
                        draggable={false}
                      />
                    </span>
                  ) : null}
                  <span className="mfbe-package-file-info">
                    <span className="mfbe-package-file-main">
                      <span className="mfbe-package-file-ext">{extLabel}</span>
                      <span className="mfbe-package-file-name">{entry.fileName}</span>
                    </span>
                    <span className="mfbe-package-file-meta">
                      <span>{formatByteSize(entry.size)}</span>
                      <span
                        className={`mfbe-package-file-status ${
                          ready
                            ? 'mfbe-package-file-status-ready'
                            : 'mfbe-package-file-status-empty'
                        }`}
                      >
                        {ready
                          ? t('package.sidebar.statusReady')
                          : t('package.sidebar.statusEmpty')}
                      </span>
                      {hasCover ? (
                        <span className="mfbe-package-file-cover">
                          {t('package.sidebar.statusCover')}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="mfbe-package-file-remove"
                  data-testid={`package-file-remove-${entry.entryId}`}
                  aria-label={`${t('package.sidebar.remove')} ${entry.fileName}`}
                  disabled={runLocked}
                  {...tip(t('tip.package.removeFile'))}
                  onClick={() => void services.packages.removeEntry(ctx, entry.entryId)}
                >
                  {'\u00D7'}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {contextMenu && menuEntry ? (
        <PopupMenu
          testId="package-file-context-menu"
          ariaLabel={menuEntry.fileName}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          items={[
            {
              id: 'importDescription',
              label: t('package.contextMenu.importDescription'),
              enabled: !runLocked,
              run: () => void services.packages.importDescriptionForEntry(ctx, menuEntry.entryId),
            },
            'separator',
            {
              id: 'setCover',
              label: t(
                menuHasCover ? 'package.contextMenu.replaceCover' : 'package.contextMenu.addCover',
              ),
              enabled: !runLocked,
              run: () => void services.packages.pickCoverForEntry(ctx, menuEntry.entryId),
            },
            {
              id: 'clearCover',
              label: t('package.contextMenu.clearCover'),
              enabled: !runLocked && menuHasCover,
              run: () => void services.packages.clearCoverForEntry(ctx, menuEntry.entryId),
            },
            'separator',
            {
              id: 'remove',
              label: t('package.contextMenu.remove'),
              enabled: !runLocked,
              run: () => void services.packages.removeEntry(ctx, menuEntry.entryId),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
