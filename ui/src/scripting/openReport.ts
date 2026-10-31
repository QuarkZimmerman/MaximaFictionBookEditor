/**
 * Opens the report window of `mfbe.ui.report` (feature 007): modeless, on the dialogs of the
 * run, numbered `script-report-<n>` in this session; it lives on after the run that opened it.
 */

import { createElement } from 'react';

import type { Dialogs } from '@/dialogs/types';
import type { RpcClient } from '@/rpc/client';

import type { ReportSpec } from './api-impl';
import { ReportWindow } from './ReportWindow';

let opened = 0;

export function openReportWindow(
  dialogs: Dialogs,
  rpc: RpcClient | null,
  report: ReportSpec,
): void {
  opened += 1;
  const index = opened;
  void dialogs.openCustom<void>(
    (close) => createElement(ReportWindow, { report, index, rpc, onClose: () => close() }),
    { modeless: true },
  );
}
