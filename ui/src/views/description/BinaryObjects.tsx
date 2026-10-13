/**
 * Binary Objects list (T075/T094, FR-050, FR-012, FR-111): every embedded binary with its id,
 * content type, size, dimensions and a preview thumbnail (`GET /binary/{docId}/{id}/preview`),
 * badges for "converted to JPEG/PNG on save", "not a decodable image" and "not referenced",
 * dangling image references (from the model and from the last validation report), Remove with
 * the reference check of `binary.remove` (confirmation before `force`) and Add (the
 * `insert.binary` flow). The list is refreshed from `binary.list` when the section mounts so
 * conversions performed by a save are reflected.
 */

import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppServices, useCommandContext, useCommandState, useRunCommand } from '@/app/services';
import { binaryPreviewUrl } from '@/editor/nodeviews/image';
import {
  danglingImageRefs,
  referenceCounts,
  removeBinaryFromModel,
  replaceBinariesInModel,
} from '@/features/images/binaries';
import type { BinaryMeta } from '@/model/document';
import { actions, useAppState } from '@/model/store';
import { RpcError } from '@/rpc/client';

import { EmptyHint, SmallButton } from './fields';
import { useDescriptionForm } from './formContext';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BinaryObjects() {
  const { t } = useTranslation();
  const { store, rpc, dialogs } = useAppServices();
  const ctx = useCommandContext();
  const runCommand = useRunCommand();
  const addState = useCommandState('insert.binary');
  const { docId, binaries } = useDescriptionForm();
  const document = useAppState((s) => s.document, store);
  const validation = useAppState((s) => s.validation, store);
  const connected = useAppState((s) => s.connection === 'connected', store);
  const modified = useAppState((s) => s.modified, store);

  // Reflect conversions / additions performed by the core since the model was loaded (on
  // mount and after every save, when `modified` drops back to false).
  useEffect(() => {
    if (!rpc || !docId || !connected || modified) return;
    let cancelled = false;
    rpc
      .call('binary.list', { docId })
      .then((list) => {
        if (!cancelled) replaceBinariesInModel(store, list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rpc, docId, connected, modified, store]);

  const references = useMemo(
    () => (document ? referenceCounts(document) : new Map<string, number>()),
    [document],
  );
  const dangling = useMemo(() => {
    const set = new Set<string>(document ? danglingImageRefs(document) : []);
    for (const issue of validation?.issues ?? []) {
      if (issue.code === 'image.missingBinary' || issue.code === 'binary.missing') {
        const href = issue.params.href;
        if (typeof href === 'string') set.add(href);
      }
    }
    return [...set];
  }, [document, validation]);

  const remove = async (binary: BinaryMeta) => {
    if (!rpc || !docId) return;
    const count = references.get(binary.id) ?? binary.referenceCount;
    const attempt = async (force: boolean) =>
      rpc.call('binary.remove', { docId, id: binary.id, force });
    try {
      await attempt(false);
    } catch (error) {
      const referenced =
        error instanceof RpcError &&
        (isReferencedError(error) || /referenced/i.test(error.message));
      if (!referenced) {
        await dialogs.showMessage({
          text: error instanceof Error ? error.message : String(error),
          caption: ctx.t('dialog.error.caption'),
          icon: 'error',
          testId: 'binary-objects-remove-failed',
        });
        return;
      }
      const answer = await dialogs.showMessage({
        text: t('descriptionForm.binaries.removeReferenced', {
          id: binary.id,
          count: referenceCountOf(error) ?? count,
        }),
        caption: t('app.name'),
        buttons: 'yesNo',
        icon: 'warning',
        defaultButton: 'no',
        testId: 'dialog-binary-remove-referenced',
      });
      if (answer !== 'yes') return;
      await attempt(true);
    }
    removeBinaryFromModel(store, binary.id);
    actions.setStatusMessage(store, t('descriptionForm.binaries.removed', { id: binary.id }));
  };

  return (
    <div className="mfbe-desc-form" data-testid="binary-objects">
      <div className="mfbe-desc-row mfbe-desc-binaries-head">
        <span data-testid="description-binaries-count">
          {t('description.fields.binariesCount')} {binaries.length}
        </span>
        <SmallButton
          testId="binary-objects-add"
          onClick={() => void runCommand('insert.binary')}
          disabled={!addState.enabled}
          title={t('descriptionForm.binaries.add')}
        >
          {`+ ${t('descriptionForm.binaries.add')}`}
        </SmallButton>
      </div>
      {dangling.length > 0 ? (
        <div className="mfbe-desc-warning mfbe-desc-note" data-testid="binary-objects-dangling">
          {t('descriptionForm.binaries.dangling', { count: dangling.length })} {dangling.join(', ')}
        </div>
      ) : null}
      {binaries.length === 0 ? (
        <EmptyHint>{t('descriptionForm.binaries.none')}</EmptyHint>
      ) : (
        <table className="mfbe-desc-binaries" data-testid="description-binaries-list">
          <thead>
            <tr>
              <th />
              <th>{t('descriptionForm.binaries.id')}</th>
              <th>{t('descriptionForm.binaries.contentType')}</th>
              <th>{t('descriptionForm.binaries.size')}</th>
              <th>{t('descriptionForm.binaries.dimensions')}</th>
              <th>{t('descriptionForm.binaries.references')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {binaries.map((binary) => {
              const refs = references.get(binary.id) ?? 0;
              const url = binary.decodable ? binaryPreviewUrl(docId, `#${binary.id}`, 96) : null;
              return (
                <tr
                  key={binary.id}
                  data-testid={`binary-objects-row-${binary.id}`}
                  data-content-type={binary.contentType}
                  data-will-convert={binary.willConvert ? 'true' : 'false'}
                  className={refs === 0 ? 'mfbe-desc-binary-unreferenced' : undefined}
                >
                  <td className="mfbe-desc-binary-thumb-cell">
                    {url ? (
                      <img
                        className="mfbe-desc-thumb"
                        src={url}
                        alt={binary.id}
                        data-testid={`binary-objects-preview-${binary.id}`}
                      />
                    ) : (
                      <span className="mfbe-desc-thumb mfbe-desc-thumb-missing">
                        {t('descriptionForm.binaries.noPreview')}
                      </span>
                    )}
                  </td>
                  <td data-testid={`description-binary-${binary.id}`}>
                    <code>{binary.id}</code>
                    <div className="mfbe-desc-badges">
                      {binary.willConvert ? (
                        <span
                          className="mfbe-desc-badge mfbe-desc-badge-convert"
                          data-testid={`binary-objects-badge-convert-${binary.id}`}
                        >
                          {t('description.fields.willConvert')}
                        </span>
                      ) : null}
                      {!binary.decodable ? (
                        <span
                          className="mfbe-desc-badge mfbe-desc-badge-warn"
                          data-testid={`binary-objects-badge-undecodable-${binary.id}`}
                        >
                          {t('description.fields.notDecodable')}
                        </span>
                      ) : null}
                      {refs === 0 ? (
                        <span
                          className="mfbe-desc-badge mfbe-desc-badge-warn"
                          data-testid={`binary-objects-badge-unreferenced-${binary.id}`}
                        >
                          {t('descriptionForm.binaries.unreferenced')}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td>{binary.contentType}</td>
                  <td title={t('description.fields.bytes', { count: binary.size })}>
                    {formatSize(binary.size)}
                  </td>
                  <td>
                    {binary.width && binary.height
                      ? `${binary.width}\u00D7${binary.height}`
                      : '\u2014'}
                  </td>
                  <td>{refs}</td>
                  <td>
                    <SmallButton
                      testId={`binary-objects-remove-${binary.id}`}
                      onClick={() => void remove(binary)}
                      title={t('descriptionForm.remove')}
                      kind="remove"
                      disabled={!rpc || !connected}
                    >
                      {t('descriptionForm.remove')}
                    </SmallButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function isReferencedError(error: RpcError): boolean {
  const data = error.data as { referenceCount?: unknown } | undefined;
  return typeof data?.referenceCount === 'number' && data.referenceCount > 0;
}

function referenceCountOf(error: unknown): number | undefined {
  if (!(error instanceof RpcError)) return undefined;
  const data = error.data as { referenceCount?: unknown } | undefined;
  return typeof data?.referenceCount === 'number' ? data.referenceCount : undefined;
}
