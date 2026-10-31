/**
 * The report of `mfbe.ui.report` (feature 007, contracts/script-api.md §4): the document its
 * frame shows under the policy that runs no script and loads nothing, its plain text (Copy) and
 * the file name Save as… proposes. ReportWindow.tsx shows it; openReport.ts opens it.
 */

import type { ReportSpec } from './api-impl';

/** The frame's policy: no script, no network; inline styles and `data:` pictures only. */
export const REPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/** The HTML document the frame shows: the report's HTML under the policy. */
export function reportDocument(html: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">` +
    '<style>body{font:13px/1.45 system-ui,sans-serif;margin:8px;color:#1e1e1e;background:#fff}</style>' +
    `</head><body>${html}</body></html>`
  );
}

/** The report as plain text: its text, or its HTML's text read from an inert document. */
export function reportPlainText(report: ReportSpec): string {
  if (report.text !== undefined) return report.text;
  const parsed = new DOMParser().parseFromString(report.html ?? '', 'text/html');
  parsed.querySelectorAll('script, style, template').forEach((element) => element.remove());
  for (const block of parsed.querySelectorAll('br, p, div, li, tr, h1, h2, h3, h4, h5, h6')) {
    block.append('\n');
  }
  return (parsed.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** The file name Save as… proposes: the title, made a file name, with the report's kind. */
export function reportFileName(report: ReportSpec): string {
  const base =
    [...report.title]
      .map((c) => (c.charCodeAt(0) < 0x20 || '\\/:*?"<>|'.includes(c) ? ' ' : c))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100) || 'report';
  return `${base}.${report.html !== undefined ? 'html' : 'txt'}`;
}
