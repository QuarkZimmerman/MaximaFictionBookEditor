/**
 * Peak memory of the processes a performance journey measures (Linux: VmHWM from /proc, as
 * tests/bench/bench.mjs reads it; elsewhere nothing is measured), against the constitution's budget.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';

/** The constitution's memory budget for one process. */
export const MEMORY_BUDGET_BYTES = 1.5 * 1024 * 1024 * 1024;

/** Peak resident set size of a process (Linux VmHWM; null elsewhere). */
export function peakRssBytes(pid: number | undefined): number | null {
  if (!pid || !existsSync(`/proc/${pid}/status`)) return null;
  const match = /VmHWM:\s+(\d+)\s+kB/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
  return match ? Number(match[1]) * 1024 : null;
}

function parentOf(pid: number): number | null {
  try {
    const match = /PPid:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/**
 * The renderer processes of this test worker's browser (Linux): the Chromium processes with
 * `--type=renderer` whose ancestors include this worker - other browsers on the machine are
 * not counted.
 */
export function rendererPids(): number[] {
  if (!existsSync('/proc')) return [];
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    let cmdline: string;
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    if (!cmdline.includes('--type=renderer')) continue;
    for (let ancestor = parentOf(pid), hops = 0; ancestor && hops < 10; hops += 1) {
      if (ancestor === process.pid) {
        pids.push(pid);
        break;
      }
      ancestor = parentOf(ancestor);
    }
  }
  return pids;
}

/** The highest peak among this worker's renderers (null where nothing can be measured). */
export function rendererPeakBytes(): number | null {
  const peaks = rendererPids()
    .map((pid) => peakRssBytes(pid))
    .filter((peak): peak is number => peak !== null);
  return peaks.length > 0 ? Math.max(...peaks) : null;
}
