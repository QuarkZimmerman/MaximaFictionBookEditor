// Converted from 13_Подзаголовки, пустые строки/527_Разметка подзаголовков, чистка пустых строк, удаление жирности в заголовках по запросу.js (FictionBook Editor 2.7), Tier 2.
// Mark up subtitles, clean up empty lines; remove bold in titles on request. The four scripts of the group share the engine in subtitles-lib.js and differ
// only in the title-formatting flags below.
import { markupSubtitles } from './subtitles-lib.js';

export default async function run(ctx) {
  await markupSubtitles(ctx, { destrongTitles: false, deitalicTitles: false, promptDestrongTitles: true });
}
