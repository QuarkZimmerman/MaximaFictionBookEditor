// Converted from 10_Статистика/01_Показать все ссылки.js (FictionBook Editor).
// Lists the links of the book in a message box: first the internal ones (anything that is
// not http/https), then the external ones. An internal link whose target does not start
// with "#" is flagged with "[!!!]" like the original did.
import { collectLinks, formatLinkReport } from './links.js';

export default async function run(ctx) {
  const ru = ctx.uiLanguage === 'ru';
  const links = collectLinks(await mfbe.doc.get());
  if (links.length === 0) {
    await mfbe.ui.message(ru ? '\nВ этом документе нет ссылок. \n\n' : '\nThis document has no links.\n\n', { icon: 'info' });
    return;
  }
  const report = formatLinkReport(links, {
    internal: ru ? 'Внутренние ссылки:' : 'Internal links:',
    external: ru ? 'Внешние ссылки:' : 'External links:',
    arrow: '->',
    divider: '------------------------------------------------------------------- ',
  });
  await mfbe.ui.message(report, { caption: ctx.script.name, icon: 'info' });
}
