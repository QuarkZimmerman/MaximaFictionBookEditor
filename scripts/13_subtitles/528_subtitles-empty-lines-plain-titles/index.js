// Converted from 13_Подзаголовки, пустые строки/528_Разметка подзаголовков, чистка пустых строк, удаление жирности и курсива в заголовках.js (FictionBook Editor 2.7), Tier 2.
// Mark up subtitles, clean up empty lines, remove bold and italics in titles. The four scripts of the group share the engine in subtitles-lib.js and differ
// only in the title-formatting flags below.
import { markupSubtitles } from './subtitles-lib.js';

export default async function run(ctx) {
  await markupSubtitles(ctx, { destrongTitles: true, deitalicTitles: true, promptDestrongTitles: false });
}
