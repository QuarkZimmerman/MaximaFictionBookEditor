// Converted from FictionBook Editor 2.7.9: Scripts/13_Заголовки, подзаголовки, пустые строки/526_Разметка подзаголовков, чистка пустых строк, удаление жирности в заголовках.js
// (version 4.7; first converted from 2.7beta1's version 4.2, brought up to 2.7.9 in feature 007).
// "Mark up subtitles, clean up empty lines, remove bold in titles".
// The four scripts of the group share the engine in subtitles-lib.js (identical copies), which
// also lists the differences from the original, and differ only in the flags below.
// The original's notice, kept as written (FR-029):
// Разметка подзаголовков, чистка пустых строк
// Автор: Sclex
import { markupSubtitles } from './subtitles-lib.js';

export default async function run(ctx) {
  await markupSubtitles(ctx, { destrongTitles: true, deitalicTitles: false, promptDestrongTitles: false });
}
