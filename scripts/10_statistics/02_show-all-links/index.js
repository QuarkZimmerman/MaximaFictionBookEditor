// Converted from 10_Статистика/02_Показать все-все ссылки.js (FictionBook Editor).
// Same list as "Показать все ссылки", but the original opened it in a separate browser
// window (links.htm) so long lists could be scrolled and copied. Scripts cannot open
// windows here, so the list is shown in a form with a multi-line text field instead.
import { collectLinks, formatLinkReport } from './links.js';

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const links = collectLinks(await mfbe.doc.get());
  if (links.length === 0) {
    await mfbe.ui.message(ru ? '\nДокумент не содержит ссылок. \n\n' : '\nThe document contains no links.\n\n', { icon: 'info' });
    return;
  }
  const report = formatLinkReport(links, {
    internal: ru ? 'ВНУТРЕННИЕ ССЫЛКИ:' : 'INTERNAL LINKS:',
    external: ru ? 'ВНЕШНИЕ ССЫЛКИ:' : 'EXTERNAL LINKS:',
    arrow: '\u2192',
    divider: '-------------------------------------------- ',
  });
  await mfbe.ui.form({
    title: ru ? 'Ссылки документа' : 'Links of the document',
    width: 560,
    fields: [
      { kind: 'static', id: 'count', text: ru ? `Всего ссылок: ${links.length}` : `Links in total: ${links.length}` },
      { kind: 'text', id: 'links', label: ru ? 'Список' : 'List', value: report, multiline: true },
    ],
    okLabel: ru ? 'Закрыть' : 'Close',
  });
}
