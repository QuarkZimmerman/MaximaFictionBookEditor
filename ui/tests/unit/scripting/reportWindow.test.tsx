/**
 * Feature 007 (T039/T044, contracts/script-api.md §4, data-model §8): the report window of
 * `mfbe.ui.report` shows HTML in a frame that runs no script and loads nothing - `sandbox`
 * without `allow-scripts` (no token at all), a policy of inline styles and `data:` pictures
 * only - or pre-wrapped text; Copy puts the plain text on the clipboard, Save as… goes through
 * the editor's Save dialog.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import { initI18n } from '@/i18n';
import { REPORT_CSP, reportDocument, reportFileName, reportPlainText } from '@/scripting/report';
import { ReportWindow } from '@/scripting/ReportWindow';

import { fakeRpc } from '../features/testUtils';

async function show(report: { title: string; text?: string; html?: string }) {
  const i18n = await initI18n({ instance: createInstance(), react: true, language: 'en' });
  const rpc = fakeRpc({ 'files.saveText': { saved: true, name: 'x.html' } });
  const onClose = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ReportWindow report={report} index={3} rpc={rpc.client} onClose={onClose} />
    </I18nextProvider>,
  );
  return { rpc, onClose };
}

describe('the report window', () => {
  it('shows HTML in a frame that runs no script and loads nothing', async () => {
    const html =
      '<h1>Статистика</h1><script>parent.hacked = true</script><img src="http://example.org/x.png"><p>Слов: 12</p>';
    await show({ title: 'Статистика', html });
    const frame = screen.getByTestId('script-report-3-frame') as HTMLIFrameElement;
    // A sandbox with no token: no scripts, no same origin, no forms, no navigation.
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain(`content="${REPORT_CSP}"`);
    expect(REPORT_CSP).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'");
    expect((window as unknown as { hacked?: boolean }).hacked).toBeUndefined();
    expect(screen.getByTestId('script-report-3')).toBeInTheDocument();
  });

  it('shows text pre-wrapped', async () => {
    await show({ title: 'Отчёт', text: 'строка 1\n  строка 2' });
    expect(screen.getByTestId('script-report-3-text').textContent).toBe('строка 1\n  строка 2');
  });

  it('copies the plain text and saves the report through the editor’s Save dialog', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { rpc } = await show({
      title: 'Нецензурные: отчёт?',
      html: '<p>a</p><p>b<script>x</script></p>',
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('script-report-3-button-copy'));
    });
    expect(writeText).toHaveBeenCalledWith('a\nb');
    expect(screen.getByTestId('script-report-3-status').textContent).toBe(
      'Copied to the clipboard',
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('script-report-3-button-saveAs'));
    });
    const save = rpc.calls.find((call) => call.method === 'files.saveText');
    expect(save?.params).toMatchObject({
      suggestedName: 'Нецензурные отчёт.html',
      title: 'Save the report',
    });
    expect((save?.params as { text: string }).text).toContain(REPORT_CSP);
  });

  it('closes on Close', async () => {
    const { onClose } = await show({ title: 'T', text: 'x' });
    fireEvent.click(screen.getByTestId('script-report-3-button-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('the helpers: the document, the plain text, the file name', () => {
    expect(reportDocument('<b>x</b>')).toMatch(
      /^<!doctype html>.*<body><b>x<\/b><\/body><\/html>$/s,
    );
    expect(reportPlainText({ title: 't', text: ' as is ' })).toBe(' as is ');
    expect(
      reportPlainText({ title: 't', html: '<style>p{}</style><div>1</div><div>2</div>' }),
    ).toBe('1\n2');
    expect(reportFileName({ title: 'a/b:c', text: 'x' })).toBe('a b c.txt');
    expect(reportFileName({ title: '   ', html: 'x' })).toBe('report.html');
  });
});
